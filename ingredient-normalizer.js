const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INGREDIENT_ALIASES = new Map([
    ['pollo', ['pollo', 'pechuga pollo', 'pechuga de pollo', 'chicken', 'chicken breast']],
    ['huevo', ['huevo', 'egg']],
    ['tomate', ['tomate', 'tomate cherry', 'cherry tomato', 'tomato']],
    ['aguacate', ['aguacate', 'avocado']],
    ['lechuga', ['lechuga', 'lettuce']],
    ['patata', ['patata', 'potato']],
    ['cebolla', ['cebolla', 'onion']],
    ['zanahoria', ['zanahoria', 'carrot']],
]);

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

function normalizeIngredient(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
}

function canonicalPantryIngredient(value) {
    let canonical = normalizeIngredient(value)
        .replace(/[–—]/g, '-')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\s*,\s*(?:sin|con|seg[uú]n)\b.*$/, '')
        .replace(/\s+(?:al gusto|para servir|para cocinar)\s*$/, '')
        .trim();
    for (let index = 0; index < 3; index += 1) {
        const before = canonical;
        canonical = canonical
            .replace(/^\s*(?:aprox\.?\s*)?\d+(?:[.,/]\d+)?(?:\s*-\s*\d+(?:[.,/]\d+)?)?\s*/, '')
            .replace(/^(?:(?:kg|g|gr|ml|l|litros?|cdtas?\.?|cdas?\.?|cucharaditas?|cucharadas?|tazas?|cups?|tbsp|tsp|pizcas?|dientes?|cloves?|ramas?|latas?|botes?|envases?|paquetes?|unidades?)\s+(?:de\s+)?)/, '')
            .replace(/^de\s+/, '')
            .trim();
        if (canonical === before) break;
    }
    canonical = canonical
        .replace(/\s+(?:finamente|bien)\s+(?:picad[oa]s?|trocead[oa]s?|cortad[oa]s?|rallad[oa]s?)\s*$/, '')
        .replace(/^(ajo|cebolla|apio)\s+(?:picad[oa]s?|trocead[oa]s?|cortad[oa]s?|rallad[oa]s?)\s*$/, '$1')
        .replace(/\btomatoes\b/g, 'tomato')
        .replace(/\bpotatoes\b/g, 'potato')
        .replace(/\beggs\b/g, 'egg')
        .replace(/\bnueces\b/g, 'nuez')
        .replace(/\b([a-záéíóúñ]{4,})s\b/g, '$1')
        .trim();
    if (canonical === 'aceite') return 'aceite de oliva';
    if (canonical === 'comino molido') return 'comino';
    return canonical;
}

function aliasComparable(value) {
    return normalizeIngredient(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function legacyIngredientKey(value) {
    const canonical = canonicalPantryIngredient(value);
    if (!canonical) return '';
    const comparable = aliasComparable(canonical);
    if (/[,/+]|\.{3}|…/.test(canonical)) return canonical;
    for (const [key, aliases] of INGREDIENT_ALIASES) {
        if (aliases.some(alias => aliasComparable(alias) === comparable)) return key;
    }
    return canonical;
}

function parseNumber(value) {
    const normalized = String(value).replace(',', '.');
    if (/^\d+\/\d+$/.test(normalized)) {
        const [numerator, denominator] = normalized.split('/').map(Number);
        return denominator ? numerator / denominator : null;
    }
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
}

function normalizeQuantityUnit(unit) {
    const value = normalizeIngredient(unit).replace(/\.$/, '');
    if (value === 'kg') return { unit: 'g', multiplier: 1000 };
    if (['g', 'gr'].includes(value)) return { unit: 'g', multiplier: 1 };
    if (['l', 'litro', 'litros'].includes(value)) return { unit: 'ml', multiplier: 1000 };
    if (value === 'ml') return { unit: 'ml', multiplier: 1 };
    if (['cdta', 'cdtas', 'cucharadita', 'cucharaditas', 'tsp'].includes(value)) return { unit: 'cdta', multiplier: 1 };
    if (['cda', 'cdas', 'cucharada', 'cucharadas', 'tbsp'].includes(value)) return { unit: 'cda', multiplier: 1 };
    if (['taza', 'tazas', 'cup', 'cups'].includes(value)) return { unit: 'taza', multiplier: 1 };
    const containers = {
        lata: 'lata', latas: 'lata', bote: 'bote', botes: 'bote', envase: 'envase', envases: 'envase',
        paquete: 'paquete', paquetes: 'paquete', rama: 'rama', ramas: 'rama', diente: 'diente', dientes: 'diente',
        unidad: 'ud', unidades: 'ud', clove: 'diente', cloves: 'diente',
    };
    return { unit: containers[value] || 'ud', multiplier: 1 };
}

function legacyParseIngredientQuantity(value) {
    const text = normalizeIngredient(value).replace(/[–—]/g, '-').replace(/\([^)]*\)/g, ' ');
    const metricMatches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|litros?)\b/g)];
    if (metricMatches.length) {
        const match = metricMatches[metricMatches.length - 1];
        const amount = parseNumber(match[1]);
        const { unit, multiplier } = normalizeQuantityUnit(match[2]);
        return { min: amount * multiplier, max: amount * multiplier, unit };
    }

    const leading = text.match(/^\s*(\d+(?:[.,/]\d+)?)(?:\s*-\s*(\d+(?:[.,/]\d+)?))?\s*(.*)$/);
    if (!leading) return null;
    const min = parseNumber(leading[1]);
    const max = leading[2] ? parseNumber(leading[2]) : min;
    if (min === null || max === null) return null;
    const unitMatch = leading[3].match(/^(cdtas?\.?|cdas?\.?|cucharaditas?|cucharadas?|tazas?|cups?|tbsp|tsp|latas?|botes?|envases?|paquetes?|ramas?|dientes?|cloves?|unidades?)\b/);
    const { unit, multiplier } = normalizeQuantityUnit(unitMatch?.[1] || 'ud');
    return { min: min * multiplier, max: max * multiplier, unit };
}

