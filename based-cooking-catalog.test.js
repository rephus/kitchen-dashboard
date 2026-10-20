'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { frontmatter, readable, durationMinutes, classify, imageUrl, parseRecipe, writeCatalog } = require('./scripts/sync-based-cooking.cjs');
const catalog = require('./based-cooking-catalog.json');

function fixture(body, fields = '') {
    return `---\ntitle: "Test dinner"\ntags: ['chicken', 'quick']\nauthor: author-id\n${fields}---\n\n${body}\n`;
}

test('parses source frontmatter without losing quoted apostrophes or tag spelling', () => {
    const parsed = frontmatter("---\ntitle: \"Baba's Feta Pasta\"\ntags: ['Eggs', 'egg whites', 'cheesefare']\n\nauthor: \"A Person\"\n---\nBody");
    assert.equal(parsed.fields.title, "Baba's Feta Pasta");
    assert.deepEqual(parsed.fields.tags, ['Eggs', 'egg whites', 'cheesefare']);
    assert.equal(parsed.fields.author, 'A Person');
});

test('converts Markdown links, emphasis and line breaks into readable safe text', () => {
    assert.equal(readable('Mix **2 tbsp** [sauce (optional)](/sauce_(example)) with _milk_.<br>Then stir.'), 'Mix 2 tbsp sauce (optional) with milk. Then stir.');
    assert.equal(readable('![Step photo](/pix/step.webp) <script>ignored</script>'), 'ignored');
    assert.equal(readable('Add ⅓ cup butter &amp; 2½ tsp salt.'), 'Add ⅓ cup butter & 2½ tsp salt.');
});

test('preserves nested ingredient groups, quantities and continued numbered steps', () => {
    const recipe = parseRecipe(fixture('A dinner.\n\n- ⏲️ Prep time: 10 min\n- 🍳 Cook time: 30 min\n- 🍽️ Servings: 4–6 people\n\n## Ingredients\n\n- Dough:\n  - 350 g flour\n  - 25 g butter\n- Filling:\n  - 1 [cheese](/cheese)\n\n## Directions\n\n### Dough\n\n1. Combine flour\n   and butter.\n2. Cook for 30 min.'), 'test');
    assert.deepEqual(recipe.recipe.ingredients, ['Dough:', '350 g flour', '25 g butter', 'Filling:', '1 cheese']);
    assert.deepEqual(recipe.recipe.ingredientRows.map(row => row.kind), ['heading', 'ingredient', 'ingredient', 'heading', 'ingredient']);
    assert.deepEqual(recipe.recipe.ingredientRows.map(row => row.text), recipe.recipe.ingredients);
    assert.deepEqual(recipe.recipe.instructions, ['Dough:', 'Combine flour and butter.', 'Cook for 30 min.']);
    assert.equal(recipe.recipe.servings, '4–6 people');
    assert.equal(recipe.recipe.totalTime, 'Prep: 10 min; Cook: 30 min');
    assert.equal(recipe.totalMinutes, 40);
});

test('ingredient quantities mentioning servings never become recipe metadata', () => {
    const parsed = parseRecipe(fixture('## Ingredients\n\n- 8 servings [shortcrust pastry](/shortcrust-pastry)\n\n## Directions\n\n1. Bake.'), 'pastry');
    assert.deepEqual(parsed.recipe.ingredients, ['8 servings shortcrust pastry']);
    assert.equal(parsed.recipe.servings, undefined);
});

test('preserves prose-only directions and separate preparation/cooking sections', () => {
    const prose = parseRecipe(fixture('## Ingredients\n\n- 2l milk\n\n## Directions\n\n### Preparation\n\nWarm milk.\nStir gently.\n\n### Aging (optional)\n\nKeep chilled.'), 'cheese');
    assert.deepEqual(prose.recipe.instructions, ['Preparation:', 'Warm milk. Stir gently.', 'Aging (optional):', 'Keep chilled.']);
    const split = parseRecipe(fixture('## Ingredients\n\n- 2 beets\n\n## Prep Directions (30 min)\n\n1. Chop.\n\n## Cooking Directions (90 min)\n\n1. Simmer.'), 'borscht');
    assert.deepEqual(split.recipe.instructions, ['Prep Directions (30 min):', 'Chop.', 'Cooking Directions (90 min):', 'Simmer.']);
});

