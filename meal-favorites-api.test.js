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
    const directory = fs.mkdtempSync(path.join(temporaryRoot, 'meal-favorites-api-'));
    for (const name of fs.readdirSync(__dirname)) {
        if (/\.(?:js|json)$/.test(name) && !/\.test\.js$/.test(name)) {
            fs.copyFileSync(path.join(__dirname, name), path.join(directory, name));
        }
    }
    for (const name of ['recipes', 'data', 'compras']) fs.mkdirSync(path.join(directory, name));
    fs.writeFileSync(path.join(directory, 'compras', 'preferencias.md'), '# Preferencias de compra\n');
    const writeData = (name, value) => fs.writeFileSync(path.join(directory, 'data', name), JSON.stringify(value));
    fs.writeFileSync(path.join(directory, 'recipes', 'base-meal.md'),
        '---\ncategory: mains\n---\n\n# Tortilla familiar\n\n## Ingredientes\n\n- 4 huevos\n\n## Elaboración\n\n1. Cocina los ingredientes.\n');
    writeData('weekly-plan.json', { version: 1, period: 'next-week', selectedRecipes: ['base-meal'],
        selectedQuickMeals: [], requests: [], excludedIngredients: [], orderReady: false, updatedAt: null });
    writeData('simple-plates.json', [{ id: 'quick-pasta', title: 'Pasta rápida', ingredients: ['200 g pasta'] }]);
    for (const name of ['shopping.json', 'recurring-items.json', 'pantry-items.json', 'shopping-rules.json']) writeData(name, []);
    fs.writeFileSync(path.join(directory, 'data', 'meal-selections.jsonl'), JSON.stringify({
        type: 'recipe', id: 'base-meal', planningWeek: '2026-10-26',
        selectedAt: '2026-10-20T10:00:00.000Z', source: 'weekly-plan',
    }) + '\n');

    const serverFile = path.join(directory, 'server.js');
    const localRequire = createRequire(serverFile);
    let server;
    let listen;
    const isolatedHTTP = { ...http, createServer(...args) {
        server = http.createServer(...args);
        listen = server.listen.bind(server);
        server.listen = () => server;
        return server;
    } };
    vm.runInNewContext(fs.readFileSync(serverFile, 'utf8'), {
        require: name => name === 'http' ? isolatedHTTP
            : name === 'dotenv' ? { config() {} } : localRequire(name),
        __dirname: directory, __filename: serverFile, module: { exports: {} },
        process: { env: {} }, Buffer, URL, setTimeout, clearTimeout,
        setInterval() { throw new Error('Production monitor must not start in an API test'); },
        console: { log() {}, error() {} },
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
    return { request, dataDirectory: path.join(directory, 'data'),
        favoritesFile: path.join(directory, 'data', 'meal-favorites.json') };
}

test('manual recipe and quick stars persist without changing the plan, shopping, or popularity history', async t => {
    const { request, dataDirectory, favoritesFile } = await fixture(t);
    const unchangedFiles = ['weekly-plan.json', 'shopping.json', 'meal-selections.jsonl'];
    const before = unchangedFiles.map(name => fs.readFileSync(path.join(dataDirectory, name)));
    assert.deepEqual(await request('/api/meal-favorites'), { status: 200, data: [] });
    const recipeRoute = '/api/meal-favorites/recipe/base-meal';
    const quickRoute = '/api/meal-favorites/quick/quick-pasta';
    const starred = await request(recipeRoute, 'PUT', { favorite: true });
    assert.equal(starred.status, 200);
    assert.equal(starred.data[0].type, 'recipe');
    assert.equal(starred.data[0].id, 'base-meal');
    assert.ok(starred.data[0].starredAt);
    const saved = fs.readFileSync(favoritesFile);
    assert.deepEqual(await request(recipeRoute, 'PUT', { favorite: true }), starred);
    assert.deepEqual(fs.readFileSync(favoritesFile), saved);
    const both = await request(quickRoute, 'PUT', { favorite: true });
    assert.equal(both.status, 200);
    assert.deepEqual(both.data.map(item => [item.type, item.id]), [['quick', 'quick-pasta'], ['recipe', 'base-meal']]);
    assert.deepEqual((await request('/api/meal-favorites')).data, both.data);
    assert.deepEqual(JSON.parse(fs.readFileSync(favoritesFile, 'utf8')), both.data);
    const unstarred = await request(recipeRoute, 'PUT', { favorite: false });
    assert.equal(unstarred.status, 200);
    assert.deepEqual(unstarred.data, [both.data[0]]);
    assert.deepEqual(await request(recipeRoute, 'PUT', { favorite: false }), unstarred);
    assert.deepEqual((await request('/api/meal-favorites')).data, unstarred.data);
    assert.deepEqual(await request(quickRoute, 'PUT', { favorite: false }), { status: 200, data: [] });
    unchangedFiles.forEach((name, index) => assert.deepEqual(fs.readFileSync(path.join(dataDirectory, name)), before[index], name));
});

test('invalid flags and unknown meals do not create favorites, and malformed favorites remain intact', async t => {
    const { request, favoritesFile } = await fixture(t);
    assert.equal((await request('/api/meal-favorites/recipe/base-meal', 'PUT', { favorite: 'true' })).status, 400);
    assert.equal((await request('/api/meal-favorites/quick/quick-pasta', 'PUT', {})).status, 400);
    assert.equal((await request('/api/meal-favorites/recipe/missing', 'PUT', { favorite: true })).status, 404);
    assert.equal((await request('/api/meal-favorites/quick/missing', 'PUT', { favorite: true })).status, 404);
    assert.equal(fs.existsSync(favoritesFile), false);
    const malformed = '{malformed favorites';
    fs.writeFileSync(favoritesFile, malformed);
    assert.equal((await request('/api/meal-favorites')).status, 500);
    assert.equal((await request('/api/meal-favorites/recipe/base-meal', 'PUT', { favorite: true })).status, 500);
    assert.equal(fs.readFileSync(favoritesFile, 'utf8'), malformed);
});
