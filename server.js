const http = require('http');
const fs = require('fs');
const path = require('path');

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
        power: 'sensor.potencia_total'
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
                    sensors[key] = {
                        value: parseFloat(state.state),
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
