// ===================
// Kitchen UI App
// ===================

// ===================
// Toast Notifications
// ===================
let toastTimer = null;
function showToast(message, duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('visible');
        toastTimer = null;
    }, duration);
}

const WEATHER_ICONS = {
    'sunny': '☀️', 'clear-night': '🌙',
    'partlycloudy': '⛅', 'cloudy': '☁️',
    'rainy': '🌧️', 'pouring': '🌧️',
    'snowy': '❄️', 'snowy-rainy': '🌨️',
    'fog': '🌫️', 'hazy': '🌫️',
    'lightning': '⚡', 'lightning-rainy': '⛈️',
    'windy': '💨', 'exceptional': '🌈'
};

// ===================
// Navigation
// ===================
function navigate(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// Back buttons (all screens)
document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.back || 'dashboard'));
});
document.getElementById('back-to-dashboard').addEventListener('click', () => navigate('dashboard'));

// Main nav buttons
document.getElementById('btn-timer').addEventListener('click', () => navigate('timer-screen'));
document.getElementById('btn-notify').addEventListener('click', sendFoodReady);
document.getElementById('btn-shopping').addEventListener('click', () => navigate('shopping-screen'));
document.getElementById('btn-recipes').addEventListener('click', () => {
    navigate('recipes-screen');
    loadRecipesList();
});
document.getElementById('btn-planner').addEventListener('click', () => {
    navigate('planner-screen');
    loadWeeklyPlanner();
});

// ===================
// Weekly Food Planner
// ===================
const plannerListEl = document.getElementById('planner-list');
const plannerQuickListEl = document.getElementById('planner-quick-list');
const plannerFavoritesListEl = document.getElementById('planner-favorites-list');
const plannerSelectedEl = document.getElementById('planner-selected');
const plannerReadyEl = document.getElementById('planner-order-ready');
const plannerReadyCardEl = document.getElementById('planner-ready-card');
const plannerReadyStatusEl = document.getElementById('planner-ready-status');
const plannerCountEl = document.getElementById('planner-count');
const plannerRequestsListEl = document.getElementById('planner-requests-list');
const plannerRecurringListEl = document.getElementById('planner-recurring-list');
const plannerShoppingListEl = document.getElementById('planner-shopping-list');
const plannerPantryListEl = document.getElementById('planner-pantry-list');
const plannerOtherShoppingListEl = document.getElementById('planner-other-shopping-list');
const plannerRulesListEl = document.getElementById('planner-rules-list');
const plannerSearchEl = document.getElementById('planner-search');
const plannerSuggestionsEl = document.getElementById('planner-suggestions-list');
const suggestionDialog = document.getElementById('planner-suggestion-dialog');
const suggestionImportBtn = document.getElementById('suggestion-import-btn');
const suggestionCategoryEl = document.getElementById('planner-suggestion-category');
const shuffleSuggestionsBtn = document.getElementById('planner-shuffle-suggestions');
const suggestionsStatusEl = document.getElementById('planner-suggestions-status');
const plannerTabs = [...document.querySelectorAll('[data-planner-tab]')];
const plannerTabPanels = [...document.querySelectorAll('[data-planner-panel]')];
const plannerFilters = [...document.querySelectorAll('[data-planner-filter]')];
const plannerBrowserPanels = [...document.querySelectorAll('[data-planner-browser]')];
let weeklyPlanState = {
    selectedRecipes: [],
    selectedQuickMeals: [],
    excludedIngredients: [],
    selected: [],
    shoppingItems: [],
    pantryItems: [],
    otherShoppingItems: [],
    requests: [],
    recurringItems: [],
    orderReady: false,
    ingredientCount: 0,
    shoppingItemCount: 0,
};
let allQuickMeals = [];
let allRecurringItems = [];
let allShoppingRules = [];
let mealPopularity = [];
let mealPopularityError = false;
let activePlannerTab = 'menu';
let activePlannerFilter = 'mains';
let recipeSuggestions = [];
let suggestionsStatus = 'loading';
let activeSuggestion = null;
let importingSuggestion = false;
let shufflingSuggestions = false;
let suggestionNotice = '';

function suggestionMeta(recipe) {
    return [recipe.source, recipe.cuisine, recipe.totalMinutes ? `${recipe.totalMinutes} min` : '',
        recipe.servings ? `${recipe.servings} raciones` : ''].filter(Boolean).join(' · ');
}

