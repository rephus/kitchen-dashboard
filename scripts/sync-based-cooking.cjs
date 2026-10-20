#!/usr/bin/env node
'use strict';

// Offline, reproducible export of public-domain Markdown. No recipe API,
// third-party parser, or image download is needed by the application.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const REPOSITORY_URL = 'https://github.com/LukeSmithxyz/based.cooking';
const DEFAULT_REF = 'a3eca801de59267d54e982a7f7a0e8e043a5532e';
const PROJECT_ROOT = path.resolve(__dirname, '..');

function scalar(value) {
    const text = value.trim();
    if (text.startsWith('"') && text.endsWith('"')) {
        try { return JSON.parse(text); } catch { return text.slice(1, -1); }
    }
    return text.startsWith("'") && text.endsWith("'")
        ? text.slice(1, -1).replace(/''/g, "'") : text;
}

function frontmatter(markdown) {
    const match = markdown.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) throw new Error('Missing Markdown frontmatter');
    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
        if (!line.trim()) continue;
        const pair = line.match(/^([a-zA-Z][\w-]*):\s*(.*?)\s*$/);
        if (!pair) throw new Error(`Unsupported frontmatter line: ${line}`);
        if (pair[1] === 'tags') {
            if (!/^\[.*\]$/.test(pair[2])) throw new Error('Expected an inline tags array');
            fields.tags = (pair[2].slice(1, -1).match(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,]+/g) || [])
                .map(scalar).filter(Boolean);
        } else fields[pair[1]] = scalar(pair[2]);
    }
    return { fields, body: markdown.slice(match[0].length) };
}

function readable(markdown) {
    return markdown
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/!\[[^\]]*\]\([^\n]*?\)/g, '')
        .replace(/\[([^\]]+)\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '$1')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .replace(/\\([\\`*_[\]{}()#+.!>~-])/g, '$1')
        .replace(/\*\*|__|(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)|`/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ').trim();
}

function blocks(lines) {
    const result = [];
    let current;
    const flush = () => {
        if (current) {
            const text = readable(current.lines.join(' '));
            if (text) result.push({ ...current, text, lines: undefined });
            current = undefined;
        }
    };
    for (const line of lines) {
        if (!line.trim()) { flush(); continue; }
        if (/^\s*!\[/.test(line) || /^\s*\[[^\]]+\]:/.test(line)) { flush(); continue; }
        const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
        const list = line.match(/^(\s*)(?:[-+*]|\d+[.)])\s+(.*)$/);
        if (heading) {
            flush(); result.push({ kind: 'heading', text: readable(heading[2]), depth: heading[1].length });
        } else if (list) {
            flush(); current = { kind: 'item', depth: list[1].replace(/\t/g, '    ').length, lines: [list[2]] };
        } else if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
            flush(); result.push({ kind: 'separator', text: '' });
        } else if (current) current.lines.push(line.trim());
        else current = { kind: 'paragraph', lines: [line.trim()] };
    }
    flush();
    return result;
}

