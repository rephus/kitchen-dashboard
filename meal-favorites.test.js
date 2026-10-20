const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createMealFavorites } = require('./meal-favorites');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meal-favorites-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return path.join(directory, 'favorites.json');
}

test('favorites persist across restarts, with newest stars first and stable retries', (t) => {
    const filePath = fixture(t);
    let timestamp = '2026-10-20T10:00:00.000Z';
    const store = createMealFavorites({ filePath, now: () => timestamp });
    assert.deepEqual(store.read(), []);
    store.set('recipe', 'arroz', true);
    timestamp = '2026-10-20T11:00:00.000Z';
    store.set('recipe', 'berenjena', true);
    const result = store.set('recipe', 'arroz', true);
    assert.deepEqual(result, [
        { type: 'recipe', id: 'berenjena', starredAt: timestamp },
        { type: 'recipe', id: 'arroz', starredAt: '2026-10-20T10:00:00.000Z' },
    ]);
    assert.deepEqual(createMealFavorites({ filePath }).read(), result);
});

test('recipe and quick IDs are independent, and unstar retries preserve other meals', (t) => {
    const filePath = fixture(t);
    const store = createMealFavorites({ filePath });
    store.set('recipe', 'same-id', true);
    store.set('quick', 'same-id', true);
    const remaining = store.set('recipe', 'same-id', false);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].type, 'quick');
    assert.deepEqual(store.set('recipe', 'same-id', false), remaining);
    assert.deepEqual(store.read(), remaining);
});

test('invalid inputs never mutate persisted favorites', (t) => {
    const filePath = fixture(t);
    const store = createMealFavorites({ filePath });
    store.set('recipe', 'valid', true);
    const original = fs.readFileSync(filePath, 'utf8');
    for (const args of [
        ['other', 'valid', true], ['recipe', '', true], ['recipe', '../id', true],
        ['quick', 42, true], ['recipe', 'id\n', true],
        ['recipe', 'a'.repeat(121), true], ['recipe', 'valid', 'false'],
    ]) assert.throws(() => store.set(...args), TypeError);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('malformed and unreadable files are preserved and prevent writes', (t) => {
    const filePath = fixture(t);
    const store = createMealFavorites({ filePath });
    for (const invalid of ['{broken json', '{}', '[{"type":"recipe","id":"bad"}]']) {
        fs.writeFileSync(filePath, invalid);
        assert.throws(() => store.read());
        assert.throws(() => store.set('recipe', 'new', true));
        assert.equal(fs.readFileSync(filePath, 'utf8'), invalid);
    }
    fs.unlinkSync(filePath);
    fs.mkdirSync(filePath);
    assert.throws(() => store.read());
    assert.throws(() => store.set('recipe', 'new', true));
    assert.equal(fs.statSync(filePath).isDirectory(), true);
    assert.deepEqual(fs.readdirSync(path.dirname(filePath)), ['favorites.json']);
});
