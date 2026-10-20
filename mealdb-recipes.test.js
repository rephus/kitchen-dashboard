'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMealDbProvider, MAIN_CATEGORIES } = require('./mealdb-recipes');

function meal(id, overrides = {}) {
    return { idMeal: String(id), strMeal: `Meal ${id}`, strCategory: 'Chicken', strArea: 'British',
        strInstructions: 'Heat the pan.\r\n\r\nAdd chicken and simmer for 12 minutes.',
        strIngredient1: 'Chicken breast', strMeasure1: '250 g', strIngredient2: 'Olive oil', strMeasure2: '1 ½ tbsp',
        strMealThumb: 'https://www.themealdb.com/images/media/meals/example.jpg',
        strSource: 'https://example.com/recipe', ...overrides };
}

function response(meals, options) {
    return new Response(JSON.stringify({ meals }), { headers: { 'Content-Type': 'application/json' }, ...options });
}

function fixture({ ids = ['1', '2', '3'], meals = new Map(), handle, random = () => 0.999 } = {}) {
    const calls = [];
    let active = 0;
    let maximum = 0;
    const provider = createMealDbProvider({ random, fetchImpl: async (input, options) => {
        const url = new URL(input);
        calls.push({ url, options });
        active++;
        maximum = Math.max(maximum, active);
        try {
            await new Promise(resolve => setImmediate(resolve));
            const custom = handle && await handle(url, calls);
            if (custom) return custom;
            if (url.pathname.endsWith('/list.php')) return response([
                { strArea: 'British', strCountry: 'United Kingdom' },
                { strArea: 'Spanish', strCountry: 'Spain' },
                { strArea: 'French', strCountry: 'France' },
                { strArea: 'Canadian', strCountry: 'Canada' },
            ]);
            if (url.pathname.endsWith('/filter.php')) return response(ids.map(id => ({ idMeal: id })));
            const id = url.searchParams.get('i');
            return response([meals.has(id) ? meals.get(id) : meal(id)]);
        } finally { active--; }
    } });
    return { provider, calls, getMaximum: () => maximum };
}

test('uses documented free V1 category and lookup endpoints and preserves the source recipe', async () => {
    const f = fixture();
    const result = await f.provider.fetchSuggestions({ category: 'Chicken', count: 1 });
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].recipe.ingredients, ['250 g Chicken breast', '1 ½ tbsp Olive oil']);
    assert.deepEqual(result[0].recipe.instructions, ['Heat the pan.', 'Add chicken and simmer for 12 minutes.']);
    assert.equal(result[0].source, 'TheMealDB');
    assert.equal(result[0].sourceUrl, 'https://www.themealdb.com/meal.php?c=1');
    assert.equal(result[0].originalSourceUrl, 'https://example.com/recipe');
    assert.equal(result[0].mealCategory, 'Chicken');
    assert.equal(result[0].category, 'mains');
    assert.equal(result[0].cuisine, 'British');
    assert.equal(result[0].totalMinutes, null);
    assert.equal(result[0].servings, null);
    assert.equal(result[0].recipe.servings, '');
    assert.equal(result[0].recipe.totalTime, '');
    assert.match(result[0].description, /British.*Chicken.*Chicken breast, Olive oil/);
    assert.equal(f.calls[0].url.search, '?c=Chicken');
    for (const { url, options } of f.calls) {
        assert.equal(url.origin, 'https://www.themealdb.com');
        assert.match(url.pathname, /^\/api\/json\/v1\/1\/(?:filter|lookup)\.php$/);
        assert.equal(options.redirect, 'error');
        assert.equal(options.headers.Accept, 'application/json');
        assert.ok(options.signal instanceof AbortSignal);
    }
});

