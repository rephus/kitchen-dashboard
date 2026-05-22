// ===================
// Kitchen UI App
// ===================

// ===================
// Toast Notifications
// ===================
let toastTimer = null;
function showToast(message, duration = 3000) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        el.classList.remove('visible');
        toastTimer = null;
    }, duration);
}

const WEATHER_ICONS = {
    'sunny': '☀️', 'clear-night': '🌙',
    'partlycloudy': '⛅', 'cloudy': '☁️',
    'rainy': '🌧️', 'pouring': '🌧️',
    'snowy': '❄️', 'snowy-rainy': '🌨️',
    'fog': '🌫️', 'hazy': '🌫️',
    'lightning': '⚡', 'lightning-rainy': '⛈️',
    'windy': '💨', 'exceptional': '🌈'
};

// ===================
// Navigation
// ===================
function navigate(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// Back buttons (all screens)
document.querySelectorAll('.back-btn').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.back || 'dashboard'));
});
document.getElementById('back-to-dashboard').addEventListener('click', () => navigate('dashboard'));

// Main nav buttons
document.getElementById('btn-timer').addEventListener('click', () => navigate('timer-screen'));
document.getElementById('btn-notify').addEventListener('click', sendFoodReady);
document.getElementById('btn-shopping').addEventListener('click', () => navigate('shopping-screen'));
document.getElementById('btn-recipes').addEventListener('click', () => {
    navigate('recipes-screen');
    loadRecipesList();
});

// ===================
// Recipes
// ===================
const recipesListEl = document.getElementById('recipes-list');
const recipeDetailEl = document.getElementById('recipe-detail');
const recipeDetailTitleEl = document.getElementById('recipe-detail-title');
const recipeDetailContentEl = document.getElementById('recipe-detail-content');
let allRecipes = [];

function simpleMarkdownToHtml(md) {
    const escape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    const lines = md.split('\n');
    const out = [];
    let inUl = false, inOl = false;
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const h1 = raw.match(/^# (.+)$/);
        const h2 = raw.match(/^## (.+)$/);
        const h3 = raw.match(/^### (.+)$/);
        const ulItem = raw.match(/^[-*] (.+)$/);
        const olItem = raw.match(/^(\d+)\. (.+)$/);
        if (h3) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
            out.push('<h3>' + inline(escape(h3[1])) + '</h3>');
            continue;
        }
        if (h2) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
            out.push('<h2>' + inline(escape(h2[1])) + '</h2>');
            continue;
        }
        if (h1) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (inOl) { out.push('</ol>'); inOl = false; }
            out.push('<h1>' + inline(escape(h1[1])) + '</h1>');
            continue;
        }
        if (ulItem) {
            if (inOl) { out.push('</ol>'); inOl = false; }
            if (!inUl) { out.push('<ul>'); inUl = true; }
            out.push('<li>' + inline(escape(ulItem[1])) + '</li>');
            continue;
        }
        if (olItem) {
            if (inUl) { out.push('</ul>'); inUl = false; }
            if (!inOl) { out.push('<ol>'); inOl = true; }
            out.push('<li>' + inline(escape(olItem[2])) + '</li>');
            continue;
        }
        if (inUl) { out.push('</ul>'); inUl = false; }
        if (inOl) { out.push('</ol>'); inOl = false; }
        if (raw.trim()) {
            out.push('<p>' + inline(escape(raw)) + '</p>');
        }
    }
    if (inUl) out.push('</ul>');
    if (inOl) out.push('</ol>');
    return out.join('\n');
}

function renderRecipesList(filterText = '') {
    const q = filterText.trim().toLowerCase();
    recipesListEl.innerHTML = '';

    if (!allRecipes.length) {
        recipesListEl.innerHTML = '<p class="recipes-empty">No recipes yet.</p>';
        return;
    }

    const filtered = q
        ? allRecipes.filter(r =>
            r.title.toLowerCase().includes(q) ||
            (r.slug && r.slug.toLowerCase().includes(q))
        )
        : allRecipes;

    if (!filtered.length) {
        recipesListEl.innerHTML = '<p class="recipes-empty">No recipes match your search.</p>';
        return;
    }

    filtered.forEach(r => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recipe-card';
        btn.innerHTML = `
                <div class="recipe-card-inner">
                    <div class="recipe-thumb ${r.image ? '' : 'recipe-thumb-placeholder'}">
                        ${r.image ? `<img src="${r.image}" alt="${r.title}">` : '📖'}
                    </div>
                    <div class="recipe-title">${r.title}</div>
                </div>
            `;
        btn.addEventListener('click', () => openRecipe(r.slug));
        recipesListEl.appendChild(btn);
    });
}

