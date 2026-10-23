require('dotenv').config();

const REQUIRED_ENV = ['SESSION_SECRET', 'NASA_API_KEY', 'ADMIN_USERNAME', 'ADMIN_PASSWORD'];

for (const name of REQUIRED_ENV) {
    if (!process.env[name]) {
        console.error(`Missing ${name} in .env (or in Render's Environment settings)`);
        process.exit(1);
    }
}

const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');


const fs = require('fs');
const path = require('path');
const { Filter } = require('bad-words');
const { error } = require('console');

const filter = new Filter();
const app = express();
const crypto = require('crypto');
const helmet = require('helmet');
const apodCache = new Map();
const db = require('./db');
const TODAY_MAX_AGE = 60 * 60 * 1000; // 1 hour in milliseconds
const MAX_CACHE_SIZE = 100;


// Trust the X-Forwarded-For header set by hosts like Render, so the rate
// limiter sees each visitor's real IP instead of the proxy's
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(helmet());

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            'img-src': ["'self'", 'data:', 'https://assets.science.nasa.gov'],
            'script-src': ["'self'", 'https://cdn.jsdelivr.net']
        }
    }
}));

const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOG_FILE = path.join(__dirname, 'server.log');

let visitorCount = 0;

// Trim the log file if it's gotten too big
if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 128 * 128) {
    const recentLines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-10);
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
    if (date === undefined) return null; // no date means today

    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return 'Date must look like YYYY-MM-DD.';
    }

    // new Date() quietly rolls Feb 30 over to Mar 2, so convert it
    // back to text and check that it did not change
    const parsed = new Date(date + 'T00:00:00Z');
    if (isNaN(parsed) || parsed.toISOString().slice(0, 10) !== date) {
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

function validateCredentials(username, password) {
    if (typeof username !== 'string' || typeof password !== 'string') {
        return { error: 'Username and password are required.' };
    }

    const normalizedUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,20}$/.test(normalizedUsername)) {
        return { error: 'Username must be 3-20 characters using lowercase letters, numbers, or underscores.' };
    }

    if (password.length < 8 || password.length > 72) {
        return { error: 'Password must be 8-72 characters.' };
    }

    return { username: normalizedUsername, password };
}

function startSession(req, user, rememberMe) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((error) => {
            if (error) return reject(error);

            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.role = user.role;

            if (rememberMe) {
                req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
            }

            resolve();
        });
    });
}

const GUESTBOOK_FILE = path.join(__dirname, 'guestbook.json');

function getGuestbookMessages() {
    if (!fs.existsSync(GUESTBOOK_FILE)) return [];
    return JSON.parse(fs.readFileSync(GUESTBOOK_FILE, 'utf8'));
}

// ==========================================
// MIDDLEWARE SETUP
// Each function below runs on every request, then calls next() to pass
// it along - like a checkpoint before your routes.
// ==========================================

// Parse incoming POST form data (from <form> submissions) and JSON bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Logs every request to the console and to server.log
app.use((req, res, next) => {
    const logLine = `[${new Date().toISOString()}] ${req.method} ${req.path}\n`;
    console.log(logLine.trim());
    fs.appendFile(LOG_FILE, logLine, (err) => {
        if (err) console.error('Log write failed:', err);
    });
    next();
});

// Rate limiter - blocks an IP with a 429 response if it sends too many
// requests within the time window
const limiter = rateLimit({
    windowMs: 10 * 1000,
    limit: 100,
    message: { error: 'Too many requests. Please wait 10 seconds.' }
});

app.use(limiter);

const spaceLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 10,           // 10 lookups per minute, per visitor
    message: { error: 'Too many space lookups. Please wait a minute.' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' }
});

// Tracks logged-in users via a signed cookie - the browser sends it back
// automatically, no frontend code needed. Requires SESSION_SECRET in .env.
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

// Route guard - use this on any route that should require login.
// Example: app.get('/dashboard', requireAuth, (req, res) => { ... });
function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Please log in first.' });
    }
    next();
}

function requireLoginPage(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    next();
}

function requireAdminPage(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/');
    }
    if (req.session.role !== 'admin') {
        return res.status(403).send('<h1>Forbidden</h1><p>Admin access required.</p><a href="/">Back to home</a>');
    }
    next();
}