function renderNewRecipeSuggestions() {
    const category = suggestionCategoryEl.value;
    const visible = recipeSuggestions.filter(recipe => category === 'any'
        || recipe.mealCategory === category
        || (recipe.mealCategories || []).includes(category)
        || (category === 'Vegetarian' && recipe.mealCategory === 'Vegan'));
    shuffleSuggestionsBtn.disabled = shufflingSuggestions || suggestionsStatus === 'loading';
    shuffleSuggestionsBtn.textContent = shufflingSuggestions ? 'Finding recipes…' : '↻ Shuffle';
    suggestionCategoryEl.disabled = shufflingSuggestions;
    suggestionsStatusEl.textContent = suggestionNotice || (shufflingSuggestions
        ? 'Finding different main courses…'
        : `${visible.length} recipes · Shuffle finds more from TheMealDB`);
    document.getElementById('planner-suggestions-count').textContent = suggestionsStatus === 'loading'
        ? '…' : suggestionsStatus === 'error' ? '!' : visible.length;
    if (suggestionsStatus === 'loading') {
        plannerSuggestionsEl.innerHTML = '<p class="planner-empty-selection">Loading new recipes…</p>';
        return;
    }
    if (suggestionsStatus === 'error') {
        plannerSuggestionsEl.innerHTML = '<div class="planner-empty-selection">Could not load suggestions. <button type="button" data-retry-suggestions>Try again</button></div>';
        return;
    }
    plannerSuggestionsEl.innerHTML = visible.length ? visible.map(recipe => `
        <button type="button" class="planner-suggestion-card" data-open-suggestion="${escapeHtml(recipe.id)}">
            <span class="planner-suggestion-image">
                ${recipe.imageUrl ? `<img src="${escapeHtml(recipe.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span aria-hidden="true">🍽️</span>'}
            </span>
            <span class="planner-suggestion-body">
                <span class="planner-suggestion-source">${escapeHtml(suggestionMeta(recipe))}</span>
                <strong>${escapeHtml(recipe.title)}</strong>
                <span class="planner-suggestion-description">${escapeHtml(recipe.description)}</span>
                <span class="planner-suggestion-view">View recipe →</span>
            </span>
        </button>`).join('') : '<p class="planner-empty-selection">No matching recipes in this batch. Use Shuffle to find more, or choose another category.</p>';
}

async function loadRecipeSuggestions({ shuffle = false } = {}) {
    if (shufflingSuggestions) return;
    suggestionNotice = '';
    if (shuffle) shufflingSuggestions = true;
    else suggestionsStatus = 'loading';
    renderNewRecipeSuggestions();
    try {
        const res = await fetch(shuffle ? '/api/recipe-suggestions/shuffle' : '/api/recipe-suggestions', shuffle ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category: suggestionCategoryEl.value, excludeIds: recipeSuggestions.map(item => item.id) }),
        } : undefined);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load suggestions');
        recipeSuggestions = data;
        suggestionsStatus = 'ready';
        if (shuffle) suggestionNotice = `${data.length} different recipes from TheMealDB. Open one to learn more about the dish.`;
    } catch (error) {
        if (shuffle) suggestionNotice = `${error.message} Your previous suggestions are still here.`;
        else suggestionsStatus = 'error';
    } finally {
        shufflingSuggestions = false;
    }
    renderNewRecipeSuggestions();
}

shuffleSuggestionsBtn.addEventListener('click', () => loadRecipeSuggestions({ shuffle: true }));
suggestionCategoryEl.addEventListener('change', () => {
    suggestionNotice = '';
    renderNewRecipeSuggestions();
});

function openRecipeSuggestion(id) {
    if (importingSuggestion) return;
    const recipe = recipeSuggestions.find(item => item.id === id);
    if (!recipe) return;
    activeSuggestion = recipe;
    document.getElementById('suggestion-dialog-content').innerHTML = `
        ${recipe.imageUrl ? `<img class="suggestion-dialog-image" src="${escapeHtml(recipe.imageUrl)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="suggestion-dialog-copy">
            <p class="planner-suggestion-source">Plato principal · ${escapeHtml(suggestionMeta(recipe))}</p>
            <h2 id="suggestion-dialog-title">${escapeHtml(recipe.title)}</h2>
            <p>${escapeHtml(recipe.description)}</p>
            <a href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer">View original on ${escapeHtml(recipe.source)} ↗</a>
        </div>`;
    document.getElementById('suggestion-dialog-error').hidden = true;
    suggestionImportBtn.disabled = false;
    suggestionImportBtn.textContent = 'Import & add to plan';
    suggestionDialog.showModal();
}

plannerSuggestionsEl.addEventListener('click', event => {
    const card = event.target.closest('[data-open-suggestion]');
    if (card) openRecipeSuggestion(card.dataset.openSuggestion);
    if (event.target.closest('[data-retry-suggestions]')) loadRecipeSuggestions();
});
plannerSuggestionsEl.addEventListener('error', event => {
    if (event.target.tagName === 'IMG') event.target.parentElement.innerHTML = '<span aria-hidden="true">🍽️</span>';
}, true);
suggestionDialog.addEventListener('error', event => {
    if (event.target.tagName === 'IMG') event.target.remove();
}, true);
document.getElementById('suggestion-dialog-close').addEventListener('click', () => suggestionDialog.close());
suggestionDialog.addEventListener('click', event => {
    if (event.target === suggestionDialog) {
        const bounds = suggestionDialog.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right
            || event.clientY < bounds.top || event.clientY > bounds.bottom) suggestionDialog.close();
    }
});
suggestionImportBtn.addEventListener('click', async () => {
    if (!activeSuggestion || importingSuggestion) return;
    importingSuggestion = true;
    suggestionImportBtn.disabled = true;
    suggestionImportBtn.textContent = 'Importing…';
    const errorEl = document.getElementById('suggestion-dialog-error');
    errorEl.hidden = true;
    try {
        const res = await fetch(`/api/recipe-suggestions/${encodeURIComponent(activeSuggestion.id)}/import`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not import recipe');
        weeklyPlanState = data.plan;
        await loadMealPopularity();
        recipeSuggestions = data.suggestions;
        allRecipes = [...allRecipes.filter(item => item.slug !== data.recipe.slug), data.recipe];
        renderWeeklyPlanner();
        renderNewRecipeSuggestions();
        suggestionDialog.close();
        setPlannerTab('menu');
        showToast(data.plan.selectionHistoryWarning || 'Recipe imported and added to next week · order needs review');
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.hidden = false;
    } finally {
        importingSuggestion = false;
        suggestionImportBtn.disabled = false;
        suggestionImportBtn.textContent = 'Import & add to plan';
    }
});

function renderMealFavorites(query = '') {
    if (mealPopularityError) {
        plannerFavoritesListEl.innerHTML = '<p class="planner-empty-selection">No se pudo leer el historial de selecciones. Vuelve a abrir el plan para reintentar.</p>';
        return;
    }
    const favorites = mealPopularity.map(item => {
        const meal = item.type === 'recipe'
            ? allRecipes.find(recipe => recipe.slug === item.id)
            : allQuickMeals.find(quick => quick.id === item.id);
        return meal && { ...item, title: meal.title };
    }).filter(item => item && (!query || item.title.toLocaleLowerCase('es').includes(query)));
    plannerFavoritesListEl.innerHTML = favorites.length ? favorites.map(item => {
        const selected = item.type === 'recipe'
            ? weeklyPlanState.selectedRecipes.includes(item.id)
            : weeklyPlanState.selectedQuickMeals.includes(item.id);
        return `<article class="planner-favorite-card">
            <div><strong>${escapeHtml(item.title)}</strong><small>Elegido en ${item.count} semana${item.count === 1 ? '' : 's'} · ${item.type === 'quick' ? 'Plato rápido' : 'Receta'}</small></div>
            <button type="button" class="planner-add-btn ${selected ? 'is-selected' : ''}" data-favorite-type="${item.type}" data-favorite-id="${escapeHtml(item.id)}">${selected ? '✓ En el menú' : 'Añadir'}</button>
        </article>`;
    }).join('') : `<p class="planner-empty-selection">${query ? 'Ningún favorito coincide con la búsqueda.' : 'Tus favoritos aparecerán aquí a medida que elijas platos. El historial empieza con tus próximas selecciones.'}</p>`;
}

async function loadMealPopularity() {
    try {
        const res = await fetch('/api/meal-popularity');
        if (!res.ok) throw new Error('Could not load meal popularity');
        mealPopularity = await res.json();
        mealPopularityError = false;
    } catch (error) {
        mealPopularityError = true;
    }
}

plannerFavoritesListEl.addEventListener('click', event => {
    const button = event.target.closest('[data-favorite-type]');
    if (!button) return;
    const { favoriteType: type, favoriteId: id } = button.dataset;
    const selected = type === 'recipe'
        ? weeklyPlanState.selectedRecipes.includes(id)
        : weeklyPlanState.selectedQuickMeals.includes(id);
    changePlannerSelection(type, id, !selected);
});

function normalizePlannerIngredient(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function setPlannerTab(tab) {
    activePlannerTab = tab;
    plannerTabs.forEach(button => button.classList.toggle('is-active', button.dataset.plannerTab === tab));
    plannerTabPanels.forEach(panel => panel.classList.toggle('is-active', panel.dataset.plannerPanel === tab));
    const activePanel = plannerTabPanels.find(panel => panel.dataset.plannerPanel === tab);
    if (activePanel) activePanel.scrollTop = 0;
}

function setPlannerFilter(filter) {
    activePlannerFilter = filter;
    plannerFilters.forEach(button => button.classList.toggle('is-active', button.dataset.plannerFilter === filter));
    plannerBrowserPanels.forEach(panel => {
        const browser = ['quick', 'ideas', 'favorites'].includes(filter) ? filter : 'recipes';
        const visible = panel.dataset.plannerBrowser === browser;
        panel.classList.toggle('is-active', visible);
    });
    plannerSearchEl.classList.toggle('is-hidden', filter === 'ideas');
    renderWeeklyPlanner();
}

function plannerCategoryLabel(category) {
    const labels = {
        mains: 'Plato principal',
        starters: 'Entrante',
        sides: 'Guarnición',
        'sauces-basics': 'Salsa o básico',
        desserts: 'Postre',
        drinks: 'Bebida',
        uncategorized: 'Receta',
    };
    return labels[category] || 'Receta';
}

function renderPlannerSuggestion(recipe) {
    const selected = weeklyPlanState.selectedRecipes.includes(recipe.slug);
    return `
        <article class="planner-recipe-card ${selected ? 'is-selected' : ''}">
            <a class="planner-recipe-image ${recipe.image ? '' : 'planner-recipe-image-empty'}" href="/?recipe=${encodeURIComponent(recipe.slug)}" target="_blank" rel="noopener">
                ${recipe.image ? `<img src="${recipe.image}" alt="">` : '<span>foto de la receta</span>'}
            </a>
            <div class="planner-recipe-body">
                <a class="planner-recipe-title" href="/?recipe=${encodeURIComponent(recipe.slug)}" target="_blank" rel="noopener">${escapeHtml(recipe.title)}</a>
                <span class="planner-recipe-meta">${plannerCategoryLabel(recipe.category)}</span>
                <button type="button" class="planner-add-btn ${selected ? 'is-selected' : ''}" data-toggle-recipe="${escapeHtml(recipe.slug)}">
                    ${selected ? '✓ En el menú' : 'Añadir'}
                </button>
            </div>
        </article>
    `;
}

function renderQuickMealSuggestion(meal) {
    const selected = weeklyPlanState.selectedQuickMeals.includes(meal.id);
    return `
        <article class="planner-quick-card ${selected ? 'is-selected' : ''}">
            <div>
                <strong>${escapeHtml(meal.title)}</strong>
                <span>${escapeHtml(meal.note || 'Plato rápido')}</span>
                <small>${meal.ingredients.map(escapeHtml).join(' · ')}</small>
            </div>
            <button type="button" class="planner-add-btn ${selected ? 'is-selected' : ''}" data-toggle-quick="${escapeHtml(meal.id)}">
                ${selected ? '✓ En el menú' : 'Añadir'}
            </button>
        </article>
    `;
}

function renderSelectedMeal(meal) {
    const ingredients = Array.isArray(meal.ingredients) ? meal.ingredients : [];
    const detailUrl = meal.type === 'recipe' ? `/?recipe=${encodeURIComponent(meal.slug)}` : '';
    const title = detailUrl
        ? `<a href="${detailUrl}" target="_blank" rel="noopener">${escapeHtml(meal.title)}</a>`
        : `<strong>${escapeHtml(meal.title)}</strong>`;
    return `
        <article class="planner-selected-card">
            ${meal.image
                ? `<a class="planner-selected-image" href="${detailUrl}" target="_blank" rel="noopener"><img src="${meal.image}" alt=""></a>`
                : '<div class="planner-selected-image planner-recipe-image-empty"><span>foto</span></div>'}
            <div class="planner-selected-main">
                ${title}
                <span>${meal.type === 'quick' ? 'Plato rápido' : plannerCategoryLabel(meal.category)} · ${ingredients.length} ingrediente${ingredients.length === 1 ? '' : 's'}</span>
            </div>
            ${ingredients.length ? `
                <details class="planner-ingredients">
                    <summary>Ingredientes</summary>
                    <ul>${ingredients.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
                </details>
            ` : '<span class="planner-no-ingredients">Sin ingredientes</span>'}
            <button type="button" class="planner-remove-btn" data-remove-type="${meal.type}" data-remove-id="${escapeHtml(meal.id)}" aria-label="Quitar ${escapeHtml(meal.title)}">×</button>
        </article>
    `;
}

function renderPlannerRequest(request) {
    const label = request.type === 'extra-list' ? 'Extra list' : 'Recipe idea';
    const generated = request.status === 'generated' && request.recipeSlug;
    const needsGeneration = request.type === 'recipe-idea' && !generated;
    const status = generated
        ? `<a class="planner-generated-link" href="/?recipe=${encodeURIComponent(request.recipeSlug)}" target="_blank" rel="noopener">Generated recipe · Review ${escapeHtml(request.recipeTitle || '')}</a>`
        : needsGeneration
            ? `<span class="planner-request-status">${request.status === 'generation-failed' ? 'Generation failed' : 'Pending generation'}</span>`
            : '';
    return `
        <article class="planner-request-card">
            <div>
                <span>${label}</span>
                <p>${escapeHtml(request.text)}</p>
                ${status}
            </div>
            <div class="planner-request-actions">
                ${needsGeneration ? `<button type="button" class="planner-retry-btn" data-generate-request="${escapeHtml(request.id)}">Retry</button>` : ''}
                <button type="button" class="planner-remove-btn" data-remove-request="${escapeHtml(request.id)}" aria-label="Remove ${label.toLowerCase()}">×</button>
            </div>
        </article>
    `;
}

function renderRecurringItem(item) {
    return `
        <article class="planner-recurring-card ${item.active ? '' : 'is-off'}">
            <label class="planner-recurring-toggle" aria-label="Include ${escapeHtml(item.text)} every week">
                <input type="checkbox" data-recurring-field="active" data-recurring-id="${escapeHtml(item.id)}" ${item.active ? 'checked' : ''}>
                <span aria-hidden="true"></span>
            </label>
            <input class="planner-recurring-name" type="text" data-recurring-field="text" data-recurring-id="${escapeHtml(item.id)}" value="${escapeHtml(item.text)}" maxlength="160" aria-label="Recurring item name">
            <div class="planner-quantity-control">
                <button type="button" data-adjust-recurring="-1" data-recurring-id="${escapeHtml(item.id)}" aria-label="Decrease quantity">−</button>
                <input type="number" data-recurring-field="quantity" data-recurring-id="${escapeHtml(item.id)}" value="${item.quantity}" min="1" max="99" aria-label="Quantity for ${escapeHtml(item.text)}">
                <button type="button" data-adjust-recurring="1" data-recurring-id="${escapeHtml(item.id)}" aria-label="Increase quantity">＋</button>
            </div>
            <button type="button" class="planner-remove-recurring" data-remove-recurring="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.text)}">×</button>
        </article>
    `;
}

function renderShoppingRule(item) {
    return `
        <article class="planner-rule-card ${item.active ? '' : 'is-off'}">
            <label class="planner-recurring-toggle planner-rule-toggle" aria-label="Use rule for ${escapeHtml(item.product)}">
                <input type="checkbox" data-shopping-rule-field="active" data-shopping-rule-id="${escapeHtml(item.id)}" ${item.active ? 'checked' : ''}>
                <span aria-hidden="true"></span>
            </label>
            <label class="planner-rule-field">
                <span>Product</span>
                <input type="text" data-shopping-rule-field="product" data-shopping-rule-id="${escapeHtml(item.id)}" value="${escapeHtml(item.product)}" maxlength="120">
            </label>
            <label class="planner-rule-field planner-rule-instruction">
                <span>Shopping instruction</span>
                <textarea data-shopping-rule-field="rule" data-shopping-rule-id="${escapeHtml(item.id)}" rows="2" maxlength="600">${escapeHtml(item.rule)}</textarea>
            </label>
            <button type="button" class="planner-rule-remove" data-remove-shopping-rule="${escapeHtml(item.id)}" aria-label="Remove rule for ${escapeHtml(item.product)}">×</button>
        </article>
    `;
}

function renderPlannerShoppingItem(item) {
    const key = item.key || normalizePlannerIngredient(item.text);
    const source = Array.isArray(item.mealTitles) && item.mealTitles.length
        ? item.mealTitles.join(' · ')
        : 'Selected meals';
    const ingredientName = item.ingredientName || item.text;
    const quantityParts = [];
    if (item.quantityText) quantityParts.push(item.quantityText);
    if (item.missingQuantityCount && item.combined) {
        quantityParts.push(`${item.missingQuantityCount} ${item.missingQuantityCount === 1
            ? 'receta sin cantidad'
            : 'recetas sin cantidad'}`);
    }
    const variants = Array.isArray(item.variantDetails) ? item.variantDetails : [];
    const recipeBreakdown = item.combined && variants.length
        ? `
            <details class="planner-ingredient-sources">
                <summary>${variants.length} ${variants.length === 1 ? 'ingrediente original' : 'ingredientes originales'}</summary>
                <ul>
                    ${variants.map(variant => `
                        <li>
                            <span>${escapeHtml(variant.text)}</span>
                            <small>${escapeHtml(variant.mealTitle)}</small>
                        </li>
                    `).join('')}
                </ul>
            </details>
        `
        : '';
    return `
        <article class="planner-shopping-item planner-meal-shopping-item ${item.included ? '' : 'is-excluded'} ${item.missingQuantityCount && item.combined ? 'has-missing-quantity' : ''}">
            <label class="planner-shopping-toggle">
                <input type="checkbox" data-plan-ingredient="${escapeHtml(key)}" ${item.included ? 'checked' : ''}>
                <span class="planner-shopping-check" aria-hidden="true">✓</span>
                <span class="planner-shopping-name">
                    <strong>${escapeHtml(ingredientName)}</strong>
                    ${quantityParts.length ? `<span>${escapeHtml(quantityParts.join(' · '))}</span>` : ''}
                </span>
            </label>
            <div class="planner-shopping-context">
                <small>${escapeHtml(source)}</small>
                ${recipeBreakdown}
            </div>
            <button type="button" class="planner-pantry-add" data-add-pantry="${escapeHtml(key)}">Always at home</button>
        </article>
    `;
}

function renderPantryItem(item) {
    const source = Array.isArray(item.mealTitles) && item.mealTitles.length
        ? `Used by ${item.mealTitles.join(' · ')}`
        : item.rule === 'spices' ? 'Covered by Spices & dried herbs' : 'Saved for future meal plans';
    return `
        <article class="planner-pantry-item">
            <span class="planner-pantry-icon" aria-hidden="true">✓</span>
            <div>
                <strong>${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(source)}</small>
            </div>
            <button type="button" data-remove-pantry="${escapeHtml(item.key)}">Include again</button>
        </article>
    `;
}

function renderOtherShoppingItem(item) {
    return `
        <label class="planner-shopping-item ${item.included ? '' : 'is-excluded'}">
            <input type="checkbox" data-other-shopping-id="${escapeHtml(item.id)}" ${item.included ? 'checked' : ''}>
            <span class="planner-shopping-check" aria-hidden="true">✓</span>
            <span class="planner-shopping-name">${escapeHtml(item.text)}</span>
            <small>Shopping list</small>
        </label>
    `;
}

function renderWeeklyPlanner() {
    const plannerScreen = document.getElementById('planner-screen');
    plannerScreen.scrollTop = 0;
    const query = plannerSearchEl.value.trim().toLocaleLowerCase('es');
    let visibleRecipes = activePlannerFilter === 'mains'
        ? allRecipes.filter(recipe => recipe.category === 'mains')
        : allRecipes;
    if (query) {
        visibleRecipes = visibleRecipes.filter(recipe => [recipe.title, recipe.altName, recipe.category]
            .filter(Boolean)
            .some(value => String(value).toLocaleLowerCase('es').includes(query)));
    }

    plannerListEl.innerHTML = visibleRecipes.length
        ? visibleRecipes.map(renderPlannerSuggestion).join('')
        : '<p class="planner-empty-selection">Ninguna receta coincide con la búsqueda.</p>';

    const visibleQuickMeals = query
        ? allQuickMeals.filter(meal => [meal.title, meal.note, ...(meal.ingredients || [])]
            .some(value => String(value || '').toLocaleLowerCase('es').includes(query)))
        : allQuickMeals;
    plannerQuickListEl.innerHTML = visibleQuickMeals.length
        ? visibleQuickMeals.map(renderQuickMealSuggestion).join('')
        : '<p class="planner-empty-selection">Ningún plato rápido coincide con la búsqueda.</p>';

    renderMealFavorites(query);

    plannerSelectedEl.innerHTML = weeklyPlanState.selected.length
        ? weeklyPlanState.selected.map(renderSelectedMeal).join('')
        : '<p class="planner-empty-selection">Choose a few meals for next week. Their ingredients will appear in Shopping.</p>';

    plannerRequestsListEl.innerHTML = weeklyPlanState.requests.length
        ? weeklyPlanState.requests.map(renderPlannerRequest).join('')
        : '<p class="planner-empty-selection">No recipe ideas or extra lists yet.</p>';

    plannerRecurringListEl.innerHTML = allRecurringItems.length
        ? allRecurringItems.map(renderRecurringItem).join('')
        : '<p class="planner-empty-selection">No recurring items yet.</p>';

    const allMealShoppingItems = Array.isArray(weeklyPlanState.shoppingItems) ? weeklyPlanState.shoppingItems : [];
    const shoppingItems = allMealShoppingItems.filter(item => !item.pantry);
    plannerShoppingListEl.innerHTML = shoppingItems.length
        ? shoppingItems.map(renderPlannerShoppingItem).join('')
        : `<p class="planner-empty-selection">${allMealShoppingItems.length
            ? 'All meal ingredients are covered by Always at home.'
            : 'Add meals to build the shopping list.'}</p>`;

    document.getElementById('planner-spice-rule').checked = weeklyPlanState.spiceRule?.enabled === true;
    document.getElementById('planner-spice-exceptions').innerHTML = (weeklyPlanState.spiceRule?.exceptions || [])
        .map(key => `<article class="planner-pantry-item"><span aria-hidden="true">↪</span><div><strong>${escapeHtml(key)}</strong><small>Exception: include in shopping when requested</small></div><button type="button" data-restore-spice="${escapeHtml(key)}">Always at home</button></article>`).join('');

    const pantryItems = Array.isArray(weeklyPlanState.pantryItems) ? weeklyPlanState.pantryItems : [];
    plannerPantryListEl.innerHTML = pantryItems.length
        ? pantryItems.map(renderPantryItem).join('')
        : '<p class="planner-empty-selection">No permanently excluded meal ingredients.</p>';

    const otherShoppingItems = Array.isArray(weeklyPlanState.otherShoppingItems)
        ? weeklyPlanState.otherShoppingItems
        : [];
    plannerOtherShoppingListEl.innerHTML = otherShoppingItems.length
        ? otherShoppingItems.map(renderOtherShoppingItem).join('')
        : '<p class="planner-empty-selection">No unchecked items in the shopping list.</p>';

    plannerRulesListEl.innerHTML = allShoppingRules.length
        ? allShoppingRules.map(renderShoppingRule).join('')
        : '<p class="planner-empty-selection">No shopping rules yet.</p>';

    plannerReadyEl.checked = weeklyPlanState.orderReady;
    const hasOrderContent = weeklyPlanState.selected.length > 0
        || weeklyPlanState.requests.length > 0
        || allRecurringItems.some(item => item.active)
        || otherShoppingItems.some(item => item.included);
    plannerReadyEl.disabled = !hasOrderContent;
    plannerReadyCardEl.classList.toggle('is-ready', weeklyPlanState.orderReady);
    plannerReadyStatusEl.textContent = weeklyPlanState.orderReady
        ? 'Ready for the shopping agent'
        : 'Until then, the basket stays unchanged';

    const mealCount = weeklyPlanState.selected.length;
    const shoppingCount = weeklyPlanState.shoppingItemCount ?? weeklyPlanState.ingredientCount;
    plannerCountEl.textContent = `${mealCount} meal${mealCount === 1 ? '' : 's'} · ${shoppingCount} shopping item${shoppingCount === 1 ? '' : 's'}`;
    document.getElementById('planner-menu-count').textContent = mealCount;
    document.getElementById('planner-browse-count').textContent = allRecipes.length;
    document.getElementById('planner-shopping-count').textContent = shoppingCount;
    document.getElementById('planner-rules-count').textContent = allShoppingRules.filter(item => item.active).length;
    plannerScreen.scrollTop = 0;
}

async function saveWeeklyPlan(selectedRecipes, selectedQuickMeals, orderReady, successMessage, excludedIngredients = weeklyPlanState.excludedIngredients) {
    const res = await fetch('/api/weekly-plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedRecipes, selectedQuickMeals, excludedIngredients, orderReady }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save next week');
    weeklyPlanState = data;
    renderWeeklyPlanner();
    if (successMessage) showToast(data.selectionHistoryWarning || successMessage);
    await loadMealPopularity();
    renderMealFavorites(plannerSearchEl.value.trim().toLocaleLowerCase('es'));
}

async function changePlannerSelection(type, id, add) {
    const recipes = weeklyPlanState.selectedRecipes;
    const quickMeals = weeklyPlanState.selectedQuickMeals;
    const nextRecipes = type === 'recipe'
        ? (add ? [...recipes, id] : recipes.filter(item => item !== id))
        : recipes;
    const nextQuickMeals = type === 'quick'
        ? (add ? [...quickMeals, id] : quickMeals.filter(item => item !== id))
        : quickMeals;
    try {
        await saveWeeklyPlan(
            [...new Set(nextRecipes)],
            [...new Set(nextQuickMeals)],
            false,
            add ? 'Meal added · order needs review' : 'Meal removed · order needs review',
        );
    } catch (error) {
        showToast(error.message);
    }
}

async function loadWeeklyPlanner() {
    plannerListEl.innerHTML = '<p class="planner-empty-selection">Loading next week…</p>';
    plannerSelectedEl.innerHTML = '';
    loadRecipeSuggestions();
    try {
        const [recipesRes, quickMealsRes, planRes, recurringRes, rulesRes] = await Promise.all([
            fetch('/api/recipes'),
            fetch('/api/quick-meals'),
            fetch('/api/weekly-plan'),
            fetch('/api/recurring-items'),
            fetch('/api/shopping-rules'),
            loadMealPopularity(),
        ]);
        if (!recipesRes.ok || !quickMealsRes.ok || !planRes.ok || !recurringRes.ok || !rulesRes.ok) throw new Error('Could not load next week');
        allRecipes = await recipesRes.json();
        allQuickMeals = await quickMealsRes.json();
        weeklyPlanState = await planRes.json();
        allRecurringItems = await recurringRes.json();
        allShoppingRules = await rulesRes.json();
        renderWeeklyPlanner();
    } catch (error) {
        plannerListEl.innerHTML = '<p class="planner-empty-selection">Could not load the weekly plan.</p>';
        showToast(error.message);
    }
}

async function saveRecurringItems(successMessage) {
    const res = await fetch('/api/recurring-items', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allRecurringItems),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save recurring items');
    allRecurringItems = data;
    weeklyPlanState.orderReady = false;
    weeklyPlanState.recurringItems = data.filter(item => item.active);
    renderWeeklyPlanner();
    if (successMessage) showToast(successMessage);
}

async function saveShoppingRules(successMessage) {
    const res = await fetch('/api/shopping-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(allShoppingRules),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save shopping rules');
    allShoppingRules = data;
    weeklyPlanState.orderReady = false;
    renderWeeklyPlanner();
    if (successMessage) showToast(successMessage);
}

async function createPlannerRequest(type, text) {
    const res = await fetch('/api/weekly-plan/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, text }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not save idea');
    weeklyPlanState = data;
    if (type === 'recipe-idea' && !data.generationWarning) {
        const recipesRes = await fetch('/api/recipes');
        if (recipesRes.ok) allRecipes = await recipesRes.json();
        await loadMealPopularity();
    }
    renderWeeklyPlanner();
    return data;
}

plannerTabs.forEach(button => button.addEventListener('click', () => setPlannerTab(button.dataset.plannerTab)));
document.querySelectorAll('[data-open-planner-tab]').forEach(button => {
    button.addEventListener('click', () => setPlannerTab(button.dataset.openPlannerTab));
});
plannerFilters.forEach(button => button.addEventListener('click', () => setPlannerFilter(button.dataset.plannerFilter)));
plannerSearchEl.addEventListener('input', renderWeeklyPlanner);

plannerListEl.addEventListener('click', event => {
    const button = event.target.closest('[data-toggle-recipe]');
    if (!button) return;
    const id = button.dataset.toggleRecipe;
    changePlannerSelection('recipe', id, !weeklyPlanState.selectedRecipes.includes(id));
});

plannerQuickListEl.addEventListener('click', event => {
    const button = event.target.closest('[data-toggle-quick]');
    if (!button) return;
    const id = button.dataset.toggleQuick;
    changePlannerSelection('quick', id, !weeklyPlanState.selectedQuickMeals.includes(id));
});

plannerSelectedEl.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-type]');
    if (button) changePlannerSelection(button.dataset.removeType, button.dataset.removeId, false);
});

plannerShoppingListEl.addEventListener('change', async event => {
    const input = event.target.closest('[data-plan-ingredient]');
    if (!input) return;
    const key = input.dataset.planIngredient;
    const excluded = new Set(weeklyPlanState.excludedIngredients || []);
    if (input.checked) excluded.delete(key);
    else excluded.add(key);
    input.disabled = true;
    try {
        await saveWeeklyPlan(
            weeklyPlanState.selectedRecipes,
            weeklyPlanState.selectedQuickMeals,
            false,
            input.checked ? 'Ingredient included' : 'Ingredient excluded from this order',
            [...excluded],
        );
    } catch (error) {
        input.checked = !input.checked;
        input.disabled = false;
        showToast(error.message);
    }
});

plannerShoppingListEl.addEventListener('click', async event => {
    const button = event.target.closest('[data-add-pantry]');
    if (!button) return;
    button.disabled = true;
    try {
        const res = await fetch('/api/pantry-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredient: button.dataset.addPantry }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not update Always at home');
        weeklyPlanState = data;
        renderWeeklyPlanner();
        showToast('Saved in Always at home · excluded from meal shopping');
    } catch (error) {
        button.disabled = false;
        showToast(error.message);
    }
});

document.getElementById('planner-spice-rule').addEventListener('change', async event => {
    const input = event.target;
    input.disabled = true;
    try {
        const res = await fetch('/api/pantry-spice-rule', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: input.checked }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not save spice rule');
        weeklyPlanState = data;
        renderWeeklyPlanner();
        showToast('Spice rule saved');
    } catch (error) {
        input.checked = !input.checked;
        showToast(error.message);
    } finally { input.disabled = false; }
});

document.getElementById('planner-spice-exceptions').addEventListener('click', async event => {
    const button = event.target.closest('[data-restore-spice]');
    if (!button) return;
    button.disabled = true;
    try {
        const res = await fetch('/api/pantry-items', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredient: button.dataset.restoreSpice }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not save spice rule');
        weeklyPlanState = data;
        renderWeeklyPlanner();
    } catch (error) { button.disabled = false; showToast(error.message); }
});

document.getElementById('planner-pantry-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = document.getElementById('planner-pantry-text');
    const ingredient = input.value.trim();
    if (!ingredient || input.disabled) return;
    const button = form.querySelector('button[type="submit"]');
    input.disabled = true;
    button.disabled = true;
    try {
        const res = await fetch('/api/pantry-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ingredient }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not update Always at home');
        weeklyPlanState = data;
        renderWeeklyPlanner();
        input.value = '';
        showToast('Saved in Always at home');
    } catch (error) {
        showToast(error.message);
    } finally {
        input.disabled = false;
        button.disabled = false;
        input.focus();
    }
});

