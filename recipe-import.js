'use strict';

// Imported recipes retain the source quantities and method. There is deliberately
// no generated fallback when a source omits either of those fields.
const SOURCE_HOSTS = new Set(['allrecipes.com', 'www.allrecipes.com', 'tasty.co', 'www.tasty.co',
    'themealdb.com', 'www.themealdb.com']);

function sourceUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Choose a valid recipe source URL'); }
    if (url.protocol !== 'https:' || !SOURCE_HOSTS.has(url.hostname)
        || url.username || url.password || url.port) {
        throw new Error('Recipe sources must use HTTPS on Allrecipes, Tasty, or TheMealDB');
    }
    url.hash = '';
    return url;
}

const ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    frac14: '¼', frac12: '½', frac34: '¾', frac13: '⅓', frac23: '⅔',
    frac18: '⅛', frac38: '⅜', frac58: '⅝', frac78: '⅞',
    deg: '°', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
    ldquo: '“', rdquo: '”', hellip: '…', times: '×', eacute: 'é',
};

function decodeEntities(value) {
    return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, entity) => {
        if (entity[0] !== '#') return ENTITIES[entity.toLowerCase()] ?? match;
        const hex = entity[1].toLowerCase() === 'x';
        const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
            ? String.fromCodePoint(code) : '';
    });
}

function plainText(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    let text = String(value);
    // Decode encoded markup too, then remove it. Source HTML can never become
    // live HTML when this markdown is rendered by the dashboard.
    for (let i = 0; i < 3; i++) {
        text = decodeEntities(text)
            .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
            .replace(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>/gi, ' ');
    }
    return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function safeImageUrl(value) {
    if (typeof value !== 'string') return '';
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password
            ? url.href : '';
    } catch { return ''; }
}

function validateSourceRecipe(recipe) {
    if (!recipe || typeof recipe !== 'object') throw new Error('Source recipe data is missing');
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients.map(plainText).filter(Boolean) : [];
    const instructions = Array.isArray(recipe.instructions) ? recipe.instructions.map(plainText).filter(Boolean) : [];
    if (!ingredients.length || !instructions.length) {
        throw new Error('The source recipe must include ingredients and preparation steps');
    }
    return {
        name: plainText(recipe.name),
        ingredients,
        instructions,
        servings: plainText(recipe.servings),
        totalTime: plainText(recipe.totalTime),
        imageUrl: safeImageUrl(recipe.imageUrl),
    };
}

function markdownText(value) {
    // Backslash escapes protect Markdown constructs, including unexpected links,
    // while plainText strips raw and encoded HTML and prevents injected lines.
    return plainText(value).replace(/([\\`*_[\]<>!])/g, '\\$1');
}

function frontmatterText(value) {
    // This app uses flat, unquoted frontmatter. No source field may add a line.
    return plainText(value);
}

function displayDuration(value) {
    const iso = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
    if (!iso) return value;
    return [iso[1] && `${iso[1]} d`, iso[2] && `${iso[2]} h`, iso[3] && `${iso[3]} min`, iso[4] && `${iso[4]} s`].filter(Boolean).join(' ') || value;
}

function buildImportedMarkdown(suggestion, sourceRecipe) {
    const url = sourceUrl(suggestion?.sourceUrl).href;
    const recipe = validateSourceRecipe(sourceRecipe);
    const title = markdownText(suggestion.title || recipe.name);
    if (!title) throw new Error('The imported recipe needs a title');
    const sourceName = markdownText(suggestion.source || new URL(url).hostname);
    const safeLink = url.replace(/[\[\]()<>"'\\]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    const metadata = [
        'category: mains',
        `source: ${frontmatterText(url)}`,
        `suggestion_id: ${frontmatterText(suggestion.id)}`,
        `alt: ${frontmatterText(suggestion.originalTitle || recipe.name)}`,
        `imported_at: ${new Date().toISOString()}`,
    ];
    const imageUrl = safeImageUrl(recipe.imageUrl || suggestion.imageUrl);
    if (imageUrl) metadata.push(`source_image: ${frontmatterText(imageUrl)}`);
    const body = [`# ${title}`];
    const description = markdownText(suggestion.description);
    if (description) body.push(description);
    body.push(`Fuente: [${sourceName}](${safeLink}).`);
    if (recipe.servings) body.push(`Raciones: ${markdownText(recipe.servings)}`);
    if (recipe.totalTime) body.push(`Tiempo total: ${markdownText(displayDuration(recipe.totalTime))}`);
    body.push('## Ingredientes', recipe.ingredients.map(value => `- ${markdownText(value)}`).join('\n'));
    body.push('## Elaboración', recipe.instructions.map((value, index) => `${index + 1}. ${markdownText(value)}`).join('\n'));
    return `---\n${metadata.join('\n')}\n---\n\n${body.join('\n\n')}\n`;
}

module.exports = { validateSourceRecipe, buildImportedMarkdown };
