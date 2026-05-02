const http = require('http');
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// Load .env
require('dotenv').config();

// ===================
// Configuration
// ===================
const PORT = 8002;

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

function listRecipes() {
    if (!fs.existsSync(RECIPES_DIR)) return [];
    const files = fs.readdirSync(RECIPES_DIR)
        .filter(f => f.endsWith('.md'))
        .map(f => {
            const slug = f.replace(/\.md$/, '');
            let title = slug.replace(/-/g, ' ');
            try {
                const content = fs.readFileSync(path.join(RECIPES_DIR, f), 'utf8');
                const m = content.match(/^#\s+(.+)/m);
                if (m) title = m[1].trim();
            } catch (e) { /* use slug as title */ }
            const image = findRecipeImage(slug);
            return { slug, title, image };
        });
    return files.sort((a, b) => a.title.localeCompare(b.title));
}

function getRecipe(slug) {
    const safeSlug = path.basename(slug, '.md').replace(/[^a-z0-9-]/gi, '');
    const filePath = path.join(RECIPES_DIR, safeSlug + '.md');
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf8');
    const titleMatch = content.match(/^#\s+(.+)/m);
    return {
        slug: safeSlug,
        title: titleMatch ? titleMatch[1].trim() : safeSlug,
        content,
        image: findRecipeImage(safeSlug)
    };
}

/**
 * Scan recipe from base64 image using Claude Vision API
 */
async function scanRecipeFromImage(base64Image, mediaType) {
    if (!anthropic) {
        throw new Error('ANTHROPIC_API_KEY not configured');
    }

    const message = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
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
    console.log('');
});