plannerPantryListEl.addEventListener('click', async event => {
    const button = event.target.closest('[data-remove-pantry]');
    if (!button) return;
    button.disabled = true;
    try {
        const res = await fetch(`/api/pantry-items/${encodeURIComponent(button.dataset.removePantry)}`, {
            method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not update Always at home');
        weeklyPlanState = data;
        renderWeeklyPlanner();
        showToast('Ingredient will be included in meal shopping again');
    } catch (error) {
        button.disabled = false;
        showToast(error.message);
    }
});

plannerOtherShoppingListEl.addEventListener('change', async event => {
    const input = event.target.closest('[data-other-shopping-id]');
    if (!input) return;
    input.disabled = true;
    try {
        const res = await fetch(`/api/weekly-plan/shopping-items/${encodeURIComponent(input.dataset.otherShoppingId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ included: input.checked }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not update the order');
        weeklyPlanState = data;
        renderWeeklyPlanner();
        showToast(input.checked ? 'Shopping item included' : 'Shopping item excluded from this order');
    } catch (error) {
        input.checked = !input.checked;
        input.disabled = false;
        showToast(error.message);
    }
});

document.getElementById('planner-request-form').addEventListener('submit', async event => {
    event.preventDefault();
    const typeInput = event.target.querySelector('input[name="planner-request-type"]:checked');
    const textInput = document.getElementById('planner-request-text');
    const submitButton = document.getElementById('planner-request-submit');
    const originalLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = typeInput.value === 'recipe-idea' ? 'Generating…' : 'Saving…';
    try {
        const data = await createPlannerRequest(typeInput.value, textInput.value);
        textInput.value = '';
        showToast(data.generationWarning
            ? 'Idea saved · automatic generation needs a retry'
            : typeInput.value === 'recipe-idea'
                ? 'Recipe generated, saved and selected'
                : 'List saved · order needs review');
    } catch (error) {
        showToast(error.message);
    } finally {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
    }
});

document.querySelectorAll('input[name="planner-request-type"]').forEach(input => {
    input.addEventListener('change', () => {
        const isRecipe = input.value === 'recipe-idea' && input.checked;
        if (input.checked) {
            document.getElementById('planner-request-submit').textContent = isRecipe ? 'Generate recipe' : 'Save list';
            document.getElementById('planner-request-text').placeholder = isRecipe
                ? 'e.g. An easy fish pie for four'
                : 'Paste products or an additional list';
        }
    });
});

plannerRequestsListEl.addEventListener('click', async event => {
    const retryButton = event.target.closest('[data-generate-request]');
    if (retryButton) {
        retryButton.disabled = true;
        retryButton.textContent = 'Generating…';
        try {
            const res = await fetch(`/api/weekly-plan/requests/${encodeURIComponent(retryButton.dataset.generateRequest)}/generate`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not generate recipe');
            weeklyPlanState = data;
            const recipesRes = await fetch('/api/recipes');
            if (recipesRes.ok) allRecipes = await recipesRes.json();
            await loadMealPopularity();
            renderWeeklyPlanner();
            showToast(data.selectionHistoryWarning || 'Recipe generated, saved and selected');
        } catch (error) {
            const planRes = await fetch('/api/weekly-plan');
            if (planRes.ok) weeklyPlanState = await planRes.json();
            renderWeeklyPlanner();
            showToast(error.message);
        }
        return;
    }
    const button = event.target.closest('[data-remove-request]');
    if (!button) return;
    try {
        const res = await fetch(`/api/weekly-plan/requests/${encodeURIComponent(button.dataset.removeRequest)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not remove item');
        weeklyPlanState = data;
        renderWeeklyPlanner();
        showToast('Removed · order needs review');
    } catch (error) {
        showToast(error.message);
    }
});

plannerRecurringListEl.addEventListener('change', async event => {
    const input = event.target.closest('[data-recurring-field]');
    if (!input) return;
    const item = allRecurringItems.find(candidate => candidate.id === input.dataset.recurringId);
    if (!item) return;
    const previous = { ...item };
    if (input.dataset.recurringField === 'active') item.active = input.checked;
    if (input.dataset.recurringField === 'text') item.text = input.value.trim();
    if (input.dataset.recurringField === 'quantity') item.quantity = Number(input.value);
    try {
        await saveRecurringItems('Recurring items saved · order needs review');
    } catch (error) {
        Object.assign(item, previous);
        renderWeeklyPlanner();
        showToast(error.message);
    }
});

plannerRecurringListEl.addEventListener('click', async event => {
    const adjust = event.target.closest('[data-adjust-recurring]');
    if (adjust) {
        const item = allRecurringItems.find(candidate => candidate.id === adjust.dataset.recurringId);
        if (!item) return;
        const previous = item.quantity;
        item.quantity = Math.max(1, Math.min(99, item.quantity + Number(adjust.dataset.adjustRecurring)));
        if (item.quantity === previous) return;
        try {
            await saveRecurringItems('Quantity saved · order needs review');
        } catch (error) {
            item.quantity = previous;
            renderWeeklyPlanner();
            showToast(error.message);
        }
        return;
    }
    const button = event.target.closest('[data-remove-recurring]');
    if (!button) return;
    const previous = allRecurringItems;
    allRecurringItems = allRecurringItems.filter(item => item.id !== button.dataset.removeRecurring);
    try {
        await saveRecurringItems('Recurring item removed · order needs review');
    } catch (error) {
        allRecurringItems = previous;
        renderWeeklyPlanner();
        showToast(error.message);
    }
});

plannerRulesListEl.addEventListener('change', async event => {
    const input = event.target.closest('[data-shopping-rule-field]');
    if (!input) return;
    const item = allShoppingRules.find(candidate => candidate.id === input.dataset.shoppingRuleId);
    if (!item) return;
    const previous = { ...item };
    if (input.dataset.shoppingRuleField === 'active') item.active = input.checked;
    if (input.dataset.shoppingRuleField === 'product') item.product = input.value.trim();
    if (input.dataset.shoppingRuleField === 'rule') item.rule = input.value.trim();
    input.disabled = true;
    try {
        await saveShoppingRules('Shopping rules saved · order needs review');
    } catch (error) {
        Object.assign(item, previous);
        renderWeeklyPlanner();
        showToast(error.message);
    }
});

plannerRulesListEl.addEventListener('click', async event => {
    const button = event.target.closest('[data-remove-shopping-rule]');
    if (!button) return;
    const previous = allShoppingRules;
    allShoppingRules = allShoppingRules.filter(item => item.id !== button.dataset.removeShoppingRule);
    button.disabled = true;
    try {
        await saveShoppingRules('Shopping rule removed · order needs review');
    } catch (error) {
        allShoppingRules = previous;
        renderWeeklyPlanner();
        showToast(error.message);
    }
});

document.getElementById('planner-rule-add-form').addEventListener('submit', async event => {
    event.preventDefault();
    const productInput = document.getElementById('planner-rule-product');
    const ruleInput = document.getElementById('planner-rule-text');
    const button = event.submitter;
    const previous = allShoppingRules;
    allShoppingRules = allShoppingRules.concat({
        id: `rule-${crypto.randomUUID()}`,
        product: productInput.value.trim(),
        rule: ruleInput.value.trim(),
        active: true,
    });
    button.disabled = true;
    try {
        await saveShoppingRules('Shopping rule added · order needs review');
        productInput.value = '';
        ruleInput.value = '';
    } catch (error) {
        allShoppingRules = previous;
        renderWeeklyPlanner();
        showToast(error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('planner-extras-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('planner-extras-text');
    const text = input.value.trim();
    if (!text) return;
    const button = event.submitter;
    button.disabled = true;
    try {
        if (button.value === 'every-week') {
            allRecurringItems = allRecurringItems.concat({
                id: `recurring-${Date.now()}`,
                text,
                quantity: 1,
                active: true,
            });
            await saveRecurringItems('Added to every week');
        } else {
            await createPlannerRequest('extra-list', text);
            showToast('Added to this week');
        }
        input.value = '';
    } catch (error) {
        showToast(error.message);
    } finally {
        button.disabled = false;
    }
});

document.getElementById('planner-new-quick-form').addEventListener('submit', async event => {
    event.preventDefault();
    const titleInput = document.getElementById('planner-quick-title');
    const ingredientsInput = document.getElementById('planner-quick-ingredients');
    const ingredients = ingredientsInput.value.split(/[,\n]/).map(item => item.trim()).filter(Boolean);
    try {
        const res = await fetch('/api/quick-meals', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: titleInput.value, ingredients }),
        });
        const meal = await res.json();
        if (!res.ok) throw new Error(meal.error || 'Could not create quick meal');
        allQuickMeals.push(meal);
        titleInput.value = '';
        ingredientsInput.value = '';
        await changePlannerSelection('quick', meal.id, true);
        event.target.closest('details').open = false;
    } catch (error) {
        showToast(error.message);
    }
});

plannerReadyEl.addEventListener('change', async () => {
    const desired = plannerReadyEl.checked;
    try {
        await saveWeeklyPlan(
            weeklyPlanState.selectedRecipes,
            weeklyPlanState.selectedQuickMeals,
            desired,
            desired ? 'Order marked ready' : 'Order paused',
        );
    } catch (error) {
        plannerReadyEl.checked = weeklyPlanState.orderReady;
        showToast(error.message);
    }
});

// ===================
// Recipes
// ===================
const recipesListEl = document.getElementById('recipes-list');
const recipeDetailEl = document.getElementById('recipe-detail');
const recipeDetailTitleEl = document.getElementById('recipe-detail-title');
const recipeDetailContentEl = document.getElementById('recipe-detail-content');
const recipeCategoriesEl = document.getElementById('recipe-categories');
const recipesSummaryEl = document.getElementById('recipes-summary');
let allRecipes = [];
let recipeCategories = [];
let selectedRecipeCategory = 'all';

function setupRecipeCategories() {
    recipeCategoriesEl.replaceChildren();
    recipeEditCategoryInput.replaceChildren();
    const categories = [{ id: 'all', label: 'Todas las recetas' }, ...recipeCategories];
    categories.forEach(category => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recipe-category-btn';
        btn.dataset.category = category.id;
        btn.append(document.createTextNode(category.label));
        const count = document.createElement('span');
        count.className = 'recipe-category-count';
        btn.append(count);
        btn.addEventListener('click', () => {
            selectedRecipeCategory = category.id;
            recipesSearchInput.value = '';
            renderRecipesList();
            recipesListEl.scrollTop = 0;
        });
        recipeCategoriesEl.append(btn);
        if (category.id !== 'all') {
            const option = document.createElement('option');
            option.value = category.id;
            option.textContent = category.label;
            recipeEditCategoryInput.append(option);
        }
    });
}

function simpleMarkdownToHtml(md) {
    const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    const lines = md.split('\n');
    const out = [];
    let inUl = false, inOl = false;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const h1 = raw.match(/^# (.+)$/);
        const h2 = raw.match(/^## (.+)$/);
        const h3 = raw.match(/^### (.+)$/);
        const ulItem = raw.match(/^[-*] (.+)$/);
        const olItem = raw.match(/^(\d+)\. (.+)$/);
        if (h3) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
            out.push('<h3>' + inline(escape(h3[1])) + '</h3>');
            continue;
        }
        if (h2) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
            out.push('<h2>' + inline(escape(h2[1])) + '</h2>');
            continue;
        }
        if (h1) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
            out.push('<h1>' + inline(escape(h1[1])) + '</h1>');
            continue;
        }
        if (ulItem) {
            if (inOl) { out.push('</ol>'); inOl = false; }
            if (!inUl) { out.push('<ul>'); inUl = true; }
            out.push('<li>' + inline(escape(ulItem[1])) + '</li>');
            continue;
        }
        if (olItem) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (!inOl) { out.push('<ol>'); inOl = true; }
            out.push('<li>' + inline(escape(olItem[2])) + '</li>');
            continue;
        }
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (raw.trim()) {
            out.push('<p>' + inline(escape(raw)) + '</p>');
        }
    }
    if (inUl) out.push('</ul>');
    if (inOl) out.push('</ol>');
    return out.join('\n');
}

function renderRecipesList(filterText = '') {
    const q = filterText.trim().toLowerCase();
    recipesListEl.innerHTML = '';
    const activeCategory = q ? 'all' : selectedRecipeCategory;
    recipeCategoriesEl.querySelectorAll('button').forEach(btn => {
        const category = btn.dataset.category;
        btn.setAttribute('aria-pressed', String(category === activeCategory));
        btn.querySelector('.recipe-category-count').textContent = category === 'all'
            ? allRecipes.length
            : allRecipes.filter(r => (r.category || 'uncategorized') === category).length;
    });

    const filtered = q
        ? allRecipes.filter(r =>
            r.title.toLowerCase().includes(q) ||
            (r.altName && r.altName.toLowerCase().includes(q)) ||
            (r.slug && r.slug.toLowerCase().includes(q))
        )
        : allRecipes.filter(r => selectedRecipeCategory === 'all' ||
            (r.category || 'uncategorized') === selectedRecipeCategory);

    const categoryLabel = recipeCategories.find(c => c.id === selectedRecipeCategory)?.label;
    const scope = q ? 'Buscando en todas las categorías' : categoryLabel || 'Todas las recetas';
    recipesSummaryEl.textContent = `${scope} · ${filtered.length} receta${filtered.length === 1 ? '' : 's'}`;

    if (!filtered.length) {
        const message = !allRecipes.length ? 'Todavía no hay recetas.'
            : q ? 'Ninguna receta coincide con la búsqueda.' : 'Todavía no hay recetas en esta categoría. Puedes elegir otra desde el menú Editar de la receta.';
        const empty = document.createElement('p');
        empty.className = 'recipes-empty';
        empty.textContent = message;
        recipesListEl.append(empty);
        return;
    }

    filtered.forEach(r => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recipe-card';
        btn.innerHTML = `
                <div class="recipe-card-inner">
                    <div class="recipe-thumb ${r.image ? '' : 'recipe-thumb-placeholder'}">
                        ${r.image ? `<img src="${escapeHtml(r.image)}" alt="${escapeHtml(r.title)}">` : '📖'}
                    </div>
                    <div class="recipe-title">${escapeHtml(r.title)}${r.generated ? '<span class="recipe-generated-badge">Auto</span>' : ''}</div>
                </div>
            `;
        btn.addEventListener('click', () => openRecipe(r.slug));
        recipesListEl.appendChild(btn);
    });
}

