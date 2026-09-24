const PLAN_ITEM_SOURCE = 'weekly-plan';

function normalizeIngredient(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function extractRecipeIngredients(markdown) {
    const beforeMethod = String(markdown || '').split(/^##\s+(?:elaboraci[oó]n|preparaci[oó]n|pasos|instrucciones)\b/im)[0];
    return beforeMethod
        .split(/\r?\n/)
        .map(line => line.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1])
        .filter(Boolean);
}

function buildPlanShoppingItems(meals) {
    const byIngredient = new Map();

    for (const meal of meals) {
        const mealId = meal.id || meal.slug;
        for (const text of meal.ingredients || []) {
            const key = normalizeIngredient(text);
            if (!key) continue;
            const existing = byIngredient.get(key);
            if (existing) {
                if (!existing.mealIds.includes(mealId)) existing.mealIds.push(mealId);
                continue;
            }
            byIngredient.set(key, {
                text: String(text).trim(),
                checked: false,
                source: PLAN_ITEM_SOURCE,
                mealIds: [mealId],
            });
        }
    }

    return [...byIngredient.values()];
}

function reconcilePlanShoppingItems(existingItems, planItems) {
    const manualItems = existingItems.filter(item => item.source !== PLAN_ITEM_SOURCE);
    const manualPending = new Set(
        manualItems.filter(item => !item.checked).map(item => normalizeIngredient(item.text)),
    );
    return manualItems.concat(planItems.filter(item => !manualPending.has(normalizeIngredient(item.text))));
}

module.exports = {
    PLAN_ITEM_SOURCE,
    extractRecipeIngredients,
    buildPlanShoppingItems,
    reconcilePlanShoppingItems,
};