test('default category samples only allowed mains, deduplicates IDs, and caps concurrency at four', async () => {
    const f = fixture({ ids: Array.from({ length: 20 }, (_, i) => String(i + 1)) });
    const result = await f.provider.fetchSuggestions();
    const categories = f.calls.filter(call => call.url.pathname.endsWith('/filter.php')).map(call => call.url.searchParams.get('c'));
    assert.deepEqual(categories, [...MAIN_CATEGORIES]);
    assert.equal(result.length, 15);
    assert.equal(new Set(result.map(value => value.id)).size, 15);
    assert.equal(f.getMaximum(), 4);
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/lookup.php')).length, 15);
});

test('caches category lists but fetches new full recipes, excludes raw and suggestion IDs before lookup', async () => {
    const f = fixture();
    const first = await f.provider.fetchSuggestions({ category: 'Chicken', count: 1 });
    const next = await f.provider.fetchSuggestions({ category: 'Chicken', excludeIds: [first[0].id, '2'], count: 1 });
    assert.equal(first[0].id, 'mealdb-1');
    assert.equal(next[0].id, 'mealdb-3');
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/filter.php')).length, 1);
    assert.deepEqual(f.calls.filter(call => call.url.pathname.endsWith('/lookup.php')).map(call => call.url.searchParams.get('i')), ['1', '3']);
    assert.deepEqual(await f.provider.fetchSuggestions({ category: 'Chicken', excludeIds: ['1', '2', '3'], count: 1 }), []);
});

test('refreshes expired category lists after one hour', async () => {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
        const f = fixture();
        await f.provider.fetchSuggestions({ category: 'Chicken', count: 1 });
        now += 60 * 60 * 1000 + 1;
        await f.provider.fetchSuggestions({ category: 'Chicken', count: 1 });
        assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/filter.php')).length, 2);
    } finally { Date.now = originalNow; }
});

test('retries transient failures once and returns complete replacements after a failed lookup', async () => {
    const tries = new Map();
    const f = fixture({ handle: url => {
        const key = url.href;
        const attempt = (tries.get(key) || 0) + 1;
        tries.set(key, attempt);
        if (url.pathname.endsWith('/filter.php') && attempt === 1) return response(null, { status: 503 });
        if (url.searchParams.get('i') === '1') return response(null, { status: 429 });
        return undefined;
    } });
    const result = await f.provider.fetchSuggestions({ category: 'Chicken', count: 2 });
    assert.deepEqual(result.map(value => value.id), ['mealdb-2', 'mealdb-3']);
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/filter.php')).length, 2);
    assert.equal(f.calls.filter(call => call.url.searchParams.get('i') === '1').length, 2);
});

test('handles network retries and partial category failure without switching to paid or scraping endpoints', async () => {
    let chickenTries = 0;
    const f = fixture({ handle: url => {
        if (url.searchParams.get('c') === 'Chicken' && chickenTries++ === 0) throw new TypeError('Network unavailable');
        if (url.searchParams.get('c') === 'Beef') return response(null, { status: 404 });
        return undefined;
    } });
    assert.equal((await f.provider.fetchSuggestions({ count: 2 })).length, 2);
    assert.equal(chickenTries, 2);
    assert.equal(f.calls.filter(call => call.url.searchParams.get('c') === 'Beef').length, 1);
    assert.ok(f.calls.every(call => /\/api\/json\/v1\/1\/(?:filter|lookup)\.php$/.test(call.url.pathname)));
});

test('skips incomplete recipes, mismatched IDs and categories, and explicit non-main tags', async () => {
    const invalid = [
        { strMeal: '' }, { strIngredient1: '', strIngredient2: '' }, { strInstructions: '' },
        { strCategory: 'Dessert' }, { strTags: 'Summer,Side' }, { strTags: 'Starter' },
        { strTags: 'Breakfast,Vegetarian' }, { strCategory: 'Pork' }, { idMeal: '999' },
        { strInstructions: '<script>alert(1)</script>' },
    ];
    const ids = invalid.map((_, i) => String(i + 1));
    ids.push('11');
    const meals = new Map(invalid.map((overrides, i) => [String(i + 1), meal(i + 1, overrides)]));
    const f = fixture({ ids, meals });
    const result = await f.provider.fetchSuggestions({ category: 'Chicken', count: 4 });
    assert.deepEqual(result.map(value => value.id), ['mealdb-11']);
});

