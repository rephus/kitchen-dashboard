const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Load .env
require('dotenv').config();
const { handlePrinterAPI } = require('./printer-api');
const { groupShoppingItems, formatGroupedShoppingList } = require('./shopping-grouper');
const {
    extractRecipeIngredients,
    buildPlanShoppingItems,
    reconcilePlanShoppingItems,
} = require('./weekly-plan');

// ===================
// Configuration
// ===================
const PORT = 8002;
const PUSHBULLET_TOKEN = process.env.PUSHBULLET_TOKEN;

const HA_CONFIG = {
    url: process.env.HA_URL,
    token: process.env.HA_TOKEN,
    sensors: {
        temperature: 'sensor.esphome_salon_temperature',
        weather: 'weather.pirateweather',
        power: 'sensor.power_load_fronius_power_flow_0_192_168_2_109',
        battery: 'sensor.samsung_galaxy_s9_battery_level'
    }
};

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.webp': 'image/webp'
};

// Initialize Anthropic client
const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

// ===================
// Home Assistant API
// ===================
async function haFetch(endpoint, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(endpoint, HA_CONFIG.url);

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: {
                'Authorization': `Bearer ${HA_CONFIG.token}`,
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function getHAState(entityId) {
    try {
        const result = await haFetch(`/api/states/${entityId}`);
        if (result.status === 200) {
            return result.data;
        }
        return null;
    } catch (error) {
        console.error(`Error fetching ${entityId}:`, error.message);
        return null;
    }
}

async function callHAService(domain, service, data = {}) {
    try {
        const result = await haFetch(`/api/services/${domain}/${service}`, 'POST', data);
        return result.status === 200;
    } catch (error) {
        console.error(`Error calling ${domain}.${service}:`, error.message);
        return false;
    }
}

async function checkHAConnection() {
    try {
        const result = await haFetch('/api/');
        return result.status === 200;
    } catch (error) {
        return false;
    }
}

// ===================
// Shopping List (JSON file storage)
// ===================
const SHOPPING_FILE = path.join(__dirname, 'data', 'shopping.json');
const WEEKLY_PLAN_FILE = path.join(__dirname, 'data', 'weekly-plan.json');
const SIMPLE_PLATES_FILE = path.join(__dirname, 'data', 'simple-plates.json');
const CUSTOM_QUICK_MEALS_FILE = path.join(__dirname, 'data', 'quick-meals.json');
const RECURRING_ITEMS_FILE = path.join(__dirname, 'data', 'recurring-items.json');

function ensureDataDir() {
    const dir = path.dirname(SHOPPING_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readShoppingList() {
    ensureDataDir();
    try {
        return JSON.parse(fs.readFileSync(SHOPPING_FILE, 'utf8'));
    } catch (e) {
        return [];
    }
}

function writeShoppingList(items) {
    ensureDataDir();
    fs.writeFileSync(SHOPPING_FILE, JSON.stringify(items, null, 2));
}

function quickMealSlug(title) {
    return String(title || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'meal';
}

function readCustomQuickMeals() {
    try {
        const items = JSON.parse(fs.readFileSync(CUSTOM_QUICK_MEALS_FILE, 'utf8'));
        return Array.isArray(items) ? items : [];
    } catch (e) {
        return [];
    }
}

function listQuickMeals() {
    let basic = [];
    try {
        const items = JSON.parse(fs.readFileSync(SIMPLE_PLATES_FILE, 'utf8'));
        basic = Array.isArray(items) ? items.map((item, index) => ({
            id: `basic-${index + 1}-${quickMealSlug(item.title)}`,
            title: item.title,
            ingredients: Array.isArray(item.ingredients) ? item.ingredients : [],
            note: item.note || 'Basic quick meal',
            builtIn: true,
        })) : [];
    } catch (e) { /* return custom meals only */ }
    return basic.concat(readCustomQuickMeals());
}

function createQuickMeal({ title, ingredients } = {}) {
    const cleanTitle = String(title || '').trim();
    const cleanIngredients = [...new Set(
        (Array.isArray(ingredients) ? ingredients : [])
            .map(item => String(item).trim())
            .filter(Boolean),
    )];
    if (!cleanTitle || cleanIngredients.length === 0) {
        const error = new Error('Add a meal name and at least one ingredient');
        error.statusCode = 400;
        throw error;
    }

    const existingIds = new Set(listQuickMeals().map(item => item.id));
    const baseId = `custom-${quickMealSlug(cleanTitle)}`;
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) id = `${baseId}-${suffix++}`;

    const meal = {
        id,
        title: cleanTitle,
        ingredients: cleanIngredients,
        note: 'Custom quick meal',
        builtIn: false,
        createdAt: new Date().toISOString(),
    };
    const customMeals = readCustomQuickMeals();
    customMeals.push(meal);
    fs.writeFileSync(CUSTOM_QUICK_MEALS_FILE, JSON.stringify(customMeals, null, 2));
    return meal;
}

function emptyWeeklyPlan() {
    return {
        version: 1,
        period: 'next-week',
        selectedRecipes: [],
        selectedQuickMeals: [],
        requests: [],
        orderReady: false,
        updatedAt: null,
    };
}

function readWeeklyPlan() {
    ensureDataDir();
    try {
        const data = JSON.parse(fs.readFileSync(WEEKLY_PLAN_FILE, 'utf8'));
        return {
            ...emptyWeeklyPlan(),
            ...data,
            selectedRecipes: Array.isArray(data.selectedRecipes) ? data.selectedRecipes : [],
            selectedQuickMeals: Array.isArray(data.selectedQuickMeals) ? data.selectedQuickMeals : [],
            requests: Array.isArray(data.requests) ? data.requests : [],
            orderReady: data.orderReady === true,
        };
    } catch (e) {
        return emptyWeeklyPlan();
    }
}

function createPlannerId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function defaultRecurringItems() {
    return [{
        id: 'water-8l',
        text: 'Garrafa de agua 8 L',
        quantity: 2,
        active: true,
    }];
}

function readRecurringItems() {
    ensureDataDir();
    try {
        const items = JSON.parse(fs.readFileSync(RECURRING_ITEMS_FILE, 'utf8'));
        return Array.isArray(items) ? items : [];
    } catch (error) {
        const items = defaultRecurringItems();
        fs.writeFileSync(RECURRING_ITEMS_FILE, JSON.stringify(items, null, 2));
        return items;
    }
}

function normalizeRecurringItems(items) {
    if (!Array.isArray(items) || items.length > 100) {
        const error = new Error('Recurring items must be an array with at most 100 entries');
        error.statusCode = 400;
        throw error;
    }

    return items.map(item => {
        const text = String(item?.text || '').trim();
        const quantity = Number(item?.quantity);
        if (!text || text.length > 160 || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
            const error = new Error('Each recurring item needs a name and a quantity between 1 and 99');
            error.statusCode = 400;
            throw error;
        }
        return {
            id: String(item.id || createPlannerId('recurring')).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80),
            text,
            quantity,
            active: item.active !== false,
        };
    });
}

function writeWeeklyPlanFile(plan) {
    ensureDataDir();
    fs.writeFileSync(WEEKLY_PLAN_FILE, JSON.stringify(plan, null, 2));
}

function saveRecurringItems(items) {
    const normalized = normalizeRecurringItems(items);
    ensureDataDir();
    fs.writeFileSync(RECURRING_ITEMS_FILE, JSON.stringify(normalized, null, 2));

    const plan = readWeeklyPlan();
    writeWeeklyPlanFile({
        ...plan,
        orderReady: false,
        updatedAt: new Date().toISOString(),
    });
    return normalized;
}

function addWeeklyPlanRequest({ type, text } = {}) {
    const allowedTypes = new Set(['recipe-idea', 'extra-list']);
    const cleanText = String(text || '').trim();
    if (!allowedTypes.has(type) || !cleanText || cleanText.length > 2000) {
        const error = new Error('Choose a valid type and enter up to 2000 characters');
        error.statusCode = 400;
        throw error;
    }

    const plan = readWeeklyPlan();
    if (plan.requests.length >= 50) {
        const error = new Error('The weekly plan can hold at most 50 ideas and extra lists');
        error.statusCode = 400;
        throw error;
    }
    const request = {
        id: createPlannerId('request'),
        type,
        text: cleanText,
        createdAt: new Date().toISOString(),
        status: type === 'recipe-idea' ? 'pending' : 'saved',
    };
    plan.requests.push(request);
    plan.orderReady = false;
    plan.updatedAt = new Date().toISOString();
    writeWeeklyPlanFile(plan);
    return request;
}

function removeWeeklyPlanRequest(id) {
    const plan = readWeeklyPlan();
    const requests = plan.requests.filter(request => request.id !== id);
    if (requests.length === plan.requests.length) {
        const error = new Error('Idea or extra list not found');
        error.statusCode = 404;
        throw error;
    }
    plan.requests = requests;
    plan.orderReady = false;
    plan.updatedAt = new Date().toISOString();
    writeWeeklyPlanFile(plan);
    return expandWeeklyPlan(plan);
}

function expandWeeklyPlan(plan) {
    const selectedRecipes = plan.selectedRecipes.map(slug => {
        const recipe = getRecipe(slug);
        if (!recipe) return null;
        return {
            type: 'recipe',
            id: recipe.slug,
            slug: recipe.slug,
            title: recipe.title,
            category: recipe.category,
            image: recipe.image,
            ingredients: extractRecipeIngredients(recipe.content),
        };
    }).filter(Boolean);
    const quickMeals = new Map(listQuickMeals().map(meal => [meal.id, meal]));
    const selectedQuickMeals = plan.selectedQuickMeals.map(id => {
        const meal = quickMeals.get(id);
        return meal ? { ...meal, type: 'quick' } : null;
    }).filter(Boolean);
    const selected = selectedRecipes.concat(selectedQuickMeals);

    return {
        ...plan,
        selected,
        ingredientCount: buildPlanShoppingItems(selected).length,
        recurringItems: readRecurringItems().filter(item => item.active),
    };
}

function saveWeeklyPlan(data) {
    if (!Array.isArray(data.selectedRecipes)) {
        const error = new Error('selectedRecipes must be an array');
        error.statusCode = 400;
        throw error;
    }

    const previous = readWeeklyPlan();
    const selectedRecipes = [...new Set(data.selectedRecipes.map(String))];
    const selectedQuickMeals = data.selectedQuickMeals === undefined
        ? previous.selectedQuickMeals
        : [...new Set((Array.isArray(data.selectedQuickMeals) ? data.selectedQuickMeals : []).map(String))];
    if (selectedRecipes.length + selectedQuickMeals.length > 21) {
        const error = new Error('Choose at most 21 recipes');
        error.statusCode = 400;
        throw error;
    }

    const selectedRecipeDetails = selectedRecipes.map(slug => {
        const recipe = getRecipe(slug);
        if (!recipe) {
            const error = new Error(`Recipe not found: ${slug}`);
            error.statusCode = 400;
            throw error;
        }
        return {
            type: 'recipe',
            id: recipe.slug,
            slug: recipe.slug,
            title: recipe.title,
            category: recipe.category,
            image: recipe.image,
            ingredients: extractRecipeIngredients(recipe.content),
        };
    });
    const quickMeals = new Map(listQuickMeals().map(meal => [meal.id, meal]));
    const selectedQuickMealDetails = selectedQuickMeals.map(id => {
        const meal = quickMeals.get(id);
        if (!meal) {
            const error = new Error(`Quick meal not found: ${id}`);
            error.statusCode = 400;
            throw error;
        }
        return { ...meal, type: 'quick' };
    });
    const selected = selectedRecipeDetails.concat(selectedQuickMealDetails);

    const selectionChanged = JSON.stringify(previous.selectedRecipes) !== JSON.stringify(selectedRecipes)
        || JSON.stringify(previous.selectedQuickMeals) !== JSON.stringify(selectedQuickMeals);
    const orderReady = selectionChanged ? false : data.orderReady === true;
    const hasOrderContent = selected.length > 0
        || previous.requests.length > 0
        || readRecurringItems().some(item => item.active);
    if (orderReady && !hasOrderContent) {
        const error = new Error('Add at least one meal, weekly request, or recurring item before marking the order ready');
        error.statusCode = 400;
        throw error;
    }

    const plan = {
        ...previous,
        version: 1,
        period: 'next-week',
        selectedRecipes,
        selectedQuickMeals,
        requests: previous.requests,
        orderReady,
        updatedAt: new Date().toISOString(),
    };
    const planItems = buildPlanShoppingItems(selected);
    writeShoppingList(reconcilePlanShoppingItems(readShoppingList(), planItems));
    writeWeeklyPlanFile(plan);

    return expandWeeklyPlan(plan);
}

// ===================
// Recipes (markdown files in recipes/)
// ===================
const RECIPES_DIR = path.join(__dirname, 'recipes');
const RECIPE_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const RECIPE_CATEGORIES = require('./recipe-categories.json');

function getRecipeCategory(meta) {
    return RECIPE_CATEGORIES.some(c => c.id === meta.category) ? meta.category : 'uncategorized';
}

function isGeneratedRecipe(meta) {
    return meta.generated === 'true' || meta.source === 'weekly-idea';
}

function findRecipeImage(slug) {
    for (const ext of RECIPE_IMAGE_EXTS) {
        const filename = slug + ext;
        const fullPath = path.join(RECIPES_DIR, filename);
        if (fs.existsSync(fullPath)) {
            return `/recipes/${filename}`;
        }
    }
    return null;
}

// Parse YAML-ish frontmatter at the top of a markdown file. Only supports flat
// `key: value` pairs — that's all we need for `alt` and any future scalar metadata.
function parseFrontmatter(raw) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { meta: {}, body: raw };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (kv) meta[kv[1]] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
    return { meta, body: m[2] };
}

function serializeFrontmatter(meta, body) {
    const keys = Object.keys(meta).filter(k => meta[k] != null && String(meta[k]).trim() !== '');
    if (keys.length === 0) return body.replace(/^\s+/, '');
    const lines = keys.map(k => `${k}: ${meta[k]}`).join('\n');
    return `---\n${lines}\n---\n\n${body.replace(/^\s+/, '')}`;
}

function readRecipeFile(slug) {
    const safeSlug = path.basename(slug, '.md').replace(/[^a-z0-9-]/gi, '');
    const filePath = path.join(RECIPES_DIR, safeSlug + '.md');
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const titleMatch = body.match(/^#\s+(.+)/m);
    return {
        safeSlug,
        filePath,
        meta,
        body,
        title: titleMatch ? titleMatch[1].trim() : safeSlug,
    };
}

function listRecipes() {
    if (!fs.existsSync(RECIPES_DIR)) return [];
    const files = fs.readdirSync(RECIPES_DIR)
        .filter(f => f.endsWith('.md'))
        .map(f => {
            const slug = f.replace(/\.md$/, '');
            let title = slug.replace(/-/g, ' ');
            let altName = null;
            let category = 'uncategorized';
            let generated = false;
            try {
                const r = readRecipeFile(slug);
                if (r) {
                    title = r.title;
                    altName = r.meta.alt || null;
                    category = getRecipeCategory(r.meta);
                    generated = isGeneratedRecipe(r.meta);
                }
            } catch (e) { /* use slug as title */ }
            const image = findRecipeImage(slug);
            return { slug, title, altName, image, category, generated };
        });
    return files.sort((a, b) => a.title.localeCompare(b.title));
}

function getRecipe(slug) {
    const r = readRecipeFile(slug);
    if (!r) return null;
    return {
        slug: r.safeSlug,
        title: r.title,
        altName: r.meta.alt || null,
        category: getRecipeCategory(r.meta),
        content: r.body,
        image: findRecipeImage(r.safeSlug),
        generated: isGeneratedRecipe(r.meta),
        generatedAt: r.meta.generated_at || null,
        weeklyRequestId: r.meta.weekly_request_id || null,
    };
}

function uniqueRecipeSlug(title) {
    const base = quickMealSlug(title) || 'receta-semanal';
    let slug = base;
    let suffix = 2;
    while (fs.existsSync(path.join(RECIPES_DIR, `${slug}.md`))) slug = `${base}-${suffix++}`;
    return slug;
}

function cleanGeneratedMarkdown(markdown) {
    return String(markdown || '')
        .trim()
        .replace(/^```(?:markdown)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
}

async function generateRecipeFromWeeklyIdea(idea) {
    if (!anthropic) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1800,
        messages: [{
            role: 'user',
            content: `Crea una receta en español a partir de esta idea: "${idea}".

Es para 2 adultos y 2 niños. Debe ser un plato principal familiar, suave, práctico para una comida semanal y con cantidades concretas para cuatro raciones. Respeta cualquier condición incluida en la idea. No inventes afirmaciones sobre fuentes externas.

Devuelve únicamente markdown con esta estructura exacta:
# Nombre de la receta

## Ingredientes

- cantidad e ingrediente

## Elaboración

1. Paso concreto

Incluye todos los ingredientes usados en la elaboración.`,
        }],
    });
    let markdown = cleanGeneratedMarkdown(message.content?.[0]?.text);
    const rawTitle = markdown.match(/^#\s+(.+)/m)?.[1]?.trim() || '';
    const title = rawTitle.replace(/[<>`*_\[\]]/g, '').trim().slice(0, 120);
    if (!title || /<\/?[a-z][^>]*>/i.test(markdown)
        || !/^##\s+Ingredientes\s*$/im.test(markdown)
        || !/^##\s+Elaboraci[oó]n\s*$/im.test(markdown)
        || extractRecipeIngredients(markdown).length === 0) {
        throw new Error('The generated recipe did not contain the expected title, ingredients, and method');
    }
    markdown = markdown.replace(/^#\s+.+/m, `# ${title}`);
    return { title, markdown };
}

function saveGeneratedWeeklyRecipe({ title, markdown, requestId }) {
    if (!fs.existsSync(RECIPES_DIR)) fs.mkdirSync(RECIPES_DIR, { recursive: true });
    const slug = uniqueRecipeSlug(title);
    const content = serializeFrontmatter({
        category: 'mains',
        generated: 'true',
        source: 'weekly-idea',
        generated_at: new Date().toISOString(),
        weekly_request_id: requestId,
    }, markdown);
    fs.writeFileSync(path.join(RECIPES_DIR, `${slug}.md`), content, 'utf8');
    return getRecipe(slug);
}

async function generateWeeklyPlanRecipe(requestId) {
    const initialPlan = readWeeklyPlan();
    const initialRequest = initialPlan.requests.find(request => request.id === requestId);
    if (!initialRequest || initialRequest.type !== 'recipe-idea') {
        const error = new Error('Recipe idea not found');
        error.statusCode = 404;
        throw error;
    }
    if (initialRequest.recipeSlug && getRecipe(initialRequest.recipeSlug)) {
        return expandWeeklyPlan(initialPlan);
    }

    try {
        const generated = await generateRecipeFromWeeklyIdea(initialRequest.text);
        const latestPlan = readWeeklyPlan();
        const request = latestPlan.requests.find(item => item.id === requestId);
        if (!request) {
            const error = new Error('Recipe idea was removed while it was being generated');
            error.statusCode = 409;
            throw error;
        }
        const recipe = saveGeneratedWeeklyRecipe({ ...generated, requestId });
        request.status = 'generated';
        request.recipeSlug = recipe.slug;
        request.recipeTitle = recipe.title;
        request.generatedAt = recipe.generatedAt;
        delete request.lastError;
        latestPlan.selectedRecipes = [...new Set([...latestPlan.selectedRecipes, recipe.slug])];
        latestPlan.orderReady = false;
        latestPlan.updatedAt = new Date().toISOString();
        writeWeeklyPlanFile(latestPlan);
        return saveWeeklyPlan({
            selectedRecipes: latestPlan.selectedRecipes,
            selectedQuickMeals: latestPlan.selectedQuickMeals,
            orderReady: false,
        });
    } catch (error) {
        const latestPlan = readWeeklyPlan();
        const request = latestPlan.requests.find(item => item.id === requestId);
        if (request) {
            request.status = 'generation-failed';
            request.lastError = error.message;
            latestPlan.orderReady = false;
            latestPlan.updatedAt = new Date().toISOString();
            writeWeeklyPlanFile(latestPlan);
        }
        throw error;
    }
}

function deleteRecipe(slug) {
    const r = readRecipeFile(slug);
    if (!r) throw new Error('Recipe not found');
    fs.unlinkSync(r.filePath);
    for (const ext of RECIPE_IMAGE_EXTS) {
        const imgPath = path.join(RECIPES_DIR, r.safeSlug + ext);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }

    const plan = readWeeklyPlan();
    const wasSelected = plan.selectedRecipes.includes(r.safeSlug);
    let requestChanged = false;
    plan.requests = plan.requests.map(request => {
        if (request.recipeSlug !== r.safeSlug) return request;
        requestChanged = true;
        const pending = { ...request, status: 'pending' };
        delete pending.recipeSlug;
        delete pending.recipeTitle;
        delete pending.generatedAt;
        delete pending.lastError;
        return pending;
    });
    if (wasSelected || requestChanged) {
        plan.selectedRecipes = plan.selectedRecipes.filter(item => item !== r.safeSlug);
        plan.orderReady = false;
        plan.updatedAt = new Date().toISOString();
        writeWeeklyPlanFile(plan);
        saveWeeklyPlan({
            selectedRecipes: plan.selectedRecipes,
            selectedQuickMeals: plan.selectedQuickMeals,
            orderReady: false,
        });
    }
    return { slug: r.safeSlug };
}

function updateRecipeMeta(slug, { title, altName, category } = {}) {
    const r = readRecipeFile(slug);
    if (!r) throw new Error('Recipe not found');
    if (category !== undefined && !RECIPE_CATEGORIES.some(c => c.id === category)) {
        const error = new Error('Choose a valid recipe category');
        error.statusCode = 400;
        throw error;
    }

    let body = r.body;
    if (typeof title === 'string' && title.trim()) {
        const newTitle = title.trim();
        if (/^#\s+.+/m.test(body)) {
            body = body.replace(/^#\s+.+/m, `# ${newTitle}`);
        } else {
            body = `# ${newTitle}\n\n${body.replace(/^\s+/, '')}`;
        }
    }

    const meta = { ...r.meta };
    if (category !== undefined) meta.category = category;
    if (typeof altName === 'string') {
        const trimmed = altName.trim();
        if (trimmed) meta.alt = trimmed;
        else delete meta.alt;
    }

    const out = serializeFrontmatter(meta, body);
    fs.writeFileSync(r.filePath, out, 'utf8');

    return getRecipe(r.safeSlug);
}

/**
 * Scan recipe from base64 image using Claude Vision API
 */
async function scanRecipeFromImage(base64Image, mediaType) {
    if (!anthropic) {
        throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data: base64Image,
                        },
                    },
                    {
                        type: 'text',
                        text: `Extract the recipe from this image and format it in Spanish markdown following this EXACT structure:

# [Recipe Name]

## Ingredientes

- [ingredient with quantity]
- [ingredient with quantity]
...

## Elaboración

1. [step]
2. [step]
...

IMPORTANT RULES:
- Use Spanish language for all text
- Keep ingredient quantities concise (e.g., "1 kg tomate", "200 ml aceite")
- Use abbreviations: cda (cucharada/tablespoon), cdta (cucharadita/teaspoon), g (gramos), ml (mililitros), kg (kilogramos)
- Number the steps in "Elaboración" section
- If there are subsections (like "Sofrito", "Caldo", etc.), include them as ## sections
- Extract ALL visible ingredients and steps from the image
- If some text is unclear, use your best judgment but stay faithful to what you can see
- Output ONLY the markdown, no additional commentary

Begin:`
                    }
                ],
            },
        ],
    });

    return message.content[0].text.trim();
}

