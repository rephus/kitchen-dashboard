const RULES_START = '<!-- shopping-rules:start -->';
const RULES_END = '<!-- shopping-rules:end -->';

function defaultShoppingRules() {
    return [
        { id: 'rule-tuna', product: 'Atún en lata', rule: 'Siempre en aceite de oliva. No sustituir por atún al natural ni en aceite de girasol.', active: true },
        { id: 'rule-milk', product: 'Leche', rule: 'Leche normal de vaca. Falta concretar si entera, semidesnatada o desnatada.', active: true },
        { id: 'rule-eggs', product: 'Huevos', rule: '6 huevos camperos por compra. No sustituir por huevos de gallinas criadas en suelo.', active: true },
        { id: 'rule-water', product: 'Agua', rule: 'Incluir 2 garrafas de 8 litros cuando preparemos una compra. Comprobar lo que ya hay en la cesta para no duplicarlas.', active: true },
        { id: 'rule-oil-biscuits', product: 'Galletas de aceite', rule: 'Es un tipo específico de galleta, no dos productos separados. Falta identificar el producto o la marca exactos.', active: true },
        { id: 'rule-dishwasher', product: 'Pastillas de lavavajillas', rule: 'Las que utiliza Javier se compran en Carrefour. Dejarlas pendientes para esa tienda; no elegir una alternativa de DIA.', active: true },
    ];
}

function normalizeShoppingRules(items, createId = () => `rule-${Date.now()}`) {
    if (!Array.isArray(items) || items.length > 100) {
        throw Object.assign(new Error('Shopping rules must contain at most 100 entries'), { statusCode: 400 });
    }
    const usedIds = new Set();
    return items.map(item => {
        const product = String(item?.product || '').trim().replace(/\s+/g, ' ');
        const rule = String(item?.rule || '').trim().replace(/\s+/g, ' ');
        if (!product || product.length > 120 || !rule || rule.length > 600) {
            throw Object.assign(new Error('Each shopping rule needs a product and an instruction'), { statusCode: 400 });
        }
        let id = String(item?.id || createId()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        if (!id || usedIds.has(id)) id = String(createId()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
        usedIds.add(id);
        return { id, product, rule, active: item.active !== false };
    });
}

function escapeMarkdownCell(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

function renderShoppingRulesSection(rules) {
    const rows = rules.map(item => `| ${escapeMarkdownCell(item.product)} | ${escapeMarkdownCell(item.rule)} | ${item.active ? 'Sí' : 'No'} |`);
    return [
        RULES_START,
        '| Producto | Preferencia confirmada | Usar |',
        '|---|---|---|',
        ...rows,
        RULES_END,
    ].join('\n');
}

function replaceShoppingRulesSection(markdown, rules) {
    const section = renderShoppingRulesSection(rules);
    const marked = new RegExp(`${RULES_START}[\\s\\S]*?${RULES_END}`);
    if (marked.test(markdown)) return markdown.replace(marked, section);

    const productsHeading = markdown.match(/^## Productos\s*$/m);
    if (!productsHeading || productsHeading.index === undefined) {
        return `${markdown.trimEnd()}\n\n## Productos\n\n${section}\n`;
    }
    const contentStart = productsHeading.index + productsHeading[0].length;
    const following = markdown.slice(contentStart);
    const nextHeading = following.match(/^##\s+/m);
    const contentEnd = nextHeading?.index === undefined ? markdown.length : contentStart + nextHeading.index;
    return `${markdown.slice(0, contentStart)}\n\n${section}\n\n${markdown.slice(contentEnd).replace(/^\s+/, '')}`;
}

module.exports = {
    RULES_START,
    RULES_END,
    defaultShoppingRules,
    normalizeShoppingRules,
    renderShoppingRulesSection,
    replaceShoppingRulesSection,
};