function metadataLine(text) {
    const clean = text.replace(/^[^a-zA-Z]+/, '').replace(/"/g, '');
    const servings = clean.match(/^serv(?:ings?|es)\s*:?\s+(.+)$/i);
    if (servings) return { kind: 'servings', value: servings[1].trim() };
    const time = clean.match(/^(prep(?:aration)?|cook|wait|fermentation|freeze|fridge|chill|rest|total)\s+time\s*:\s*(.+)$/i);
    return time ? { kind: 'time', label: time[1].toLowerCase().replace('preparation', 'prep'), value: time[2].trim() } : null;
}

function durationMinutes(value) {
    const text = value.toLowerCase().replace(/,/g, ' ').trim();
    let total = 0;
    let matched = false;
    const rest = text.replace(/(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/g,
        (_, quantity, unit) => {
            matched = true;
            total += Number(quantity) * (/^d/.test(unit) ? 1440 : /^h/.test(unit) ? 60 : /^s/.test(unit) ? 1 / 60 : 1);
            return '';
        }).replace(/\band\b/g, '').trim();
    return matched && !rest && Number.isInteger(total) ? total : null;
}

function classify(title, originalTags) {
    const tags = new Set(originalTags.map(tag => tag.toLowerCase()));
    const name = title.toLowerCase();
    const has = (...values) => values.some(value => tags.has(value));
    const result = (category, reason) => ({ category, mainCourseCandidate: category === 'mains', reason, method: 'heuristic' });
    if (has('drink', 'smoothie', 'liquor', 'digestivo') || /\b(?:lemonade|kvass|cocktail|tea|mulled wine|hot chocolate|smoothie)\b/.test(name)) return result('drinks', 'Drink tag or title');
    if (has('dessert', 'sweet', 'sweets', 'cake', 'cookies', 'pudding', 'icecream', 'muffins', 'biscuit', 'jam', 'syrup', 'meringue')
        || /\b(?:cookies?|brownies?|muffins?|cheesecake|ice cream|sorbet|jam|syrup|biscuits?|torrijas)\b/.test(name)
        || (/\bcake\b/.test(name) && !has('fish', 'seafood', 'meat', 'chicken'))) return result('desserts', 'Dessert tag or title');
    if (has('sauce', 'spread', 'dressing', 'stock', 'dough', 'batter', 'pate')
        || /^(?:salsa|guacamole|hummus|hummous|greek yogurt|cheese|lard|ghee|roux|mayonnaise|bone broth|peanut butter|simple syrup)$/.test(name)
        || /\b(?:pizza sauce|pastry dough|spice mix|seasoning mix|lasagna filling)\b/.test(name) || /^(?:rag[uù]|fajita seasoning|garam masala|zaatar|cream cheese|ricotta)$/.test(name)) return result('sauces-basics', 'Sauce, spread or basic component');
    if (has('side', 'salad', 'bread', 'sourdough', 'breakfast', 'snack', 'pancake', 'brunch')
        || /\b(?:salads?|pancakes?|waffles?|french toast|flatbread|focaccia|naan|mashed potatoes|potato purée|coleslaw|refried beans|cooked chickpeas)\b/.test(name)) return result('sides', 'Side, bread, breakfast or snack');
    if (has('soup') || /\b(?:soup|chowder)\b/.test(name)) return result('starters', 'Soup tag or title');
    if (has('beef', 'chicken', 'pork', 'fish', 'seafood', 'lamb', 'meat', 'pasta', 'rice', 'stew', 'curry', 'pizza', 'supper', 'lunch', 'tofu', 'lentil', 'beans', 'shrimp', 'turkey', 'venison', 'rabbit', 'duck', 'sausage', 'noodles', 'salmon', 'tuna', 'sandwich')
        || /\b(?:lasagna|lasagne|spaghetti|risotto|curry|biryani|paella|burger|meatballs?|stew|roast|quiche|stuffed|sandwich|taco|burrito|enchilada|noodles|pizza|chili|couscous|tajine|tortilla|quesadilla)\b/.test(name)) return result('mains', 'Main dish ingredient tag or title');
    return result('uncategorized', 'No confident course match');
}

function imageUrl(body) {
    for (const match of body.matchAll(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
        try {
            const url = new URL(match[1], 'https://based.cooking/');
            if (url.protocol === 'https:' && url.hostname === 'based.cooking' && url.pathname.startsWith('/pix/')
                && !url.username && !url.password && !url.port) return url.href;
        } catch { /* Images are optional; malformed links never enter the catalog. */ }
    }
    return '';
}

function parseRecipe(markdown, slug, authors = {}, snapshot = {}) {
    const { fields, body } = frontmatter(markdown);
    if (!fields.title) throw new Error(`${slug}: Missing title`);
    const sections = [];
    let section = { heading: '', kind: 'intro', lines: [] };
    const finish = () => {
        sections.push({ heading: section.heading, kind: section.kind,
            text: section.lines.join('\n').trim(), blocks: blocks(section.lines) });
    };
    for (const line of body.split(/\r?\n/)) {
        const heading = line.match(/^##\s+(.+?)\s*#*$/);
        if (!heading) { section.lines.push(line); continue; }
        finish();
        const label = readable(heading[1]);
        let kind = 'context';
        if (/^ingredients$/i.test(label) || (/^spice blend$/i.test(label) && section.kind === 'ingredients')) kind = 'ingredients';
        else if (/directions|^frying$|^seasoning suggestion$|^consumption recommendation$/i.test(label)) kind = 'instructions';
        else if (/^description$/i.test(label)) kind = 'intro';
        section = { heading: label, kind, lines: [] };
    }
    finish();
    const ingredients = [];
    const ingredientRows = [];
    const instructions = [];
    const context = [];
    const timing = [];
    let servings;
    let footer = false;
    for (const current of sections) {
        const target = current.kind === 'ingredients' ? ingredients : current.kind === 'instructions' ? instructions : null;
        if (target && !/^(?:ingredients|directions)$/i.test(current.heading)) {
            const text = `${current.heading.replace(/:+\s*$/, '')}:`;
            target.push(text);
            if (current.kind === 'ingredients') ingredientRows.push({ kind: 'heading', text });
        }
        if (current.kind === 'context' && current.text) context.push({ heading: current.heading, text: readable(current.text) });
        for (let index = 0; index < current.blocks.length; index++) {
            const block = current.blocks[index];
            if (block.kind === 'separator') { footer = true; continue; }
            const meta = current.kind === 'intro' ? metadataLine(block.text) : null;
            if (current.kind === 'intro' && meta?.kind === 'servings') servings = meta.value;
            else if (current.kind === 'intro' && meta?.kind === 'time') timing.push({ label: meta.label, value: meta.value });
            if (!target || footer || meta || /^(?:see also|author|contributed by|recipe by|credits?(?: to)?|source)\s*:/i.test(block.text)) continue;
            const next = current.blocks[index + 1];
            // Upstream unbulleted ingredient paragraphs are context or group labels,
            // never shopping items. Preserve their text without guessing quantities.
            const subheading = block.kind === 'heading'
                || (block.kind === 'item' && (/:$/.test(block.text) || (next?.kind === 'item' && next.depth > block.depth)))
                || (block.kind === 'paragraph' && (/:$/.test(block.text)
                    || (next?.kind === 'item' && block.text.split(/\s+/).length <= 6 && !/[.!?\d]/.test(block.text))));
            const text = block.kind === 'heading' || /:+\s*$/.test(block.text)
                ? `${block.text.replace(/:+\s*$/, '')}:` : block.text;
            target.push(text);
            if (current.kind === 'ingredients') ingredientRows.push({
                kind: subheading ? 'heading' : block.kind === 'item' ? 'ingredient' : 'note', text,
            });
        }
    }
    if (!ingredients.length || !instructions.length) throw new Error(`${slug}: Empty recipe ingredients or instructions`);
    const intro = sections.filter(item => item.kind === 'intro').flatMap(item => item.blocks)
        .filter(block => block.kind === 'paragraph' && !metadataLine(block.text) && !/^credits?\b/i.test(block.text))
        .map(block => block.text).join(' ');
    const description = intro.length <= 320 ? intro : `${intro.slice(0, 317).replace(/\s+\S*$/, '')}…`;
    const authorId = fields.author || '';
    const authorRecord = authors[authorId];
    const author = authorId ? { id: authorId, name: authorRecord?.name || authorId, ...authorRecord } : null;
    const credits = `${author ? `Recipe credit: ${author.name}. ` : ''}Based Cooking. Public domain (Unlicense).${snapshot.commit ? ` Snapshot: ${snapshot.commit}.` : ''}`;
    const image = imageUrl(body);
    const classification = classify(fields.title, fields.tags || []);
    const recipe = { name: fields.title, ingredients, ingredientRows, instructions, credits };
    if (servings) recipe.servings = servings;
    if (timing.length) recipe.totalTime = timing.map(item => `${item.label[0].toUpperCase()}${item.label.slice(1)}: ${item.value}`).join('; ');
    if (image) recipe.imageUrl = image;
    const totalTiming = timing.find(item => item.label === 'total');
    const durations = (totalTiming ? [totalTiming] : timing).map(item => durationMinutes(item.value));
    const canTotal = totalTiming || (timing.some(item => item.label === 'prep') && timing.some(item => item.label === 'cook'));
    const totalMinutes = canTotal && durations.length && durations.every(value => value !== null)
        ? durations.reduce((sum, value) => sum + value, 0) : null;
    return {
        id: `based-${slug.replace(/[^a-z0-9-]/g, '-')}`, title: fields.title, originalTitle: fields.title,
        description, category: classification.category, source: 'Based Cooking', sourceName: 'Based Cooking',
        sourceUrl: `https://based.cooking/${encodeURIComponent(slug)}/`, imageUrl: image,
        tags: fields.tags || [], author, credits, classification, timing, totalMinutes,
        ...(servings ? { servings } : {}), recipe, context,
        sections: sections.map(({ blocks: ignored, ...item }) => item),
        sourcePath: `content/${slug}.md`, sourceSha256: crypto.createHash('sha256').update(markdown).digest('hex'), sourceMarkdown: markdown,
    };
}

function git(root, ...args) {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function buildCatalog(sourceRoot) {
    const commit = git(sourceRoot, 'rev-parse', 'HEAD');
    const snapshot = { repositoryUrl: REPOSITORY_URL, commit,
        committedAt: git(sourceRoot, 'show', '-s', '--format=%cI', 'HEAD'), license: 'Unlicense',
        licenseUrl: `${REPOSITORY_URL}/blob/${commit}/LICENSE.md` };
    const authors = {};
    for (const file of fs.readdirSync(path.join(sourceRoot, 'data/authors')).sort()) {
        if (file.endsWith('.json')) authors[file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'data/authors', file), 'utf8'));
    }
    const files = fs.readdirSync(path.join(sourceRoot, 'content')).filter(file => file.endsWith('.md') && !file.startsWith('_')).sort();
    const recipes = files.map(file => parseRecipe(fs.readFileSync(path.join(sourceRoot, 'content', file), 'utf8'), file.slice(0, -3), authors, snapshot));
    const ids = new Set(recipes.map(item => item.id));
    if (ids.size !== recipes.length) throw new Error('Duplicate recipe IDs');
    const categories = {};
    for (const recipe of recipes) categories[recipe.category] = (categories[recipe.category] || 0) + 1;
    return { catalog: { version: 1, source: 'Based Cooking', snapshot,
        classification: { method: 'heuristic', official: false,
            description: 'Course labels are local tag/title heuristics. Main-course candidates exclude identified desserts, drinks, sides, breads, sauces, breakfast, snacks and soups; uncertain recipes remain uncategorized.' },
        counts: { recipes: recipes.length, authors: Object.keys(authors).length, categories }, recipes }, authors };
}

function writeCatalog(sourceRoot, outputRoot) {
    const { catalog, authors } = buildCatalog(sourceRoot);
    const attributionRoot = path.join(outputRoot, 'third-party/based-cooking');
    fs.mkdirSync(attributionRoot, { recursive: true });
    fs.writeFileSync(path.join(outputRoot, 'based-cooking-catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
    fs.copyFileSync(path.join(sourceRoot, 'LICENSE.md'), path.join(attributionRoot, 'LICENSE.md'));
    fs.writeFileSync(path.join(attributionRoot, 'authors.json'), `${JSON.stringify(authors, null, 2)}\n`);
    fs.writeFileSync(path.join(attributionRoot, 'snapshot.json'), `${JSON.stringify(catalog.snapshot, null, 2)}\n`);
    fs.writeFileSync(path.join(attributionRoot, 'README.md'), `# Based Cooking snapshot\n\nSource: ${REPOSITORY_URL}\n\nPinned commit: ${catalog.snapshot.commit}\n\nUpstream commit date: ${catalog.snapshot.committedAt}\n\n${catalog.recipes.length} recipes from content/*.md, excluding the website index. All recipe text and author records are retained; image files are not copied. Original Markdown, source paths and hashes remain in the catalog. Recipe author names and source links remain attached to imported recipes. The original author registry is in authors.json, including the public credit links authors supplied.\n\nLICENSE.md is copied verbatim. Upstream declares the website and all content public domain under the Unlicense: https://github.com/LukeSmithxyz/based.cooking#license\n\nCourse classifications are local heuristics, not official source labels. The complete catalog includes every course. Optional image links point to based.cooking/pix; the recipe text is fully local. Source time labels and serving ranges are retained without guessing missing values. Numeric totalMinutes is supplied only for a declared total or when both prep and cook times are present and every declared timing component parses exactly. Summed component times are derived locally; the original labels always remain available.\n\nRebuild the pinned snapshot, with no recipe API:\n\n    node scripts/sync-based-cooking.cjs\n\nRebuild from an existing checkout:\n\n    node scripts/sync-based-cooking.cjs --source /path/to/based.cooking\n\nRefresh deliberately to an upstream ref:\n\n    node scripts/sync-based-cooking.cjs --ref master\n\nThe default ref is pinned in the script. Output ordering and provenance are deterministic for the same upstream commit.\n`);
    return catalog;
}

function main(argv) {
    const options = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('-') && !options.source) { options.source = argv[i]; continue; }
        if (!['--source', '--ref', '--output'].includes(argv[i]) || !argv[i + 1]) throw new Error('Usage: sync-based-cooking.cjs [--source checkout] [--ref git-ref] [--output directory]');
        options[argv[i].slice(2)] = argv[++i];
    }
    let temporary;
    try {
        let sourceRoot = options.source && path.resolve(options.source);
        if (!sourceRoot) {
            temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-based-cooking-'));
            execFileSync('git', ['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', `${REPOSITORY_URL}.git`, temporary], { stdio: 'inherit' });
            execFileSync('git', ['-C', temporary, 'sparse-checkout', 'set', 'content', 'data/authors'], { stdio: 'inherit' });
            const ref = options.ref || DEFAULT_REF;
            execFileSync('git', ['-C', temporary, 'fetch', '--quiet', '--depth', '1', 'origin', ref], { stdio: 'inherit' });
            execFileSync('git', ['-C', temporary, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { stdio: 'inherit' });
            sourceRoot = temporary;
        } else if (options.ref && git(sourceRoot, 'rev-parse', options.ref) !== git(sourceRoot, 'rev-parse', 'HEAD')) {
            throw new Error('--source must already be checked out at --ref; existing checkouts are never changed');
        }
        const catalog = writeCatalog(sourceRoot, path.resolve(options.output || PROJECT_ROOT));
        process.stdout.write(`Saved ${catalog.counts.recipes} recipes from ${catalog.snapshot.commit}\n${JSON.stringify(catalog.counts.categories)}\n`);
    } finally {
        if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    }
}

if (require.main === module) {
    try { main(process.argv.slice(2)); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { DEFAULT_REF, frontmatter, readable, blocks, metadataLine, durationMinutes, classify, imageUrl, parseRecipe, buildCatalog, writeCatalog };
