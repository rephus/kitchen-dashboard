const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { normalizeOrderSummary, createOrderSummaryPdf } = require('./order-ready');

test('normalizes an order summary and rejects unsafe URLs', () => {
    const summary = normalizeOrderSummary({
        store: 'DIA',
        items: [{ name: 'Leche entera', quantity: '2 x 1 L', price: 2.4 }],
        total: 2.4,
        recipes: ['Chili con carne'],
        basketUrl: 'https://www.dia.es/cart',
    });
    assert.equal(summary.items[0].status, 'added');
    assert.equal(summary.currency, 'EUR');
    assert.throws(() => normalizeOrderSummary({ store: 'DIA', items: [], basketUrl: 'file:///tmp/cart' }));
});

test('creates a readable PDF report', async t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-order-'));
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
    const outputPath = path.join(tempDir, 'report.pdf');
    await createOrderSummaryPdf({
        store: 'Mercadona',
        test: true,
        items: [
            { name: 'Garrafa de agua 8 L', quantity: '2 unidades', price: 3.1, status: 'added' },
            { name: 'Pastillas de lavavajillas', quantity: '1 caja', status: 'manual' },
        ],
        total: 3.1,
        recipes: ['Puchero', 'Chili con carne suave'],
        missing: ['Pastillas de lavavajillas: comprar en Carrefour'],
        notes: ['No se ha formalizado el pedido.'],
    }, outputPath);

    const pdf = fs.readFileSync(outputPath);
    assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdf.length > 2000);
});
