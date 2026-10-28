require('dotenv').config();

const REQUIRED_ENV = [
    'SESSION_SECRET',
    'NASA_API_KEY',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD'
];

for (const name of REQUIRED_ENV) {
    if (!process.env[name]) {
        console.error(
            `Missing ${name} in .env (or in Render's Environment settings)`
        );
        process.exit(1);
    }
}

const db = require('./db');
const bcrypt = require('bcryptjs');

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');

const fs = require('fs');
const path = require('path');
const { Filter } = require('bad-words');
const { error } = require('console');

const filter = new Filter();
const app = express();
const crypto = require('crypto');
const helmet = require('helmet');
const apodCache = new Map();

const TODAY_MAX_AGE = 60 * 60 * 1000;
const MAX_CACHE_SIZE = 100;

// Trust the X-Forwarded-For header set by hosts like Render
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(helmet());

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            'img-src': [
                "'self'",
                'data:',
                'https://assets.science.nasa.gov'
            ],
            'script-src': [
                "'self'",
                'https://cdn.jsdelivr.net'
            ]
        }
    }
}));

function canModify(req, entry) {
    return entry.authorId === req.session.userId || req.session.role === 'admin';
}

const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_FILE = path.join(__dirname, 'server.log');

let visitorCount = 0;

// Trim the log file if it gets too big
if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 128 * 128) {
    const recentLines = fs
        .readFileSync(LOG_FILE, 'utf8')
        .split('\n')
        .slice(-10);

    fs.writeFileSync(LOG_FILE, recentLines.join('\n'));
}

function validateEntry(name, msg) {
    if (typeof name !== 'string' || typeof msg !== 'string') {
        return 'Name and message must be text.';
    }

    if (name.trim().length < 1 || name.trim().length > 40) {
        return 'Name must be 1 to 40 characters.';
    }

    if (msg.trim().length < 1 || msg.trim().length > 280) {
        return 'Message must be 1 to 280 characters.';
    }

    return null;
}

function validateApodDate(date) {
    if (date === undefined) return null;

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return 'Date must look like YYYY-MM-DD.';
    }

    const parsed = new Date(date + 'T00:00:00Z');

    if (
        isNaN(parsed) ||
        parsed.toISOString().slice(0, 10) !== date
    ) {
        return 'That is not a real date.';
    }

    if (date < '1995-06-16') {
        return 'The first picture is from 1995-06-16.';
    }

    const today = new Date().toISOString().slice(0, 10);

    if (date > today) {
        return 'That date is in the future.';
    }

    return null;
}

const GUESTBOOK_FILE = path.join(__dirname, 'guestbook.json');

function getGuestbookMessages() {
    if (!fs.existsSync(GUESTBOOK_FILE)) return [];

    return JSON.parse(
        fs.readFileSync(GUESTBOOK_FILE, 'utf8')
    );
}

function validateCredentials(username, password) {
    if (
        typeof username !== 'string' ||
        typeof password !== 'string'
    ) {
        return 'Username and password must be text.';
    }

    if (
        !/^[a-z0-9_]{3,20}$/.test(
            username.trim().toLowerCase()
        )
    ) {
        return 'Username must be 3 to 20 letters, numbers or underscores.';
    }

    if (password.length < 8 || password.length > 72) {
        return 'Password must be 8 to 72 characters.';
    }

    return null;
}

// Starts a brand-new session for this user
function startSession(req, user, rememberMe) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) return reject(err);

            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.role = user.role;

            if (rememberMe) {
                req.session.cookie.maxAge =
                    7 * 24 * 60 * 60 * 1000;
            }

            resolve();
        });
    });
}

const MIN_FILL_TIME = 2000; // 2 seconds, in milliseconds

// Writes a note about a caught bot to the console and server.log
function logBot(req, reason) {
    const line = `[${new Date().toISOString()}] BOT BLOCKED (${reason}) from ${req.ip} on ${req.path}\n`;
    console.log(line.trim());
    fs.appendFile(LOG_FILE, line, () => { });
}

// Blocks bot submissions using a honeypot and a time trap.
// Bots get a fake "success" so they don't learn they were caught.
function botCheck(req, res, next) {
    // Check 1: the honeypot. Humans leave it empty.
    if (req.body.website) {
        logBot(req, 'honeypot filled');
        return res.status(201).json({});
    }

    // Check 2: the time trap. Humans need more than 2 seconds.
    const loadedAt = req.session.formLoadedAt;
    if (!loadedAt || Date.now() - loadedAt < MIN_FILL_TIME) {
        logBot(req, 'submitted too fast');
        return res.status(201).json({});
    }

    next(); // passed both checks
}

// Route guard for logged-in API routes
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: 'Please log in first.'
        });
    }

    next();
}


// Route guard for logged-in pages
function requireLoginPage(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/');
    }

    next();
}

// Route guard for admin-only pages
function requireAdminPage(req, res, next) {
    if (req.session.role !== 'admin') {
        return res.redirect('/');
    }

    next();
}


