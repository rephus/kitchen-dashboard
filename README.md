# Kitchen Dashboard

A kitchen dashboard UI for Home Assistant with recipe management, timers, and shopping lists.

## Features

- 📱 Mobile-friendly recipe browser
- 🏠 Home Assistant integration (temperature, weather, power, battery)
- 📸 **Recipe Scanner** - Extract recipes from cookbook photos using AI
- ⏱️ Timer and notification support
- 🛒 Shopping list management
- 🧺 AI grouping into supermarket sections when sending or printing (Claude Haiku)
- 🖨️ Print unchecked shopping items on the PT210 Bluetooth thermal printer

The Shopping screen's **Print list** button uses the queued print service in
`../funprint`, routing shopping jobs to PT210 (`86:67:7A:B1:30:97`) through the
active `esphome-cocina` Bluetooth proxy (`192.168.2.70`). Keep it near the kitchen
proxy, on with paper loaded and the cover closed. This printer uses standard
ESC/POS over BLE. Printing temporarily releases only the kitchen ESPHome
integration from Home Assistant, restoring and verifying it afterward. Spanish
accents and wrapping use the existing 384-dot bitmap renderer; printing does not
remove or check off shopping items. Generic text/image/QR printing still defaults
to the old Fun Print printer and is available at `POST /api/print`
with bearer authentication and an `Idempotency-Key` header. Progress is at
`GET /api/print/jobs/{id}`. See `../funprint/API.md` for setup and examples.

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

## Recipe Scanner 📸

The recipe scanner uses Claude's Vision API to extract recipes from cookbook or magazine photos directly from your phone's camera.

### Prerequisites

- An Anthropic API key (get one at https://console.anthropic.com/)
- Set the `ANTHROPIC_API_KEY` environment variable in your `.env` file

### How to Use

1. Open the kitchen dashboard in your mobile browser
2. Navigate to the **Recipes** page
3. Tap the **📷 Scan Recipe** button
4. Your phone's camera will open
5. Take a photo of the cookbook or magazine page
6. Wait a few seconds while the AI processes the image
7. The recipe appears in your list automatically! ✨

### What It Does

- Extracts recipe name, ingredients, and cooking instructions from photos
- Formats everything in Spanish markdown matching your existing recipes
- Auto-generates a slug from the recipe title
- Saves both the recipe markdown (`recipes/<slug>.md`) and the source image
- Refreshes the recipe list and opens the new recipe for you

### Recipe Format

Recipes are stored as markdown files in the `recipes/` directory with this structure:

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
├── app.js              # Frontend JavaScript (includes recipe scanner UI)
├── style.css           # Styling
├── server.js           # Node.js backend (includes recipe scan API)
├── recipes/            # Recipe markdown files and images
└── package.json
```

## Configuration

Edit `server.js` to configure Home Assistant sensors and other settings.

## License

ISC