async function loadRecipesList() {
    recipesListEl.innerHTML = '';
    const searchInput = document.getElementById('recipes-search-input');
    if (searchInput) searchInput.value = '';

    try {
        const res = await fetch('/api/recipes');
        allRecipes = await res.json();
        renderRecipesList();
    } catch (e) {
        recipesListEl.innerHTML = '<p class="recipes-empty">Could not load recipes.</p>';
        showToast('Could not load recipes');
    }
}

let currentRecipeSlug = null;
let currentRecipe = null;

function renderRecipeDetail(recipe) {
    currentRecipe = recipe;
    recipeDetailTitleEl.textContent = recipe.title;
    let html = `
        <div class="recipe-detail-image${recipe.image ? '' : ' recipe-detail-image-empty'}">
            ${recipe.image ? `<img src="${recipe.image}" alt="${recipe.title}">` : ''}
            <button class="recipe-regen-btn" id="recipe-regen-btn" title="Regenerate image">⟳</button>
        </div>
    `;
    html += simpleMarkdownToHtml(recipe.content);
    recipeDetailContentEl.innerHTML = html;
    const regenBtn = document.getElementById('recipe-regen-btn');
    if (regenBtn) regenBtn.addEventListener('click', () => regenerateCurrentImage());
}

async function openRecipe(slug) {
    try {
        currentRecipeSlug = slug;
        const res = await fetch(`/api/recipes/${encodeURIComponent(slug)}`);
        const recipe = await res.json();
        renderRecipeDetail(recipe);
        closeRecipeEditForm();
        recipesListEl.style.display = 'none';
        recipeDetailEl.style.display = 'flex';
    } catch (e) {
        recipeDetailContentEl.innerHTML = '<p>Could not load recipe.</p>';
        showToast('Could not load recipe');
    }
}