// Parse incoming form and JSON data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Logs every request
app.use((req, res, next) => {
    const logLine =
        `[${new Date().toISOString()}] ` +
        `${req.method} ${req.path}\n`;

    console.log(logLine.trim());

    fs.appendFile(LOG_FILE, logLine, (err) => {
        if (err) console.error('Log write failed:', err);
    });

    next();
});

// General rate limiter
const limiter = rateLimit({
    windowMs: 10 * 1000,
    limit: 100,
    message: {
        error: 'Too many requests. Please wait 10 seconds.'
    }
});

app.use(limiter);

// NASA rate limiter
const spaceLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    message: {
        error: 'Too many space lookups. Please wait a minute.'
    }
});

// Login and registration rate limiter
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: {
        error: 'Too many login attempts. Please wait 15 minutes and try again.'
    }
});

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 15 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction
    }
}));

// ==========================================
// ROUTES
// ==========================================

app.get('/api/hello', (req, res) => {
    res.json({
        message: 'Hello, world!'
    });
});

app.get('/guestbook', requireLoginPage, (req, res) => {
    req.session.formLoadedAt = Date.now(); // start the clock
    res.sendFile(path.join(PUBLIC_DIR, 'guestbook.html'));
});

// Get all guestbook entries
app.get('/api/guestbook', requireAuth, async (req, res) => {
    const entries = await db.getAllEntries();
    res.json(entries);
});

// Get one guestbook entry
app.get('/api/guestbook/:id', requireAuth, async (req, res) => {
    const entry = await db.getEntryById(req.params.id);

    if (!entry) {
        return res.status(404).json({
            error: 'Entry not found.'
        });
    }

    res.json(entry);
});

// Delete a guestbook entry
app.delete('/api/guestbook/:id', requireAuth, async (req, res) => {
    const entry = await db.getEntryById(req.params.id);
    if (!entry) {
        return res.status(404).json({ error: 'Entry not found.' });
    }
    if (!canModify(req, entry)) {
        return res.status(403).json({ error: 'You can only delete your own messages.' });
    }

    await db.deleteEntry(entry.id);
    res.status(204).end();
});

// Update a guestbook entry
app.put('/api/guestbook/:id', requireAuth, async (req, res) => {
    const { msg } = req.body;
    const entry = await db.getEntryById(req.params.id);
    if (!entry) {
        return res.status(404).json({ error: 'Entry not found.' });
    }
    if (!canModify(req, entry)) {
        return res.status(403).json({ error: 'You can only edit your own messages.' });
    }

    const error = validateEntry(entry.name, msg);
    if (error) {
        return res.status(400).json({ error });
    }

    // Keep your bad-words check here too, if you have one

    const updated = await db.updateEntry(entry.id, { name: entry.name, msg: msg.trim() });
    res.json(updated);
});

// Create a guestbook entry
app.post('/api/guestbook', requireAuth, botCheck, async (req, res) => {
    const { msg } = req.body;
    const name = req.session.username;

    const error = validateEntry(name, msg);
    if (error) {
        return res.status(400).json({ error });
    }

    // Keep your bad-words check here, if you have one

    const entry = await db.addEntry({
        name,
        msg: msg.trim(),
        authorId: req.session.userId
    });
    res.status(201).json(entry);
});

// NASA space picture route
app.get('/api/space', spaceLimiter, async (req, res) => {
    const { date } = req.query;

    const cacheKey = date || 'today';
    const cached = apodCache.get(cacheKey);

    const isFresh =
        cacheKey !== 'today' ||
        Date.now() - cached?.savedAt < TODAY_MAX_AGE;

    if (cached && isFresh) {
        console.log('Cache hit:', cacheKey);
        return res.json(cached.data);
    }

    const dateError = validateApodDate(date);

    if (dateError) {
        return res.status(400).json({
            error: dateError
        });
    }

    let address =
        'https://science.nasa.gov/wp-json/wp/v2/apod-basic/';

    if (date) {
        const shortDate = date
            .slice(2)
            .replaceAll('-', '');

        address = address + shortDate;
    }

    const nasaUrl = new URL(address);
    nasaUrl.searchParams.set(
        'api_key',
        process.env.NASA_API_KEY
    );

    let nasaResponse;

    try {
        nasaResponse = await fetch(nasaUrl, {
            signal: AbortSignal.timeout(8000)
        });
    } catch (err) {
        return res.status(502).json({
            error: 'Could not reach NASA. Try again later.'
        });
    }

    if (nasaResponse.status === 404) {
        return res.status(404).json({
            error: 'NASA has no picture for that date.'
        });
    }

    if (!nasaResponse.ok) {
        console.error(
            'NASA error:',
            nasaResponse.status
        );

        return res.status(502).json({
            error: 'NASA could not send a picture right now.'
        });
    }

    const data = await nasaResponse.json();

    const picture = Array.isArray(data)
        ? data[0]
        : data;

    const result = {
        title: picture.title,
        date: picture.date,
        imageUrl: picture.hdurl,
        description: picture.alt,
        nasaPage: picture.permalink
    };

    apodCache.set(cacheKey, {
        data: result,
        savedAt: Date.now()
    });

    if (apodCache.size > MAX_CACHE_SIZE) {
        const oldestKey =
            apodCache.keys().next().value;

        apodCache.delete(oldestKey);
    }

    res.json(result);
});