async function loadRecipesList() {
    recipesListEl.innerHTML = '';
    recipesSummaryEl.textContent = '';
    closeRecipeEditForm();
    recipeDetailEl.style.display = 'none';
    recipesListEl.style.display = '';
    const searchInput = document.getElementById('recipes-search-input');
    if (searchInput) searchInput.value = '';

    try {
        const [res, categoriesRes] = await Promise.all([
            fetch('/api/recipes'),
            fetch('/recipe-categories.json'),
        ]);
        if (!res.ok || !categoriesRes.ok) throw new Error('Could not load recipes');
        allRecipes = await res.json();
        recipeCategories = await categoriesRes.json();
        setupRecipeCategories();
        renderRecipesList();
    } catch (e) {
        recipesListEl.innerHTML = '<p class="recipes-empty">Could not load recipes.</p>';
        showToast('Could not load recipes');
    }
}

let currentRecipeSlug = null;
let currentRecipe = null;

function renderRecipeDetail(recipe) {
    currentRecipe = recipe;
    recipeDetailTitleEl.textContent = recipe.title;
    let html = `
        <div class="recipe-detail-image${recipe.image ? '' : ' recipe-detail-image-empty'}">
            ${recipe.image ? `<img src="${escapeHtml(recipe.image)}" alt="${escapeHtml(recipe.title)}">` : ''}
            <button class="recipe-regen-btn" id="recipe-regen-btn" title="Regenerate image">⟳</button>
        </div>
    `;
    if (recipe.generated) {
        html += '<div class="recipe-generated-note"><strong>Autogenerated recipe</strong><span>Created from a weekly idea. Review and edit it before relying on it again.</span></div>';
    }
    if (recipe.sourceUrl) {
        html += `<p><a href="${escapeHtml(recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer">View original recipe ↗</a></p>`;
    }
    html += simpleMarkdownToHtml(recipe.content);
    recipeDetailContentEl.innerHTML = html;
    const regenBtn = document.getElementById('recipe-regen-btn');
    if (regenBtn) regenBtn.addEventListener('click', () => regenerateCurrentImage());
}

