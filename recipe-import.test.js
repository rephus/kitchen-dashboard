'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSourceRecipe, buildImportedMarkdown } = require('./recipe-import');

const sourceRecipe = {
    name: 'Chicken &amp; Rice',
    ingredients: ['1 ½ cups rice', '2 tablespoons olive oil', '¼ teaspoon salt'],
    instructions: ['Heat the oil.', 'Cook for 20 minutes.'],
    servings: '4 servings', totalTime: 'PT45M', imageUrl: 'https://images.example.com/chicken.jpg',
};
const suggestion = {
    id: 'chicken-rice', title: 'Pollo con arroz', originalTitle: 'Chicken & Rice',
    source: 'Allrecipes', sourceUrl: 'https://www.allrecipes.com/recipe/123/chicken-rice/',
    description: 'Pollo y arroz con una preparación sencilla.', category: 'mains',
    totalMinutes: 20, servings: 2,
};

test('validates cached source quantities, servings, timing and image without guessing', () => {
    assert.deepEqual(validateSourceRecipe(sourceRecipe), {
        name: 'Chicken & Rice', ingredients: ['1 ½ cups rice', '2 tablespoons olive oil', '¼ teaspoon salt'],
        instructions: ['Heat the oil.', 'Cook for 20 minutes.'], servings: '4 servings', totalTime: 'PT45M',
        imageUrl: 'https://images.example.com/chicken.jpg',
    });
});

test('cleans cached source HTML and entities without changing ingredient quantities', () => {
    const parsed = validateSourceRecipe({
        ingredients: ['1 &frac12; cups &lt;b&gt;rice&lt;/b&gt;', '&#188; teaspoon salt', '2 tablespoons <em>oil</em>'],
        instructions: ['<p>Heat to 350&deg;F.</p>', 'Stir &amp; serve.&#10;Enjoy.'],
        imageUrl: 'javascript:alert(1)',
    });
    assert.deepEqual(parsed.ingredients, ['1 ½ cups rice', '¼ teaspoon salt', '2 tablespoons oil']);
    assert.deepEqual(parsed.instructions, ['Heat to 350°F.', 'Stir & serve. Enjoy.']);
    assert.equal(parsed.imageUrl, '');
});

test('rejects missing ingredients or instructions without generating a substitute', () => {
    assert.throws(() => validateSourceRecipe({ ingredients: [], instructions: ['Cook.'] }), /ingredients and preparation/);
    assert.throws(() => validateSourceRecipe({ ingredients: ['1 egg'] }), /ingredients and preparation/);
    assert.throws(() => validateSourceRecipe({ ingredients: ['<script>alert(1)</script>'], instructions: ['Cook.'] }), /ingredients and preparation/);
    assert.throws(() => validateSourceRecipe({ ingredients: ['1 egg'], instructions: [] }), /ingredients and preparation/);
    assert.throws(() => validateSourceRecipe(null), /missing/);
});

test('builds the imported main-course page using source quantities and source attribution', () => {
    const markdown = buildImportedMarkdown(suggestion, validateSourceRecipe(sourceRecipe));
    assert.match(markdown, /^---\ncategory: mains\nsource: https:\/\/www\.allrecipes\.com\/recipe\/123\/chicken-rice\/\nsuggestion_id: chicken-rice\nalt: Chicken & Rice\nimported_at: \d{4}-\d\d-\d\dT.+Z\nsource_image: https:\/\/images\.example\.com\/chicken.jpg\n---/);
    assert.match(markdown, /# Pollo con arroz\n/);
    assert.match(markdown, /Fuente: \[Allrecipes\]\(https:\/\/www\.allrecipes\.com\/recipe\/123\/chicken-rice\/\)/);
    assert.match(markdown, /Raciones: 4 servings/);
    assert.match(markdown, /Tiempo total: 45 min/);
    assert.match(markdown, /## Ingredientes\n\n- 1 ½ cups rice\n- 2 tablespoons olive oil\n- ¼ teaspoon salt/);
    assert.match(markdown, /## Elaboración\n\n1\. Heat the oil\.\n2\. Cook for 20 minutes\./);
    assert.doesNotMatch(markdown, /Raciones: 2|Tiempo total: 20|idioma original/);
});

test('does not fill missing source servings or duration with catalog estimates', () => {
    const markdown = buildImportedMarkdown(suggestion, { ingredients: ['1 egg'], instructions: ['Cook.'] });
    assert.doesNotMatch(markdown, /Raciones:|Tiempo total:/);
    assert.doesNotMatch(markdown, /undefined/);
});

test('preserves apostrophes in the original recipe title metadata', () => {
    const markdown = buildImportedMarkdown({ ...suggestion, originalTitle: "Chef John's Chicken" }, sourceRecipe);
    assert.match(markdown, /alt: Chef John's Chicken\n/);
});

test('cleans HTML, multiline frontmatter and markdown injection without changing quantities', () => {
    const markdown = buildImportedMarkdown({
        ...suggestion, title: '<img src=x onerror=alert(1)>Dinner [link](javascript:alert(1))',
        originalTitle: 'Dinner\ncategory: desserts', description: '<script>alert(1)</script>Nice **rice**',
        imageUrl: 'javascript:alert(1)',
    }, {
        ingredients: ['1/2 cup <b>rice</b>', '2 tsp salt\n## injected', '1 tablespoon &amp; 1 teaspoon oil'],
        instructions: ['<iframe src=x></iframe>Cook **well**.', 'Rest &lt;script&gt;alert(1)&lt;/script&gt;briefly.'],
        imageUrl: 'javascript:alert(1)',
    });
    assert.doesNotMatch(markdown, /<\/?(?:img|script|iframe|b)\b|onerror|\ncategory: desserts|\n## injected|source_image:/i);
    assert.match(markdown, /alt: Dinner category: desserts/);
    assert.ok(markdown.includes('1/2 cup rice'));
    assert.ok(markdown.includes('1 tablespoon & 1 teaspoon oil'));
    assert.ok(markdown.includes('Nice \\*\\*rice\\*\\*'));
    assert.ok(markdown.includes('Dinner \\[link\\](javascript:alert(1))'));
});

test('rejects attribution URLs outside the HTTPS source allowlist', () => {
    for (const sourceUrl of [
        'http://www.allrecipes.com/recipe/1/', 'https://allrecipes.com.evil.example/recipe/1/',
        'https://evil.example/', 'https://user:pass@www.allrecipes.com/recipe/1/',
        'https://www.allrecipes.com:8443/recipe/1/', 'https://127.0.0.1/', undefined,
    ]) {
        assert.throws(() => buildImportedMarkdown({ ...suggestion, sourceUrl }, sourceRecipe), /HTTPS|valid recipe source/);
    }
    assert.match(buildImportedMarkdown({ ...suggestion, sourceUrl: 'https://tasty.co/recipe/chicken' }, sourceRecipe), /source: https:\/\/tasty.co\/recipe\/chicken/);
});
