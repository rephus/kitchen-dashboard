# Kitchen Dashboard

A kitchen dashboard UI for Home Assistant with recipe management, timers, and shopping lists.

## Features

- 📱 Mobile-friendly recipe browser
- 🏠 Home Assistant integration (temperature, weather, power, battery)
- 📸 **Recipe Scanner** - Extract recipes from cookbook photos using AI
- ⏱️ Timer and notification support
- 🛒 Shopping list management

## Setup

1. Clone the repository:
```bash
git clone https://github.com/rephus/kitchen-dashboard.git
cd kitchen-dashboard
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the server:
```bash
npm start
# or for development with auto-reload:
npm run dev
```

The server will run on port 8002 by default.

## Recipe Scanner

The recipe scanner uses Claude's Vision API to extract recipes from cookbook or magazine photos and convert them to the markdown format used by the kitchen dashboard.

### Prerequisites

- An Anthropic API key (get one at https://console.anthropic.com/)
- Set the `ANTHROPIC_API_KEY` environment variable in your `.env` file

### Usage

```bash
# Basic usage (auto-generates filename from image name)
npm run scan-recipe <path-to-image>

# Specify custom output name
npm run scan-recipe <path-to-image> <output-name>
```

### Examples

```bash
# Scan a recipe photo
npm run scan-recipe ~/photos/tortilla-recipe.jpg

# Scan and specify output name
npm run scan-recipe ~/photos/IMG_1234.jpg tortilla-espanola
```

This will:
1. Analyze the image using Claude's Vision API
2. Extract recipe name, ingredients, and instructions
3. Format it in Spanish markdown matching the existing recipe format
4. Save to `recipes/<name>.md`
5. Copy the image to `recipes/<name>.<ext>`

### Recipe Format

Recipes are stored as markdown files in the `recipes/` directory with the following structure:

```markdown
# Recipe Name

## Ingredientes

- ingredient with quantity
- ingredient with quantity

## Elaboración

1. First step
2. Second step
```

You can also add subsections like `## Sofrito`, `## Caldo`, etc. for complex recipes.

## Directory Structure

```
kitchen-dashboard/
├── index.html          # Main dashboard UI
├── app.js              # Frontend JavaScript
├── style.css           # Styling
├── server.js           # Node.js backend
├── recipes/            # Recipe markdown files and images
├── scripts/            # Utility scripts
│   └── scan-recipe.js  # Recipe scanner
└── package.json
```

## Configuration

Edit `server.js` to configure Home Assistant sensors and other settings.

## License

ISC
