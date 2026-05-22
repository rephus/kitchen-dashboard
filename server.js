const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Load .env
require('dotenv').config();

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

// ===================
// Recipes (markdown files in recipes/)
// ===================
const RECIPES_DIR = path.join(__dirname, 'recipes');
const RECIPE_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

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
            try {
                const r = readRecipeFile(slug);
                if (r) {
                    title = r.title;
                    altName = r.meta.alt || null;
                }
            } catch (e) { /* use slug as title */ }
            const image = findRecipeImage(slug);
            return { slug, title, altName, image };
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
        content: r.body,
        image: findRecipeImage(r.safeSlug),
    };
}

function deleteRecipe(slug) {
    const r = readRecipeFile(slug);
    if (!r) throw new Error('Recipe not found');
    fs.unlinkSync(r.filePath);
    for (const ext of RECIPE_IMAGE_EXTS) {
        const imgPath = path.join(RECIPES_DIR, r.safeSlug + ext);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    return { slug: r.safeSlug };
}

function updateRecipeMeta(slug, { title, altName } = {}) {
    const r = readRecipeFile(slug);
    if (!r) throw new Error('Recipe not found');

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

    // PUT /api/recipes/:slug - Update title and/or alt name
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
            });
            res.end(JSON.stringify(updated));
        } catch (error) {
            console.error('Recipe update error:', error.message);
            res.statusCode = error.message === 'Recipe not found' ? 404 : 500;
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

    const message = unchecked.map(i => `- ${i.text}`).join('\n');
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
