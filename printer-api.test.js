const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const { handlePrinterAPI } = require('./printer-api');

async function request(body, { origin = 'https://kitchen.example', route = '/api/shopping/print', buildShoppingListText } = {}) {
    let forwarded;
    const read = fs.readFileSync;
    const send = http.request;
    fs.readFileSync = () => 'test-token';
    http.request = (options, callback) => {
        const upstream = new EventEmitter();
        upstream.end = data => {
            forwarded = { options, body: JSON.parse(data) };
            const response = new EventEmitter();
            response.statusCode = 202;
            callback(response);
            queueMicrotask(() => {
                response.emit('data', '{"id":"test-job"}');
                response.emit('end');
            });
        };
        return upstream;
    };
    try {
        const req = Readable.from([Buffer.from(JSON.stringify(body))]);
        req.method = 'POST';
        req.headers = { host: 'kitchen.example', origin, 'content-type': 'application/json',
            'idempotency-key': 'test-print-key', authorization: 'Bearer test-token' };
        const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
        await handlePrinterAPI(req, res, route,
            () => [{ text: 'Café', checked: false }, { text: 'Pan', checked: true }], buildShoppingListText);
        return { res, forwarded };
    } finally {
        fs.readFileSync = read;
        http.request = send;
    }
}

test('shopping jobs target PT210 and keep Unicode and the request ID', async () => {
    const { res, forwarded } = await request({ items: [' Piñones\n500g ', 'Café'] });
    assert.equal(res.statusCode, 202);
    assert.equal(forwarded.body.printer, 'pt210');
    assert.equal(forwarded.body.text, 'Lista de la compra\n\n[ ] Piñones 500g\n[ ] Café');
    assert.equal(forwarded.options.headers['Idempotency-Key'], 'test-print-key');
});

test('server-side shopping list excludes checked items', async () => {
    const { forwarded } = await request({});
    assert.equal(forwarded.body.text, 'Lista de la compra\n\n[ ] Café');
});

test('shopping print uses the grouped formatter when supplied', async () => {
    const { forwarded } = await request({ items: ['Tomate', 'Hielo'] }, {
        buildShoppingListText: async items => `AGRUPADA\n${items.join('|')}`,
    });
    assert.equal(forwarded.body.text, 'AGRUPADA\nTomate|Hielo');
});

test('generic API retains its existing printer default', async () => {
    const { forwarded } = await request({ type: 'text', text: 'Generic note' }, { route: '/api/print' });
    assert.equal(forwarded.body.printer, undefined);
});

test('empty lists and cross-origin shopping prints are rejected', async () => {
    for (const [body, options, status] of [[{ items: [] }, {}, 400], [{ items: ['Pan'] }, { origin: 'https://other.example' }, 403]]) {
        const { res, forwarded } = await request(body, options);
        assert.equal(res.statusCode, status);
        assert.equal(forwarded, undefined);
    }
});
