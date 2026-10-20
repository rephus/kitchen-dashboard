const fs = require('fs');
const path = require('path');
const { buildImportedMarkdown, validateSourceRecipe } = require('./recipe-import');

function comparable(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function suggestionPreview({ recipe, ...suggestion }) {
    return { ...suggestion, ingredients: recipe?.ingredients || [] };
}

function createRecipeSuggestions({ catalog, recipesDir, listRecipes, readRecipeFile,
    getRecipe, uniqueRecipeSlug, readWeeklyPlan, saveWeeklyPlan, expandWeeklyPlan,
    cacheFile, fetchSuggestions }) {
    let suggestions = [...catalog];
    let shuffling = false;
    if (cacheFile && fs.existsSync(cacheFile)) {
        try {
            const saved = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            if (saved.version === 1 && Array.isArray(saved.recipes)) {
                suggestions = [...saved.recipes.filter(item => item.category === 'mains'
                    && /^mealdb-\d+$/.test(item.id)), ...catalog];
            }
        } catch (error) {
            console.error('Could not load saved recipe suggestions:', error.message);
        }
    }
    function findExisting(suggestion) {
        const titles = [suggestion.title, suggestion.originalTitle].map(comparable).filter(Boolean);
        return listRecipes().find(recipe => {
            const meta = readRecipeFile(recipe.slug)?.meta || {};
            return meta.suggestion_id === suggestion.id || meta.source === suggestion.sourceUrl
                || [recipe.title, recipe.altName].some(title => title && titles.includes(comparable(title)));
        });
    }

    function listSuggestions() {
        const available = [];
        for (const item of suggestions) {
            if (item.category === 'mains' && !findExisting(item)) {
                available.push(suggestionPreview(item));
                if (available.length === 15) break;
            }
        }
        return available;
    }

    async function shuffleSuggestions({ category = 'any', excludeIds = [] } = {}) {
        if (!Array.isArray(excludeIds) || excludeIds.length > 100
            || excludeIds.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,100}$/.test(id))) {
            throw Object.assign(new Error('Invalid recipe exclusions'), { statusCode: 400 });
        }
        if (!fetchSuggestions) throw new Error('Recipe discovery is unavailable');
        if (shuffling) throw Object.assign(new Error('A new recipe batch is already loading'), { statusCode: 429 });
        shuffling = true;
        try {
            const importedIds = listRecipes().map(item => readRecipeFile(item.slug)?.meta.suggestion_id).filter(Boolean);
            const excluded = new Set([...excludeIds, ...suggestions.map(item => item.id), ...importedIds]);
            const fresh = await fetchSuggestions({ category, excludeIds: [...excluded], count: 15 });
            const seen = new Set();
            const available = fresh.filter(item => {
                if (item.category !== 'mains' || excluded.has(item.id) || seen.has(item.id) || findExisting(item)) return false;
                validateSourceRecipe(item.recipe);
                seen.add(item.id);
                return true;
            }).slice(0, 15);
            if (!available.length) {
                throw Object.assign(new Error('No different main courses found. Try another category.'), { statusCode: 422 });
            }
            const cached = [...available, ...suggestions.filter(item => !seen.has(item.id))]
                .filter(item => /^mealdb-\d+$/.test(item.id)).slice(0, 200);
            const next = [...cached, ...catalog];
            if (cacheFile) {
                fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
                const temporary = `${cacheFile}.${process.pid}.tmp`;
                fs.writeFileSync(temporary, JSON.stringify({ version: 1, recipes: cached }), 'utf8');
                fs.renameSync(temporary, cacheFile);
            }
            suggestions = next;
            return available.map(suggestionPreview);
        } finally {
            shuffling = false;
        }
    }

    function importSuggestion(id) {
        const suggestion = suggestions.find(item => item.id === id && item.category === 'mains');
        if (!suggestion) {
            const error = new Error('Recipe suggestion not found');
            error.statusCode = 404;
            throw error;
        }
        const previous = readWeeklyPlan();
        const existing = findExisting(suggestion);
        if (existing && previous.selectedRecipes.includes(existing.slug)) {
            return { recipe: getRecipe(existing.slug), plan: expandWeeklyPlan(previous),
                suggestions: listSuggestions(), alreadyImported: true };
        }
        if (previous.selectedRecipes.length + previous.selectedQuickMeals.length >= 21) {
            const error = new Error('Choose at most 21 recipes. Remove a meal before importing another.');
            error.statusCode = 400;
            throw error;
        }

        let createdFile;
        const slug = existing?.slug || uniqueRecipeSlug(suggestion.title);
        if (!existing) {
            const recipe = validateSourceRecipe(suggestion.recipe);
            const markdown = buildImportedMarkdown(suggestion, recipe);
            fs.mkdirSync(recipesDir, { recursive: true });
            createdFile = path.join(recipesDir, `${slug}.md`);
            fs.writeFileSync(createdFile, markdown, { encoding: 'utf8', flag: 'wx' });
        }
        try {
            const plan = saveWeeklyPlan({
                selectedRecipes: [...previous.selectedRecipes, slug],
                selectedQuickMeals: previous.selectedQuickMeals,
                excludedIngredients: previous.excludedIngredients,
                orderReady: false,
            }, { selectionSource: 'recipe-suggestion' });
            return { recipe: getRecipe(slug), plan, suggestions: listSuggestions(),
                alreadyImported: Boolean(existing) };
        } catch (error) {
            if (createdFile && !readWeeklyPlan().selectedRecipes.includes(slug)) fs.unlinkSync(createdFile);
            throw error;
        }
    }

    return { listSuggestions, importSuggestion, shuffleSuggestions };
}

module.exports = { createRecipeSuggestions };
