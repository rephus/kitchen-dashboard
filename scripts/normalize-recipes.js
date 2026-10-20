#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { persistRecipeIngredients, normalizedRecipeRecord } = require('../ingredient-normalizer');
const root = path.resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const directory = path.join(root, 'recipes');
const report = { recipes: 0, ingredients: 0, needsReview: 0, ambiguous: [], dryRun };
for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.md'))) {
    const raw = fs.readFileSync(path.join(directory, filename), 'utf8');
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    const slug = filename.slice(0, -3);
    const record = dryRun ? normalizedRecipeRecord(body)
        : persistRecipeIngredients(body, slug, path.join(root, 'data', 'recipe-ingredients'));
    report.recipes += 1;
    report.ingredients += record.ingredients.length;
    report.needsReview += record.ingredients.filter(item => item.needsReview).length;
    for (const ingredient of record.ingredients) {
        if (ingredient.warnings.some(warning => warning !== 'Cantidad no especificada')) {
            report.ambiguous.push({ recipe: slug, original: ingredient.originalText, warnings: ingredient.warnings });
        }
    }
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
