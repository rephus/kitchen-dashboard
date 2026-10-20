const fs = require('node:fs');
const path = require('node:path');

// Compute calendar weeks in the household's timezone, independently of the host.
function nextPlanningWeek(date) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date).map(part => [part.type, part.value]));
    const monday = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
    monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
    return monday.toISOString().slice(0, 10);
}

function eventKey(event) {
    return JSON.stringify([event.planningWeek, event.type, event.id]);
}

function createMealSelectionHistory({ filePath, now = () => new Date() }) {
    function readHistory() {
        let raw;
        try {
            raw = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return { raw: '', events: [] };
            throw error;
        }
        const events = [];
        for (const [index, line] of raw.split('\n').entries()) {
            if (!line.trim()) continue;
            try {
                const event = JSON.parse(line);
                if (!event || !['recipe', 'quick'].includes(event.type)
                    || typeof event.id !== 'string' || !event.id
                    || typeof event.title !== 'string'
                    || typeof event.source !== 'string'
                    || typeof event.selectedAt !== 'string' || !Number.isFinite(Date.parse(event.selectedAt))
                    || typeof event.planningWeek !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.planningWeek)) {
                    throw new Error('Invalid selection event');
                }
                events.push(event);
            } catch (error) {
                // Never truncate an incomplete trailing line or replace damaged history.
                throw new Error(`Cannot read meal selection history at line ${index + 1}: ${error.message}`);
            }
        }
        return { raw, events };
    }

    function recordSelections(previousPlan, nextPlan, { recipes = [], quickMeals = [], source = 'weekly-planner' } = {}) {
        const { raw, events } = readHistory();
        const selectedAt = new Date(now()).toISOString();
        const planningWeek = nextPlanningWeek(new Date(selectedAt));
        const seen = new Set(events.map(eventKey));
        const additions = [];
        for (const [type, field, meals] of [
            ['recipe', 'selectedRecipes', recipes],
            ['quick', 'selectedQuickMeals', quickMeals],
        ]) {
            const previous = new Set(previousPlan[field] || []);
            const details = new Map(meals.map(meal => [meal.slug || meal.id, meal]));
            for (const id of new Set(nextPlan[field] || [])) {
                const event = {
                    type, id, title: details.get(id)?.title || id, source,
                    selectedAt, planningWeek, period: 'next-week',
                };
                if (previous.has(id) || seen.has(eventKey(event))) continue;
                additions.push(event);
                seen.add(eventKey(event));
            }
        }
        if (additions.length) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            const separator = raw && !raw.endsWith('\n') ? '\n' : '';
            fs.appendFileSync(filePath, separator + additions.map(event => JSON.stringify(event)).join('\n') + '\n');
        }
        return additions;
    }

    function getPopularity() {
        const { events } = readHistory();
        const meals = new Map();
        const seen = new Set();
        for (const event of events) {
            if (seen.has(eventKey(event))) continue;
            seen.add(eventKey(event));
            const key = JSON.stringify([event.type, event.id]);
            const meal = meals.get(key) || { type: event.type, id: event.id, title: event.title, count: 0, lastSelectedAt: '' };
            meal.count += 1;
            if (event.selectedAt > meal.lastSelectedAt) {
                meal.lastSelectedAt = event.selectedAt;
                meal.title = event.title;
            }
            meals.set(key, meal);
        }
        return [...meals.values()].sort((a, b) => b.count - a.count
            || b.lastSelectedAt.localeCompare(a.lastSelectedAt) || a.title.localeCompare(b.title));
    }

    return { recordSelections, getPopularity };
}

module.exports = { createMealSelectionHistory };