test('strips raw and encoded markup while retaining measurements, method, and safe images only', async () => {
    const f = fixture({ meals: new Map([['1', meal(1, {
        strMeal: '<b>Chicken &amp; rice</b>', strIngredient1: '&lt;b&gt;Chicken&lt;/b&gt;', strMeasure1: '1/2 kg',
        strInstructions: '<p>Stir &amp; simmer.</p><p>Serve at 70&#176;C.</p>',
        strMealThumb: 'https://www.themealdb.com.evil.example/image.jpg', strSource: 'javascript:alert(1)',
    })]]) });
    const [result] = await f.provider.fetchSuggestions({ category: 'Chicken', count: 1 });
    assert.equal(result.title, 'Chicken & rice');
    assert.equal(result.recipe.ingredients[0], '1/2 kg Chicken');
    assert.deepEqual(result.recipe.instructions, ['Stir & simmer.', 'Serve at 70°C.']);
    assert.equal(result.imageUrl, '');
    assert.equal(result.recipe.imageUrl, '');
    assert.equal(result.originalSourceUrl, undefined);
});

test('rejects unsupported filters and counts before any network requests', async () => {
    const f = fixture();
    for (const category of ['Dessert', 'Breakfast', 'Miscellaneous', 'chicken', '../Chicken', null]) {
        await assert.rejects(f.provider.fetchSuggestions({ category }), error => error.statusCode === 400);
    }
    for (const count of [0, 21, 1.5, '15']) await assert.rejects(f.provider.fetchSuggestions({ count }), /between 1 and 20/);
    assert.equal(f.calls.length, 0);
});

test('malformed, non-JSON, or oversized upstream data cannot become suggestions', async () => {
    const cases = [
        () => new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
        () => new Response(JSON.stringify({ data: [] }), { headers: { 'Content-Type': 'application/json' } }),
        () => new Response(JSON.stringify({ meals: {} }), { headers: { 'Content-Type': 'application/json' } }),
        () => new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } }),
        () => new Response('x', { headers: { 'Content-Length': '2097153' } }),
        () => new Response(' '.repeat(2097153), { headers: { 'Content-Type': 'application/json' } }),
    ];
    for (const createResponse of cases) {
        let calls = 0;
        const provider = createMealDbProvider({ fetchImpl: async () => { calls++; return createResponse(); } });
        await assert.rejects(provider.fetchSuggestions({ category: 'Chicken', count: 1 }), /temporarily unavailable/);
        assert.equal(calls, 1);
    }
});

test('all upstream failures are bounded and reported as unavailable', async () => {
    let calls = 0;
    const provider = createMealDbProvider({ fetchImpl: async () => { calls++; return response(null, { status: 503 }); } });
    await assert.rejects(provider.fetchSuggestions({ category: 'Chicken' }), /temporarily unavailable/);
    assert.equal(calls, 2);
});

test('caps replacement lookups when every source recipe is incomplete', async () => {
    const ids = Array.from({ length: 50 }, (_, i) => String(i + 1));
    const f = fixture({ ids, handle: url => url.pathname.endsWith('/lookup.php')
        ? response([meal(url.searchParams.get('i'), { strInstructions: '' })]) : undefined });
    assert.deepEqual(await f.provider.fetchSuggestions({ category: 'Chicken', count: 2 }), []);
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/lookup.php')).length, 6);
});