test('keeps spice ingredients and later cooking methods, while separating notes and equipment', () => {
    const parsed = parseRecipe(fixture('## Equipment\n\n- Heavy pan\n\n## Ingredients\n\n- 1 potato\n\n## Spice Blend\n\n- 1 tsp cumin\n\n## Directions\n\n1. Cook.\n\n## Frying\n\n- Air fry for 10 minutes.\n\n## Notes\n\nCool leftovers.\n\n---\n\nSee also: [Author](/author)'), 'potato');
    assert.deepEqual(parsed.recipe.ingredients, ['1 potato', 'Spice Blend:', '1 tsp cumin']);
    assert.deepEqual(parsed.recipe.instructions, ['Cook.', 'Frying:', 'Air fry for 10 minutes.']);
    assert.deepEqual(parsed.context.map(item => item.heading), ['Equipment', 'Notes']);
    assert.ok(!parsed.recipe.instructions.some(step => step.includes('Author')));
});

test('retains explicit serving ranges and ambiguous waiting durations without inventing numeric totals', () => {
    const parsed = parseRecipe(fixture('- ⏲️ Prep time: 20 min + 30 min for rising\n- 🍳 Cook time: Simmer all day\n- 🍽️ Servings: 6-8 people\n\n## Ingredients\n\n- Beef\n\n## Directions\n\n1. Simmer.'), 'stew');
    assert.equal(parsed.recipe.servings, '6-8 people');
    assert.equal(parsed.totalMinutes, null);
    assert.equal(parsed.recipe.totalTime, 'Prep: 20 min + 30 min for rising; Cook: Simmer all day');
    assert.equal(durationMinutes('1 hour 30 minutes'), 90);
    assert.equal(durationMinutes('2.5 hours'), 150);
    assert.equal(durationMinutes('10–15 minutes'), null);
    assert.equal(durationMinutes('overnight'), null);
    const prepOnly = parseRecipe(fixture('- Prep time: 10 min\n\n## Ingredients\n\n- Egg\n\n## Directions\n\n1. Cook.'), 'incomplete-time');
    assert.equal(prepOnly.totalMinutes, null);
    assert.equal(prepOnly.recipe.totalTime, 'Prep: 10 min');
    assert.equal(durationMinutes('20 min + 30 min for rising'), null);
});

test('only exposes HTTPS Based Cooking pix images, without local file or credential URLs', () => {
    assert.equal(imageUrl('![Title](/pix/photo.webp)'), 'https://based.cooking/pix/photo.webp');
    for (const url of ['file:///tmp/photo.webp', 'http://based.cooking/pix/a.webp', 'https://user:secret@based.cooking/pix/a.webp', 'https://evil.example/pix/a.webp', '/etc/passwd']) {
        assert.equal(imageUrl(`![Title](${url})`), '');
    }
});

test('course heuristics are conservative and explicitly separate known non-main courses', () => {
    for (const [title, tags, category] of [
        ['Chicken curry', ['chicken'], 'mains'],
        ['Herbs pizza', ['cheesefare', 'pie'], 'mains'],
        ['Chocolate Cake', ['chocolate'], 'desserts'],
        ['Sardine Cakes', ['fish'], 'mains'],
        ['French toast', ['breakfast'], 'sides'],
        ['Simple Tuna Salad', ['tuna'], 'sides'],
        ['Naan Bread', ['bread'], 'sides'],
        ['Lentil Soup', ['lentil'], 'starters'],
        ['Clam Chowder', ['seafood'], 'starters'],
        ['Ricotta lasagna filling', ['pasta'], 'sauces-basics'],
        ['Greek Yogurt', ['basic'], 'sauces-basics'],
        ['Kvass', ['bread', 'drink'], 'drinks'],
        ['Mystery dish', ['traditional'], 'uncategorized'],
    ]) {
        const result = classify(title, tags);
        assert.equal(result.category, category, title);
        assert.equal(result.method, 'heuristic');
        assert.equal(result.mainCourseCandidate, category === 'mains');
    }
});

