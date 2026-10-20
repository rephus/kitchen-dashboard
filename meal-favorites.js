const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function validateMeal(type, id) {
    if (!['recipe', 'quick'].includes(type) || typeof id !== 'string' ||
        id.length === 0 || id.length > 120 || /[^a-zA-Z0-9_-]/.test(id)) {
        throw new TypeError('A valid meal type and ID are required');
    }
}

function createMealFavorites({ filePath, now = () => new Date().toISOString() }) {
    function read() {
        let contents;
        try {
            contents = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
        const favorites = JSON.parse(contents);
        if (!Array.isArray(favorites)) throw new Error('Invalid favorites file');
        for (const favorite of favorites) {
            if (!favorite || typeof favorite !== 'object') {
                throw new Error('Invalid favorite entry');
            }
            validateMeal(favorite.type, favorite.id);
            if (typeof favorite.starredAt !== 'string' ||
                !Number.isFinite(Date.parse(favorite.starredAt))) {
                throw new Error('Invalid favorite timestamp');
            }
        }
        return favorites;
    }

    function set(type, id, favorite) {
        validateMeal(type, id);
        if (typeof favorite !== 'boolean') throw new TypeError('Favorite must be a boolean');
        const favorites = read();
        const index = favorites.findIndex((item) => item.type === type && item.id === id);
        if ((favorite && index !== -1) || (!favorite && index === -1)) return favorites;
        if (favorite) favorites.unshift({ type, id, starredAt: new Date(now()).toISOString() });
        else favorites.splice(index, 1);

        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(temporaryPath, `${JSON.stringify(favorites, null, 2)}\n`, { flag: 'wx' });
            fs.renameSync(temporaryPath, filePath);
        } finally {
            try {
                fs.unlinkSync(temporaryPath);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        return favorites;
    }

    return { read, set };
}

module.exports = { createMealFavorites };