async function withVirtualTimeouts(run) {
    const realNow = Date.now;
    const realSetTimeout = global.setTimeout;
    const realClearTimeout = global.clearTimeout;
    let now = 1000000;
    let nextId = 1;
    const timers = new Map();
    const durations = [];
    Date.now = () => now;
    global.setTimeout = (callback, duration) => {
        const id = nextId++;
        durations.push(duration);
        timers.set(id, { at: now + duration, callback });
        return id;
    };
    global.clearTimeout = id => timers.delete(id);
    let settled = false;
    let outcome;
    let failure;
    const promise = run({ durations, elapsed: () => now - 1000000 }).then(value => {
        settled = true;
        outcome = value;
    }, error => {
        settled = true;
        failure = error;
    });
    try {
        for (let iteration = 0; !settled && iteration < 100; iteration++) {
            // Let all pending request and worker continuations run before the
            // next virtual deadline. No network or wall-clock sleeps are used.
            await new Promise(resolve => setImmediate(resolve));
            if (timers.size) {
                now = Math.min(...[...timers.values()].map(timer => timer.at));
                const due = [...timers.entries()].filter(([, timer]) => timer.at <= now);
                for (const [id, timer] of due) {
                    timers.delete(id);
                    timer.callback();
                }
            }
        }
        assert.equal(settled, true, 'provider must settle within the bounded request budget');
        await promise;
        if (failure) throw failure;
        return outcome;
    } finally {
        Date.now = realNow;
        global.setTimeout = realSetTimeout;
        global.clearTimeout = realClearTimeout;
    }
}

test('aborts hung requests after eight seconds and stops at the total 25 second deadline', async () => {
    await withVirtualTimeouts(async ({ durations, elapsed }) => {
        const signals = [];
        const provider = createMealDbProvider({ fetchImpl: (url, options) => {
            signals.push(options.signal);
            return new Promise(() => {});
        } });
        await assert.rejects(provider.fetchSuggestions(), /temporarily unavailable/);
        assert.ok(signals.length <= MAIN_CATEGORIES.length * 2);
        assert.ok(signals.every(signal => signal.aborted));
        assert.ok(durations.every(value => value > 0 && value <= 8000));
        assert.equal(elapsed(), 25000);
    });
});

test('includes a stalled response body in the request timeout', async () => {
    await withVirtualTimeouts(async ({ elapsed }) => {
        let calls = 0;
        const provider = createMealDbProvider({ fetchImpl: async () => {
            calls++;
            return new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'application/json' } });
        } });
        await assert.rejects(provider.fetchSuggestions({ category: 'Chicken', count: 1 }), /temporarily unavailable/);
        assert.equal(calls, 2);
        assert.equal(elapsed(), 16000);
    });
});

test('omits untagged starters and condiments even when the upstream category is a protein or vegetarian', async () => {
    const nonMains = ['Chicken Liver Pate Recipe', 'Chicken Liver Pâté', 'Hummus', 'Houmous', 'Guacamole',
        'Spicy tuna dip', 'Homemade tomato sauce', 'Pasta sauce', 'Basil pesto', 'Fresh salsa', 'Mango chutney',
        'Chicken gravy', 'Salad dressing'];
    const ids = nonMains.map((_, index) => String(index + 1));
    const f = fixture({ ids, meals: new Map(nonMains.map((title, index) => [String(index + 1), meal(index + 1, { strMeal: title, strTags: null })])) });
    assert.deepEqual(await f.provider.fetchSuggestions({ category: 'Chicken', count: 5 }), []);
});

test('preserves clear mains that include sauces or dips, plus hearty soups and salads', async () => {
    const mains = ['Chicken in tomato sauce', 'Chicken with peanut sauce', 'Hummus chicken bowl',
        'Pasta with pesto', 'Chicken wings with guacamole', 'Hearty chicken soup', 'Chicken and rice salad',
        'Dijon mustard chicken casserole', 'Pesto pasta'];
    const ids = mains.map((_, index) => String(index + 1));
    const f = fixture({ ids, meals: new Map(mains.map((title, index) => [String(index + 1), meal(index + 1, { strMeal: title })])) });
    const result = await f.provider.fetchSuggestions({ category: 'Chicken', count: mains.length });
    assert.deepEqual(result.map(recipe => recipe.title), mains);
});