test('all 440 published recipes retain source bytes, usable methods, author credits, groups and provenance', () => {
    assert.equal(catalog.recipes.length, 440);
    assert.equal(catalog.counts.recipes, catalog.recipes.length);
    assert.equal(catalog.classification.official, false);
    assert.match(catalog.snapshot.commit, /^[0-9a-f]{40}$/);
    assert.ok(Number.isFinite(Date.parse(catalog.snapshot.committedAt)));
    assert.equal(catalog.snapshot.license, 'Unlicense');
    assert.equal(new Set(catalog.recipes.map(item => item.id)).size, catalog.recipes.length);
    const validCategories = new Set(['mains', 'starters', 'sides', 'sauces-basics', 'desserts', 'drinks', 'uncategorized']);
    for (const item of catalog.recipes) {
        assert.match(item.id, /^based-[a-z0-9-]+$/, item.id);
        assert.ok(validCategories.has(item.category), item.id);
        assert.equal(item.source, 'Based Cooking');
        assert.ok(item.recipe.ingredients.length && item.recipe.instructions.length, item.id);
        assert.deepEqual(item.recipe.ingredientRows.map(row => row.text), item.recipe.ingredients, item.id);
        assert.ok(item.recipe.ingredientRows.some(row => row.kind === 'ingredient'), item.id);
        assert.ok(item.recipe.ingredientRows.every(row => ['ingredient', 'heading', 'note'].includes(row.kind)), item.id);
        assert.ok(item.recipe.ingredientRows.filter(row => row.kind === 'heading').every(row => !row.text.endsWith('::')), item.id);
        assert.equal(item.sourceSha256, crypto.createHash('sha256').update(item.sourceMarkdown).digest('hex'), item.id);
        const parsed = parseRecipe(item.sourceMarkdown, path.basename(item.sourcePath, '.md'));
        assert.deepEqual(item.recipe.ingredients, parsed.recipe.ingredients, item.id);
        assert.deepEqual(item.recipe.instructions, parsed.recipe.instructions, item.id);
        assert.deepEqual(item.context, parsed.context, item.id);
        assert.ok(item.credits.includes('Public domain'), item.id);
        if (item.author) assert.ok(item.credits.includes(item.author.name), item.id);
        assert.match(item.sourceUrl, /^https:\/\/based\.cooking\//);
        if (item.imageUrl) assert.match(item.imageUrl, /^https:\/\/based\.cooking\/pix\//);
    }
    const byId = Object.fromEntries(catalog.recipes.map(item => [item.id, item]));
    assert.equal(byId['based-modern-borscht'].recipe.instructions.filter(step => /^(?:Prep|Cooking) Directions/.test(step)).length, 2);
    assert.ok(byId['based-kettle-chips'].recipe.instructions.some(step => step.includes('6 hours')));
    assert.ok(byId['based-chimichanga'].recipe.instructions.some(step => step.includes('air fryer')));
    assert.ok(byId['based-tajine'].recipe.ingredients.some(ingredient => ingredient.includes('caraway')));
    assert.ok(byId['based-cheese'].recipe.instructions.some(step => step.includes('Every day of aging')));
    assert.ok(byId['based-chocolate-cake'].sourcePath.endsWith('/chocolate_cake.md'));
    assert.equal(byId['based-asian-style-chicken-sticky-sauce'].recipe.ingredientRows.find(row => row.text === 'Sauce:').kind, 'heading');
    assert.equal(byId['based-cheesy-meatballs'].recipe.ingredientRows[0].kind, 'note');
    assert.equal(byId['based-cheesy-meatballs'].recipe.ingredientRows.find(row => row.text === 'For the meatballs:').kind, 'heading');
    assert.equal(byId['based-nashville-chicken'].recipe.ingredientRows.find(row => row.text === 'Flour').kind, 'heading');
});

test('snapshot export is byte reproducible and copies license and full author registry', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'based-catalog-test-'));
    try {
        const source = path.join(root, 'source');
        const output = path.join(root, 'output');
        fs.mkdirSync(path.join(source, 'content'), { recursive: true });
        fs.mkdirSync(path.join(source, 'data/authors'), { recursive: true });
        fs.mkdirSync(output);
        fs.writeFileSync(path.join(source, 'content/test.md'), fixture('## Ingredients\n\n- 2 eggs\n\n## Directions\n\n1. Cook.'));
        fs.writeFileSync(path.join(source, 'content/_index.md'), 'Website index; not a recipe.');
        fs.writeFileSync(path.join(source, 'data/authors/author-id.json'), JSON.stringify({ name: 'Original Cook', website: 'https://cook.example/' }));
        fs.writeFileSync(path.join(source, 'LICENSE.md'), 'Original public-domain license\n');
        execFileSync('git', ['init', '--quiet', source]);
        execFileSync('git', ['-C', source, 'add', '.']);
        execFileSync('git', ['-C', source, '-c', 'user.name=Catalog Test', '-c', 'user.email=catalog@example.invalid', 'commit', '--quiet', '-m', 'fixture']);
        writeCatalog(source, output);
        const first = fs.readFileSync(path.join(output, 'based-cooking-catalog.json'), 'utf8');
        writeCatalog(source, output);
        assert.equal(fs.readFileSync(path.join(output, 'based-cooking-catalog.json'), 'utf8'), first);
        assert.equal(JSON.parse(first).recipes.length, 1);
        assert.equal(JSON.parse(first).recipes[0].author.name, 'Original Cook');
        assert.equal(fs.readFileSync(path.join(output, 'third-party/based-cooking/LICENSE.md'), 'utf8'), 'Original public-domain license\n');
        assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'third-party/based-cooking/authors.json'), 'utf8'))['author-id'].website, 'https://cook.example/');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