/**
 * Recipe cover image search.
 * Primary source: Unsplash (high-quality food photography, requires UNSPLASH_ACCESS_KEY).
 * Fallback source: Wikimedia Commons (free, no key required).
 */
const COMMONS_USER_AGENT = 'KitchenDashboard/1.0 (recipe cover regenerator)';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;


function httpsGetBuffer(targetUrl, { headers = {}, redirects = 3 } = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(targetUrl);
        const opts = {
            hostname: u.hostname,
            path: u.pathname + u.search,
            method: 'GET',
            headers: { 'User-Agent': COMMONS_USER_AGENT, ...headers }
        };
        const req = https.request(opts, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
                const next = new URL(res.headers.location, targetUrl).toString();
                resolve(httpsGetBuffer(next, { headers, redirects: redirects - 1 }));
                return;
            }
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
        req.end();
    });
}

async function httpsGetJson(url, options = {}) {
    const buf = await httpsGetBuffer(url, options);
    const text = buf.toString();
    try {
        return JSON.parse(text);
    } catch (e) {
        const preview = text.slice(0, 200).replace(/\s+/g, ' ').trim();
        throw new Error(`Non-JSON response from ${new URL(url).host}: ${preview || '(empty)'}`);
    }
}

async function findRandomUnsplashImage(searchTerm) {
    if (!UNSPLASH_ACCESS_KEY) return null;

    // Random page (1-3) lets each call sample different photos beyond the top 20.
    const page = 1 + Math.floor(Math.random() * 3);
    // Unsplash tags are mostly English — append "food" to bias away from
    // unrelated meanings (e.g. "humus" the soil → dirt bikes on dirt).
    const query = /\bfood\b|\bdish\b|\bcocktail\b|\bsauce\b|\bsoup\b|\bstew\b/i.test(searchTerm)
        ? searchTerm
        : `${searchTerm} food`;
    const url = 'https://api.unsplash.com/search/photos?' + new URLSearchParams({
        query,
        per_page: '20',
        page: String(page),
        orientation: 'landscape',
        content_filter: 'high',
    });

    const headers = { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` };
    const data = await httpsGetJson(url, { headers });
    const results = data.results || [];
    if (!results.length) return null;

    const pick = results[Math.floor(Math.random() * results.length)];

    // Per Unsplash API guidelines, ping the download endpoint when actually using a photo.
    if (pick.links?.download_location) {
        httpsGetBuffer(pick.links.download_location, { headers })
            .catch(() => { /* fire-and-forget tracking */ });
    }

    return {
        url: pick.urls?.regular || pick.urls?.full,
        mime: 'image/jpeg',
        title: pick.alt_description || pick.description || pick.id,
        photographer: pick.user?.name,
        photographerUrl: pick.user?.links?.html,
        source: 'unsplash',
    };
}

// Bilingual food-context hints. Picking a random one each call biases the
// search toward cooked dishes (vs. plants/ingredients) AND adds extra variety
// across regenerations.
const FOOD_HINTS = [
    'food dish', 'cooked dish', 'plate', 'recipe', 'meal',
    'plato', 'comida', 'cocido', 'guiso', 'receta',
];

async function searchCommons(query, offset = 0) {
    const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: query,
        srnamespace: '6',
        srlimit: '20',
        sroffset: String(offset),
        format: 'json',
        origin: '*',
    });
    const data = await httpsGetJson(url);
    return (data.query?.search || []).filter(r => r.title && /^File:/i.test(r.title));
}

async function resolveCommonsImage(fileTitle) {
    const url = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
        action: 'query',
        titles: fileTitle,
        prop: 'imageinfo',
        iiprop: 'url|mime',
        iiurlwidth: '1200',
        format: 'json',
        origin: '*',
    });
    const data = await httpsGetJson(url);
    const page = Object.values(data.query?.pages || {})[0];
    const image = page?.imageinfo?.[0];
    if (!image) return null;
    const resolved = image.thumburl || image.url;
    return resolved ? { url: resolved, mime: image.mime, title: fileTitle } : null;
}

async function findRandomCommonsImage(searchTerm) {
    // Try the food-biased query first, fall back to bare term if nothing matches.
    const hint = FOOD_HINTS[Math.floor(Math.random() * FOOD_HINTS.length)];
    const offset = Math.floor(Math.random() * 10);
    const queries = [`${searchTerm} ${hint}`, searchTerm];

    for (const query of queries) {
        let candidates;
        try {
            candidates = await searchCommons(query, offset);
        } catch (e) {
            // Surface API errors instead of silently swallowing them, but keep
            // trying the next query so a single hiccup doesn't kill the call.
            console.warn(`Commons search failed for "${query}":`, e.message);
            continue;
        }
        if (!candidates.length) continue;

        const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
        for (const c of shuffled) {
            try {
                const resolved = await resolveCommonsImage(c.title);
                if (resolved) return resolved;
            } catch (e) {
                console.warn(`Commons resolve failed for "${c.title}":`, e.message);
            }
        }
    }
    return null;
}

async function regenerateRecipeImage(slug, customSearchTerm) {
    const r = readRecipeFile(slug);
    if (!r) throw new Error('Recipe not found');
    const safeSlug = r.safeSlug;

    let term = (customSearchTerm || '').trim();
    if (!term) term = r.meta.alt || r.title || safeSlug.replace(/-/g, ' ');

    let image = null;
    try {
        image = await findRandomUnsplashImage(term);
    } catch (e) {
        console.warn('Unsplash search failed:', e.message);
    }
    if (!image) {
        image = await findRandomCommonsImage(term);
    }
    if (!image) {
        throw new Error(`No image found for "${term}"`);
    }

    const buffer = await httpsGetBuffer(image.url);

    const mimeExt = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif',
    };
    const urlExt = (image.url.match(/\.(jpe?g|png|webp|gif)(?:$|\?)/i)?.[1] || '').toLowerCase();
    const ext = mimeExt[image.mime] || (urlExt ? '.' + (urlExt === 'jpeg' ? 'jpg' : urlExt) : '.jpg');

    // Drop any existing image regardless of extension before writing the new one.
    for (const e of RECIPE_IMAGE_EXTS) {
        const old = path.join(RECIPES_DIR, safeSlug + e);
        if (fs.existsSync(old)) fs.unlinkSync(old);
    }

    const newPath = path.join(RECIPES_DIR, safeSlug + ext);
    fs.writeFileSync(newPath, buffer);

    return {
        slug: safeSlug,
        searchTerm: term,
        candidate: image.title,
        sourceUrl: image.url,
        provider: image.source || 'commons',
        photographer: image.photographer || null,
        photographerUrl: image.photographerUrl || null,
        image: `/recipes/${safeSlug}${ext}`,
    };
}

/**
 * Save scanned recipe (markdown + image)
 */
function saveScannedRecipe(markdown, base64Image, mediaType) {
    if (!fs.existsSync(RECIPES_DIR)) {
        fs.mkdirSync(RECIPES_DIR, { recursive: true });
    }

    // Extract title from markdown to generate slug
    const titleMatch = markdown.match(/^#\s+(.+)/m);
    const title = titleMatch ? titleMatch[1].trim() : 'recipe';
    const slug = title.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')  // Remove accents
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    // Determine image extension from media type
    const extMap = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif'
    };
    const ext = extMap[mediaType] || '.jpg';

    // Save markdown
    const mdPath = path.join(RECIPES_DIR, `${slug}.md`);
    fs.writeFileSync(mdPath, markdown, 'utf8');

    // Save image
    const imagePath = path.join(RECIPES_DIR, `${slug}${ext}`);
    const imageBuffer = Buffer.from(base64Image, 'base64');
    fs.writeFileSync(imagePath, imageBuffer);

    return {
        slug,
        title,
        mdPath,
        imagePath,
        image: `/recipes/${slug}${ext}`
    };
}

// ===================
// API Routes
// ===================
async function handleAPI(req, res, pathname) {
    res.setHeader('Content-Type', 'application/json');
    if (await handlePrinterAPI(req, res, pathname, readShoppingList, async items => {
        const groups = await groupShoppingItems(items, anthropic);
        return formatGroupedShoppingList(groups, { checkbox: true });
    })) return;

    // GET /api/status
    if (pathname === '/api/status') {
        const connected = await checkHAConnection();
        res.end(JSON.stringify({ connected }));
        return;
    }

    // GET /api/sensors
    if (pathname === '/api/sensors') {
        const sensors = {};

        for (const [key, entityId] of Object.entries(HA_CONFIG.sensors)) {
            const state = await getHAState(entityId);
            if (state) {
                if (entityId.startsWith('weather.')) {
                    sensors[key] = {
                        state: state.state,
                        friendly_name: state.attributes?.friendly_name || key,
                        last_updated: state.last_updated,
                        attributes: {
                            temperature: state.attributes?.temperature,
                            humidity: state.attributes?.humidity,
                            cloud_coverage: state.attributes?.cloud_coverage
                        }
                    };
                } else if (entityId.startsWith('media_player.') || entityId.startsWith('switch.') || entityId.startsWith('binary_sensor.') || entityId.startsWith('alarm_control_panel.')) {
                    sensors[key] = {
                        state: state.state,
                        friendly_name: state.attributes?.friendly_name || key,
                        last_updated: state.last_updated
                    };
                } else {
                    const val = parseFloat(state.state);
                    sensors[key] = {
                        value: isNaN(val) ? null : val,
                        unit: state.attributes?.unit_of_measurement || '',
                        friendly_name: state.attributes?.friendly_name || key,
                        last_updated: state.last_updated
                    };
                }
            } else {
                sensors[key] = null;
            }
        }

        res.end(JSON.stringify(sensors));
        return;
    }

    // POST /api/service/:domain/:service - Call HA service
    const serviceMatch = pathname.match(/^\/api\/service\/(\w+)\/(\w+)$/);
    if (serviceMatch && req.method === 'POST') {
        let body = '';
        await new Promise(resolve => {
            req.on('data', chunk => body += chunk);
            req.on('end', resolve);
        });

        const data = body ? JSON.parse(body) : {};
        const success = await callHAService(serviceMatch[1], serviceMatch[2], data);
        res.end(JSON.stringify({ success }));
        return;
    }

    // GET /api/shopping - Get shopping list
    if (pathname === '/api/shopping' && req.method === 'GET') {
        res.end(JSON.stringify(readShoppingList()));
        return;
    }

    // PUT /api/shopping - Save full shopping list
    if (pathname === '/api/shopping' && req.method === 'PUT') {
        let body = '';
        await new Promise(resolve => {
            req.on('data', chunk => body += chunk);
            req.on('end', resolve);
        });
        const items = JSON.parse(body);
        writeShoppingList(items);
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // POST /api/shopping/send - Send shopping list via Pushbullet
    if (pathname === '/api/shopping/send' && req.method === 'POST') {
        await sendShoppingListNotification();
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    // POST /api/notify/food-ready - Send food-ready push notification via Pushbullet
    if (pathname === '/api/notify/food-ready' && req.method === 'POST') {
        const ok = await sendPushbulletNotification('cocina', 'La comida esta lista');
        res.end(JSON.stringify({ ok }));
        return;
    }

    // GET /api/weekly-plan - Read the persisted plan for next week
    if (pathname === '/api/weekly-plan' && req.method === 'GET') {
        res.end(JSON.stringify(expandWeeklyPlan(readWeeklyPlan())));
        return;
    }

    // PUT /api/weekly-plan - Save selections, sync their ingredients, and set readiness
    if (pathname === '/api/weekly-plan' && req.method === 'PUT') {
        try {
            let body = '';
            await new Promise(resolve => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });
            const data = body ? JSON.parse(body) : {};
            res.end(JSON.stringify(saveWeeklyPlan(data)));
        } catch (error) {
            res.statusCode = error.statusCode || 400;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // POST /api/weekly-plan/requests - Add a recipe idea or an extra shopping list
    if (pathname === '/api/weekly-plan/requests' && req.method === 'POST') {
        try {
            let body = '';
            await new Promise(resolve => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });
            const data = body ? JSON.parse(body) : {};
            const request = addWeeklyPlanRequest(data);
            if (request.type === 'recipe-idea') {
                try {
                    const plan = await generateWeeklyPlanRecipe(request.id);
                    res.statusCode = 201;
                    res.end(JSON.stringify(plan));
                } catch (generationError) {
                    console.error('Weekly recipe generation error:', generationError.message);
                    res.statusCode = 202;
                    res.end(JSON.stringify({
                        ...expandWeeklyPlan(readWeeklyPlan()),
                        generationWarning: generationError.message,
                    }));
                }
            } else {
                res.statusCode = 201;
                res.end(JSON.stringify(expandWeeklyPlan(readWeeklyPlan())));
            }
        } catch (error) {
            res.statusCode = error.statusCode || 400;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // POST /api/weekly-plan/requests/:id/generate - Retry a saved recipe idea
    const plannerGenerateMatch = pathname.match(/^\/api\/weekly-plan\/requests\/([^/]+)\/generate$/);
    if (plannerGenerateMatch && req.method === 'POST') {
        try {
            const plan = await generateWeeklyPlanRecipe(decodeURIComponent(plannerGenerateMatch[1]));
            res.end(JSON.stringify(plan));
        } catch (error) {
            console.error('Weekly recipe generation retry error:', error.message);
            res.statusCode = error.statusCode || 500;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // DELETE /api/weekly-plan/requests/:id - Remove a saved idea or extra list
    const plannerRequestMatch = pathname.match(/^\/api\/weekly-plan\/requests\/([^/]+)$/);
    if (plannerRequestMatch && req.method === 'DELETE') {
        try {
            res.end(JSON.stringify(removeWeeklyPlanRequest(decodeURIComponent(plannerRequestMatch[1]))));
        } catch (error) {
            res.statusCode = error.statusCode || 400;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // GET /api/recurring-items - Read separately persisted repeat purchases
    if (pathname === '/api/recurring-items' && req.method === 'GET') {
        res.end(JSON.stringify(readRecurringItems()));
        return;
    }

    // PUT /api/recurring-items - Replace repeat purchases and require order review
    if (pathname === '/api/recurring-items' && req.method === 'PUT') {
        try {
            let body = '';
            await new Promise(resolve => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });
            const data = body ? JSON.parse(body) : [];
            res.end(JSON.stringify(saveRecurringItems(data)));
        } catch (error) {
            res.statusCode = error.statusCode || 400;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // GET /api/quick-meals - Built-in simple plates plus lightweight custom meals
    if (pathname === '/api/quick-meals' && req.method === 'GET') {
        res.end(JSON.stringify(listQuickMeals()));
        return;
    }

    // POST /api/quick-meals - Create a lightweight meal from a name and ingredients
    if (pathname === '/api/quick-meals' && req.method === 'POST') {
        try {
            let body = '';
            await new Promise(resolve => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });
            const data = body ? JSON.parse(body) : {};
            res.statusCode = 201;
            res.end(JSON.stringify(createQuickMeal(data)));
        } catch (error) {
            res.statusCode = error.statusCode || 400;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // GET /api/recipes - List recipes
    if (pathname === '/api/recipes' && req.method === 'GET') {
        res.end(JSON.stringify(listRecipes()));
        return;
    }

    // GET /api/recipes/:slug - Get one recipe (markdown content)
    const recipeMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
    if (recipeMatch && req.method === 'GET') {
        const recipe = getRecipe(recipeMatch[1]);
        if (!recipe) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Recipe not found' }));
            return;
        }
        res.end(JSON.stringify(recipe));
        return;
    }

    // DELETE /api/recipes/:slug - Delete recipe markdown + image
    const deleteMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
        try {
            const result = deleteRecipe(deleteMatch[1]);
            console.log(`✓ Deleted recipe ${result.slug}`);
            res.end(JSON.stringify({ success: true, slug: result.slug }));
        } catch (error) {
            console.error('Recipe delete error:', error.message);
            res.statusCode = error.message === 'Recipe not found' ? 404 : 500;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // PUT /api/recipes/:slug - Update title, alt name, and/or category
    const updateMatch = pathname.match(/^\/api\/recipes\/([^/]+)$/);
    if (updateMatch && req.method === 'PUT') {
        try {
            let body = '';
            await new Promise(resolve => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });
            const data = body ? JSON.parse(body) : {};
            const updated = updateRecipeMeta(updateMatch[1], {
                title: data.title,
                altName: data.altName,
                category: data.category,
            });
            res.end(JSON.stringify(updated));
        } catch (error) {
            console.error('Recipe update error:', error.message);
            res.statusCode = error.statusCode || (error.message === 'Recipe not found' ? 404 : 500);
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // POST /api/recipes/:slug/regenerate-image - Regenerate cover image from Wikimedia Commons
    const regenMatch = pathname.match(/^\/api\/recipes\/([^/]+)\/regenerate-image$/);
    if (regenMatch && req.method === 'POST') {
        try {
            let body = '';
            await new Promise(resolve => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });
            const data = body ? JSON.parse(body) : {};
            const result = await regenerateRecipeImage(regenMatch[1], data.searchTerm);
            console.log(`✓ Regenerated image for ${result.slug} from "${result.candidate}"`);
            res.end(JSON.stringify({ success: true, ...result }));
        } catch (error) {
            console.error('Regenerate image error:', error.message);
            res.statusCode = error.message === 'Recipe not found' ? 404 : 500;
            res.end(JSON.stringify({ error: error.message }));
        }
        return;
    }

    // POST /api/recipes/scan - Scan recipe from image
    if (pathname === '/api/recipes/scan' && req.method === 'POST') {
        try {
            let body = '';
            await new Promise(resolve => {
                req.on('data', chunk => body += chunk);
                req.on('end', resolve);
            });

            const data = JSON.parse(body);
            if (!data.image || !data.mediaType) {
                res.statusCode = 400;
                res.end(JSON.stringify({ error: 'Missing image or mediaType' }));
                return;
            }

            // Extract recipe using Claude Vision
            console.log('Scanning recipe with Claude Vision...');
            const markdown = await scanRecipeFromImage(data.image, data.mediaType);

            // Save recipe and image
            const result = saveScannedRecipe(markdown, data.image, data.mediaType);
            console.log(`✓ Saved recipe: ${result.slug}`);

            res.end(JSON.stringify({
                success: true,
                slug: result.slug,
                title: result.title,
                image: result.image
            }));
        } catch (error) {
            console.error('Recipe scan error:', error);
            res.statusCode = 500;
            res.end(JSON.stringify({
                error: 'Failed to scan recipe',
                message: error.message
            }));
        }
        return;
    }

    // 404
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
}

// ===================
// Static File Server
// ===================
function serveStatic(req, res, pathname) {
    let filePath = pathname === '/' ? '/index.html' : pathname;
    filePath = path.join(__dirname, filePath);

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.statusCode = 404;
                res.end('File not found');
            } else {
                res.statusCode = 500;
                res.end('Server error');
            }
            return;
        }

        res.setHeader('Content-Type', contentType);
        if (['.html', '.js', '.css'].includes(ext)) {
            res.setHeader('Cache-Control', 'no-cache');
        }
        res.end(data);
    });
}

// ===================
// Supermarket Location Monitor
// ===================
const DEVICE_TRACKER = 'device_tracker.google_maps_108072729064674902442';
const LOCATION_KEYWORD = 'supermercado';
const MONITOR_INTERVAL_MS = 60_000; // check every 60 seconds
const NOTIFICATION_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours between notifications

let lastNotificationTime = 0;
let wasAtSupermarket = false;

async function checkSupermarketLocation() {
    try {
        const state = await getHAState(DEVICE_TRACKER);
        if (!state) return;

        // Check state and attributes for "supermercado"
        const locationFields = [
            state.state,
            state.attributes?.friendly_name,
            state.attributes?.address,
            state.attributes?.location_name,
        ].filter(Boolean).map(s => s.toLowerCase());

        const atSupermarket = locationFields.some(f => f.includes(LOCATION_KEYWORD));

        if (atSupermarket && !wasAtSupermarket) {
            const now = Date.now();
            if (now - lastNotificationTime > NOTIFICATION_COOLDOWN_MS) {
                await sendShoppingListNotification();
                lastNotificationTime = now;
            }
        }

        wasAtSupermarket = atSupermarket;
    } catch (e) {
        console.error('Supermarket monitor error:', e.message);
    }
}

async function sendShoppingListNotification() {
    const items = readShoppingList();
    const unchecked = items.filter(i => !i.checked);

    if (unchecked.length === 0) {
        console.log('At supermarket but shopping list is empty, skipping notification');
        return;
    }

    const groups = await groupShoppingItems(unchecked.map(i => i.text), anthropic);
    const message = formatGroupedShoppingList(groups, { title: false });
    const title = `Lista de la compra (${unchecked.length} items)`;

    const success = await callHAService('notify', 'pushbullet_de_mar', {
        title,
        message,
    });

    if (success) {
        console.log(`Sent shopping list (${unchecked.length} items) via Pushbullet`);
    } else {
        console.error('Failed to send shopping list via Pushbullet');
    }
}

async function sendPushbulletNotification(title, body) {
    if (!PUSHBULLET_TOKEN) {
        console.error('PUSHBULLET_TOKEN not configured');
        return false;
    }

    return new Promise((resolve) => {
        const payload = JSON.stringify({
            type: 'note',
            title,
            body
        });

        const req = https.request({
            hostname: 'api.pushbullet.com',
            path: '/v2/pushes',
            method: 'POST',
            headers: {
                'Access-Token': PUSHBULLET_TOKEN,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(true);
                    return;
                }
                console.error('Pushbullet request failed:', res.statusCode, data);
                resolve(false);
            });
        });

        req.on('error', (err) => {
            console.error('Pushbullet request error:', err.message);
            resolve(false);
        });

        req.write(payload);
        req.end();
    });
}

// ===================
// Main Server
// ===================
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    console.log(`${req.method} ${pathname}`);

    if (pathname.startsWith('/api/')) {
        await handleAPI(req, res, pathname);
        return;
    }

    serveStatic(req, res, pathname);
});

server.listen(PORT, async () => {
    console.log(`\n🍳 Kitchen UI server running at http://localhost:${PORT}\n`);

    const connected = await checkHAConnection();
    if (connected) {
        console.log(`✅ Connected to Home Assistant at ${HA_CONFIG.url}`);
    } else {
        console.log(`❌ Failed to connect to Home Assistant at ${HA_CONFIG.url}`);
    }
    // Start supermarket location monitor
    setInterval(checkSupermarketLocation, MONITOR_INTERVAL_MS);
    checkSupermarketLocation(); // initial check
    console.log(`Supermarket monitor active (checking every ${MONITOR_INTERVAL_MS / 1000}s, cooldown ${NOTIFICATION_COOLDOWN_MS / 3600000}h)`);
    console.log('');
});