async function openRecipe(slug) {
    try {
        currentRecipeSlug = slug;
        const res = await fetch(`/api/recipes/${encodeURIComponent(slug)}`);
        const recipe = await res.json();
        renderRecipeDetail(recipe);
        closeRecipeEditForm();
        recipesListEl.style.display = 'none';
        recipeDetailEl.style.display = 'flex';
    } catch (e) {
        recipeDetailContentEl.innerHTML = '<p>Could not load recipe.</p>';
        showToast('Could not load recipe');
    }
}

async function regenerateCurrentImage() {
    if (!currentRecipeSlug) return;
    const btn = document.getElementById('recipe-regen-btn');
    const img = document.querySelector('.recipe-detail-image img');
    const wrapper = document.querySelector('.recipe-detail-image');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    try {
        const res = await fetch(`/api/recipes/${encodeURIComponent(currentRecipeSlug)}/regenerate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.error || 'Could not regenerate image');
            return;
        }
        const cacheBusted = `${data.image}?t=${Date.now()}`;
        if (img) {
            img.src = cacheBusted;
        } else if (wrapper) {
            const newImg = document.createElement('img');
            newImg.src = cacheBusted;
            newImg.alt = recipeDetailTitleEl.textContent || '';
            wrapper.classList.remove('recipe-detail-image-empty');
            wrapper.insertBefore(newImg, wrapper.firstChild);
        }
        showToast('Image updated');
    } catch (e) {
        showToast('Could not regenerate image');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    }
}

document.getElementById('recipe-detail-back').addEventListener('click', () => {
    closeRecipeEditForm();
    recipeDetailEl.style.display = 'none';
    recipesListEl.style.display = '';
});

const recipeEditFormEl = document.getElementById('recipe-edit-form');
const recipeEditTitleInput = document.getElementById('recipe-edit-title');
const recipeEditAltInput = document.getElementById('recipe-edit-alt');
const recipeEditCategoryInput = document.getElementById('recipe-edit-category');

function openRecipeEditForm() {
    if (!currentRecipe) return;
    recipeEditTitleInput.value = currentRecipe.title || '';
    recipeEditAltInput.value = currentRecipe.altName || '';
    recipeEditCategoryInput.value = currentRecipe.category || 'uncategorized';
    recipeEditFormEl.style.display = 'flex';
    recipeEditTitleInput.focus();
}

function closeRecipeEditForm() {
    recipeEditFormEl.style.display = 'none';
}

async function saveRecipeEdit() {
    if (!currentRecipeSlug) return;
    const payload = {
        title: recipeEditTitleInput.value.trim(),
        altName: recipeEditAltInput.value.trim(),
        category: recipeEditCategoryInput.value,
    };
    try {
        const res = await fetch(`/api/recipes/${encodeURIComponent(currentRecipeSlug)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Could not save');
            return;
        }
        renderRecipeDetail(data);
        // Refresh the list and counts immediately after a title or category change.
        const idx = allRecipes.findIndex(r => r.slug === data.slug);
        if (idx >= 0) {
            allRecipes[idx] = { ...allRecipes[idx], title: data.title, altName: data.altName, category: data.category };
        }
        renderRecipesList(recipesSearchInput.value);
        closeRecipeEditForm();
        showToast('Saved');
    } catch (e) {
        showToast('Could not save');
    }
}

async function deleteCurrentRecipe() {
    if (!currentRecipeSlug) return;
    const title = currentRecipe?.title || currentRecipeSlug;
    if (!confirm(`Delete "${title}"? This removes the markdown and image and cannot be undone.`)) return;
    try {
        const res = await fetch(`/api/recipes/${encodeURIComponent(currentRecipeSlug)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.error || 'Could not delete');
            return;
        }
        allRecipes = allRecipes.filter(r => r.slug !== currentRecipeSlug);
        renderRecipesList(document.getElementById('recipes-search-input')?.value || '');
        closeRecipeEditForm();
        recipeDetailEl.style.display = 'none';
        recipesListEl.style.display = '';
        currentRecipeSlug = null;
        currentRecipe = null;
        showToast('Recipe deleted');
    } catch (e) {
        showToast('Could not delete');
    }
}

document.getElementById('recipe-edit-btn').addEventListener('click', openRecipeEditForm);
document.getElementById('recipe-edit-cancel').addEventListener('click', closeRecipeEditForm);
document.getElementById('recipe-edit-save').addEventListener('click', saveRecipeEdit);
document.getElementById('recipe-edit-delete').addEventListener('click', deleteCurrentRecipe);

const recipesSearchInput = document.getElementById('recipes-search-input');
if (recipesSearchInput) {
    recipesSearchInput.addEventListener('input', (e) => {
        renderRecipesList(e.target.value || '');
    });
}

async function openInitialRecipeFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('recipe');
    if (!slug) return;
    navigate('recipes-screen');
    await loadRecipesList();
    openRecipe(slug);
}

openInitialRecipeFromQuery();

// ===================
// Recipe Scanner (Camera)
// ===================
const scanRecipeBtn = document.getElementById('scan-recipe-btn');
const recipeCameraInput = document.getElementById('recipe-camera-input');
const scanStatusEl = document.getElementById('scan-status');

function showScanStatus(message, type = 'info') {
    scanStatusEl.textContent = message;
    scanStatusEl.className = `scan-status scan-status-${type}`;
    scanStatusEl.style.display = 'block';
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            scanStatusEl.style.display = 'none';
        }, 5000);
    }
}

if (scanRecipeBtn && recipeCameraInput) {
    scanRecipeBtn.addEventListener('click', () => {
        recipeCameraInput.click();
    });

    recipeCameraInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reset input
        e.target.value = '';

        try {
            showScanStatus('📸 Scanning recipe...', 'info');

            // Convert to base64
            const reader = new FileReader();
            const base64Promise = new Promise((resolve, reject) => {
                reader.onload = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
            });
            reader.readAsDataURL(file);

            const base64Image = await base64Promise;

            // Send to backend
            const response = await fetch('/api/recipes/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: base64Image,
                    mediaType: file.type
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Scan failed');
            }

            const result = await response.json();
            showScanStatus(`✅ Recipe saved: ${result.title}`, 'success');

            // Reload recipes list
            await loadRecipesList();

            // Auto-open the new recipe
            setTimeout(() => {
                openRecipe(result.slug);
            }, 1000);

        } catch (error) {
            console.error('Recipe scan error:', error);
            showScanStatus(`❌ Scan failed: ${error.message}`, 'error');
        }
    });
}

// ===================
// Clock
// ===================
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}`;
}
updateClock();
setInterval(updateClock, 10000);

// ===================
// Home Assistant
// ===================
let haConnected = false;
// Suppress toast spam from transient blips (cert rotation, wifi hiccups). Only
// surface "Could not reach server" after several consecutive failures, and
// only once per outage — re-armed on the next successful fetch.
let consecutiveFetchFailures = 0;
let outageToastShown = false;
const FETCH_FAILURE_TOAST_THRESHOLD = 3;

async function fetchSensors() {
    try {
        const res = await fetch('/api/sensors');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        consecutiveFetchFailures = 0;
        outageToastShown = false;

        if (data.temperature) {
            document.getElementById('temperature').textContent =
                `${Math.round(data.temperature.value)}°`;
        }

        if (data.weather) {
            const icon = WEATHER_ICONS[data.weather.state] || '🌡️';
            document.getElementById('weather-icon').textContent = icon;
        }

        if (data.battery && data.battery.value != null) {
            const pct = Math.round(data.battery.value);
            const levelEl = document.getElementById('battery-level');
            const iconEl = document.getElementById('battery-icon');
            levelEl.textContent = `${pct}%`;
            iconEl.textContent = pct <= 20 ? '🪫' : '🔋';
            levelEl.className = pct <= 20 ? 'battery-low'
                : pct <= 50 ? 'battery-mid'
                : 'battery-high';
        }

        if (data.power && data.power.value != null) {
            const w = Math.abs(Math.round(data.power.value));
            const el = document.getElementById('power');
            el.textContent = w;
            el.className = w > 4000 ? 'power-high' : w > 2000 ? 'power-mid' : 'power-low';
        }
    } catch (e) {
        consecutiveFetchFailures++;
        if (consecutiveFetchFailures >= FETCH_FAILURE_TOAST_THRESHOLD && !outageToastShown) {
            showToast('Could not reach server');
            outageToastShown = true;
        }
    }
}

async function checkConnection() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        haConnected = data.connected;
        const dot = document.querySelector('.ha-dot');
        const text = document.querySelector('.ha-text');
        dot.className = 'ha-dot ' + (haConnected ? 'connected' : 'disconnected');
        text.textContent = haConnected ? 'Home Assistant' : 'Disconnected';
    } catch (e) {
        haConnected = false;
    }
}

checkConnection();
fetchSensors();
setInterval(fetchSensors, 30000);

// ===================
// Food Ready Notification
// ===================
async function sendFoodReady() {
    const btn = document.getElementById('btn-notify');
    const feedback = document.getElementById('notify-feedback');

    btn.classList.add('sending');

    try {
        const message = 'La comida esta lista';

        // Send both: Pushbullet + Home Assistant → Alexa (Echo Show TTS)
        const [pushbulletResult, alexaResult] = await Promise.all([
            fetch('/api/notify/food-ready', { method: 'POST' })
                .then(r => r.json())
                .then(d => d.ok === true)
                .catch(() => false),
            fetch('/api/service/notify/alexa_media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    data: { type: 'tts' },
                    target: 'media_player.echo_show'
                })
            }).then(r => r.json()).catch(() => ({})).then(d => d.success === true)
        ]);

        const isSuccess = pushbulletResult || alexaResult;
        feedback.textContent = isSuccess ? 'Notification sent!' : 'Failed to send';
        feedback.style.color = isSuccess ? 'var(--success)' : 'var(--accent)';
    } catch (e) {
        feedback.textContent = 'Failed to send';
        feedback.style.color = 'var(--accent)';
        showToast('Connection lost — notification not sent');
    }

    feedback.classList.add('visible');
    setTimeout(() => {
        btn.classList.remove('sending');
        feedback.classList.remove('visible');
    }, 2000);
}

