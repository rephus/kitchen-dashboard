const PLAN_ITEM_SOURCE = 'weekly-plan';

const { normalizeIngredient, canonicalPantryIngredient, canonicalIngredientKey, legacyIngredientKey,
    aliasComparable, parseIngredientQuantity, normalizeIngredientLine, extractRecipeIngredients } = require('./ingredient-normalizer');

const INGREDIENT_LABELS = new Map([
    ['pollo', 'Pollo'],
    ['huevo', 'Huevos'],
    ['tomate', 'Tomate'],
    ['aguacate', 'Aguacate'],
    ['lechuga', 'Lechuga'],
    ['patata', 'Patatas'],
    ['cebolla', 'Cebolla'],
    ['zanahoria', 'Zanahoria'],
]);

const SPICE_NAMES = new Set(('nuez moscada|perejil|oregano|pimenton|pimienta|comino|cilantro|canela|curcuma|jengibre|cayena|azafran|clavo|clavo de olor|cardamomo|anis|anis estrellado|laurel|tomillo|romero|albahaca|eneldo|estragon|salvia|mejorana|hierbabuena|menta|cebollino|hinojo|fenogreco|alcaravea|ajedrea|sumac|zumaque|macis|enebro|mostaza en grano|ajo en polvo|cebolla en polvo|curry|garam masala|ras el hanout|zaatar|hierbas provenzales|hierba provenzal|hierba provenzale|finas hierbas|fina hierba|especias|especia|chile en polvo|chili en polvo|chilli en polvo').split('|'));
const SPICE_ALIASES = { nutmeg: 'nuez moscada', parsley: 'perejil', oregano: 'oregano', paprika: 'pimenton',
    pepper: 'pimienta', cumin: 'comino', coriander: 'cilantro', cinnamon: 'canela', turmeric: 'curcuma',
    ginger: 'jengibre', saffron: 'azafran', thyme: 'tomillo', rosemary: 'romero', basil: 'albahaca',
    dill: 'eneldo', tarragon: 'estragon', sage: 'salvia', marjoram: 'mejorana', mint: 'menta',
    'bay leaf': 'laurel', 'bay leaves': 'laurel', 'garlic powder': 'ajo en polvo', 'onion powder': 'cebolla en polvo' };

function spiceKey(value) {
    const raw = aliasComparable(value);
    if (/\b(fresc[oa]s?|fresh|manojos?|bunch|congelad[oa]s?|frozen)\b/.test(raw)) return null;
    let text = aliasComparable(canonicalPantryIngredient(value));
    const parts = text.split(/\s*(?:,|\+|\by\b)\s*/);
    if (parts.length > 1) return parts.every(part => part === 'sal' || spiceKey(part)) ? text : null;
    if (SPICE_NAMES.has(text)) return text;
    text = text.replace(/^(?:ground|dried|dry|black|white|smoked)\s+/, '')
        .replace(/^(?:ground|dried|dry)\s+/, '')
        .replace(/^(?:hojas? de|semillas? de)\s+/, '')
        .replace(/\s+(?:seco|seca|deshidratado|deshidratada|molido|molida|picado|picada|dulce|picante|ahumado|ahumada|negro|negra|blanco|blanca|verde|rojo|roja|en polvo|en grano|en rama|en hoja|entero|entera|de la vera)(?:\s+(?:molido|molida|dulce|picante|ahumado|ahumada|seco|seca|en polvo|de la vera))*$/, '');
    return SPICE_ALIASES[text] || (SPICE_NAMES.has(text) ? text : null);
}

function isSpiceExcluded(value, rule = {}) {
    const key = spiceKey(value);
    return rule.enabled === true && key !== null && !(rule.exceptions || []).includes(key);
}

function ingredientLabel(key) {
    if (INGREDIENT_LABELS.has(key)) return INGREDIENT_LABELS.get(key);
    return key ? key.charAt(0).toLocaleUpperCase('es') + key.slice(1) : '';
}

function formatAmount(value) {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100).replace('.', ',');
}

