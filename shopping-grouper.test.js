const { test } = require('node:test');
const assert = require('node:assert/strict');
const { groupShoppingItems, formatGroupedShoppingList } = require('./shopping-grouper');

function anthropicResponse(assignments, inspectRequest) {
    return {
        messages: {
            async create(request) {
                inspectRequest?.(request);
                return { content: [{ type: 'text', text: JSON.stringify({ assignments }) }] };
            },
        },
    };
}

test('uses Haiku and groups every source item exactly once', async () => {
    let request;
    const groups = await groupShoppingItems(
        ['tomate', 'hielo', 'pharma loratadina', 'que son nachos'],
        anthropicResponse([
            { index: 0, section: 'produce' },
            { index: 1, section: 'frozen' },
            { index: 3, section: 'other' },
        ], value => { request = value; }),
    );

    assert.equal(request.model, 'claude-haiku-4-5-20251001');
    assert.equal(request.output_config.format.type, 'json_schema');
    assert.equal(request.messages[0].content.includes('pharma loratadina'), false);
    assert.deepEqual(groups.flatMap(group => group.items),
        ['tomate', 'hielo', 'pharma loratadina', 'que son nachos']);
    assert.deepEqual(groups.map(group => group.id), ['produce', 'frozen', 'pharmacy', 'other']);
});

test('omitted, duplicate and invalid assignments safely fall back to Other', async () => {
    const groups = await groupShoppingItems(
        ['pan', 'leche', 'misterio'],
        anthropicResponse([
            { index: 0, section: 'bakery' },
            { index: 0, section: 'drinks' },
            { index: 1, section: 'not-a-section' },
            { index: 99, section: 'produce' },
        ]),
    );

    assert.deepEqual(groups, [
        { id: 'bakery', title: 'Panadería y bollería', items: ['pan'] },
        { id: 'other', title: 'Otros / por aclarar', items: ['leche', 'misterio'] },
    ]);
});

test('API failure keeps the complete list and printer formatting', async () => {
    const warnings = [];
    const anthropic = { messages: { async create() { throw new Error('offline'); } } };
    const groups = await groupShoppingItems(['Piñones\n500g', 'Café'], anthropic,
        { warn: message => warnings.push(message) });

    assert.equal(warnings.length, 1);
    assert.equal(formatGroupedShoppingList(groups, { checkbox: true }),
        'Lista de la compra\n\nOtros / por aclarar\n[ ] Piñones 500g\n[ ] Café');
});
