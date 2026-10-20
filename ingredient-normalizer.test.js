const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { normalizeIngredientLine, normalizeRecipeIngredients, canonicalIngredientKey,
    parseIngredientQuantity, persistRecipeIngredients, readRecipeIngredients } = require('./ingredient-normalizer');
const { buildPlanShoppingItems, reconcilePlanShoppingItems, buildOrderProposal } = require('./weekly-plan');

test('normalizes plural, preparation, temperature and known spelling errors', () => {
    for (const [a,b] of [['1 huevo','3 huevos medianos'], ['1 ajo','4 ajos'], ['ajo','4 dientes de ajo machacados'],
        ['leche','400 ml leche tibia'], ['garbanzos de bote','400g garbazo de bote'],
        ['1 cebolla','1 cebolla grande, en juliana'], ['zanahoria','500 g zanahorias, peladas y troceadas']]) {
        assert.equal(canonicalIngredientKey(a), canonicalIngredientKey(b), `${a} / ${b}`);
    }
    const [milk] = normalizeIngredientLine('400–600 ml leche tibia');
    assert.deepEqual(milk.quantity, {min:400,max:600,unit:'ml'});
    assert.ok(milk.preparation.includes('tibia'));
    assert.equal(milk.originalText, '400–600 ml leche tibia');
});

test('preserves product form, variety and dietary qualifiers', () => {
    for (const [a,b] of [['tomate','1 lata de 400 g de tomates'], ['garbanzos','garbanzos de bote'],
        ['leche','leche (sin lactosa)'], ['leche entera','leche desnatada'], ['perejil','perejil fresco'],
        ['tomate','tomate cherry'], ['pollo','pechuga de pollo']]) assert.notEqual(canonicalIngredientKey(a),canonicalIngredientKey(b));
    assert.equal(canonicalIngredientKey('400g garbazo de bote'),'garbanzo (conserva)');
});

test('splits only unambiguous lists, preserving original provenance and missing quantities', () => {
    const rows=normalizeIngredientLine('Sal, pimienta, nuez moscada');
    assert.deepEqual(rows.map(row=>row.key),['sal','pimienta','nuez moscada']);
    assert.ok(rows.every(row=>row.originalText==='Sal, pimienta, nuez moscada' && row.quantity===null));
    const [alternative]=normalizeIngredientLine('200 g bacon, brócoli, espinaca… (al gusto)');
    assert.equal(alternative.needsReview,true);
    assert.match(alternative.warnings[0],/alternativa/);
});

test('ambiguous quantities and optional lines remain reviewable', () => {
    assert.equal(parseIngredientQuantity('2 latas anchoas (2 x 29 g)'),null);
    const items=buildPlanShoppingItems([{id:'one',ingredients:['(opcional: 1 vaso caldo pollo)','2 latas anchoas (2 x 29 g)']}]);
    assert.equal(items.length,2);
    const proposal=buildOrderProposal({shoppingItems:items});
    assert.equal(proposal.orderItems.length,0);
    assert.equal(proposal.orderReviewItems.length,2);
});

test('legacy checked and excluded ingredients do not reappear under their new keys', () => {
    const items=buildPlanShoppingItems([{id:'one',ingredients:['1 lata de 400 g tomates']}],['tomate']);
    assert.equal(items[0].excluded,true);
    const reconciled=reconcilePlanShoppingItems([{key:'tomate',source:'weekly-plan',checked:true,id:'old'}],items);
    assert.equal(reconciled[0].checked,true);
    assert.equal(reconciled[0].id,'old');
    const proposal=buildOrderProposal({shoppingItems:buildPlanShoppingItems([{id:'one',ingredients:['1 lata de 400 g tomates']}]),shoppingList:[{text:'Tomates',checked:true}]});
    assert.equal(proposal.orderItems.length,0);
});

test('structured input and original recipe input give identical grouping', () => {
    const markdown='# Cena\n## Ingredientes\n- 4 ajos\n- Sal, pimienta, nuez moscada\n## Elaboración\n1. Mezclar.';
    const structured=normalizeRecipeIngredients(markdown);
    const stringMeal={id:'one',ingredients:['4 ajos','Sal, pimienta, nuez moscada']};
    assert.deepEqual(buildPlanShoppingItems([stringMeal]),buildPlanShoppingItems([{...stringMeal,normalizedIngredients:structured}]));
});

test('scanner preserves transcribed ingredients without creating normalized records', async t => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-scan-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const markdown='# Receta prueba\n## Ingredientes\n- 4 ajos\n- 400–600 ml leche tibia\n- Sal, pimienta, nuez moscada\n## Elaboración\n1. Mezclar.';
    const source=fs.readFileSync(path.join(__dirname,'server.js'),'utf8');
    const functionSource=name=>{ const start=source.indexOf(`function ${name}(`);const end=source.indexOf('\n}\n',start)+2;return source.slice(start,end); };
    const context={fs,path,Buffer,persistRecipeIngredients,RECIPES_DIR:path.join(directory,'recipes'),NORMALIZED_RECIPES_DIR:path.join(directory,'data'),anthropic:{messages:{create:async request=>{
        assert.match(request.messages[0].content[1].text,/one ingredient per bullet/);
        return {content:[{text:markdown}]};
    }}}};
    vm.createContext(context);
    vm.runInContext('async '+functionSource('scanRecipeFromImage')+'\n'+functionSource('saveScannedRecipe'),context);
    const result=await vm.runInContext("scanRecipeFromImage('ZmFrZQ==','image/png').then(markdown=>saveScannedRecipe(markdown,'ZmFrZQ==','image/png'))",context);
    assert.equal(result.ingredients, undefined);
    assert.equal(result.normalizationWarnings, undefined);
    assert.equal(fs.existsSync(path.join(directory,'data')), false);
    assert.equal(fs.readFileSync(result.mdPath,'utf8'),markdown);
    assert.equal(fs.readFileSync(result.imagePath).toString(), 'fake');
});

test('one-off records are reused without writes and ignored when recipe text changes', t => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kitchen-oneoff-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const markdown='# Cena\n## Ingredientes\n- 2 huevos';
    const records=path.join(directory, 'records');
    assert.equal(readRecipeIngredients(markdown, 'cena', records), undefined);
    assert.equal(fs.existsSync(records), false);
    const record=persistRecipeIngredients(markdown, 'cena', records);
    const file=path.join(records, 'cena.json');
    const before=fs.readFileSync(file);
    const modified=fs.statSync(file).mtimeMs;
    assert.deepEqual(readRecipeIngredients(markdown, 'cena', records), record.ingredients);
    assert.equal(readRecipeIngredients(markdown+'\n- 1 tomate', 'cena', records), undefined);
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.statSync(file).mtimeMs, modified);
});
