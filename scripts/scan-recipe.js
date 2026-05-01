#!/usr/bin/env node

/**
 * Recipe Scanner - Extract recipes from book images using Claude Vision API
 *
 * Usage:
 *   node scripts/scan-recipe.js <image-path> [output-name]
 *
 * Example:
 *   node scripts/scan-recipe.js ~/photos/recipe.jpg tortilla-espanola
 *
 * The script will:
 * 1. Read the image from the provided path
 * 2. Use Claude's vision API to extract the recipe
 * 3. Format it in markdown matching the kitchen-dashboard format
 * 4. Save it to recipes/<output-name>.md
 * 5. Copy the image to recipes/<output-name>.<ext>
 */

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// Configuration
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const RECIPES_DIR = path.join(__dirname, '../recipes');

if (!ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY environment variable not set');
    console.error('Please set it with: export ANTHROPIC_API_KEY="your-key-here"');
    process.exit(1);
}

const anthropic = new Anthropic({
    apiKey: ANTHROPIC_API_KEY,
});

/**
 * Extract recipe from image using Claude Vision API
 */
async function extractRecipe(imagePath) {
    console.log(`Reading image: ${imagePath}`);

    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Detect image type
    const ext = path.extname(imagePath).toLowerCase();
    const mediaTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    };
    const mediaType = mediaTypeMap[ext] || 'image/jpeg';

    console.log('Analyzing image with Claude...');

    const message = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: mediaType,
                            data: base64Image,
                        },
                    },
                    {
                        type: 'text',
                        text: `Extract the recipe from this image and format it in Spanish markdown following this EXACT structure:

# [Recipe Name]

## Ingredientes

- [ingredient with quantity]
- [ingredient with quantity]
...

## Elaboración

1. [step]
2. [step]
...

IMPORTANT RULES:
- Use Spanish language for all text
- Keep ingredient quantities concise (e.g., "1 kg tomate", "200 ml aceite")
- Use abbreviations: cda (cucharada/tablespoon), cdta (cucharadita/teaspoon), g (gramos), ml (mililitros), kg (kilogramos)
- Number the steps in "Elaboración" section
- If there are subsections (like "Sofrito", "Caldo", etc.), include them as ## sections
- Extract ALL visible ingredients and steps from the image
- If some text is unclear, use your best judgment but stay faithful to what you can see
- Output ONLY the markdown, no additional commentary

Begin:`
                    }
                ],
            },
        ],
    });

    const recipeMarkdown = message.content[0].text;
    return recipeMarkdown.trim();
}

/**
 * Save recipe markdown and image to recipes directory
 */
function saveRecipe(markdown, imagePath, outputName) {
    // Ensure recipes directory exists
    if (!fs.existsSync(RECIPES_DIR)) {
        fs.mkdirSync(RECIPES_DIR, { recursive: true });
    }

    // Save markdown
    const mdPath = path.join(RECIPES_DIR, `${outputName}.md`);
    fs.writeFileSync(mdPath, markdown, 'utf8');
    console.log(`✓ Saved recipe: ${mdPath}`);

    // Copy image
    const ext = path.extname(imagePath);
    const imageDest = path.join(RECIPES_DIR, `${outputName}${ext}`);
    fs.copyFileSync(imagePath, imageDest);
    console.log(`✓ Copied image: ${imageDest}`);

    return { mdPath, imageDest };
}

/**
 * Main function
 */
async function main() {
    const args = process.argv.slice(2);

    if (args.length < 1) {
        console.error('Usage: node scripts/scan-recipe.js <image-path> [output-name]');
        console.error('');
        console.error('Example:');
        console.error('  node scripts/scan-recipe.js ~/photos/recipe.jpg tortilla-espanola');
        process.exit(1);
    }

    const imagePath = args[0];

    // Check if image exists
    if (!fs.existsSync(imagePath)) {
        console.error(`Error: Image not found: ${imagePath}`);
        process.exit(1);
    }

    // Determine output name
    let outputName = args[1];
    if (!outputName) {
        // Generate from image filename
        const basename = path.basename(imagePath, path.extname(imagePath));
        outputName = basename.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    }

    try {
        // Extract recipe from image
        const markdown = await extractRecipe(imagePath);

        console.log('\n--- Extracted Recipe ---');
        console.log(markdown);
        console.log('--- End Recipe ---\n');

        // Save recipe
        const { mdPath, imageDest } = saveRecipe(markdown, imagePath, outputName);

        console.log('\n✅ Recipe successfully scanned and saved!');
        console.log(`   Markdown: ${mdPath}`);
        console.log(`   Image: ${imageDest}`);

    } catch (error) {
        console.error('Error scanning recipe:', error.message);
        if (error.response) {
            console.error('API Error:', error.response.data);
        }
        process.exit(1);
    }
}

main();