test('lists cached official country labels, merges repeated areas, and supports safe source punctuation and legacy responses', async () => {
    const f = fixture({ handle: url => url.pathname.endsWith('/list.php') ? response([
        { strArea: 'Dominican', strCountry: 'Dominican Republic' },
        { strArea: 'Spanish', strCountry: 'Spain' },
        { strArea: 'Dominican', strCountry: 'Dominica' },
        { strArea: 'Dominican', strCountry: 'Dominica' },
        { strArea: 'Antiguan, Barbudan', strCountry: 'Antigua and Barbuda' },
        { strArea: 'Ivorian', strCountry: "Côte d'Ivoire" },
        { strArea: 'British' },
        { strArea: '<script>Bad</script>', strCountry: 'Unsafe' },
        { strArea: 'Injected\nArea', strCountry: 'Unsafe' },
        { strArea: 'Unknown', strCountry: 'Unknown' },
        { strArea: 'Broken', strCountry: 7 },
        null,
    ]) : undefined });
    const first = await f.provider.listAreas();
    assert.deepEqual(first, [
        { area: 'Antiguan, Barbudan', country: 'Antigua and Barbuda' },
        { area: 'British', country: 'British' },
        { area: 'Ivorian', country: "Côte d'Ivoire" },
        { area: 'Dominican', country: 'Dominica / Dominican Republic' },
        { area: 'Spanish', country: 'Spain' },
    ]);
    first[0].country = 'Changed by a caller';
    const second = await f.provider.listAreas();
    assert.equal(second[0].country, 'Antigua and Barbuda');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url.pathname, '/api/json/v1/1/list.php');
    assert.equal(f.calls[0].url.search, '?a=list');
});

test('country filtering keeps only matching complete main courses while preserving source provenance', async () => {
    const invalid = [
        { strArea: 'British' }, { strCategory: 'Dessert' }, { strCategory: 'Starter' },
        { strTags: 'Side' }, { strMeal: 'Guacamole' }, { strInstructions: '' },
    ];
    const ids = invalid.map((_, index) => String(index + 1)).concat(['7', '8']);
    const meals = new Map(ids.map(id => [id, meal(id, { strArea: 'Spanish', ...(invalid[Number(id) - 1] || {}) })]));
    const f = fixture({ ids, meals });
    const result = await f.provider.fetchSuggestions({ area: 'Spanish', count: 3 });
    assert.deepEqual(result.map(recipe => recipe.id), ['mealdb-7', 'mealdb-8']);
    assert.ok(result.every(recipe => recipe.cuisine === 'Spanish' && recipe.area === 'Spanish' && recipe.country === 'Spain' && recipe.category === 'mains'));
    const filters = f.calls.filter(call => call.url.pathname.endsWith('/filter.php'));
    assert.equal(filters.length, 1);
    assert.equal(filters[0].url.search, '?a=Spanish');
    assert.ok(f.calls.every(call => !call.url.searchParams.has('c')));
});

test('country and existing category filters work together and exclude previous IDs before lookup', async () => {
    const f = fixture({ ids: ['1', '2', '3', '4'], meals: new Map([
        ['1', meal('1', { strArea: 'Spanish' })],
        ['2', meal('2', { strArea: 'Spanish' })],
        ['3', meal('3', { strArea: 'Spanish', strCategory: 'Pork' })],
        ['4', meal('4', { strArea: 'Spanish' })],
    ]) });
    const first = await f.provider.fetchSuggestions({ area: 'Spanish', category: 'Chicken', excludeIds: ['mealdb-1', '2'], count: 1 });
    assert.deepEqual(first.map(recipe => recipe.id), ['mealdb-4']);
    const second = await f.provider.fetchSuggestions({ area: 'Spanish', category: 'Chicken', excludeIds: ['1', '2', 'mealdb-4'], count: 1 });
    assert.deepEqual(second, []);
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/list.php')).length, 1);
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/filter.php')).length, 1);
    assert.ok(f.calls.filter(call => call.url.pathname.endsWith('/lookup.php')).every(call => !['1', '2'].includes(call.url.searchParams.get('i'))));
});

