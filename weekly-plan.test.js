const test = require('node:test');
const assert = require('node:assert/strict');
const {
    extractRecipeIngredients,
    buildPlanShoppingItems,
    reconcilePlanShoppingItems,
    normalizeIngredient,
    canonicalPantryIngredient,
    canonicalIngredientKey,
} = require('./weekly-plan');

test('extracts ingredient bullets from all sections before the method', () => {
    const markdown = `# Paella\n\n## Sofrito\n\n- 5 tomates\n- 2 pimientos\n\n## Caldo\n\n- Pollo\n\n## Elaboración\n\n- This is an instruction, not an ingredient`;
    assert.deepEqual(extractRecipeIngredients(markdown), ['5 tomates', '2 pimientos', 'Pollo']);
});

test('groups Spanish and English equivalents and keeps every recipe line', () => {
    const items = buildPlanShoppingItems([
        { id: 'quiche', ingredients: ['1 huevo', '5 huevos (4 grandes)'] },
        { id: 'toast', ingredients: ['egg', 'cherry tomatoes', 'Pollo'] },
        { id: 'omelette', ingredients: ['eggs', 'tomato', '1–2 pechuga pollo'] },
    ]);

    const eggs = items.find(item => item.key === 'huevo');
    assert.equal(eggs.text, 'Huevos — 6 uds · 2 recetas sin cantidad');
    assert.equal(eggs.quantityText, '6 uds');
    assert.equal(eggs.missingQuantityCount, 2);
    assert.deepEqual(eggs.mealIds, ['quiche', 'toast', 'omelette']);
    assert.deepEqual(eggs.variants.map(variant => variant.text), [
        '1 huevo', '5 huevos (4 grandes)', 'egg', 'eggs',
    ]);

    const tomatoes = items.find(item => item.key === 'tomate');
    assert.deepEqual(tomatoes.mealIds, ['omelette']);
    assert.deepEqual(items.find(item => item.key === 'tomate cherry').mealIds, ['toast']);
    assert.equal(tomatoes.missingQuantityCount, 1);

    const chicken = items.find(item => item.key === 'pollo');
    assert.equal(chicken.text, 'Pollo');
    assert.deepEqual(chicken.mealIds, ['toast']);
    assert.equal(items.find(item => item.key === 'pechuga de pollo').quantityText, '1–2 uds');
});

test('sums compatible weights and converts kilograms to grams', () => {
    const [item] = buildPlanShoppingItems([
        { id: 'one', ingredients: ['500 g carne picada'] },
        { id: 'two', ingredients: ['0,75 kg de carne picada'] },
    ]);
    assert.equal(item.key, 'carne picada');
    assert.equal(item.quantityText, '1,25 kg');
    assert.equal(item.text, 'Carne picada — 1,25 kg');
    assert.equal(item.missingQuantityCount, 0);
});

test('keeps incompatible quantity units explicit instead of guessing a conversion', () => {
    const items = buildPlanShoppingItems([
        { id: 'one', ingredients: ['400 g de tomate'] },
        { id: 'two', ingredients: ['1 lata de tomate'] },
    ]);
    assert.deepEqual(items.map(item => [item.key, item.quantityText]), [['tomate', '400 g'], ['tomate (conserva)', '1 latas']]);
});

test('does not add noisy missing-quantity text to an ingredient used once', () => {
    const [item] = buildPlanShoppingItems([{ id: 'one', ingredients: ['Sal'] }]);
    assert.equal(item.text, 'Sal');
    assert.equal(item.quantityText, '');
    assert.equal(item.missingQuantityCount, 1);
});

test('marks excluded ingredients by their canonical grouped key', () => {
    const items = buildPlanShoppingItems([
        { id: 'dinner', ingredients: ['2 Tomates', 'tomato', 'Aceite de oliva'] },
    ], ['tomate']);
    assert.equal(normalizeIngredient('  2 TOMATES '), '2 tomates');
    assert.equal(items.find(item => item.key === 'tomate').excluded, true);
    assert.equal(items.find(item => item.key === 'aceite de oliva').excluded, false);
});

