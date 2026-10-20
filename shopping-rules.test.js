const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    normalizeShoppingRules,
    replaceShoppingRulesSection,
} = require('./shopping-rules');

test('normalizes editable shopping rules and keeps disabled entries visible', () => {
    let next = 0;
    const rules = normalizeShoppingRules([
        { id: 'eggs', product: '  Huevos  ', rule: '  Solo camperos  ', active: false },
        { id: 'eggs', product: 'Atún', rule: 'En aceite de oliva' },
    ], () => `generated-${++next}`);
    assert.deepEqual(rules, [
        { id: 'eggs', product: 'Huevos', rule: 'Solo camperos', active: false },
        { id: 'generated-1', product: 'Atún', rule: 'En aceite de oliva', active: true },
    ]);
});

test('updates only the marked product-rules table in the preferences markdown', () => {
    const markdown = '# Preferencias\n\n## Productos\n\n<!-- shopping-rules:start -->\nold\n<!-- shopping-rules:end -->\n\n## Funcionamiento\n\nKeep this.';
    const updated = replaceShoppingRulesSection(markdown, [
        { id: 'eggs', product: 'Huevos', rule: '6 huevos camperos | sin sustitución', active: true },
    ]);
    assert.match(updated, /\| Huevos \| 6 huevos camperos \\\| sin sustitución \| Sí \|/);
    assert.match(updated, /## Funcionamiento\n\nKeep this\./);
    assert.doesNotMatch(updated, /\nold\n/);
});
