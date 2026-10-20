const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createRequire } = require('node:module');

async function fixture(t) {
    const temporaryRoot = path.join(__dirname, 'tmp');
    fs.mkdirSync(temporaryRoot, { recursive: true });
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'meal-selection-api-'));
    for (const name of fs.readdirSync(__dirname)) {
        if (/\.(?:js|json)$/.test(name) && !/\.test\.js$/.test(name)) {
            fs.copyFileSync(path.join(__dirname, name), path.join(directory, name));
        }
    }
    for (const name of ['recipes', 'data', 'compras']) fs.mkdirSync(path.join(directory, name));
    fs.writeFileSync(path.join(directory, 'compras', 'preferencias.md'), '# Preferencias de compra\n');
    const writeData = (name, value) => fs.writeFileSync(path.join(directory, 'data', name), JSON.stringify(value));
    for (const [slug, title] of [['base-meal', 'Tortilla familiar'], ['extra-meal', 'Arroz con tomate']]) {
        fs.writeFileSync(path.join(directory, 'recipes', `${slug}.md`),
            `---\ncategory: mains\nlegacy_note: conservar\n---\n\n# ${title}\n\n## Ingredientes\n\n- 4 huevos\n- 2 tomates\n\n## Elaboración\n\n1. Cocina los ingredientes.\n`);
    }
    const initialPlan = { version: 1, period: 'next-week', selectedRecipes: ['base-meal'], selectedQuickMeals: [],
        requests: [], excludedIngredients: [], orderReady: false, updatedAt: null };
    writeData('weekly-plan.json', initialPlan);
    writeData('simple-plates.json', [{ id: 'quick-pasta', title: 'Pasta rápida', ingredients: ['200 g pasta'] }]);
    for (const name of ['shopping.json', 'recurring-items.json', 'pantry-items.json', 'shopping-rules.json']) writeData(name, []);

    const serverFile = path.join(directory, 'server.js');
    const localRequire = createRequire(serverFile);
    const errors = [];
    let server;
    let listen;
    const isolatedHTTP = { ...http, createServer(...args) {
        server = http.createServer(...args);
        listen = server.listen.bind(server);
        server.listen = () => server; // Suppress production startup and its monitors.
        return server;
    } };
    vm.runInNewContext(fs.readFileSync(serverFile, 'utf8'), {
        require: name => name === 'http' ? isolatedHTTP
            : name === 'dotenv' ? { config() {} } : localRequire(name),
        __dirname: directory, __filename: serverFile, module: { exports: {} },
        process: { env: {} }, Buffer, URL, setTimeout, clearTimeout,
        setInterval() { throw new Error('Production monitor must not start in an API test'); },
        console: { log() {}, error: (...args) => errors.push(args.join(' ')) },
    }, { filename: serverFile });
    t.after(async () => {
        if (server) {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
        fs.rmSync(directory, { recursive: true, force: true });
    });
    server.listen = listen;
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        listen(0, '127.0.0.1', resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (route, method = 'GET', body) => {
        const response = await fetch(origin + route, { method,
            headers: { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(5000) });
        return { status: response.status, data: await response.json() };
    };
    const historyFile = path.join(directory, 'data', 'meal-selections.jsonl');
    const events = () => fs.existsSync(historyFile)
        ? fs.readFileSync(historyFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
    return { directory, initialPlan, request, historyFile, events, errors };
}

test('planner selections persist popularity for recipes and quick meals without backfilling or retry inflation', async t => {
    const { request, events, initialPlan } = await fixture(t);
    assert.deepEqual((await request('/api/meal-popularity')).data, []);
    assert.equal((await request('/api/weekly-plan', 'PUT', initialPlan)).status, 200);
    assert.equal(events().length, 0);
    const selected = { ...initialPlan, selectedRecipes: ['base-meal', 'extra-meal'], selectedQuickMeals: ['quick-pasta'] };
    assert.equal((await request('/api/weekly-plan', 'PUT', selected)).status, 200);
    assert.deepEqual(events().map(event => [event.type, event.id]), [['recipe', 'extra-meal'], ['quick', 'quick-pasta']]);
    assert.ok(events().every(event => event.source && event.selectedAt && /^\d{4}-\d{2}-\d{2}$/.test(event.planningWeek)));
    await request('/api/weekly-plan', 'PUT', selected);
    await request('/api/weekly-plan', 'PUT', initialPlan);
    await request('/api/weekly-plan', 'PUT', selected);
    assert.equal(events().length, 2);
    const popularity = await request('/api/meal-popularity');
    assert.equal(popularity.status, 200);
    assert.equal(popularity.data.length, 2);
    assert.ok(popularity.data.every(meal => meal.count === 1 && meal.lastSelectedAt));
    assert.ok(popularity.data.some(meal => meal.type === 'quick' && meal.title === 'Pasta rápida'));
    assert.ok(popularity.data.some(meal => meal.type === 'recipe' && meal.title === 'Arroz con tomate'));
    assert.deepEqual((await request('/api/weekly-plan')).data.selectedRecipes, selected.selectedRecipes);
});

test('importing a suggested main records one selection and preserves provenance through retries and edits', async t => {
    const { directory, request, events, initialPlan } = await fixture(t);
    const suggestions = await request('/api/recipe-suggestions');
    assert.equal(suggestions.status, 200);
    const suggestion = suggestions.data[0];
    const source = JSON.parse(fs.readFileSync(path.join(directory, 'recipe-suggestion-catalog.json'), 'utf8'))
        .find(recipe => recipe.id === suggestion.id);
    const route = `/api/recipe-suggestions/${suggestion.id}/import`;
    const imported = await request(route, 'POST');
    assert.equal(imported.status, 200);
    const { recipe, plan } = imported.data;
    assert.equal(recipe.category, 'mains');
    assert.equal(recipe.sourceUrl, suggestion.sourceUrl);
    assert.ok(recipe.content.includes('## Ingredientes'));
    assert.ok(recipe.content.includes(source.recipe.ingredients[0]));
    assert.deepEqual(plan.selectedRecipes, ['base-meal', recipe.slug]);
    assert.ok(plan.shoppingItems.some(item => item.mealIds.includes(recipe.slug)));
    assert.equal(events().length, 1);
    assert.equal(events()[0].id, recipe.slug);
    const originalFiles = fs.readdirSync(path.join(directory, 'recipes'));
    assert.equal((await request(route, 'POST')).status, 200);
    await request('/api/weekly-plan', 'PUT', initialPlan);
    assert.equal((await request(route, 'POST')).status, 200);
    assert.deepEqual(fs.readdirSync(path.join(directory, 'recipes')), originalFiles);
    assert.equal(events().length, 1);
    const popularity = (await request('/api/meal-popularity')).data;
    assert.deepEqual(popularity.map(meal => [meal.id, meal.count]), [[recipe.slug, 1]]);
    const edited = await request(`/api/recipes/${recipe.slug}`, 'PUT', { title: `${recipe.title} casero` });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.sourceUrl, suggestion.sourceUrl);
    assert.ok(!(await request('/api/recipe-suggestions')).data.some(item => item.id === suggestion.id));
});

test('the complete offline catalog can be browsed and imported with its original course and quantities', async t => {
    const { directory, request, initialPlan, events } = await fixture(t);
    const source = require('./based-cooking-catalog.json');
    const catalog = await request('/api/recipe-suggestions/based-cooking');
    assert.equal(catalog.status, 200);
    assert.equal(catalog.data.recipes.length, source.recipes.length);
    assert.ok(catalog.data.recipes.length > 400);
    assert.equal(catalog.data.snapshot.commit, source.snapshot.commit);
    assert.deepEqual((await request('/api/weekly-plan')).data.selectedRecipes, initialPlan.selectedRecipes);
    assert.equal(events().length, 0);
    const candidate = source.recipes.find((recipe, index) => index > 15 && recipe.category === 'desserts');
    assert.ok(candidate);
    const preview = catalog.data.recipes.find(recipe => recipe.id === candidate.id);
    assert.deepEqual(preview.ingredients, candidate.recipe.ingredients);
    assert.deepEqual(preview.instructions, candidate.recipe.instructions);
    assert.equal(preview.importedRecipeSlug, null);
    const route = `/api/recipe-suggestions/${candidate.id}/import`;
    const imported = await request(route, 'POST');
    assert.equal(imported.status, 200);
    assert.equal(imported.data.recipe.category, 'desserts');
    assert.equal(imported.data.recipe.sourceUrl, candidate.sourceUrl);
    assert.ok(imported.data.plan.selectedRecipes.includes(imported.data.recipe.slug));
    assert.equal(imported.data.plan.orderReady, false);
    assert.equal(imported.data.offlineSuggestion.importedRecipeSlug, imported.data.recipe.slug);
    assert.equal(imported.data.offlineSuggestion.selected, true);
    assert.equal((await request(route, 'POST')).data.alreadyImported, true);
    assert.equal(events().length, 1);
    const refreshed = (await request('/api/recipe-suggestions/based-cooking')).data.recipes;
    assert.equal(refreshed.length, source.recipes.length);
    assert.equal(refreshed.find(recipe => recipe.id === candidate.id).selected, true);
    assert.equal(fs.readdirSync(path.join(directory, 'recipes')).length, 3);
});

test('unreadable history warns while saving a selection and keeps legacy recipe metadata edits compatible', async t => {
    const { directory, request, historyFile, initialPlan, errors } = await fixture(t);
    fs.mkdirSync(historyFile);
    const selected = { ...initialPlan, selectedRecipes: ['base-meal', 'extra-meal'] };
    const saved = await request('/api/weekly-plan', 'PUT', selected);
    assert.equal(saved.status, 200);
    assert.ok(saved.data.selectionHistoryWarning);
    assert.deepEqual((await request('/api/weekly-plan')).data.selectedRecipes, selected.selectedRecipes);
    assert.equal((await request('/api/meal-popularity')).status, 500);
    assert.ok(fs.statSync(historyFile).isDirectory());
    assert.ok(errors.some(message => /history.*EISDIR/i.test(message)));
    const edited = await request('/api/recipes/base-meal', 'PUT', { title: 'Tortilla de la casa', altName: 'Tortilla', category: 'starters' });
    assert.equal(edited.status, 200);
    assert.equal(edited.data.title, 'Tortilla de la casa');
    assert.equal(edited.data.altName, 'Tortilla');
    assert.equal(edited.data.category, 'starters');
    assert.equal(edited.data.sourceUrl, null);
    assert.ok(fs.readFileSync(path.join(directory, 'recipes', 'base-meal.md'), 'utf8').includes('legacy_note: conservar'));
});
