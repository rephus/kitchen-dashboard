'use strict';

const MAIN_CATEGORIES = Object.freeze([
    'Beef', 'Chicken', 'Lamb', 'Pasta', 'Pork', 'Seafood', 'Vegan', 'Vegetarian', 'Goat',
]);
const CATEGORY_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const CALL_TIMEOUT_MS = 25000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const CONCURRENCY = 4;
const NON_MAIN_TAG = /^(?:starter|side|side dish|side dishes|dessert|breakfast|snack|appetizer|appetiser)s?$/i;

function isMainCourseTitle(title) {
    const normalized = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const mainDish = /\b(?:bowls?|wraps?|sandwich(?:es)?|burgers?|curr(?:y|ies)|stews?|casseroles?|pasta|risotto|lasagn[ae]|pizzas?|enchiladas?|tacos?|burritos?|fajitas?|pies?|wings|drumsticks|skewers?|stir[ -]?fr(?:y|ies)|roast|bakes?|soups?|salads?)\b/.test(normalized);
    // Protein categories also contain starters with no useful source tags. Keep
    // these out unless the title explicitly makes them part of a main dish.
    if (/\b(?:pate|hummus|houmous|guacamole|dips?|appeti[sz]ers?|starters?)\b/.test(normalized) && !mainDish) return false;
    const condiment = /\b(?:sauces?|pesto|salsas?|chutneys?|relish|gravy|vinaigrette|dressing|marinade|ketchup|mustard|mayonnaise)\b/;
    if (condiment.test(normalized)) {
        const proteinDish = /\b(?:chicken|beef|lamb|pork|goat|turkey|duck|fish|salmon|cod|tuna|prawns?|shrimp|tofu)\b/.test(normalized);
        const accompaniment = /\b(?:in|with)\b/.test(normalized);
        const standaloneCondiment = new RegExp(`${condiment.source}(?:\\s+recipe)?$`).test(normalized);
        if (!(mainDish || proteinDish) || (standaloneCondiment && !accompaniment)) return false;
    }
    return true;
}

function plainText(value) {
    if (typeof value !== 'string') return '';
    let text = value;
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
        frac14: '¼', frac12: '½', frac34: '¾', deg: '°', ndash: '–', mdash: '—' };
    for (let pass = 0; pass < 3; pass++) {
        text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, entity) => {
            if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? match;
            const hex = entity[1].toLowerCase() === 'x';
            const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
                ? String.fromCodePoint(code) : '';
        }).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
            .replace(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>/gi, ' ');
    }
    return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function imageUrl(value) {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && ['themealdb.com', 'www.themealdb.com'].includes(url.hostname)
            && !url.username && !url.password && !url.port ? url.href : '';
    } catch { return ''; }
}

function originalSourceUrl(value) {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : '';
    } catch { return ''; }
}

function suggestionFromMeal(meal, requestedCategory) {
    if (!meal || typeof meal !== 'object' || Array.isArray(meal)) return null;
    const id = meal.idMeal;
    const title = plainText(meal.strMeal);
    const category = plainText(meal.strCategory);
    if (typeof id !== 'string' || !/^\d{1,12}$/.test(id) || !title || title.length > 250
        || !MAIN_CATEGORIES.includes(category) || (requestedCategory !== 'any' && category !== requestedCategory)
        || !isMainCourseTitle(title)) return null;
    if (typeof meal.strTags === 'string' && meal.strTags.split(/[,;|]/).some(tag => NON_MAIN_TAG.test(tag.trim()))) return null;
    if (typeof meal.strInstructions !== 'string' || !meal.strInstructions.trim()) return null;

    const ingredients = [];
    const ingredientNames = [];
    for (let index = 1; index <= 20; index++) {
        const ingredient = plainText(meal[`strIngredient${index}`]);
        const measure = plainText(meal[`strMeasure${index}`]);
        if (ingredient) {
            ingredientNames.push(ingredient);
            ingredients.push([measure, ingredient].filter(Boolean).join(' '));
        }
    }
    const instructions = meal.strInstructions.replace(/\r\n?/g, '\n')
        .replace(/<br\s*\/?\s*>|<\/p\s*>/gi, '\n\n')
        .split(/\n\s*\n/).map(plainText).filter(Boolean);
    if (!ingredients.length || !instructions.length) return null;
    const cuisine = plainText(meal.strArea);
    const image = imageUrl(meal.strMealThumb);
    const upstreamUrl = originalSourceUrl(meal.strSource);
    return {
        id: `mealdb-${id}`, title, originalTitle: title, source: 'TheMealDB',
        sourceUrl: `https://www.themealdb.com/meal.php?c=${id}`,
        description: `${cuisine && cuisine !== 'Unknown' ? `${cuisine} cuisine. ` : ''}${category} main course. Ingredients include ${ingredientNames.slice(0, 3).join(', ')}.`,
        imageUrl: image, category: 'mains', mealCategory: category, cuisine,
        totalMinutes: null, servings: null,
        ...(upstreamUrl ? { originalSourceUrl: upstreamUrl } : {}),
        recipe: { name: title, ingredients, instructions, servings: '', totalTime: '', imageUrl: image },
    };
}

