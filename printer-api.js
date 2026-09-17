const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_FILE = process.env.PRINTER_TOKEN_FILE || path.join(__dirname, '../funprint/.api-token');

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', chunk => {
            size += chunk.length;
            if (size > 4100000) {
                reject(Object.assign(new Error('Print request is too large'), { status: 413 }));
            } else chunks.push(chunk);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
            catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
        });
        req.on('error', reject);
    });
}

function forward(method, route, token, key, body) {
    return new Promise((resolve, reject) => {
        const data = body === undefined ? null : JSON.stringify(body);
        const headers = { Authorization: `Bearer ${token}` };
        if (data) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(data);
        }
        if (key) headers['Idempotency-Key'] = key;
        const request = http.request({ hostname: '127.0.0.1', port: 8097, path: route,
            method, headers, timeout: 15000 }, response => {
            let result = '';
            response.on('data', chunk => result += chunk);
            response.on('end', () => resolve({ status: response.statusCode, body: result }));
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error('Print service timed out')));
        request.on('error', reject);
        request.end(data);
    });
}

async function handlePrinterAPI(req, res, pathname, readShoppingList, buildShoppingListText) {
    if (!pathname.startsWith('/api/print') && !pathname.startsWith('/api/shopping/print')) return false;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    try {
        const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
        const shopping = pathname.startsWith('/api/shopping/print');
        if (!shopping) {
            const supplied = Buffer.from(req.headers.authorization || '');
            const expected = Buffer.from(`Bearer ${token}`);
            if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
                throw Object.assign(new Error('Bearer token required'), { status: 401 });
            }
        }
        let route, body;
        if (req.method === 'POST' && (pathname === '/api/print' || pathname === '/api/shopping/print')) {
            if ((req.headers['content-type'] || '').split(';')[0] !== 'application/json') {
                throw Object.assign(new Error('Send application/json'), { status: 415 });
            }
            if (shopping) {
                let sameOrigin = false;
                try { sameOrigin = new URL(req.headers.origin).host === req.headers.host; } catch {}
                if (!sameOrigin) throw Object.assign(new Error('Print shopping lists from the kitchen app'), { status: 403 });
            }
            body = await readBody(req);
            if (shopping) {
                const items = body.items === undefined
                    ? readShoppingList().filter(item => !item.checked).map(item => item.text)
                    : body.items;
                if (!Array.isArray(items) || !items.length || items.length > 80 ||
                    items.some(item => typeof item !== 'string' || !item.trim() || item.length > 200)) {
                    throw Object.assign(new Error('Add 1–80 unchecked items before printing'), { status: 400 });
                }
                const text = buildShoppingListText
                    ? await buildShoppingListText(items)
                    : 'Lista de la compra\n\n' + items.map(item => '[ ] ' + item.trim().replace(/[\r\n]/g, ' ')).join('\n');
                body = { printer: 'pt210', type: 'text', title: 'Shopping list', font_size: 24, align: 'left', text };
            }
            route = '/jobs';
        } else if (req.method === 'GET' && /^\/api\/(?:print\/jobs|shopping\/print)\/[0-9a-f-]{36}$/.test(pathname)) {
            route = '/jobs/' + pathname.split('/').pop();
        } else if (req.method === 'GET' && pathname === '/api/print/health') {
            route = '/health';
        } else throw Object.assign(new Error('Print endpoint not found'), { status: 404 });
        const result = await forward(req.method, route, token, req.headers['idempotency-key'], body);
        res.statusCode = result.status;
        res.end(result.body);
    } catch (error) {
        res.statusCode = error.status || 503;
        res.end(JSON.stringify({ error: error.status ? error.message : 'Printer service unavailable. Retry using the same request ID.' }));
    }
    return true;
}

module.exports = { handlePrinterAPI };
