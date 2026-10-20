const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMealSelectionHistory } = require('./meal-selection-history');

function fixture(t, date = '2026-10-20T12:00:00Z') {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-selection-history-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filePath = path.join(directory, 'data', 'meal-selections.jsonl');
    let currentDate = date;
    return {
        filePath,
        history: createMealSelectionHistory({ filePath, now: () => currentDate }),
        setDate: value => { currentDate = value; },
    };
}

const emptyPlan = { selectedRecipes: [], selectedQuickMeals: [] };
const recipes = [{ slug: 'pasta', title: 'Pasta with tomatoes' }, { slug: 'soup', title: 'Lentil soup' }];

test('creates history only for additions, without backfilling existing selections', t => {
    const { history, filePath } = fixture(t);
    assert.deepEqual(history.getPopularity(), []);
    assert.deepEqual(history.recordSelections({ selectedRecipes: ['soup'] }, { selectedRecipes: ['soup'] }), []);
    assert.equal(fs.existsSync(filePath), false);
    const [event] = history.recordSelections({ selectedRecipes: ['soup'] }, { selectedRecipes: ['soup', 'pasta'] }, {
        recipes, source: 'recipe-suggestion',
    });
    assert.deepEqual(event, {
        type: 'recipe', id: 'pasta', title: 'Pasta with tomatoes', source: 'recipe-suggestion',
        selectedAt: '2026-10-20T12:00:00.000Z', planningWeek: '2026-10-26', period: 'next-week',
    });
    assert.equal(fs.readFileSync(filePath, 'utf8'), JSON.stringify(event) + '\n');
});

test('retries, reselecting, removals and restarts cannot inflate one planning week', t => {
    const { history, filePath } = fixture(t);
    const selected = { selectedRecipes: ['pasta', 'pasta'] };
    history.recordSelections(emptyPlan, selected, { recipes });
    assert.deepEqual(history.recordSelections(emptyPlan, selected, { recipes }), []);
    assert.deepEqual(history.recordSelections(selected, emptyPlan), []);
    assert.deepEqual(history.recordSelections(emptyPlan, selected, { recipes }), []);
    const restarted = createMealSelectionHistory({ filePath, now: () => '2026-10-22T09:00:00Z' });
    assert.deepEqual(restarted.recordSelections(emptyPlan, selected, { recipes }), []);
    assert.deepEqual(restarted.getPopularity(), [{
        type: 'recipe', id: 'pasta', title: 'Pasta with tomatoes', count: 1, lastSelectedAt: '2026-10-20T12:00:00.000Z',
    }]);
});

test('a new selection in the following planning week increases popularity', t => {
    const { history, setDate } = fixture(t);
    const selected = { selectedRecipes: ['pasta'] };
    history.recordSelections(emptyPlan, selected, { recipes });
    setDate('2026-10-26T11:00:00Z');
    assert.deepEqual(history.recordSelections(selected, selected, { recipes }), []);
    const [event] = history.recordSelections(emptyPlan, selected, { recipes });
    assert.equal(event.planningWeek, '2026-11-02');
    assert.equal(history.getPopularity()[0].count, 2);
    assert.equal(history.getPopularity()[0].lastSelectedAt, '2026-10-26T11:00:00.000Z');
});

test('recipe and quick meal IDs remain distinct, and favorites sort by count', t => {
    const { history, setDate } = fixture(t);
    const quickMeals = [{ id: 'pasta', title: 'Quick pasta' }];
    history.recordSelections(emptyPlan, { selectedRecipes: ['pasta', 'soup'], selectedQuickMeals: ['pasta'] }, { recipes, quickMeals });
    setDate('2026-10-27T12:00:00Z');
    history.recordSelections(emptyPlan, { selectedQuickMeals: ['pasta'] }, { quickMeals });
    const popularity = history.getPopularity();
    assert.equal(popularity.length, 3);
    assert.deepEqual(popularity[0], {
        type: 'quick', id: 'pasta', title: 'Quick pasta', count: 2, lastSelectedAt: '2026-10-27T12:00:00.000Z',
    });
    assert.equal(popularity.find(item => item.type === 'recipe' && item.id === 'pasta').count, 1);
});

test('planning weeks follow Europe/Madrid midnight across DST and year boundaries', t => {
    const { history, setDate } = fixture(t, '2026-10-25T22:59:59Z');
    assert.equal(history.recordSelections(emptyPlan, { selectedRecipes: ['before'] })[0].planningWeek, '2026-10-26');
    setDate('2026-10-25T23:00:00Z');
    assert.equal(history.recordSelections(emptyPlan, { selectedRecipes: ['after'] })[0].planningWeek, '2026-11-02');
    setDate('2026-12-31T20:00:00Z');
    assert.equal(history.recordSelections(emptyPlan, { selectedRecipes: ['year-end'] })[0].planningWeek, '2027-01-04');
});

test('a valid final line without newline is preserved before appending', t => {
    const { history, filePath } = fixture(t);
    history.recordSelections(emptyPlan, { selectedRecipes: ['pasta'] }, { recipes });
    const original = fs.readFileSync(filePath, 'utf8').trimEnd();
    fs.writeFileSync(filePath, original);
    history.recordSelections(emptyPlan, { selectedRecipes: ['soup'] }, { recipes });
    assert.ok(fs.readFileSync(filePath, 'utf8').startsWith(original + '\n'));
    assert.equal(history.getPopularity().length, 2);
});

test('malformed or incomplete history surfaces an error without truncation or append', t => {
    const { history, filePath } = fixture(t);
    history.recordSelections(emptyPlan, { selectedRecipes: ['pasta'] }, { recipes });
    for (const damagedLine of ['{"type":', '{}']) {
        const original = fs.readFileSync(filePath, 'utf8').split('\n')[0] + '\n' + damagedLine;
        fs.writeFileSync(filePath, original);
        assert.throws(() => history.getPopularity(), /Cannot read meal selection history at line 2/);
        assert.throws(() => history.recordSelections(emptyPlan, { selectedRecipes: ['soup'] }, { recipes }), /line 2/);
        assert.equal(fs.readFileSync(filePath, 'utf8'), original);
    }
});

test('unexpected filesystem read failures are surfaced', t => {
    const { filePath } = fixture(t);
    fs.mkdirSync(filePath, { recursive: true });
    const history = createMealSelectionHistory({ filePath });
    assert.throws(() => history.getPopularity(), { code: 'EISDIR' });
    assert.throws(() => history.recordSelections(emptyPlan, { selectedRecipes: ['pasta'] }), { code: 'EISDIR' });
});