// ===================
// Timer System
// ===================
let timers = [];
let timerIdCounter = 0;

function createTimer(totalSeconds, label) {
    const timer = {
        id: ++timerIdCounter,
        totalSeconds,
        remaining: totalSeconds,
        label: label || formatTimerLabel(totalSeconds),
        running: true,
        done: false
    };
    timers.push(timer);
    renderTimers();
    updateTimerPreviews();
    return timer;
}

function formatTimerLabel(seconds) {
    if (seconds >= 3600) return `${Math.round(seconds / 3600)} hour timer`;
    if (seconds >= 60) return `${Math.round(seconds / 60)} min timer`;
    return `${seconds} sec timer`;
}

function formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderTimers() {
    const list = document.getElementById('timers-list');
    list.innerHTML = '';

    timers.forEach(timer => {
        const card = document.createElement('div');
        card.className = 'timer-card' + (timer.done ? ' done' : '');
        card.id = `timer-${timer.id}`;

        const progress = timer.totalSeconds > 0
            ? ((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100
            : 100;

        card.innerHTML = `
            <div class="timer-progress" style="width: ${progress}%"></div>
            <div class="timer-display">${formatTime(timer.remaining)}</div>
            <div class="timer-label">${timer.label}</div>
            <div class="timer-controls">
                <button class="timer-ctrl-btn" onclick="toggleTimer(${timer.id})">${timer.running && !timer.done ? '⏸' : '▶'}</button>
                <button class="timer-ctrl-btn" onclick="addMinute(${timer.id})">+1m</button>
                <button class="timer-ctrl-btn danger" onclick="removeTimer(${timer.id})">✕</button>
            </div>
        `;
        list.appendChild(card);
    });
}

function toggleTimer(id) {
    const timer = timers.find(t => t.id === id);
    if (!timer) return;
    if (timer.done) {
        stopAlarm(timer);
        return;
    }
    timer.running = !timer.running;
    renderTimers();
}

function addMinute(id) {
    const timer = timers.find(t => t.id === id);
    if (!timer) return;
    timer.remaining += 60;
    timer.totalSeconds += 60;
    if (timer.done) {
        timer.done = false;
        timer.running = true;
        stopAlarm(timer);
    }
    renderTimers();
    updateTimerPreviews();
}

function removeTimer(id) {
    const timer = timers.find(t => t.id === id);
    if (timer) stopAlarm(timer);
    timers = timers.filter(t => t.id !== id);
    renderTimers();
    updateTimerPreviews();
}

function stopAlarm(timer) {
    if (timer._alarmInterval) {
        clearInterval(timer._alarmInterval);
        timer._alarmInterval = null;
    }
}

function playAlarmSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [880, 1100, 880, 1100];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            osc.type = 'square';
            gain.gain.value = 0.15;
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.12);
        });
    } catch (e) {}
}