test('canonicalizes quantities, plurals and units for grouping and pantry matching', () => {
    assert.equal(canonicalPantryIngredient('1 cucharadita de comino'), 'comino');
    assert.equal(canonicalPantryIngredient('4 dientes de ajo'), 'ajo');
    assert.equal(canonicalPantryIngredient('4 dientes de ajo finamente picados'), 'ajo');
    assert.equal(canonicalPantryIngredient('200 ml de aceite de oliva'), 'aceite de oliva');
    assert.equal(canonicalPantryIngredient('1 cdta aceite'), 'aceite de oliva');
    assert.equal(canonicalPantryIngredient('2 cdta cilantro molido'), 'cilantro molido');
    assert.equal(canonicalPantryIngredient('1 cdta comino molido'), 'comino');
    assert.equal(canonicalPantryIngredient('1 lata de 400 g de tomates'), 'tomate');
    assert.equal(canonicalPantryIngredient('2–6 guindillas rojas, sin semillas'), 'guindilla roja');
    assert.equal(canonicalPantryIngredient('5 huevos (4 grandes)'), 'huevo');
    assert.equal(canonicalPantryIngredient('Sal al gusto'), 'sal');
    assert.equal(canonicalIngredientKey('eggs'), 'huevo');
    assert.equal(canonicalIngredientKey('cherry tomatoes'), 'tomate cherry');
    assert.equal(canonicalIngredientKey('chicken breast'), 'pechuga de pollo');
});

test('marks a grouped ingredient as pantry while retaining it for review', () => {
    const items = buildPlanShoppingItems([
        { id: 'chilli', ingredients: ['1 cucharadita de comino', 'Comino', '2 tomates'] },
        { id: 'stew', ingredients: ['4 dientes de ajo'] },
    ], [], ['comino', 'ajo']);

    const cumin = items.find(item => item.key === 'comino');
    assert.equal(cumin.excluded, true);
    assert.equal(cumin.pantry, true);
    assert.equal(cumin.pantryKey, 'comino');
    assert.deepEqual(cumin.mealIds, ['chilli']);

    const garlic = items.find(item => item.key === 'ajo');
    assert.equal(garlic.excluded, true);
    assert.equal(garlic.pantry, true);
    assert.equal(items.find(item => item.key === 'tomate').excluded, false);
});

test('replaces prior plan ingredients and canonically deduplicates manual items', () => {
    const existing = [
        { text: 'chicken', checked: false },
        { text: 'Old ingredient', checked: false, source: 'weekly-plan', mealIds: ['old'] },
    ];
    const planned = buildPlanShoppingItems([
        { id: 'new', ingredients: ['500 g pollo', '2 tomates'] },
    ]);
    const reconciled = reconcilePlanShoppingItems(existing, planned);
    assert.deepEqual(reconciled.map(item => item.text), ['chicken', 'Tomate — 2 uds']);
});

test('built-in quick meals keep stable IDs and Spanish display content', () => {
    const meals = require('./data/simple-plates.json');
    assert.equal(new Set(meals.map(meal => meal.id)).size, meals.length);
    assert.ok(meals.every(meal => /^basic-\d+-/.test(meal.id)));
    assert.equal(
        meals.find(meal => meal.id === 'basic-10-potato-omelette-with-tomato-salad')?.title,
        'Tortilla de patatas con ensalada de tomate',
    );
    assert.equal(
        meals.find(meal => meal.id === 'basic-29-avocado-egg-toast-with-cherry-tomatoes')?.title,
        'Tostada de aguacate y huevo con tomates cherry',
    );
    const displayText = meals
        .flatMap(meal => [meal.title, meal.note, ...(meal.ingredients || [])])
        .join(' ');
    assert.doesNotMatch(
        displayText,
        /\b(?:chicken|egg|eggs|tomato|tomatoes|bread|lettuce|cheese|onion|potato|rice|beans|quick dinner|simple plate|kid friendly)\b/i,
    );
});

test('retains a checked recipe ingredient when the plan is regenerated', () => {
    const existing = [{ key: 'tomate', text: 'Tomate — 2 uds', source: 'weekly-plan', checked: true, id: 'tomato-row' }];
    const next = reconcilePlanShoppingItems(existing, buildPlanShoppingItems([{ id: 'salad', ingredients: ['3 tomatoes'] }]));
    assert.equal(next[0].checked, true);
    assert.equal(next[0].id, 'tomato-row');
    assert.equal(next[0].quantityText, '3 uds');
});

