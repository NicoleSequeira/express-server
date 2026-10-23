const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const GUESTBOOK_FILE = path.join(__dirname, 'guestbook.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const MAX_ENTRIES = 50;

async function readAll(file = GUESTBOOK_FILE) {
    try {
        const text = await fs.readFile(file, 'utf8');
        return JSON.parse(text);
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

async function writeAll(data, file = GUESTBOOK_FILE) {
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function getUserByUsername(username) {
    const users = await readAll(USERS_FILE);
    return users.find(
        user => user.username === username.toLowerCase()
    ) || null;
}

// Takes a passwordHash, never a password
async function addUser({ username, passwordHash, role = 'user' }) {
    const users = await readAll(USERS_FILE);

    const user = {
        id: crypto.randomUUID(),
        username: username.toLowerCase(),
        passwordHash,
        role,
        createdAt: new Date().toISOString()
    };

    users.push(user);
    await writeAll(users, USERS_FILE);
    return user;
}

async function getAllEntries() {
    return readAll(GUESTBOOK_FILE);
}

async function getEntryById(id) {
    const entries = await readAll(GUESTBOOK_FILE);
    return entries.find(entry => entry.id === id) || null;
}

async function addEntry({ name, msg }) {
    const entries = await readAll(GUESTBOOK_FILE);

    const entry = {
        id: crypto.randomUUID(),
        name,
        msg,
        createdAt: new Date().toISOString()
    };

    entries.push(entry);
    await writeAll(entries.slice(-MAX_ENTRIES), GUESTBOOK_FILE);
    return entry;
}

async function updateEntry(id, { name, msg }) {
    const entries = await readAll(GUESTBOOK_FILE);
    const entry = entries.find(entry => entry.id === id);

    if (!entry) return null;

    entry.name = name;
    entry.msg = msg;
    entry.updatedAt = new Date().toISOString();

    await writeAll(entries, GUESTBOOK_FILE);
    return entry;
}

async function deleteEntry(id) {
    const entries = await readAll(GUESTBOOK_FILE);
    const remaining = entries.filter(entry => entry.id !== id);

    if (remaining.length === entries.length) return false;

    await writeAll(remaining, GUESTBOOK_FILE);
    return true;
}

module.exports = {
    getAllEntries,
    getEntryById,
    addEntry,
    updateEntry,
    deleteEntry,
    getUserByUsername,
    addUser
};