test('uses only the official country alias when a documented adjective returns no recipes', async () => {
    const f = fixture({ ids: ['1', '2'], meals: new Map([
        ['1', meal('1', { strArea: 'France' })],
        ['2', meal('2', { strArea: 'Spanish' })],
    ]), handle: url => url.searchParams.get('a') === 'French' ? response(null) : undefined });
    const result = await f.provider.fetchSuggestions({ area: 'French', count: 2 });
    assert.deepEqual(result.map(recipe => recipe.id), ['mealdb-1']);
    assert.equal(result[0].cuisine, 'France');
    assert.equal(result[0].area, 'French');
    assert.equal(result[0].country, 'France');
    const filters = f.calls.filter(call => call.url.pathname.endsWith('/filter.php'));
    assert.deepEqual(filters.map(call => call.url.searchParams.get('a')), ['French', 'France']);
});

test('empty countries return an empty result instead of falling back to another cuisine', async () => {
    const f = fixture({ handle: url => url.pathname.endsWith('/filter.php') ? response(null) : undefined });
    assert.deepEqual(await f.provider.fetchSuggestions({ area: 'Spanish' }), []);
    assert.deepEqual(f.calls.filter(call => call.url.pathname.endsWith('/filter.php')).map(call => call.url.searchParams.get('a')), ['Spanish', 'Spain']);
    assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/lookup.php')).length, 0);
});

test('rejects invalid or unsupported country filters without arbitrary upstream requests', async () => {
    const f = fixture();
    for (const area of [null, 12, '', '../Spanish', '<b>Spanish</b>', 'Spanish\n']) {
        await assert.rejects(f.provider.fetchSuggestions({ area }), error => error.statusCode === 400);
    }
    assert.equal(f.calls.length, 0);
    await assert.rejects(f.provider.fetchSuggestions({ area: 'Atlantis' }), error => error.statusCode === 400);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url.search, '?a=list');
});

test('invalid or unavailable country lists give a friendly retryable UI error without poisoning the cache', async () => {
    for (const payload of [null, [], [{ strArea: 1 }], [{ strArea: '<img src=x>', strCountry: 'Bad' }]]) {
        let invalid = true;
        const f = fixture({ handle: url => url.pathname.endsWith('/list.php') && invalid ? response(payload) : undefined });
        await assert.rejects(f.provider.listAreas(), error => error.statusCode === 502 && /Could not load countries.*try again/.test(error.message));
        invalid = false;
        assert.ok((await f.provider.listAreas()).some(item => item.area === 'Spanish'));
    }
    const f = fixture({ handle: url => url.pathname.endsWith('/list.php') ? response(null, { status: 503 }) : undefined });
    await assert.rejects(f.provider.fetchSuggestions({ area: 'Spanish' }), /Could not load countries/);
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every(call => call.url.pathname.endsWith('/list.php')));
});

test('refreshes the country list and country recipe IDs after one hour', async () => {
    const originalNow = Date.now;
    let now = originalNow();
    Date.now = () => now;
    try {
        const f = fixture({ meals: new Map([['1', meal('1', { strArea: 'Spanish' })]]) });
        await f.provider.fetchSuggestions({ area: 'Spanish', count: 1 });
        now += 60 * 60 * 1000 + 1;
        await f.provider.fetchSuggestions({ area: 'Spanish', count: 1 });
        assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/list.php')).length, 2);
        assert.equal(f.calls.filter(call => call.url.pathname.endsWith('/filter.php')).length, 2);
    } finally { Date.now = originalNow; }
});

test('country-list requests share a bounded cache fill and retain the existing request timeout', async () => {
    const f = fixture();
    const [first, second] = await Promise.all([f.provider.listAreas(), f.provider.listAreas()]);
    assert.deepEqual(first, second);
    assert.equal(f.calls.length, 1);
    await withVirtualTimeouts(async ({ elapsed }) => {
        const provider = createMealDbProvider({ fetchImpl: () => new Promise(() => {}) });
        await assert.rejects(provider.listAreas(), /Could not load countries/);
        assert.equal(elapsed(), 16000);
    });
});