async function regenerateCurrentImage() {
    if (!currentRecipeSlug) return;
    const btn = document.getElementById('recipe-regen-btn');
    const img = document.querySelector('.recipe-detail-image img');
    const wrapper = document.querySelector('.recipe-detail-image');
    if (btn) { btn.disabled = true; btn.classList.add('spinning'); }
    try {
        const res = await fetch(`/api/recipes/${encodeURIComponent(currentRecipeSlug)}/regenerate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.error || 'Could not regenerate image');
            return;
        }
        const cacheBusted = `${data.image}?t=${Date.now()}`;
        if (img) {
            img.src = cacheBusted;
        } else if (wrapper) {
            const newImg = document.createElement('img');
            newImg.src = cacheBusted;
            newImg.alt = recipeDetailTitleEl.textContent || '';
            wrapper.classList.remove('recipe-detail-image-empty');
            wrapper.insertBefore(newImg, wrapper.firstChild);
        }
        showToast('Image updated');
    } catch (e) {
        showToast('Could not regenerate image');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('spinning'); }
    }
}

document.getElementById('recipe-detail-back').addEventListener('click', () => {
    closeRecipeEditForm();
    recipeDetailEl.style.display = 'none';
    recipesListEl.style.display = '';
});

const recipeEditFormEl = document.getElementById('recipe-edit-form');
const recipeEditTitleInput = document.getElementById('recipe-edit-title');
const recipeEditAltInput = document.getElementById('recipe-edit-alt');

function openRecipeEditForm() {
    if (!currentRecipe) return;
    recipeEditTitleInput.value = currentRecipe.title || '';
    recipeEditAltInput.value = currentRecipe.altName || '';
    recipeEditFormEl.style.display = 'flex';
    recipeEditTitleInput.focus();
}

function closeRecipeEditForm() {
    recipeEditFormEl.style.display = 'none';
}

async function saveRecipeEdit() {
    if (!currentRecipeSlug) return;
    const payload = {
        title: recipeEditTitleInput.value.trim(),
        altName: recipeEditAltInput.value.trim(),
    };
    try {
        const res = await fetch(`/api/recipes/${encodeURIComponent(currentRecipeSlug)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Could not save');
            return;
        }
        renderRecipeDetail(data);
        // Keep the cached list in sync so the search results show the new title.
        const idx = allRecipes.findIndex(r => r.slug === data.slug);
        if (idx >= 0) {
            allRecipes[idx] = { ...allRecipes[idx], title: data.title, altName: data.altName };
        }
        closeRecipeEditForm();
        showToast('Saved');
    } catch (e) {
        showToast('Could not save');
    }
}

async function deleteCurrentRecipe() {
    if (!currentRecipeSlug) return;
    const title = currentRecipe?.title || currentRecipeSlug;
    if (!confirm(`Delete "${title}"? This removes the markdown and image and cannot be undone.`)) return;
    try {
        const res = await fetch(`/api/recipes/${encodeURIComponent(currentRecipeSlug)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok || !data.success) {
            showToast(data.error || 'Could not delete');
            return;
        }
        allRecipes = allRecipes.filter(r => r.slug !== currentRecipeSlug);
        renderRecipesList(document.getElementById('recipes-search-input')?.value || '');
        closeRecipeEditForm();
        recipeDetailEl.style.display = 'none';
        recipesListEl.style.display = '';
        currentRecipeSlug = null;
        currentRecipe = null;
        showToast('Recipe deleted');
    } catch (e) {
        showToast('Could not delete');
    }
}

document.getElementById('recipe-edit-btn').addEventListener('click', openRecipeEditForm);
document.getElementById('recipe-edit-cancel').addEventListener('click', closeRecipeEditForm);
document.getElementById('recipe-edit-save').addEventListener('click', saveRecipeEdit);
document.getElementById('recipe-edit-delete').addEventListener('click', deleteCurrentRecipe);

const recipesSearchInput = document.getElementById('recipes-search-input');
if (recipesSearchInput) {
    recipesSearchInput.addEventListener('input', (e) => {
        renderRecipesList(e.target.value || '');
    });
}

// ===================
// Recipe Scanner (Camera)
// ===================
const scanRecipeBtn = document.getElementById('scan-recipe-btn');
const recipeCameraInput = document.getElementById('recipe-camera-input');
const scanStatusEl = document.getElementById('scan-status');

function showScanStatus(message, type = 'info') {
    scanStatusEl.textContent = message;
    scanStatusEl.className = `scan-status scan-status-${type}`;
    scanStatusEl.style.display = 'block';
    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            scanStatusEl.style.display = 'none';
        }, 5000);
    }
}

if (scanRecipeBtn && recipeCameraInput) {
    scanRecipeBtn.addEventListener('click', () => {
        recipeCameraInput.click();
    });

    recipeCameraInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Reset input
        e.target.value = '';

        try {
            showScanStatus('📸 Scanning recipe...', 'info');

            // Convert to base64
            const reader = new FileReader();
            const base64Promise = new Promise((resolve, reject) => {
                reader.onload = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
            });
            reader.readAsDataURL(file);

            const base64Image = await base64Promise;

            // Send to backend
            const response = await fetch('/api/recipes/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: base64Image,
                    mediaType: file.type
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Scan failed');
            }

            const result = await response.json();
            showScanStatus(`✅ Recipe saved: ${result.title}`, 'success');

            // Reload recipes list
            await loadRecipesList();

            // Auto-open the new recipe
            setTimeout(() => {
                openRecipe(result.slug);
            }, 1000);

        } catch (error) {
            console.error('Recipe scan error:', error);
            showScanStatus(`❌ Scan failed: ${error.message}`, 'error');
        }
    });
}

// ===================
// Clock
// ===================
function updateClock() {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    document.getElementById('clock').textContent = `${h}:${m}`;
}
updateClock();
setInterval(updateClock, 10000);

// ===================
// Home Assistant
// ===================
let haConnected = false;
// Suppress toast spam from transient blips (cert rotation, wifi hiccups). Only
// surface "Could not reach server" after several consecutive failures, and
// only once per outage — re-armed on the next successful fetch.
let consecutiveFetchFailures = 0;
let outageToastShown = false;
const FETCH_FAILURE_TOAST_THRESHOLD = 3;

async function fetchSensors() {
    try {
        const res = await fetch('/api/sensors');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        consecutiveFetchFailures = 0;
        outageToastShown = false;

        if (data.temperature) {
            document.getElementById('temperature').textContent =
                `${Math.round(data.temperature.value)}°`;
        }

        if (data.weather) {
            const icon = WEATHER_ICONS[data.weather.state] || '🌡️';
            document.getElementById('weather-icon').textContent = icon;
        }

        if (data.battery && data.battery.value != null) {
            const pct = Math.round(data.battery.value);
            const levelEl = document.getElementById('battery-level');
            const iconEl = document.getElementById('battery-icon');
            levelEl.textContent = `${pct}%`;
            iconEl.textContent = pct <= 20 ? '🪫' : '🔋';
            levelEl.className = pct <= 20 ? 'battery-low'
                : pct <= 50 ? 'battery-mid'
                : 'battery-high';
        }

        if (data.power && data.power.value != null) {
            const w = Math.abs(Math.round(data.power.value));
            const el = document.getElementById('power');
            el.textContent = w;
            el.className = w > 4000 ? 'power-high' : w > 2000 ? 'power-mid' : 'power-low';
        }
    } catch (e) {
        consecutiveFetchFailures++;
        if (consecutiveFetchFailures >= FETCH_FAILURE_TOAST_THRESHOLD && !outageToastShown) {
            showToast('Could not reach server');
            outageToastShown = true;
        }
    }
}

async function checkConnection() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        haConnected = data.connected;
        const dot = document.querySelector('.ha-dot');
        const text = document.querySelector('.ha-text');
        dot.className = 'ha-dot ' + (haConnected ? 'connected' : 'disconnected');
        text.textContent = haConnected ? 'Home Assistant' : 'Disconnected';
    } catch (e) {
        haConnected = false;
    }
}

checkConnection();
fetchSensors();
setInterval(fetchSensors, 30000);

// ===================
// Food Ready Notification
// ===================
async function sendFoodReady() {
    const btn = document.getElementById('btn-notify');
    const feedback = document.getElementById('notify-feedback');

    btn.classList.add('sending');

    try {
        const message = 'La comida esta lista';

        // Send both: Pushbullet + Home Assistant → Alexa (Echo Show TTS)
        const [pushbulletResult, alexaResult] = await Promise.all([
            fetch('/api/notify/food-ready', { method: 'POST' })
                .then(r => r.json())
                .then(d => d.ok === true)
                .catch(() => false),
            fetch('/api/service/notify/alexa_media', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    data: { type: 'tts' },
                    target: 'media_player.echo_show'
                })
            }).then(r => r.json()).catch(() => ({})).then(d => d.success === true)
        ]);

        const isSuccess = pushbulletResult || alexaResult;
        feedback.textContent = isSuccess ? 'Notification sent!' : 'Failed to send';
        feedback.style.color = isSuccess ? 'var(--success)' : 'var(--accent)';
    } catch (e) {
        feedback.textContent = 'Failed to send';
        feedback.style.color = 'var(--accent)';
        showToast('Connection lost — notification not sent');
    }

    feedback.classList.add('visible');
    setTimeout(() => {
        btn.classList.remove('sending');
        feedback.classList.remove('visible');
    }, 2000);
}

// ===================
// Timer System
// ===================
let timers = [];
let timerIdCounter = 0;

function createTimer(totalSeconds, label) {
    const timer = {
        id: ++timerIdCounter,
        totalSeconds,
        remaining: totalSeconds,
        label: label || formatTimerLabel(totalSeconds),
        running: true,
        done: false
    };
    timers.push(timer);
    renderTimers();
    updateTimerPreviews();
    return timer;
}

function formatTimerLabel(seconds) {
    if (seconds >= 3600) return `${Math.round(seconds / 3600)} hour timer`;
    if (seconds >= 60) return `${Math.round(seconds / 60)} min timer`;
    return `${seconds} sec timer`;
}

function formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderTimers() {
    const list = document.getElementById('timers-list');
    list.innerHTML = '';

    timers.forEach(timer => {
        const card = document.createElement('div');
        card.className = 'timer-card' + (timer.done ? ' done' : '');
        card.id = `timer-${timer.id}`;

        const progress = timer.totalSeconds > 0
            ? ((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100
            : 100;

        card.innerHTML = `
            <div class="timer-progress" style="width: ${progress}%"></div>
            <div class="timer-display">${formatTime(timer.remaining)}</div>
            <div class="timer-label">${timer.label}</div>
            <div class="timer-controls">
                <button class="timer-ctrl-btn" onclick="toggleTimer(${timer.id})">${timer.running && !timer.done ? '⏸' : '▶'}</button>
                <button class="timer-ctrl-btn" onclick="addMinute(${timer.id})">+1m</button>
                <button class="timer-ctrl-btn danger" onclick="removeTimer(${timer.id})">✕</button>
            </div>
        `;
        list.appendChild(card);
    });
}

function toggleTimer(id) {
    const timer = timers.find(t => t.id === id);
    if (!timer) return;
    if (timer.done) {
        stopAlarm(timer);
        return;
    }
    timer.running = !timer.running;
    renderTimers();
}

function addMinute(id) {
    const timer = timers.find(t => t.id === id);
    if (!timer) return;
    timer.remaining += 60;
    timer.totalSeconds += 60;
    if (timer.done) {
        timer.done = false;
        timer.running = true;
        stopAlarm(timer);
    }
    renderTimers();
    updateTimerPreviews();
}

function removeTimer(id) {
    const timer = timers.find(t => t.id === id);
    if (timer) stopAlarm(timer);
    timers = timers.filter(t => t.id !== id);
    renderTimers();
    updateTimerPreviews();
}

function stopAlarm(timer) {
    if (timer._alarmInterval) {
        clearInterval(timer._alarmInterval);
        timer._alarmInterval = null;
    }
}

function playAlarmSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const notes = [880, 1100, 880, 1100];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            osc.type = 'square';
            gain.gain.value = 0.15;
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.12);
        });
    } catch (e) {}
}

function timerDone(timer) {
    timer.done = true;
    timer.running = false;
    timer.remaining = 0;
    playAlarmSound();
    timer._alarmInterval = setInterval(playAlarmSound, 2000);
    renderTimers();
    updateTimerPreviews();

}

// Timer tick
setInterval(() => {
    let changed = false;
    timers.forEach(timer => {
        if (timer.running && !timer.done) {
            timer.remaining--;
            if (timer.remaining <= 0) {
                timerDone(timer);
            }
            changed = true;
        }
    });

    if (changed) {
        timers.forEach(timer => {
            const card = document.getElementById(`timer-${timer.id}`);
            if (!card) return;
            const display = card.querySelector('.timer-display');
            if (display) display.textContent = formatTime(timer.remaining);
            const bar = card.querySelector('.timer-progress');
            if (bar) {
                const pct = timer.totalSeconds > 0
                    ? ((timer.totalSeconds - timer.remaining) / timer.totalSeconds) * 100
                    : 100;
                bar.style.width = pct + '%';
            }
        });
        updateTimerPreviews();
    }
}, 1000);

// Timer previews on dashboard
function updateTimerPreviews() {
    const container = document.getElementById('active-timers');
    const list = document.getElementById('timer-previews');
    const active = timers.filter(t => t.running || t.done);

    if (active.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = '';
    list.innerHTML = '';
    active.forEach(timer => {
        const el = document.createElement('div');
        el.className = 'timer-preview';
        el.innerHTML = `
            <span class="timer-preview-label">${timer.label}</span>
            <span class="timer-preview-time ${timer.done ? 'urgent' : ''}">${timer.done ? 'DONE!' : formatTime(timer.remaining)}</span>
        `;
        el.addEventListener('click', () => navigate('timer-screen'));
        list.appendChild(el);
    });
}

// Preset buttons
document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.minutes);
        createTimer(mins * 60);
    });
});

// ===================
// Shopping List
// ===================
let shoppingItems = [];

async function loadShoppingList() {
    try {
        const res = await fetch('/api/shopping');
        shoppingItems = await res.json();
        renderShoppingList();
    } catch (e) {
        showToast('Could not load shopping list');
    }
}

function saveShoppingList() {
    fetch('/api/shopping', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shoppingItems)
    }).then(res => {
        if (!res.ok) showToast('Failed to save list');
    }).catch(() => showToast('Connection lost — could not save'));
}

function renderShoppingList() {
    const list = document.getElementById('shopping-list');
    list.innerHTML = '';

    const sorted = [...shoppingItems].sort((a, b) => a.checked - b.checked);

    sorted.forEach(item => {
        const el = document.createElement('div');
        el.className = 'shopping-item' + (item.checked ? ' checked' : '');
        el.innerHTML = `
            <div class="item-check">${item.checked ? '✓' : ''}</div>
            <span class="item-text">${escapeHtml(item.text)}</span>
            <button class="item-delete">✕</button>
        `;

        el.querySelector('.item-check').addEventListener('click', (e) => {
            e.stopPropagation();
            item.checked = !item.checked;
            saveShoppingList();
            renderShoppingList();
        });

        el.querySelector('.item-text').addEventListener('click', () => {
            item.checked = !item.checked;
            saveShoppingList();
            renderShoppingList();
        });

        el.querySelector('.item-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            shoppingItems = shoppingItems.filter(i => i !== item);
            saveShoppingList();
            renderShoppingList();
        });

        list.appendChild(el);
    });
}

function addShoppingItem(text) {
    text = text.trim();
    if (!text) return;
    // Add new items to the top of the list
    shoppingItems.unshift({ text, checked: false });
    saveShoppingList();
    renderShoppingList();
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

document.getElementById('add-item-btn').addEventListener('click', () => {
    const input = document.getElementById('shopping-input');
    addShoppingItem(input.value);
    input.value = '';
    input.focus();
});

document.getElementById('shopping-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        addShoppingItem(e.target.value);
        e.target.value = '';
    }
});

document.getElementById('clear-checked').addEventListener('click', () => {
    shoppingItems = shoppingItems.filter(i => !i.checked);
    saveShoppingList();
    renderShoppingList();
});

document.getElementById('send-list-btn').addEventListener('click', async () => {
    const btn = document.getElementById('send-list-btn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
        const res = await fetch('/api/shopping/send', { method: 'POST' });
        const data = await res.json();
        btn.textContent = data.ok ? 'Sent!' : 'Failed';
    } catch (e) {
        btn.textContent = 'Failed';
        showToast('Connection lost — list not sent');
    }
    setTimeout(() => {
        btn.disabled = false;
        btn.textContent = 'Send list';
    }, 2000);
});

loadShoppingList();

// ===================
// Voice Recognition
// ===================
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;
/** Pending onend → restart timer; must be cleared when user turns mic off */
let micRestartTimer = null;
/** Last final transcript for this mic session (fixes progressive finals: "tortilla" → "tortilla de patatas") */
let lastVoiceFinalTranscript = '';

function normalizeVoicePhrase(text) {
    return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Split spoken text into individual items
// Handles: "leche, pan y huevos" -> ["leche", "pan", "huevos"]
function splitIntoItems(text) {
    return text
        .split(/,|\by\b|\be\b/i)    // split on commas, "y", "e"
        .map(s => s.trim().toLowerCase())
        .filter(s => s.length > 0);
}

/** Remove unchecked list rows whose text matches any of these parts (voice refinement undo). */
function removeShoppingItemsMatchingParts(parts) {
    const set = new Set(parts.map((p) => p.trim().toLowerCase()).filter(Boolean));
    if (set.size === 0) return;
    const before = shoppingItems.length;
    shoppingItems = shoppingItems.filter((i) => {
        if (i.checked) return true;
        return !set.has(i.text.trim().toLowerCase());
    });
    if (shoppingItems.length !== before) {
        saveShoppingList();
        renderShoppingList();
    }
}

function applyVoiceFinalTranscript(rawTranscript) {
    const normalized = normalizeVoicePhrase(rawTranscript);
    if (!normalized) return;

    if (normalized === lastVoiceFinalTranscript) return;

    // Only treat as same utterance growing if the longer text continues after space/comma
    // (avoids "pan" then "panadero" being merged; progressive API uses "tortilla" → "tortilla de …")
    const last = lastVoiceFinalTranscript;
    const isRefinement =
        last &&
        normalized.length > last.length &&
        (normalized.startsWith(last + ' ') || normalized.startsWith(last + ','));

    if (isRefinement) {
        const oldParts = splitIntoItems(last);
        removeShoppingItemsMatchingParts(oldParts);
    }

    const items = splitIntoItems(normalized);
    items.slice()
        .reverse()
        .forEach((item) => addShoppingItem(item));
    lastVoiceFinalTranscript = normalized;
}

function initVoice() {
    const micBtn = document.getElementById('mic-btn');
    const micStatus = document.getElementById('mic-status');

    if (!SpeechRecognition) {
        micBtn.addEventListener('click', () => {
            micStatus.textContent = 'Voice not supported in this browser. Use Chrome.';
        });
        return;
    }

    recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
        let interim = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript.trim();

            if (event.results[i].isFinal) {
                applyVoiceFinalTranscript(transcript);
                const items = splitIntoItems(normalizeVoicePhrase(transcript));
                if (items.length > 0) {
                    micStatus.textContent = `+ ${items.join(', ')}`;
                    micStatus.className = 'mic-status heard';
                }
            } else {
                interim = transcript;
            }
        }

        if (interim) {
            micStatus.textContent = interim;
            micStatus.className = 'mic-status';
        }
    };

    recognition.onerror = (event) => {
        if (event.error === 'not-allowed') {
            micStatus.textContent = 'Microphone blocked (needs HTTPS)';
            document.getElementById('mic-help').style.display = '';
        } else if (event.error === 'no-speech') {
            micStatus.textContent = 'No speech detected, try again';
        } else if (event.error !== 'aborted') {
            micStatus.textContent = `Error: ${event.error}`;
        }
        stopListening();
    };

    recognition.onend = () => {
        if (!isListening) return;
        if (micRestartTimer != null) {
            clearTimeout(micRestartTimer);
            micRestartTimer = null;
        }
        // Defer restart; cancel via clearTimeout(micRestartTimer) when user turns mic off
        micRestartTimer = setTimeout(() => {
            micRestartTimer = null;
            if (!isListening) return;
            try {
                recognition.start();
            } catch (e) {
                stopListening();
            }
        }, 0);
    };

    micBtn.addEventListener('click', () => {
        if (isListening) {
            stopListening();
        } else {
            startListening();
        }
    });
}

function startListening() {
    if (!recognition) return;
    if (micRestartTimer != null) {
        clearTimeout(micRestartTimer);
        micRestartTimer = null;
    }
    isListening = true;
    lastVoiceFinalTranscript = '';
    document.getElementById('mic-btn').classList.add('listening');
    document.getElementById('mic-status').textContent = 'Escuchando...';
    document.getElementById('mic-status').className = 'mic-status';
    try {
        recognition.start();
    } catch (e) {}
}

function stopListening() {
    if (micRestartTimer != null) {
        clearTimeout(micRestartTimer);
        micRestartTimer = null;
    }
    isListening = false;
    document.getElementById('mic-btn').classList.remove('listening');
    // abort() stops continuous recognition immediately; stop() can still fire onend and re-queue listening in WebKit
    try {
        recognition.abort();
    } catch (e) {}
    setTimeout(() => {
        if (!isListening) document.getElementById('mic-status').textContent = '';
    }, 3000);
}

initVoice();

// ===================
// Wake Lock (keep screen on)
// ===================
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            await navigator.wakeLock.request('screen');
        }
    } catch (e) {}
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        requestWakeLock();
        updateClock();
        fetchSensors();
        loadShoppingList();
    }
});

requestWakeLock();