function shuffle(values, random) {
    const shuffled = [...values];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const value = random();
        const j = Math.floor((Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999999) : 0) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

async function mapConcurrent(values, handler) {
    const results = new Array(values.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, values.length) }, async () => {
        while (next < values.length) {
            const index = next++;
            try { results[index] = { value: await handler(values[index]) }; }
            catch (error) { results[index] = { error }; }
        }
    }));
    return results;
}

async function readJson(response) {
    const length = response.headers?.get('content-length');
    if (length && Number(length) > MAX_BODY_BYTES) throw new Error('TheMealDB response is too large');
    const type = response.headers?.get('content-type');
    if (type && !/^application\/(?:[a-z0-9.-]+\+)?json\b/i.test(type)) throw new Error('TheMealDB returned a non-JSON response');
    let text;
    if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        try {
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > MAX_BODY_BYTES) {
                    await reader.cancel();
                    throw new Error('TheMealDB response is too large');
                }
                chunks.push(Buffer.from(chunk.value));
            }
        } finally { reader.releaseLock(); }
        text = Buffer.concat(chunks, bytes).toString('utf8');
    } else {
        text = await response.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) throw new Error('TheMealDB response is too large');
    }
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)
        || !(data.meals === null || Array.isArray(data.meals))) throw new Error('TheMealDB returned invalid meal data');
    return data.meals || [];
}

function createMealDbProvider({ fetchImpl = global.fetch, random = Math.random, apiKey = '1' } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
    if (typeof apiKey !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(apiKey)) throw new Error('Invalid TheMealDB API key');
    const baseUrl = `https://www.themealdb.com/api/json/v1/${apiKey}/`;
    const categoryCache = new Map();

    async function request(endpoint, parameters, deadline) {
        let lastError;
        for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
            const controller = new AbortController();
            let timer;
            try {
                const timeout = new Promise((resolve, reject) => {
                    timer = setTimeout(() => {
                        controller.abort();
                        const error = new Error('TheMealDB request timed out');
                        error.retryable = true;
                        reject(error);
                    }, Math.min(REQUEST_TIMEOUT_MS, Math.max(1, deadline - Date.now())));
                });
                const operation = (async () => {
                    const response = await fetchImpl(`${baseUrl}${endpoint}?${new URLSearchParams(parameters)}`, {
                        headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'error',
                    });
                    if (!response.ok) {
                        const error = new Error(`TheMealDB request failed (${response.status})`);
                        error.retryable = response.status === 429 || response.status >= 500;
                        await response.body?.cancel?.();
                        throw error;
                    }
                    return readJson(response);
                })();
                return await Promise.race([operation, timeout]);
            } catch (error) {
                lastError = error;
                if (error.retryable === false || (error.retryable !== true && !(error instanceof TypeError))) throw error;
            } finally {
                clearTimeout(timer);
                controller.abort();
            }
        }
        throw lastError || new Error('TheMealDB request budget was exhausted');
    }

    async function categoryIds(category, deadline) {
        const cached = categoryCache.get(category);
        if (cached && cached.expiresAt > Date.now()) return cached.ids;
        const meals = await request('filter.php', { c: category }, deadline);
        const ids = [...new Set(meals.map(meal => meal && typeof meal === 'object' ? meal.idMeal : '')
            .filter(id => typeof id === 'string' && /^\d{1,12}$/.test(id)))];
        categoryCache.set(category, { ids, expiresAt: Date.now() + CATEGORY_TTL_MS });
        return ids;
    }

    async function fetchSuggestions({ category = 'any', excludeIds = [], count = 15 } = {}) {
        if (category !== 'any' && !MAIN_CATEGORIES.includes(category)) {
            const error = new Error('Choose a supported main-course category');
            error.statusCode = 400;
            throw error;
        }
        if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Choose between 1 and 20 recipe suggestions');
        const deadline = Date.now() + CALL_TIMEOUT_MS;
        const categories = category === 'any' ? MAIN_CATEGORIES : [category];
        const categoryResults = await mapConcurrent(categories, value => categoryIds(value, deadline));
        if (categoryResults.every(result => result.error)) throw new Error('TheMealDB is temporarily unavailable');
        const excluded = new Set(Array.isArray(excludeIds) ? excludeIds.map(String) : []);
        const ids = shuffle([...new Set(categoryResults.flatMap(result => result.value || []))], random)
            .filter(id => !excluded.has(id) && !excluded.has(`mealdb-${id}`));
        const suggestions = [];
        let successfulLookups = 0;
        let processed = 0;
        // Small batches avoid downloading a catalogue and stop as soon as the
        // requested page is complete. Invalid records leave room for replacements.
        while (processed < ids.length && processed < count * 3 && suggestions.length < count && Date.now() < deadline) {
            const batchSize = Math.min(CONCURRENCY, count - suggestions.length, count * 3 - processed);
            const batch = ids.slice(processed, processed + batchSize);
            processed += batch.length;
            const results = await mapConcurrent(batch, async id => {
                const meals = await request('lookup.php', { i: id }, deadline);
                successfulLookups++;
                const meal = meals.find(value => value?.idMeal === id);
                return suggestionFromMeal(meal, category);
            });
            for (const result of results) if (result.value) suggestions.push(result.value);
        }
        if (ids.length && !successfulLookups) throw new Error('TheMealDB is temporarily unavailable');
        return suggestions;
    }

    return { fetchSuggestions };
}

module.exports = { createMealDbProvider, MAIN_CATEGORIES };
