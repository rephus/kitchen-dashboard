const fs = require('fs');
const path = require('path');
const { buildImportedMarkdown, validateSourceRecipe } = require('./recipe-import');

function comparable(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]/g, '');
}

function createRecipeSuggestions({ catalog, recipesDir, listRecipes, readRecipeFile,
    getRecipe, uniqueRecipeSlug, readWeeklyPlan, saveWeeklyPlan, expandWeeklyPlan }) {
    function findExisting(suggestion) {
        const titles = [suggestion.title, suggestion.originalTitle].map(comparable).filter(Boolean);
        return listRecipes().find(recipe => {
            const meta = readRecipeFile(recipe.slug)?.meta || {};
            return meta.suggestion_id === suggestion.id || meta.source === suggestion.sourceUrl
                || [recipe.title, recipe.altName].some(title => title && titles.includes(comparable(title)));
        });
    }

    function listSuggestions() {
        return catalog.filter(item => item.category === 'mains' && !findExisting(item))
            .slice(0, 20).map(({ recipe, ...suggestion }) => suggestion);
    }

    function importSuggestion(id) {
        const suggestion = catalog.find(item => item.id === id && item.category === 'mains');
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

    return { listSuggestions, importSuggestion };
}

module.exports = { createRecipeSuggestions };