// ==========================================
// ROUTES
// Fill these in! Example routes are shown below.
// ==========================================

app.get('/api/hello', (req, res) => {
    res.json({ message: 'Hello, world!' });
});

app.get('/guestbook', requireLoginPage, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'guestbook.html'));
})

// READ ALL
app.get('/api/guestbook', requireAuth, async (req, res) => {
    const entries = await db.getAllEntries();
    res.json(entries);
});

app.get('/api/guestbook/:id', requireAuth, async (req, res) => {
    const entry = await db.getEntryById(req.params.id);
    if (!entry) {
        return res.status(404).json({ error: 'Entry not found.' });
    }
    res.json(entry);
});

// DELETE
app.delete('/api/guestbook/:id', requireAuth, async (req, res) => {
    const deleted = await db.deleteEntry(req.params.id);
    if (!deleted) {
        return res.status(404).json({ error: 'Entry not found.' });
    }
    res.status(204).end();
});


app.put('/api/guestbook/:id', requireAuth, async (req, res) => {
    const { name, msg } = req.body;
    const error = validateEntry(name, msg);
    if (error) {
        return res.status(400).json({ error });
    }

    const updated = await db.updateEntry(req.params.id, {
        name: name.trim(),
        msg: msg.trim()
    });
    if (!updated) {
        return res.status(404).json({ error: 'Entry not found.' });
    }
    res.json(updated);
});

// CREATE
app.post('/api/guestbook', requireAuth, async (req, res) => {
    const { name, msg } = req.body;
    const error = validateEntry(name, msg);
    if (error) {
        return res.status(400).json({ error });
    }

    if (filter.isProfane(msg)) {
        return res.status(400).json({ error: 'Please keep your message friendly.' });
    }

    const entry = await db.addEntry({ name: name.trim(), msg: msg.trim() });
    res.status(201).json(entry);
});

app.get('/api/space', spaceLimiter, async (req, res) => {
    const { date } = req.query;

    const cacheKey = date || 'today';
    const cached = apodCache.get(cacheKey);
    const isFresh = cacheKey !== 'today' || Date.now() - cached?.savedAt < TODAY_MAX_AGE;

    if (cached && isFresh) {
        console.log('Cache hit:', cacheKey);
        return res.json(cached.data);
    }

    const dateError = validateApodDate(date);
    if (dateError) {
        return res.status(400).json({ error: dateError });
    }

    // NASA has one address for the latest pictures, and another for one day.
    // The one-day address uses the date as YYMMDD: 2025-07-04 becomes 250704
    let address = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic/';
    if (date) {
        const shortDate = date.slice(2).replaceAll('-', '');
        address = address + shortDate;
    }

    // Add the secret key on the server
    const nasaUrl = new URL(address);
    nasaUrl.searchParams.set('api_key', process.env.NASA_API_KEY);

    let nasaResponse;
    try {
        // Give up if NASA takes longer than 8 seconds
        nasaResponse = await fetch(nasaUrl, { signal: AbortSignal.timeout(8000) });
    } catch (err) {
        return res.status(502).json({ error: 'Could not reach NASA. Try again later.' });
    }

    if (nasaResponse.status === 404) {
        return res.status(404).json({ error: 'NASA has no picture for that date.' });
    }
    if (!nasaResponse.ok) {
        console.error('NASA error:', nasaResponse.status);
        return res.status(502).json({ error: 'NASA could not send a picture right now.' });
    }

    const data = await nasaResponse.json();

    // With a date, NASA sends one picture. Without one, it sends a list,
    // and the first item is the newest.
    const picture = Array.isArray(data) ? data[0] : data;

    const result = {
        title: picture.title,
        date: picture.date,
        imageUrl: picture.hdurl,
        description: picture.alt,
        nasaPage: picture.permalink
    };

    apodCache.set(cacheKey, { data: result, savedAt: Date.now() });

    // Too many entries? Remove the oldest one (a Map remembers insertion order)
    if (apodCache.size > MAX_CACHE_SIZE) {
        const oldestKey = apodCache.keys().next().value;
        apodCache.delete(oldestKey);
    }

    res.json(result);
});

