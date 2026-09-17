const SHOPPING_SECTIONS = [
    ['produce', 'Fruta y verdura'],
    ['bakery', 'Panadería y bollería'],
    ['meat', 'Carne'],
    ['fish', 'Pescado y marisco'],
    ['deli', 'Quesos y fiambres'],
    ['dairy', 'Lácteos y huevos'],
    ['pantry', 'Despensa'],
    ['preserves', 'Conservas, encurtidos y salsas'],
    ['snacks', 'Desayuno, dulces y aperitivos'],
    ['drinks', 'Bebidas'],
    ['chilled', 'Refrigerados y platos preparados'],
    ['frozen', 'Congelados'],
    ['cleaning', 'Limpieza y papel'],
    ['personal_care', 'Higiene y cosmética'],
    ['baby_pets', 'Bebé y mascotas'],
    ['pharmacy', 'Farmacia / fuera del supermercado'],
    ['other', 'Otros / por aclarar'],
];

const SECTION_TITLES = new Map(SHOPPING_SECTIONS);
const SECTION_IDS = SHOPPING_SECTIONS.map(([id]) => id);
const PHARMACY_MARKER = /\b(?:pharma|farmacia)\b/i;

function cleanItem(item) {
    return String(item).trim().replace(/[\r\n]+/g, ' ');
}

function addToSection(sections, sectionId, item) {
    if (!sections.has(sectionId)) sections.set(sectionId, []);
    sections.get(sectionId).push(item);
}

async function groupShoppingItems(items, anthropic, logger = console) {
    const cleanItems = items.map(cleanItem);
    const assignments = new Map();
    const forClaude = [];

    cleanItems.forEach((text, index) => {
        // Explicitly marked medicines stay local and are never sent to Claude.
        if (PHARMACY_MARKER.test(text)) assignments.set(index, 'pharmacy');
        else forClaude.push({ index, text });
    });

    if (forClaude.length && anthropic) {
        try {
            const response = await anthropic.messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 1024,
                system: `Clasifica artículos de una lista de compra española en una única sección de supermercado.
Usa "other" ante cualquier duda: no adivines abreviaturas ni corrijas el texto. Da prioridad a "frozen" si el artículo indica que está congelado. Devuelve una asignación para cada índice recibido.`,
                messages: [{ role: 'user', content: JSON.stringify(forClaude) }],
                output_config: {
                    format: {
                        type: 'json_schema',
                        schema: {
                            type: 'object',
                            properties: {
                                assignments: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            index: { type: 'integer' },
                                            section: { type: 'string', enum: SECTION_IDS },
                                        },
                                        required: ['index', 'section'],
                                        additionalProperties: false,
                                    },
                                },
                            },
                            required: ['assignments'],
                            additionalProperties: false,
                        },
                    },
                },
            });
            const textBlock = response.content.find(block => block.type === 'text');
            const parsed = JSON.parse(textBlock?.text || '{}');
            const allowedIndexes = new Set(forClaude.map(item => item.index));

            for (const assignment of parsed.assignments || []) {
                if (allowedIndexes.has(assignment.index) && SECTION_TITLES.has(assignment.section) &&
                    !assignments.has(assignment.index)) {
                    assignments.set(assignment.index, assignment.section);
                }
            }
        } catch (error) {
            logger.warn('Could not categorize shopping list with Claude; using Other:', error.message);
        }
    }

    // Iterate over the source list, not the model response: every item appears exactly once.
    const sections = new Map();
    cleanItems.forEach((item, index) => addToSection(sections, assignments.get(index) || 'other', item));

    return SHOPPING_SECTIONS
        .filter(([id]) => sections.has(id))
        .map(([id, title]) => ({ id, title, items: sections.get(id) }));
}

function formatGroupedShoppingList(groups, { checkbox = false, title = true } = {}) {
    const lines = title ? ['Lista de la compra', ''] : [];
    groups.forEach((group, index) => {
        lines.push(group.title);
        lines.push(...group.items.map(item => `${checkbox ? '[ ]' : '-'} ${item}`));
        if (index < groups.length - 1) lines.push('');
    });
    return lines.join('\n');
}

module.exports = { SHOPPING_SECTIONS, groupShoppingItems, formatGroupedShoppingList };