function timerDone(timer) {
    timer.done = true;
    timer.running = false;
    timer.remaining = 0;
    playAlarmSound();
    timer._alarmInterval = setInterval(playAlarmSound, 2000);
    renderTimers();
    updateTimerPreviews();

}

// Timer tick
setInterval(() => {
    let changed = false;
    timers.forEach(timer => {
        if (timer.running && !timer.done) {
            timer.remaining--;
            if (timer.remaining <= 0) {
                timerDone(timer);
            }
            changed = true;
        }
    });

    if (changed) {
        timers.forEach(timer => {
            const card = document.getElementById(`timer-${timer.id}`);
            if (!card) return;
            const display = card.querySelector('.timer-display');
            if (display) display.textContent = formatTime(timer.remaining);
            const bar = card.querySelector('.timer-progress');
            if (bar) {
                const pct = timer.totalSeconds > 0
                    ? ((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100
                    : 100;
                bar.style.width = pct + '%';
            }
        });
        updateTimerPreviews();
    }
}, 1000);

// Timer previews on dashboard
function updateTimerPreviews() {
    const container = document.getElementById('active-timers');
    const list = document.getElementById('timer-previews');
    const active = timers.filter(t => t.running || t.done);

    if (active.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = '';
    list.innerHTML = '';
    active.forEach(timer => {
        const el = document.createElement('div');
        el.className = 'timer-preview';
        el.innerHTML = `
            <span class="timer-preview-label">${timer.label}</span>
            <span class="timer-preview-time ${timer.done ? 'urgent' : ''}">${timer.done ? 'DONE!' : formatTime(timer.remaining)}</span>
        `;
        el.addEventListener('click', () => navigate('timer-screen'));
        list.appendChild(el);
    });
}

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.minutes);
        createTimer(mins * 60);
    });
});

// ===================
// Shopping List
// ===================
let shoppingItems = [];