function extractRecipeIngredients(markdown) {
    const beforeMethod = String(markdown || '').split(/^##\s+(?:elaboraci[oó]n|preparaci[oó]n|pasos|instrucciones|uso)\b/im)[0];
    return beforeMethod
        .split(/\r?\n/)
        .map(line => line.match(/^\s*[-*]\s+(.+?)\s*$/)?.[1])
        .filter(Boolean);
}


const NORMALIZATION_VERSION = 1;

function parseIngredientQuantity(value) {
    const text = normalizeIngredient(value).replace(/[–—]/g, '-');
    // Keep both ends of a metric range; never silently take the upper bound.
    const metric = text.match(/(\d+(?:[.,/]\d+)?)(?:\s*-\s*(\d+(?:[.,/]\d+)?))?\s*(kg|g|gr|ml|l|litros?)\b/);
    if (metric) {
        const min = parseNumber(metric[1]);
        const max = parseNumber(metric[2] || metric[1]);
        const { unit, multiplier } = normalizeQuantityUnit(metric[3]);
        if (min === null || max === null || min > max) return null;
        // Multiple containers with a weight per container need interpretation.
        const containers = text.match(/^\s*(\d+(?:[.,/]\d+)?)\s*(?:latas?|botes?|paquetes?|envases?)\b/);
        if ((containers && parseNumber(containers[1]) > 1) || /\d\s*[x×]\s*\d/.test(text)) return null;
        return { min: min * multiplier, max: max * multiplier, unit };
    }
    return legacyParseIngredientQuantity(text);
}

function normalizeSingleIngredient(originalText, componentText = originalText) {
    const original = String(originalText).trim();
    const text = String(componentText).trim();
    const notes = [...text.matchAll(/\(([^)]+)\)/g)].map(match => match[1]);
    let name = canonicalPantryIngredient(text).replace(/\s+/g, ' ').trim();
    name = name.replace(/,\s*(?:pelad[oa]|trocead[oa]|cortad[oa]|rallad[oa])(?:\s+y\s+(?:pelad[oa]|trocead[oa]|cortad[oa]|rallad[oa]))*$/, '');
    name = name.replace(/\bajos\b/g, 'ajo').replace(/\bgarbazos?\b/g, 'garbanzo');
    // Preparation is kept separately; product-defining forms remain in the name.
    const preparation = [];
    if (/^(?:ajo|cebolla|zanahoria|patata|tomate|calabac[ií]n|puerro|apio|perejil|cilantro|leche)\b/.test(name)) name = name.replace(/(?:,?\s+(?:finamente\s+)?(?:picad[oa]|trocead[oa]|machacad[oa]|cortad[oa](?:\s+en\s+dos)?|en juliana|en cuarto|rallad[oa]|tibi[oa]|caliente|fri[oa]|frí[oa]|a temperatura ambiente))$/g,
        match => { preparation.push(match.trim().replace(/^,\s*/, '')); return ''; });
    // canonicalPantryIngredient already removes some preparation; retain it too.
    for (const match of text.matchAll(/\b(?:finamente\s+)?(?:picad[oa]s?|trocead[oa]s?|machacad[oa]s?|en juliana|en cuartos|tibi[oa]s?|frí[oa]s?|a temperatura ambiente)\b/gi)) {
        if (!preparation.includes(match[0])) preparation.push(match[0]);
    }
    const qualifiers = [];
    name = name.replace(/\s+(?:mediano|mediana|grande|pequeño|pequeña)$/,
        match => { qualifiers.push(match.trim()); return ''; });
    if (!name) name = normalizeIngredient(text);
    const comparable = aliasComparable(name);
    const breast = ['pechuga pollo', 'pechuga de pollo', 'chicken breast'].includes(comparable);
    if (breast) name = 'pechuga de pollo';
    for (const [key, aliases] of INGREDIENT_ALIASES) {
        // Cherry tomatoes retain their product variety instead of becoming generic tomatoes.
        if (breast || /cherry/.test(comparable)) break;
        if (aliases.some(alias => aliasComparable(alias) === comparable)) { name = key; break; }
    }
    if (comparable === 'cherry tomato') name = 'tomate cherry';
    const canned = /\b(?:latas?|botes?|conserva)\b/i.test(text);
    const frozen = /\b(?:congelad[oa]s?|frozen)\b/i.test(text);
    const fresh = /\b(?:fresc[oa]s?|fresh)\b/i.test(text);
    const form = frozen ? 'congelado' : canned ? 'conserva' : fresh ? 'fresco' : null;
    name = name.replace(/\s+(?:de bote|en conserva)\b/g, '').trim();
    const productAttributes = notes.filter(note => /sin lactosa|sin gluten|integral|entera|desnatada|%\s*m\.?g/i.test(note));
    const namedForm = form === 'fresco' ? /\bfresc[oa]\b/.test(name) : name.includes(form);
    const identity = form && !namedForm ? `${name} (${form})` : name;
    const key = productAttributes.length ? `${identity} (${productAttributes.join('; ')})` : identity;
    const quantity = parseIngredientQuantity(text);
    const warnings = [];
    if (/\b(?:opcional|o bien|ilegible)\b|\s+o\s+|[,/+]|…|\.{3}/i.test(name)) warnings.push('Revisar alternativa o ingrediente compuesto');
    if (/\b(?:sustituir|si no hay)\b/i.test(original)) warnings.push('Contiene una sustitución condicional');
    if (notes.some(note => /^\d+\s+(?:grandes|pequeños|medianos)\b/i.test(note))) warnings.push('Revisar cantidad alternativa según tamaño');
    if (!quantity) warnings.push(/\d/.test(text) ? 'La cantidad requiere interpretación' : 'Cantidad no especificada');
    return { key, name, form, productAttributes, quantity, preparation: [...new Set(preparation)], qualifiers, notes,
        originalText: original, componentText: text, needsReview: warnings.length > 0, warnings };
}

