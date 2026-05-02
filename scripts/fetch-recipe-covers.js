#!/usr/bin/env node
/**
 * Fetch cover images for recipes from Wikimedia Commons.
 * Saves as recipes/<slug>.jpg when no cover exists (same base name as .md).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const RECIPES_DIR = path.join(__dirname, '..', 'recipes');
const RECIPE_IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

// Search terms for each recipe slug (Spanish/English dish names)
const SEARCH_TERMS = {
  'alioli': 'aioli sauce',
  'bechamel-mar': 'bechamel sauce',
  'berza': 'berza col stew spanish',
  'crema-de-verduras': 'cream vegetable soup',
  'fabada': 'fabada asturiana',
  'falafel': 'falafel',
  'falafel-wraps': 'falafel wrap',
  'guacamole': 'guacamole',
  'lentejas': 'lentejas stew spanish',
  'marinada-bbq': 'bbq marinade',
  'masa-pizza-telepizza': 'pizza dough',
  'migas': 'migas españolas',
  'paella': 'paella',
  'pesto': 'pesto sauce',
  'pipirrana': 'pipirrana salad spanish',
  'pisto': 'pisto manchego',
  'porra': 'porra antequerana',
  'puchero': 'puchero stew',
  'salsa-bolonesa': 'bolognese sauce',
  'salsa-kebab': 'kebab sauce',
  'salsa-mostaza-miel': 'mustard honey sauce',
  'salsa-pico-de-gallo': 'pico de gallo',
  'salsa-putanesca': 'puttanesca sauce',
  'salsa-queso-azul': 'blue cheese sauce',
  'salsa-yogur': 'yogurt sauce',
  'tortitas': 'pancakes tortitas',
  'west-end-cobb-special': 'cobb salad',
};

function hasCoverImage(slug) {
  for (const ext of RECIPE_IMAGE_EXTS) {
    if (fs.existsSync(path.join(RECIPES_DIR, slug + ext))) return true;
  }
  return false;
}

function getSlugFromMd(filename) {
  return filename.replace(/\.md$/, '');
}

function searchTerm(slug) {
  return SEARCH_TERMS[slug] || slug.replace(/-/g, ' ');
}

const USER_AGENT = 'KitchenDashboard/1.0 (recipe cover fetcher; https://github.com/kitchen-dashboard)';

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = { hostname: u.hostname, path: u.pathname + u.search, method: 'GET', headers: { 'User-Agent': USER_AGENT } };
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function httpsGetJson(url) {
  return httpsGet(url).then((buf) => JSON.parse(buf.toString()));
}

async function findImageOnCommons(searchTerm) {
  const searchUrl = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: searchTerm,
    srnamespace: 6,
    srlimit: 5,
    format: 'json',
    origin: '*',
  });
  const data = await httpsGetJson(searchUrl);
  const results = data.query?.search || [];
  for (const r of results) {
    const title = r.title; // e.g. "File:Guacamole 2016.jpg"
    if (!title || !/^File:/i.test(title)) continue;
    const imageUrl = await getImageUrlFromFileTitle(title);
    if (imageUrl) return imageUrl;
  }
  return null;
}

async function getImageUrlFromFileTitle(fileTitle) {
  const apiUrl = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({
    action: 'query',
    titles: fileTitle,
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: 800,
    format: 'json',
    origin: '*',
  });
  const data = await httpsGetJson(apiUrl);
  const pages = data.query?.pages || {};
  const page = Object.values(pages)[0];
  const info = page?.imageinfo?.[0];
  return info?.thumburl || info?.url || null;
}

async function downloadImage(url, destPath) {
  const buf = await httpsGet(url);
  fs.writeFileSync(destPath, buf);
}

async function main() {
  if (!fs.existsSync(RECIPES_DIR)) {
    console.error('Recipes dir not found:', RECIPES_DIR);
    process.exit(1);
  }

  const mdFiles = fs.readdirSync(RECIPES_DIR).filter((f) => f.endsWith('.md'));
  const missing = mdFiles.map((f) => getSlugFromMd(f)).filter((slug) => !hasCoverImage(slug));

  console.log(`Recipes with existing cover: ${mdFiles.length - missing.length}`);
  console.log(`Recipes missing cover: ${missing.length}`);

  for (const slug of missing) {
    const term = searchTerm(slug);
    process.stdout.write(`${slug} (${term})... `);
    try {
      const imageUrl = await findImageOnCommons(term);
      if (!imageUrl) {
        console.log('no image found');
        continue;
      }
      const ext = (imageUrl.match(/\.(jpe?g|png|webp)/i)?.[0] || '.jpg').toLowerCase();
      const destPath = path.join(RECIPES_DIR, slug + ext);
      await downloadImage(imageUrl, destPath);
      console.log('saved');
    } catch (e) {
      console.log('error:', e.message);
    }
  }

  console.log('Done.');
}

main();