async function loadShoppingList() {
    try {
        const res = await fetch('/api/shopping');
        shoppingItems = await res.json();
        renderShoppingList();
    } catch (e) {
        showToast('Could not load shopping list');
    }
}

function saveShoppingList() {
    fetch('/api/shopping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shoppingItems)
    }).then(res => {
        if (!res.ok) showToast('Failed to save list');
    }).catch(() => showToast('Connection lost — could not save'));
}

function renderShoppingList() {
    const list = document.getElementById('shopping-list');
    list.innerHTML = '';

    const sorted = shoppingItems.filter(item => !item.excluded).sort((a, b) => a.checked - b.checked);

    sorted.forEach(item => {
        const el = document.createElement('div');
        el.className = 'shopping-item' + (item.checked ? ' checked' : '');
        el.innerHTML = `
            <div class="item-check">${item.checked ? '✓' : ''}</div>
            <span class="item-text">${escapeHtml(item.text)}</span>
            <button class="item-delete">✕</button>
        `;

        el.querySelector('.item-check').addEventListener('click', (e) => {
            e.stopPropagation();
            item.checked = !item.checked;
            saveShoppingList();
            renderShoppingList();
        });

        el.querySelector('.item-text').addEventListener('click', () => {
            item.checked = !item.checked;
            saveShoppingList();
            renderShoppingList();
        });

        el.querySelector('.item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            shoppingItems = shoppingItems.filter(i => i !== item);
            saveShoppingList();
            renderShoppingList();
        });

        list.appendChild(el);
    });
}

function addShoppingItem(text) {
    text = text.trim();
    if (!text) return;
    // Add new items to the top of the list
    shoppingItems.unshift({ id: `shopping-${crypto.randomUUID()}`, text, checked: false });
    saveShoppingList();
    renderShoppingList();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.getElementById('add-item-btn').addEventListener('click', () => {
    const input = document.getElementById('shopping-input');
    addShoppingItem(input.value);
    input.value = '';
    input.focus();
});

document.getElementById('shopping-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        addShoppingItem(e.target.value);
        e.target.value = '';
    }
});

document.getElementById('clear-checked').addEventListener('click', () => {
    shoppingItems = shoppingItems.filter(i => !i.checked);
    saveShoppingList();
    renderShoppingList();
});

document.getElementById('send-list-btn').addEventListener('click', async () => {
    const btn = document.getElementById('send-list-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
        const res = await fetch('/api/shopping/send', { method: 'POST' });
        const data = await res.json();
        btn.textContent = data.ok ? 'Sent!' : 'Failed';
    } catch (e) {
        btn.textContent = 'Failed';
        showToast('Connection lost — list not sent');
    }
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Send list';
    }, 2000);
});

// Keep the request ID across lost responses/reloads so a retry cannot print twice.
let pendingPrint = null;
try { pendingPrint = JSON.parse(localStorage.getItem('shopping-print-job') || 'null'); } catch {}
let printPolling = false;
const printButton = document.getElementById('print-list-btn');
const printStatus = document.getElementById('print-status');

function rememberPrint() {
    try {
        if (pendingPrint) localStorage.setItem('shopping-print-job', JSON.stringify(pendingPrint));
        else localStorage.removeItem('shopping-print-job');
    } catch {}
}

async function followPrint() {
    if (printPolling || !pendingPrint) return;
    printPolling = true;
    printButton.disabled = true;
    printButton.textContent = 'Printing…';
    try {
        if (!pendingPrint.id) {
            const response = await fetch('/api/shopping/print', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pendingPrint.key },
                body: JSON.stringify({ items: pendingPrint.items })
            });
            const job = await response.json();
            if (!response.ok) {
                // A validation/full-queue rejection did not create a job.
                if ([400, 403, 413, 415, 429].includes(response.status)) {
                    pendingPrint = null;
                    rememberPrint();
                }
                throw new Error(job.error || 'Could not submit print');
            }
            pendingPrint.id = job.id;
            rememberPrint();
        }
        for (;;) {
            const response = await fetch('/api/shopping/print/' + pendingPrint.id);
            const job = await response.json();
            if (!response.ok) throw new Error(job.error || 'Could not check print status');
            printStatus.textContent = job.message;
            if (['succeeded', 'failed', 'unknown'].includes(job.state)) {
                if (job.state === 'succeeded') showToast('Shopping list printed');
                pendingPrint = null;
                rememberPrint();
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    } catch (error) {
        printStatus.textContent = error.message + (pendingPrint ? ' Tap to check again; this will not print a second copy.' : '');
    } finally {
        printPolling = false;
        printButton.disabled = false;
        printButton.textContent = pendingPrint ? 'Check print' : 'Print list';
    }
}

printButton.addEventListener('click', () => {
    if (!pendingPrint) {
        const items = shoppingItems.filter(item => !item.checked && !item.excluded && !item.orderExcluded).map(item => item.text);
        if (!items.length) { showToast('No unchecked items to print'); return; }
        const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
        pendingPrint = { key, items };
        rememberPrint();
        printStatus.textContent = 'Sending shopping list to printer…';
    }
    followPrint();
});
if (pendingPrint) followPrint();

loadShoppingList();

// ===================
// Voice Recognition
// ===================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
/** Pending onend → restart timer; must be cleared when user turns mic off */
let micRestartTimer = null;
/** Last final transcript for this mic session (fixes progressive finals: "tortilla" → "tortilla de patatas") */
let lastVoiceFinalTranscript = '';

function normalizeVoicePhrase(text) {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Split spoken text into individual items
// Handles: "leche, pan y huevos" -> ["leche", "pan", "huevos"]
function splitIntoItems(text) {
    return text
        .split(/,|\by\b|\be\b/i)    // split on commas, "y", "e"
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
}

/** Remove unchecked list rows whose text matches any of these parts (voice refinement undo). */
function removeShoppingItemsMatchingParts(parts) {
    const set = new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean));
    if (set.size === 0) return;
    const before = shoppingItems.length;
    shoppingItems = shoppingItems.filter((i) => {
        if (i.checked || i.excluded || i.orderExcluded) return true;
        return !set.has(i.text.trim().toLowerCase());
    });
    if (shoppingItems.length !== before) {
        saveShoppingList();
        renderShoppingList();
    }
}

function applyVoiceFinalTranscript(rawTranscript) {
    const normalized = normalizeVoicePhrase(rawTranscript);
    if (!normalized) return;

    if (normalized === lastVoiceFinalTranscript) return;

    // Only treat as same utterance growing if the longer text continues after space/comma
    // (avoids "pan" then "panadero" being merged; progressive API uses "tortilla" → "tortilla de …")
    const last = lastVoiceFinalTranscript;
    const isRefinement =
        last &&
        normalized.length > last.length &&
        (normalized.startsWith(last + ' ') || normalized.startsWith(last + ','));

    if (isRefinement) {
        const oldParts = splitIntoItems(last);
        removeShoppingItemsMatchingParts(oldParts);
    }

    const items = splitIntoItems(normalized);
    items.slice()
        .reverse()
        .forEach((item) => addShoppingItem(item));
    lastVoiceFinalTranscript = normalized;
}

function initVoice() {
    const micBtn = document.getElementById('mic-btn');
    const micStatus = document.getElementById('mic-status');

    if (!SpeechRecognition) {
        micBtn.addEventListener('click', () => {
            micStatus.textContent = 'Voice not supported in this browser. Use Chrome.';
        });
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();

            if (event.results[i].isFinal) {
                applyVoiceFinalTranscript(transcript);
                const items = splitIntoItems(normalizeVoicePhrase(transcript));
                if (items.length > 0) {
                    micStatus.textContent = `+ ${items.join(', ')}`;
                    micStatus.className = 'mic-status heard';
                }
            } else {
                interim = transcript;
            }
        }

        if (interim) {
            micStatus.textContent = interim;
            micStatus.className = 'mic-status';
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            micStatus.textContent = 'Microphone blocked (needs HTTPS)';
            document.getElementById('mic-help').style.display = '';
        } else if (event.error === 'no-speech') {
            micStatus.textContent = 'No speech detected, try again';
        } else if (event.error !== 'aborted') {
            micStatus.textContent = `Error: ${event.error}`;
        }
        stopListening();
    };

    recognition.onend = () => {
        if (!isListening) return;
        if (micRestartTimer != null) {
            clearTimeout(micRestartTimer);
            micRestartTimer = null;
        }
        // Defer restart; cancel via clearTimeout(micRestartTimer) when user turns mic off
        micRestartTimer = setTimeout(() => {
            micRestartTimer = null;
            if (!isListening) return;
            try {
                recognition.start();
            } catch (e) {
                stopListening();
            }
        }, 0);
    };

    micBtn.addEventListener('click', () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    });
}

function startListening() {
    if (!recognition) return;
    if (micRestartTimer != null) {
        clearTimeout(micRestartTimer);
        micRestartTimer = null;
    }
    isListening = true;
    lastVoiceFinalTranscript = '';
    document.getElementById('mic-btn').classList.add('listening');
    document.getElementById('mic-status').textContent = 'Escuchando...';
    document.getElementById('mic-status').className = 'mic-status';
    try {
        recognition.start();
    } catch (e) {}
}

function stopListening() {
    if (micRestartTimer != null) {
        clearTimeout(micRestartTimer);
        micRestartTimer = null;
    }
    isListening = false;
    document.getElementById('mic-btn').classList.remove('listening');
    // abort() stops continuous recognition immediately; stop() can still fire onend and re-queue listening in WebKit
    try {
        recognition.abort();
    } catch (e) {}
    setTimeout(() => {
        if (!isListening) document.getElementById('mic-status').textContent = '';
    }, 3000);
}

initVoice();

// ===================
// Wake Lock (keep screen on)
// ===================
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            await navigator.wakeLock.request('screen');
        }
    } catch (e) {}
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        updateClock();
        fetchSensors();
        loadShoppingList();
    }
});

requestWakeLock();