// Exposes the visitor count as JSON, e.g. for a frontend script to display
app.get('/api/stats', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ visitorCount });
});

app.post('/register', authLimiter, async (req, res, next) => {
    try {
        const { username, password, rememberMe } = req.body;
        const validated = validateCredentials(username, password);

        if (validated.error) {
            return res.status(400).json({ success: false, error: validated.error });
        }

        const existing = await db.getUserByUsername(validated.username);
        if (existing) {
            return res.status(409).json({ success: false, error: 'That username is already taken.' });
        }

        const passwordHash = await bcrypt.hash(validated.password, 12);
        const user = await db.addUser({
            username: validated.username,
            passwordHash,
            role: 'user'
        });

        await startSession(req, user, Boolean(rememberMe));
        return res.status(201).json({ success: true, redirect: '/guestbook' });
    } catch (error) {
        next(error);
    }
});

app.post('/login', authLimiter, async (req, res, next) => {
    try {
        const { username, password, rememberMe } = req.body;
        const validated = validateCredentials(username, password);

        if (validated.error) {
            return res.status(400).json({ success: false, error: validated.error });
        }

        const user = await db.getUserByUsername(validated.username);
        const validPassword = user
            ? await bcrypt.compare(validated.password, user.passwordHash)
            : false;

        if (!user || !validPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password.'
            });
        }

        await startSession(req, user, Boolean(rememberMe));
        return res.status(200).json({
            success: true,
            redirect: user.role === 'admin' ? '/dashboard' : '/guestbook'
        });
    } catch (error) {
        next(error);
    }
});

app.post('/logout', (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                success: false,
                error: 'Logout failed'
            });
        }

        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// Example protected route - try visiting this without logging in first
app.get('/dashboard', requireLoginPage, requireAdminPage, (req, res) => {
    // res.send('<h1>Dashboard</h1><p>You are logged in!</p>');
    res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

// Example: run code (logging, a counter, etc.) before serving a page from /public
app.get('/projects', (req, res) => {
    visitorCount++;
    console.log(`Visit #${visitorCount}: someone viewed the projects pagne`);
    res.sendFile(path.join(PUBLIC_DIR, 'projects.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'about.html'));
});

app.get('/api/whoami', (req, res) => {
    if (!req.session.userId) {
        return res.json({ loggedIn: false });
    }

    res.json({
        loggedIn: true,
        userId: req.session.userId,
        username: req.session.username,
        role: req.session.role
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// app.post('/your-route-here', (req, res) => {

// });

// ==========================================
// STATIC FILES
// Serves everything in /public (put this AFTER your routes)
// `extensions: ['html']` lets /projects find projects.html without the extension
// ==========================================
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

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

app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

app.use((err, req, res, next) => {
    // Full details go to YOU, in the console and the log file
    const time = new Date().toISOString();
    console.error(`[${time}] ERROR ${req.method} ${req.path}`, err);
    fs.appendFile(LOG_FILE, `[${time}] ERROR ${req.method} ${req.path}: ${err.message}\n`, () => { });

    // If a response already started sending, let Express finish up
    if (res.headersSent) return next(err);

    // Errors with a status under 500 are the user's fault and safe to explain.
    // Anything else is our fault, so hide the details.
    const status = err.status || 500;
    const message = status < 500 ? err.message : 'Something went wrong on our end.';

    if (req.path.startsWith('/api/')) {
        return res.status(status).json({ error: message });
    }
    res.status(status).send('<h1>Something went wrong</h1><p>Please try again later.</p><a href="/">Back to home</a>');
});



async function ensureAdmin() {
    const validation = validateCredentials(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD);
    if (validation.error) {
        throw new Error(`Invalid ADMIN credentials: ${validation.error}`);
    }

    const existingAdmin = await db.getUserByUsername(validation.username);
    if (existingAdmin) return;

    const passwordHash = await bcrypt.hash(validation.password, 12);
    await db.addUser({
        username: validation.username,
        passwordHash,
        role: 'admin'
    });
}

ensureAdmin()
    .then(() => {
        app.listen(PORT, () => console.log(`Server live on http://localhost:${PORT}`));
    })
    .catch((error) => {
        console.error('Startup failed:', error);
        process.exit(1);
    });