function formatQuantity(min, max, unit) {
    let displayMin = min;
    let displayMax = max;
    let displayUnit = unit;
    if (unit === 'g' && min >= 1000 && max >= 1000) {
        displayMin /= 1000;
        displayMax /= 1000;
        displayUnit = 'kg';
    } else if (unit === 'ml' && min >= 1000 && max >= 1000) {
        displayMin /= 1000;
        displayMax /= 1000;
        displayUnit = 'L';
    }
    const labels = { ud: 'uds', lata: 'latas', bote: 'botes', envase: 'envases', paquete: 'paquetes', rama: 'ramas', diente: 'dientes' };
    const amount = displayMin === displayMax
        ? formatAmount(displayMin)
        : `${formatAmount(displayMin)}–${formatAmount(displayMax)}`;
    return `${amount} ${labels[displayUnit] || displayUnit}`;
}

function finalizeShoppingItem(group, excluded, pantry, spiceRule) {
    const quantities = new Map();
    const missingMealIds = new Set();
    for (const variant of group.variants) {
        if (!variant.quantity) {
            missingMealIds.add(variant.mealId);
            continue;
        }
        const current = quantities.get(variant.quantity.unit) || { min: 0, max: 0 };
        current.min += variant.quantity.min;
        current.max += variant.quantity.max;
        quantities.set(variant.quantity.unit, current);
    }
    const quantityText = [...quantities]
        .map(([unit, amount]) => formatQuantity(amount.min, amount.max, unit))
        .join(' + ');
    const missingQuantityCount = missingMealIds.size;
    const label = ingredientLabel(group.key);
    const missingText = missingQuantityCount && group.variants.length > 1
        ? `${missingQuantityCount} ${missingQuantityCount === 1 ? 'receta sin cantidad' : 'recetas sin cantidad'}`
        : '';
    const summary = [quantityText, missingText].filter(Boolean).join(' · ');
    let pantryKey = [...pantry].find(key => key === group.key
        || group.variants.some(variant => canonicalPantryIngredient(variant.text) === key));
    const spice = !pantryKey && group.variants.every(variant => isSpiceExcluded(variant.text, spiceRule));
    if (spice) pantryKey = group.key;
    const pantryIngredient = Boolean(pantryKey);
    const excludedIngredient = excluded.has(group.key)
        || group.variants.some(variant => excluded.has(normalizeIngredient(variant.text)) || excluded.has(legacyIngredientKey(variant.text)));

    const item = {
        key: group.key,
        text: summary ? `${label} — ${summary}` : label,
        ingredientName: label,
        quantityText,
        missingQuantityCount,
        variants: group.variants.map(({ text, mealId, normalized }) => ({ text, mealId, normalized })),
        normalizationWarnings: [...new Set(group.variants.flatMap(variant => variant.normalized?.warnings || []))],
        requiresReview: group.variants.some(variant => variant.normalized?.warnings.some(warning => warning !== 'Cantidad no especificada')),
        combined: group.variants.length > 1,
        checked: false,
        source: PLAN_ITEM_SOURCE,
        mealIds: group.mealIds,
        excluded: excludedIngredient || pantryIngredient,
    };
    if (pantryIngredient) {
        item.pantry = true;
        item.pantryKey = pantryKey;
        if (spice) item.pantryRule = 'spices';
    }
    return item;
}

function buildPlanShoppingItems(meals, excludedIngredients = [], pantryIngredients = [], spiceRule = {}) {
    const byIngredient = new Map();
    const excluded = new Set(excludedIngredients.map(value => canonicalIngredientKey(value) || normalizeIngredient(value)));
    const pantry = new Set(pantryIngredients.map(canonicalPantryIngredient));

    for (const meal of meals) {
        const mealId = meal.id || meal.slug;
        for (const normalized of (meal.normalizedIngredients || meal.ingredients || []).flatMap(normalizeIngredientLine)) {
            const text = normalized.componentText;
            const key = normalized.key;
            if (!key) continue;
            const group = byIngredient.get(key) || { key, mealIds: [], variants: [] };
            if (!group.mealIds.includes(mealId)) group.mealIds.push(mealId);
            group.variants.push({ text, mealId, quantity: normalized.quantity, normalized });
            byIngredient.set(key, group);
        }
    }

    return [...byIngredient.values()].map(group => finalizeShoppingItem(group, excluded, pantry, spiceRule));
}