test('basket exclusions override recipes, manual duplicates and recurring items', () => {
    const { buildOrderProposal } = require('./weekly-plan');
    const proposal = buildOrderProposal({
        shoppingItems: [
            { key: 'tomate', text: 'Tomate — 2 uds', included: true, mealTitles: ['Ensalada'] },
            { key: 'huevo', text: 'Huevos', included: true, mealTitles: ['Tortilla'] },
            { key: 'arroz', text: 'Arroz', included: true, mealTitles: ['Paella'] },
        ],
        shoppingList: [{ text: 'tomatoes', checked: true }, { text: 'eggs', orderExcluded: true }],
        otherShoppingItems: [{ text: 'Tomates', included: true }, { text: 'Papel cocina', included: true }],
        recurringItems: [{ text: 'Huevos', active: true }, { text: 'Agua 8 L', active: true }, { text: 'Cerveza', active: false }],
        pantryItems: [{ key: 'arroz', label: 'Arroz' }],
    });
    assert.deepEqual(proposal.orderItems.map(item => item.text), ['Papel cocina', 'Agua 8 L']);
    assert.deepEqual(proposal.orderItems.map(item => item.sources[0].type), ['shopping-list', 'recurring']);
    assert.deepEqual(proposal.orderExclusions.map(item => item.key), ['tomate', 'huevo', 'arroz']);
});

test('recipe exclusions block another source and retain every recipe origin on included items', () => {
    const { buildOrderProposal } = require('./weekly-plan');
    const input = {
        shoppingItems: [{ key: 'pollo', text: 'Pollo', included: true, mealTitles: ['Puchero', 'Ensalada'] }],
        otherShoppingItems: [{ text: '2 tomates', included: true }],
        excludedIngredients: ['tomato'],
    };
    assert.deepEqual(buildOrderProposal(input).orderItems.map(item => item.sources), [[
        { type: 'recipe', name: 'Puchero' }, { type: 'recipe', name: 'Ensalada' },
    ]]);
    assert.equal(buildOrderProposal({ ...input, excludedIngredients: [] }).orderItems.length, 2);
});

const { spiceKey, isSpiceExcluded } = require('./weekly-plan');
test('spice category covers common names, quantities and dried variants', () => {
    for (const name of ['Nuez moscada', '1 cdta de orégano', 'perejil', 'pimentón dulce', 'pimienta negra molida',
        '2 cucharaditas de comino', 'cúrcuma', 'ajo en polvo', 'cebolla en polvo', 'mostaza en grano',
        'ground nutmeg', 'dried parsley', 'black pepper', 'sal, pimienta y nuez moscada', 'hierbas provenzales']) {
        assert.equal(isSpiceExcluded(name, { enabled: true, exceptions: [] }), true, name);
    }
});

test('does not confuse spices with fresh herbs, vegetables, sauces or prepared food', () => {
    for (const name of ['perejil fresco', '1 manojo de perejil', 'cilantro (fresco)', 'fresh basil', 'hierbas congeladas',
        'pimiento rojo', 'ajo', 'cebolla', 'jengibre fresco', 'salsa de curry', 'pollo al curry', 'mostaza',
        'pimienta negra con pollo', 'perejil, tomate']) assert.equal(spiceKey(name), null, name);
});

test('spice rule can be disabled or overridden per spice', () => {
    assert.equal(isSpiceExcluded('orégano', { enabled: false }), false);
    assert.equal(isSpiceExcluded('2 cdta orégano seco', { enabled: true, exceptions: ['oregano'] }), false);
    assert.equal(isSpiceExcluded('pimentón', { enabled: true, exceptions: ['oregano'] }), true);
});

test('recipe spices become pantry items and an exception brings them back', () => {
    const meals = [{ id: 'one', ingredients: ['1 cdta orégano', 'perejil fresco', '2 tomates'] }];
    const grouped = buildPlanShoppingItems(meals, [], [], { enabled: true, exceptions: [] });
    assert.equal(grouped[0].pantryRule, 'spices');
    assert.equal(grouped[0].excluded, true);
    assert.equal(grouped[1].excluded, false);
    assert.equal(grouped[2].excluded, false);
    assert.equal(buildPlanShoppingItems(meals, [], [], { enabled: true, exceptions: ['oregano'] })[0].excluded, false);
});

test('category exclusion also applies to manual and recurring purchase candidates', () => {
    const { buildOrderProposal } = require('./weekly-plan');
    const input = { otherShoppingItems: [{ text: 'Pimentón', included: true }, { text: 'Perejil fresco', included: true }],
        recurringItems: [{ text: 'Nuez moscada', active: true }], spiceRule: { enabled: true, exceptions: [] } };
    const proposal = buildOrderProposal(input);
    assert.deepEqual(proposal.orderItems.map(item => item.text), ['Perejil fresco']);
    assert.equal(proposal.orderExclusions.length, 2);
    assert.equal(buildOrderProposal({ ...input, spiceRule: { enabled: false } }).orderItems.length, 3);
});