function normalizeIngredientLine(value) {
    if (value && typeof value === 'object') {
        // Always derive data from its preserved component, not stale derived fields.
        return [normalizeSingleIngredient(value.originalText, value.componentText || value.originalText)];
    }
    const text = String(value || '').trim();
    if (!text) return [];
    const parts = text.split(/\s*(?:,|\by\b)\s*/i);
    // Only split unambiguous lists of seasonings without a shared quantity.
    const seasoning = /^(?:sal|pimienta(?: negra| blanca)?|nuez moscada|perejil|orégano|oregano|pimentón|pimenton|comino|canela|tomillo|romero|albahaca|aceite|vinagre|miel|azúcar moreno)$/i;
    if (parts.length > 1 && parts.every(part => seasoning.test(part))) {
        return parts.map(part => normalizeSingleIngredient(text, part));
    }
    return [normalizeSingleIngredient(text)];
}

function canonicalIngredientKey(value) {
    return normalizeSingleIngredient(value).key;
}

function normalizeRecipeIngredients(markdown) {
    return extractRecipeIngredients(markdown).flatMap(normalizeIngredientLine);
}

function normalizedRecipeRecord(markdown) {
    return { version: NORMALIZATION_VERSION,
        sourceHash: crypto.createHash('sha256').update(markdown).digest('hex'),
        ingredients: normalizeRecipeIngredients(markdown) };
}

// Reuse only the explicit one-off snapshot; reading never creates or updates it.
function readRecipeIngredients(markdown, slug, directory) {
    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(directory, `${slug}.json`), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    const sourceHash = crypto.createHash('sha256').update(markdown).digest('hex');
    return record.version === NORMALIZATION_VERSION && record.sourceHash === sourceHash
        ? record.ingredients : undefined;
}

function persistRecipeIngredients(markdown, slug, directory) {
    const record = normalizedRecipeRecord(markdown);
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${slug}.json`);
    let previous;
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous?.version !== record.version || previous?.sourceHash !== record.sourceHash) {
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(record, null, 2));
        fs.renameSync(temporary, file);
    }
    return record;
}

module.exports = { normalizeIngredient, canonicalPantryIngredient, aliasComparable, legacyIngredientKey,
    canonicalIngredientKey, parseIngredientQuantity, extractRecipeIngredients, normalizeIngredientLine,
    normalizeRecipeIngredients, normalizedRecipeRecord, persistRecipeIngredients, readRecipeIngredients };
