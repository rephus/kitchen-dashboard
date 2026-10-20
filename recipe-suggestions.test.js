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
    const service = createRecipeSuggestions({
        catalog: [suggestion, { ...suggestion, id: 'dessert', category: 'desserts' }], recipesDir: dir,
        listRecipes: () => [...recipes, ...fs.readdirSync(dir).map(file => ({ slug: file.slice(0, -3), title: suggestion.title }))],
        readRecipeFile: slug => ({ meta: meta.get(slug) || {} }),
        getRecipe: slug => ({ slug, title: suggestion.title, content: fs.existsSync(path.join(dir, `${slug}.md`))
            ? fs.readFileSync(path.join(dir, `${slug}.md`), 'utf8') : '' }),
        uniqueRecipeSlug: () => 'nuevo-plato', readWeeklyPlan: () => plan,
        saveWeeklyPlan: data => {
            if (options.failSave) throw new Error('Disk unavailable');
            plan = { ...plan, ...data };
            return plan;
        }, expandWeeklyPlan: value => value,
    });
    return { service, suggestion, dir, recipes, meta, setPlan: value => { plan = value; }, getPlan: () => plan };
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
