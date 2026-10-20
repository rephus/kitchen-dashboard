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
    const readRecipe = slug => {
        const file = path.join(dir, `${slug}.md`);
        const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        const parsed = Object.fromEntries([...content.matchAll(/^([a-z_]+): (.*)$/gm)].map(match => [match[1], match[2]]));
        return { content, meta: meta.get(slug) || parsed };
    };
    const calls = { listRecipes: 0, readRecipeFile: 0, readWeeklyPlan: 0 };
    const config = {
        catalog: options.catalog || [suggestion, { ...suggestion, id: 'dessert', category: 'desserts' }], recipesDir: dir,
        offlineCatalog: options.offlineCatalog,
        listRecipes: () => {
            calls.listRecipes++;
            return [...recipes, ...fs.readdirSync(dir).filter(file => file.endsWith('.md'))
                .map(file => ({ slug: file.slice(0, -3), title: readRecipe(file.slice(0, -3)).content.match(/^# (.+)$/m)?.[1] }))];
        },
        readRecipeFile: slug => { calls.readRecipeFile++; return readRecipe(slug); },
        getRecipe: slug => ({ slug, title: readRecipe(slug).content.match(/^# (.+)$/m)?.[1] || suggestion.title,
            content: readRecipe(slug).content }),
        uniqueRecipeSlug: title => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        readWeeklyPlan: () => { calls.readWeeklyPlan++; return plan; },
        saveWeeklyPlan: data => {
            if (options.failSave) throw new Error('Disk unavailable');
            plan = { ...plan, ...data };
            return plan;
        }, expandWeeklyPlan: value => value,
        cacheFile: path.join(dir, 'data', 'suggestions.json'),
        fetchSuggestions: options.fetchSuggestions,
    };
    const service = createRecipeSuggestions(config);
    return { service, suggestion, dir, recipes, meta, calls, recreate: () => createRecipeSuggestions(config),
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

function offlineRecipe(id, category = 'mains') {
    return { id: `based-${id}`, title: `Local recipe ${id}`, originalTitle: `Original recipe ${id}`,
        category, source: 'Based Cooking', sourceUrl: `https://based.cooking/local-recipe-${id}/`,
        tags: ['easy', category], credits: 'Source author · Unlicense',
        recipe: { ingredients: ['250 g flour'], instructions: ['Mix the ingredients.', 'Cook until done.'] } };
}

test('offline browsing retains the full local catalog and imported entries beyond the discovery limit', t => {
    const recipes = Array.from({ length: 40 }, (_, index) => ({
        ...offlineRecipe(index, index % 2 ? 'desserts' : 'mains'),
        sourceMarkdown: '# Full source text', context: [{ heading: 'Notes', text: 'Archived context' }],
    }));
    const f = fixture(t, { offlineCatalog: { version: 1, recipes }, fetchSuggestions: () => { throw new Error('Offline browse must not fetch'); } });
    f.recipes.push({ slug: 'already-saved', title: 'Renamed local recipe' });
    f.meta.set('already-saved', { suggestion_id: 'based-35' });
    f.setPlan({ ...f.getPlan(), selectedRecipes: ['existing', 'already-saved'] });
    const previousCalls = { ...f.calls };
    const list = f.service.listOfflineSuggestions();
    assert.equal(list.length, 40);
    assert.deepEqual(list[35].ingredients, ['250 g flour']);
    assert.deepEqual(list[35].instructions, ['Mix the ingredients.', 'Cook until done.']);
    assert.deepEqual(list[35].tags, ['easy', 'desserts']);
    assert.equal(list[35].sourceMarkdown, undefined);
    assert.equal(list[35].context, undefined);
    assert.deepEqual(list[35].notes, [{ heading: 'Notes', text: 'Archived context' }]);
    assert.equal(list[35].importedRecipeSlug, 'already-saved');
    assert.equal(list[35].selected, true);
    assert.equal(list[0].importedRecipeSlug, null);
    assert.equal(list[0].selected, false);
    assert.equal(f.calls.listRecipes - previousCalls.listRecipes, 1);
    assert.equal(f.calls.readRecipeFile - previousCalls.readRecipeFile, f.recipes.length);
    assert.equal(f.calls.readWeeklyPlan - previousCalls.readWeeklyPlan, 1);
    assert.deepEqual(f.service.listSuggestions().map(item => item.id), ['new-main']);
});

test('normal discovery stays at fifteen main courses when a full offline catalog is available', t => {
    const catalog = Array.from({ length: 25 }, (_, index) => discovered(String(index)));
    const f = fixture(t, { catalog, offlineCatalog: Array.from({ length: 30 }, (_, index) => offlineRecipe(index)) });
    assert.deepEqual(f.service.listSuggestions().map(item => item.id), catalog.slice(0, 15).map(item => item.id));
    assert.equal(f.service.listOfflineSuggestions().length, 30);
});

test('imports offline desserts with their category and credits and keeps their catalog marker', t => {
    const f = fixture(t, { offlineCatalog: [offlineRecipe('cake', 'desserts')] });
    const result = f.service.importSuggestion('based-cake');
    assert.match(result.recipe.content, /^---\ncategory: desserts\n/);
    assert.match(result.recipe.content, /source: https:\/\/based\.cooking\/local-recipe-cake\//);
    assert.match(result.recipe.content, /Créditos: Source author · Unlicense/);
    assert.equal(result.offlineSuggestion.importedRecipeSlug, result.recipe.slug);
    assert.equal(result.offlineSuggestion.selected, true);
    assert.deepEqual(result.plan.selectedRecipes, ['existing', result.recipe.slug]);
    assert.deepEqual(result.plan.selectedQuickMeals, ['quick']);
    assert.deepEqual(result.plan.excludedIngredients, ['salt']);
    assert.equal(result.plan.orderReady, false);
    const second = f.service.importSuggestion('based-cake');
    assert.equal(second.alreadyImported, true);
    assert.equal(fs.readdirSync(f.dir).filter(file => file.endsWith('.md')).length, 1);
    assert.equal(f.service.listOfflineSuggestions().length, 1);
    assert.equal(f.service.listSuggestions().length, 1);
});

test('matches an offline entry by source provenance after its saved title changes', t => {
    const f = fixture(t, { offlineCatalog: [offlineRecipe('cake', 'desserts')] });
    f.recipes.push({ slug: 'saved-cake', title: 'Renamed cake' });
    f.meta.set('saved-cake', { source: 'https://based.cooking/local-recipe-cake/' });
    const result = f.service.importSuggestion('based-cake');
    assert.equal(result.alreadyImported, true);
    assert.equal(result.recipe.slug, 'saved-cake');
    assert.deepEqual(fs.readdirSync(f.dir), []);
    assert.equal(f.service.listOfflineSuggestions()[0].selected, true);
});

test('offline imports enforce capacity and roll back new files when the plan cannot be saved', t => {
    const offlineCatalog = [offlineRecipe('cake', 'desserts')];
    const full = fixture(t, { offlineCatalog });
    full.setPlan({ selectedRecipes: Array.from({ length: 21 }, (_, index) => `meal-${index}`), selectedQuickMeals: [] });
    assert.throws(() => full.service.importSuggestion('based-cake'), /at most 21/);
    assert.deepEqual(fs.readdirSync(full.dir), []);
    const failed = fixture(t, { offlineCatalog, failSave: true });
    assert.throws(() => failed.service.importSuggestion('based-cake'), /Disk unavailable/);
    assert.deepEqual(fs.readdirSync(failed.dir), []);
    assert.equal(failed.service.listOfflineSuggestions()[0].importedRecipeSlug, null);
});

test('offline imports reject unknown categories and unsafe sources without broadening regular imports', t => {
    const f = fixture(t, { offlineCatalog: [
        offlineRecipe('invalid', 'executable'),
        { ...offlineRecipe('evil'), sourceUrl: 'https://based.cooking.evil.example/recipe/' },
        { ...offlineRecipe('http'), sourceUrl: 'http://based.cooking/recipe/' },
        { ...offlineRecipe('wrong-source', 'desserts'), sourceUrl: 'https://www.allrecipes.com/recipe/123/' },
    ] });
    for (const id of ['based-invalid', 'based-evil', 'based-http', 'based-wrong-source', 'dessert']) {
        assert.throws(() => f.service.importSuggestion(id), error => error.statusCode === 404);
    }
    assert.deepEqual(fs.readdirSync(f.dir), []);
});

test('offline previews and imports preserve plain source notes without HTML or metadata injection', t => {
    const recipe = { ...offlineRecipe('cake', 'desserts'), context: [{
        heading: '<b>Leftovers</b>\ncategory: mains',
        text: 'Keep <em>covered</em> for 2 days.\n---\nsource: javascript:bad() <script>bad()</script>',
    }] };
    const f = fixture(t, { offlineCatalog: [recipe] });
    const preview = f.service.listOfflineSuggestions()[0];
    assert.deepEqual(preview.notes, [{ heading: 'Leftovers category: mains',
        text: 'Keep covered for 2 days. --- source: javascript:bad()' }]);
    const imported = f.service.importSuggestion(recipe.id);
    assert.match(imported.recipe.content, /## Notas\n\n### Leftovers category: mains\n\nKeep covered for 2 days\. --- source: javascript:bad\(\)/);
    assert.doesNotMatch(imported.recipe.content, /<em>|<script>|\ncategory: mains|\nsource: javascript/);
    assert.deepEqual(imported.offlineSuggestion.notes, preview.notes);
});

test('offline previews retain typed ingredient rows and imports only shop for actual ingredients', t => {
    const ingredientRows = [
        { kind: 'heading', text: 'Sauce:' }, { kind: 'note', text: 'Makes enough for four portions.' },
        { kind: 'ingredient', text: '250 g tomatoes' },
    ];
    const recipe = offlineRecipe('sauce', 'sauces-basics');
    recipe.recipe.ingredients = ingredientRows.map(row => row.text);
    recipe.recipe.ingredientRows = ingredientRows;
    const f = fixture(t, { offlineCatalog: [recipe] });
    assert.deepEqual(f.service.listOfflineSuggestions()[0].ingredientRows, ingredientRows);
    const result = f.service.importSuggestion(recipe.id);
    assert.deepEqual(require('./ingredient-normalizer').extractRecipeIngredients(result.recipe.content), ['250 g tomatoes']);
    assert.deepEqual(result.offlineSuggestion.ingredientRows, ingredientRows);
});