function reconcilePlanShoppingItems(existingItems, planItems) {
    const manualItems = existingItems.filter(item => item.source !== PLAN_ITEM_SOURCE);
    const manualPending = new Set(
        manualItems.filter(item => !item.checked).map(item => canonicalIngredientKey(item.text)),
    );
    const previousPlanItems = new Map(existingItems
        .filter(item => item.source === PLAN_ITEM_SOURCE)
        .map(item => [item.key || canonicalIngredientKey(item.text), item]));
    return manualItems.concat(planItems.filter(item => !manualPending.has(item.key)).map(item => {
        const previous = previousPlanItems.get(item.key) || item.variants
            .map(variant => previousPlanItems.get(legacyIngredientKey(variant.text))).find(Boolean);
        return previous ? { ...item, id: previous.id, checked: previous.checked === true } : item;
    }));
}

// This is the only purchase input for the scheduled basket. Raw recipe
// ingredients remain available for display, but must not bypass exclusions.
function buildOrderProposal({ shoppingItems = [], otherShoppingItems = [], recurringItems = [],
    shoppingList = [], excludedIngredients = [], pantryItems = [], spiceRule = {} }) {
    const exclusions = new Map();
    const exclude = (key, text, reason) => {
        if (key && !exclusions.has(key)) exclusions.set(key, { key, text, reason });
    };
    for (const item of shoppingList) {
        if (item.checked || item.orderExcluded || item.excluded) {
            exclude(item.key || canonicalIngredientKey(item.text), item.text,
                item.checked ? 'checked' : 'excluded');
        }
    }
    for (const key of excludedIngredients) exclude(canonicalIngredientKey(key), key, 'excluded');
    for (const item of pantryItems) exclude(canonicalIngredientKey(item.key), item.label || item.key, 'pantry');
    for (const item of shoppingItems) {
        if (item.excluded || item.included === false) exclude(item.key, item.text, 'excluded');
    }
    for (const item of otherShoppingItems) {
        if (item.included === false) exclude(canonicalIngredientKey(item.text), item.text, 'excluded');
    }
    const candidates = [
        ...shoppingItems.map(item => ({ ...item, sources: (item.mealTitles || []).map(name => ({ type: 'recipe', name })) })),
        ...otherShoppingItems.map(item => ({ ...item, key: canonicalIngredientKey(item.text),
            sources: [{ type: 'shopping-list', name: item.text }] })),
        ...recurringItems.filter(item => item.active !== false).map(item => ({ ...item,
            key: canonicalIngredientKey(item.text), sources: [{ type: 'recurring', name: item.text }] })),
    ];
    for (const item of candidates) {
        const legacyExcluded = (item.variants || []).some(variant => exclusions.has(legacyIngredientKey(variant.text)));
        if (legacyExcluded) exclude(item.key, item.text, 'excluded');
        if (isSpiceExcluded(item.ingredientName || item.text, spiceRule)) exclude(item.key, item.text, 'spices');
    }
    const eligible = candidates.filter(item => item.included !== false && !item.checked
        && !item.excluded && !item.orderExcluded && !exclusions.has(item.key));
    return {
        orderItems: eligible.filter(item => !item.requiresReview),
        orderReviewItems: eligible.filter(item => item.requiresReview),
        orderExclusions: [...exclusions.values()],
    };
}

module.exports = {
    PLAN_ITEM_SOURCE,
    spiceKey,
    isSpiceExcluded,
    buildOrderProposal,
    normalizeIngredient,
    canonicalPantryIngredient,
    canonicalIngredientKey,
    legacyIngredientKey,
    parseIngredientQuantity,
    extractRecipeIngredients,
    buildPlanShoppingItems,
    reconcilePlanShoppingItems,
};
