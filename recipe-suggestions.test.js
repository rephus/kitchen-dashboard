const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRecipeSuggestions } = require('./recipe-suggestions');

function fixture(t, options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-suggestions-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let plan = { selectedRecipes: ['existing'], selectedQuickMeals: ['quick'], excludedIngredients: ['salt'], orderReady: true };
    const suggestion = { id: 'new-main', title: 'Nuevo plato', originalTitle: 'New main', category: 'mains',
        source: 'Allrecipes', sourceUrl: 'https://www.allrecipes.com/recipe/123/new-main/',
        description: 'Un plato nuevo.', recipe: { name: 'New main', ingredients: ['200 g rice'], instructions: ['Cook the rice.'] } };
    const recipes = [{ slug: 'existing', title: 'Existing meal' }];
    const meta = new Map();
    const config = {
        catalog: [suggestion, { ...suggestion, id: 'dessert', category: 'desserts' }], recipesDir: dir,
        listRecipes: () => [...recipes, ...fs.readdirSync(dir).filter(file => file.endsWith('.md'))
            .map(file => ({ slug: file.slice(0, -3), title: suggestion.title }))],
        readRecipeFile: slug => ({ meta: meta.get(slug) || {} }),
        getRecipe: slug => ({ slug, title: suggestion.title, content: fs.existsSync(path.join(dir, `${slug}.md`))
            ? fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8') : '' }),
        uniqueRecipeSlug: () => 'nuevo-plato', readWeeklyPlan: () => plan,
        saveWeeklyPlan: data => {
            if (options.failSave) throw new Error('Disk unavailable');
            plan = { ...plan, ...data };
            return plan;
        }, expandWeeklyPlan: value => value,
        cacheFile: path.join(dir, 'data', 'suggestions.json'),
        fetchSuggestions: options.fetchSuggestions,
    };
    const service = createRecipeSuggestions(config);
    return { service, suggestion, dir, recipes, meta, recreate: () => createRecipeSuggestions(config),
        setPlan: value => { plan = value; }, getPlan: () => plan };
}

test('imports a complete main and selects it, preserving prior meals and exclusions', t => {
    const f = fixture(t);
    assert.equal(f.service.listSuggestions().length, 1);
    assert.equal(f.service.listSuggestions()[0].recipe, undefined);
    const result = f.service.importSuggestion('new-main');
    assert.deepEqual(result.plan.selectedRecipes, ['existing', 'nuevo-plato']);
    assert.deepEqual(result.plan.selectedQuickMeals, ['quick']);
    assert.deepEqual(result.plan.excludedIngredients, ['salt']);
    assert.equal(result.plan.orderReady, false);
    assert.match(result.recipe.content, /## Ingredientes/);
    assert.match(result.recipe.content, /## Elaboración/);
    assert.deepEqual(result.suggestions, []);
    assert.equal(f.service.importSuggestion('new-main').alreadyImported, true);
    assert.equal(fs.readdirSync(f.dir).length, 1);
    assert.deepEqual(f.getPlan().selectedRecipes, ['existing', 'nuevo-plato']);
});

test('reselects an imported recipe without creating a duplicate', t => {
    const f = fixture(t);
    f.recipes.push({ slug: 'previous-import', title: 'Renamed main' });
    f.meta.set('previous-import', { suggestion_id: 'new-main' });
    assert.equal(f.service.listSuggestions().length, 0);
    const result = f.service.importSuggestion('new-main');
    assert.equal(result.recipe.slug, 'previous-import');
    assert.deepEqual(result.plan.selectedRecipes, ['existing', 'previous-import']);
    assert.equal(fs.readdirSync(f.dir).length, 0);
});

test('rejects unknown suggestions and non-main courses without writing anything', t => {
    const f = fixture(t);
    for (const id of ['missing', 'dessert', '../../recipes/new']) {
        assert.throws(() => f.service.importSuggestion(id), error => error.statusCode === 404);
    }
    assert.deepEqual(fs.readdirSync(f.dir), []);
    assert.equal(f.getPlan().orderReady, true);
});

test('enforces plan capacity before writing a recipe', t => {
    const f = fixture(t);
    f.setPlan({ selectedRecipes: Array.from({ length: 20 }, (_, i) => `meal-${i}`), selectedQuickMeals: ['quick'] });
    assert.throws(() => f.service.importSuggestion('new-main'), /at most 21/);
    assert.deepEqual(fs.readdirSync(f.dir), []);
});

test('removes a new recipe when saving the plan fails, so import can be retried', t => {
    const f = fixture(t, { failSave: true });
    assert.throws(() => f.service.importSuggestion('new-main'), /Disk unavailable/);
    assert.deepEqual(fs.readdirSync(f.dir), []);
    assert.equal(f.getPlan().orderReady, true);
});

test('rejects incomplete cached recipes without changing the plan', t => {
    const f = fixture(t);
    f.suggestion.recipe.instructions = [];
    assert.throws(() => f.service.importSuggestion('new-main'), /instruction|step|method/i);
    assert.deepEqual(fs.readdirSync(f.dir), []);
    assert.deepEqual(f.getPlan().selectedRecipes, ['existing']);
});

function discovered(id = '123') {
    return { id: `mealdb-${id}`, title: `New recipe ${id}`, originalTitle: `New recipe ${id}`,
        category: 'mains', mealCategory: 'Chicken', source: 'TheMealDB',
        sourceUrl: `https://www.themealdb.com/meal.php?c=${id}`,
        recipe: { name: 'Source dish', ingredients: ['200 g chicken'], instructions: ['Cook the chicken.'] } };
}

test('shuffle persists new source recipes across restart without changing the menu', async t => {
    let request;
    const f = fixture(t, { fetchSuggestions: async options => { request = options; return [discovered()]; } });
    f.meta.set('existing', { suggestion_id: 'mealdb-999' });
    const previous = structuredClone(f.getPlan());
    const fresh = await f.service.shuffleSuggestions({ category: 'Chicken', excludeIds: ['visible-id'] });
    assert.equal(request.category, 'Chicken');
    assert.ok(request.excludeIds.includes('visible-id'));
    assert.ok(request.excludeIds.includes('new-main'));
    assert.ok(request.excludeIds.includes('mealdb-999'));
    assert.deepEqual(fresh.map(item => item.id), ['mealdb-123']);
    assert.equal(fresh[0].recipe, undefined);
    assert.deepEqual(f.getPlan(), previous);
    const restarted = f.recreate();
    assert.equal(restarted.listSuggestions()[0].id, 'mealdb-123');
    const imported = restarted.importSuggestion('mealdb-123');
    assert.match(imported.recipe.content, /200 g chicken/);
    assert.match(imported.recipe.content, /https:\/\/www.themealdb.com\/meal.php\?c=123/);
    assert.ok(imported.plan.selectedRecipes.includes(imported.recipe.slug));
});

test('shuffle excludes earlier discoveries and rejects duplicate, non-main and empty results', async t => {
    let iteration = 0;
    let exclusions;
    const f = fixture(t, { fetchSuggestions: async options => {
        exclusions = options.excludeIds;
        return iteration++ ? [discovered(), { ...discovered('124'), category: 'desserts' }]
            : [discovered(), discovered()];
    } });
    assert.equal((await f.service.shuffleSuggestions()).length, 1);
    await assert.rejects(f.service.shuffleSuggestions(), /No different main courses/);
    assert.ok(exclusions.includes('mealdb-123'));
    assert.equal(f.service.listSuggestions()[0].id, 'mealdb-123');
});

test('upstream failure preserves the current suggestions and saved cache', async t => {
    let fail = false;
    const f = fixture(t, { fetchSuggestions: async () => {
        if (fail) throw new Error('Source is unavailable');
        return [discovered()];
    } });
    await f.service.shuffleSuggestions();
    const before = fs.readFileSync(path.join(f.dir, 'data', 'suggestions.json'), 'utf8');
    fail = true;
    await assert.rejects(f.service.shuffleSuggestions(), /Source is unavailable/);
    assert.equal(fs.readFileSync(path.join(f.dir, 'data', 'suggestions.json'), 'utf8'), before);
    assert.equal(f.service.listSuggestions()[0].id, 'mealdb-123');
});

test('invalid exclusions and concurrent shuffle requests never start extra fetches', async t => {
    let complete;
    let calls = 0;
    const f = fixture(t, { fetchSuggestions: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
    await assert.rejects(f.service.shuffleSuggestions({ excludeIds: [null] }), /Invalid recipe exclusions/);
    assert.equal(calls, 0);
    const first = f.service.shuffleSuggestions();
    await assert.rejects(f.service.shuffleSuggestions(), error => error.statusCode === 429);
    complete([discovered()]);
    await first;
    assert.equal(calls, 1);
});
