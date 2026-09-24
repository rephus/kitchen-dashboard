const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractRecipeIngredients,
    buildPlanShoppingItems,
    reconcilePlanShoppingItems,
} = require('./weekly-plan');

test('extracts ingredient bullets from all sections before the method', () => {
    const markdown = `# Paella\n\n## Sofrito\n\n- 5 tomates\n- 2 pimientos\n\n## Caldo\n\n- Pollo\n\n## Elaboración\n\n- This is an instruction, not an ingredient`;
    assert.deepEqual(extractRecipeIngredients(markdown), ['5 tomates', '2 pimientos', 'Pollo']);
});

test('deduplicates matching ingredients and keeps their meal sources', () => {
    const items = buildPlanShoppingItems([
        { slug: 'one', ingredients: ['1 cebolla', 'Sal'] },
        { id: 'quick-two', ingredients: [' sal ', '2 tomates'] },
    ]);
    assert.deepEqual(items, [
        { text: '1 cebolla', checked: false, source: 'weekly-plan', mealIds: ['one'] },
        { text: 'Sal', checked: false, source: 'weekly-plan', mealIds: ['one', 'quick-two'] },
        { text: '2 tomates', checked: false, source: 'weekly-plan', mealIds: ['quick-two'] },
    ]);
});

test('replaces prior plan ingredients while preserving manual shopping items', () => {
    const existing = [
        { text: 'leche', checked: false },
        { text: 'Old ingredient', checked: false, source: 'weekly-plan', mealIds: ['old'] },
    ];
    const planned = [
        { text: 'Leche', checked: false, source: 'weekly-plan', mealIds: ['new'] },
        { text: 'Tomates', checked: false, source: 'weekly-plan', mealIds: ['new'] },
    ];
    assert.deepEqual(reconcilePlanShoppingItems(existing, planned), [
        { text: 'leche', checked: false },
        { text: 'Tomates', checked: false, source: 'weekly-plan', mealIds: ['new'] },
    ]);
});