// Visitor count
app.get('/api/stats', (req, res) => {
    res.set('Cache-Control', 'no-store');

    res.json({
        visitorCount
    });
});

// Register a new user
app.post('/register', authLimiter, async (req, res) => {
    const { username, password } = req.body;

    const validationError =
        validateCredentials(username, password);

    if (validationError) {
        return res.status(400).json({
            error: validationError
        });
    }

    const cleanName =
        username.trim().toLowerCase();

    const existingUser =
        await db.getUserByUsername(cleanName);

    if (existingUser) {
        return res.status(409).json({
            error: 'That username is already taken.'
        });
    }

    const passwordHash =
        await bcrypt.hash(password, 12);

    const user = await db.addUser({
        username: cleanName,
        passwordHash
    });

    await startSession(req, user);

    res.status(201).json({
        username: user.username
    });
});

// Log in an existing user
app.post('/login', authLimiter, async (req, res) => {
    const {
        username,
        password,
        rememberMe
    } = req.body;

    if (
        typeof username !== 'string' ||
        typeof password !== 'string'
    ) {
        return res.status(400).json({
            error: 'Username and password are required.'
        });
    }

    const user =
        await db.getUserByUsername(username.trim());

    const passwordOk =
        user &&
        await bcrypt.compare(
            password,
            user.passwordHash
        );

    if (!passwordOk) {
        return res.status(401).json({
            error: 'Incorrect username or password.'
        });
    }

    await startSession(req, user, rememberMe);

    res.json({
        success: true,
        username: user.username
    });
});

// Log out
app.post('/logout', (req, res) => {
    req.session.destroy((sessionError) => {
        if (sessionError) {
            return res.status(500).json({
                success: false,
                error: 'Logout failed'
            });
        }

        res.clearCookie('connect.sid');

        res.json({
            success: true
        });
    });
});

// Admin-only dashboard
app.get('/dashboard', requireAdminPage, (req, res) => {
    res.sendFile(
        path.join(PUBLIC_DIR, 'dashboard.html')
    );
});

// Projects page
app.get('/projects', (req, res) => {
    visitorCount++;

    console.log(
        `Visit #${visitorCount}: someone viewed the projects page`
    );

    res.sendFile(
        path.join(PUBLIC_DIR, 'projects.html')
    );
});

// About page
app.get('/about', (req, res) => {
    res.sendFile(
        path.join(PUBLIC_DIR, 'about.html')
    );
});

// Check who is logged in
app.get('/api/whoami', (req, res) => {
    if (!req.session.userId) {
        return res.json({
            loggedIn: false
        });
    }

    res.json({
        loggedIn: true,
        userId: req.session.userId,
        username: req.session.username,
        role: req.session.role
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok'
    });
});

// Static files
app.use(express.static(PUBLIC_DIR, {
    extensions: ['html']
}));

if (!isProduction) {
    app.get('/api/headers-demo', (req, res) => {
        res.set('X-Student-Name', 'Riley');

        res.json({
            browser: req.get('User-Agent'),
            languages: req.get('Accept-Language'),
            allRequestHeaders: req.headers
        });
    });
}

// 404 handler
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({
            error: 'Not found'
        });
    }

    res.status(404).sendFile(
        path.join(PUBLIC_DIR, '404.html')
    );
});

// Error handler
app.use((err, req, res, next) => {
    const time = new Date().toISOString();

    console.error(
        `[${time}] ERROR ${req.method} ${req.path}`,
        err
    );

    fs.appendFile(
        LOG_FILE,
        `[${time}] ERROR ${req.method} ${req.path}: ${err.message}\n`,
        () => { }
    );

    if (res.headersSent) {
        return next(err);
    }

    const status = err.status || 500;

    const message =
        status < 500
            ? err.message
            : 'Something went wrong on our end.';

    if (req.path.startsWith('/api/')) {
        return res.status(status).json({
            error: message
        });
    }

    res.status(status).send(
        '<h1>Something went wrong</h1>' +
        '<p>Please try again later.</p>' +
        '<a href="/">Back to home</a>'
    );
});

// Create the admin account from .env if it does not exist
async function ensureAdmin() {
    const existing =
        await db.getUserByUsername(
            process.env.ADMIN_USERNAME
        );

    if (existing) return;

    const passwordHash =
        await bcrypt.hash(
            process.env.ADMIN_PASSWORD,
            12
        );

    await db.addUser({
        username: process.env.ADMIN_USERNAME,
        passwordHash,
        role: 'admin'
    });

    console.log('Created admin account');
}

// Start the server after creating the admin account
ensureAdmin()
    .then(() => {
        app.listen(PORT, () => {
            console.log(
                `Server live on http://localhost:${PORT}`
            );
        });
    })
    .catch((err) => {
        console.error('Could not start server:', err);
        process.exit(1);
    });