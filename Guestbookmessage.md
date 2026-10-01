
# Guestbook: Shared Messages

Sep 27, 2026 · @Kevin

## Overview

You will build a protected guestbook page where logged-in users read a shared list of messages and post new ones, without the page ever reloading.

This follows a three-part pattern you will use in almost every web app from now on:

| Piece | Where it lives | Job |
| --- | --- | --- |
| **GET route** | `server.js` | Sends the current data as JSON |
| **POST route** | `server.js` | Receives new data and saves it |
| **Frontend script** | `guestbook.html` | Fetches the data and draws it on the page |

The same shape powers a full CRUD API later in the course, so this is a good rehearsal.

Files you will change: `server.js`, and a new `public/guestbook.html`.

## Before you start

1. **Finish the login and "Remember me" steps first.** The guestbook uses your `requireAuth` middleware, so login must already work.
2. **Commit your current work** with Git so you can go back if something breaks.
3. **Confirm `fs` and `path` are required** at the top of `server.js`. You already use them for `server.log`:

```js
const fs = require('fs');
const path = require('path');
```

## Part 1: The data file and helper function

Messages are saved to a file called `guestbook.json`, so they survive when the server restarts. A variable in memory would be wiped every restart.

**Step 1.** Near your other constants (like `LOG_FILE`), add the file path and a helper function that reads it:

```js
const GUESTBOOK_FILE = path.join(__dirname, 'guestbook.json');

function getGuestbookMessages() {
    if (!fs.existsSync(GUESTBOOK_FILE)) return [];
    return JSON.parse(fs.readFileSync(GUESTBOOK_FILE, 'utf8'));
}
```

Key ideas:

- **`path.join(__dirname, ...)`** builds a full path to the file next to `server.js`, and works on both Windows and Mac.
- **`fs.existsSync`** checks whether the file exists yet. The first time your server runs, it does not, so we return an empty array `[]`.
- **`fs.readFileSync(..., 'utf8')`** reads the file as a string.
- **`JSON.parse`** turns that string back into a real JavaScript array.

You do not need to create `guestbook.json` yourself. The POST route in Part 3 creates it the first time someone posts.

## Part 2: GET route that returns messages

This route answers the question "what messages are there?" by sending the whole list as JSON.

**Step 1.** Add this in your ROUTES section:

```js
app.get('/api/guestbook', requireAuth, (req, res) => {
    res.json(getGuestbookMessages());
});
```

Key ideas:

- **`requireAuth`** runs before your route. If the user is not logged in, it sends a `401` and your route never runs.
- **`res.json(...)`** turns the array into JSON text and sends it with the right `Content-Type` header.
- The URL starts with **`/api/`** because it sends data, not a web page. This is a common naming habit.

**Step 2.** Test it. Log in, then visit `http://localhost:3000/api/guestbook` in your browser. You should see `[]`, an empty list, because nobody has posted yet.

## Part 3: POST route that saves a message

This route receives a new message, adds it to the list and saves the list back to the file.

**Step 1.** Add this right below your GET route:

```js
app.post('/api/guestbook', requireAuth, (req, res) => {
    const { msg } = req.body;
    if (!msg) {
        return res.status(400).json({ error: 'Message is required' });
    }
    const messages = getGuestbookMessages();
    messages.push(msg);
    fs.writeFileSync(GUESTBOOK_FILE, JSON.stringify(messages.slice(-50), null, 2));
    res.json({ success: true });
});
```

The route works in four steps:

1. **Read the message** from `req.body`. This works because `express.json()` middleware already parsed the JSON the browser sent.
2. **Reject empty messages** with status `400`, which means "Bad Request: the problem is on your end." The `return` stops the route so nothing gets saved.
3. **Load the current list, add the new message** with `push`.
4. **Save the list back to the file.**

A closer look at the save line:

- **`messages.slice(-50)`** keeps only the 50 newest messages, so the file cannot grow forever.
- **`JSON.stringify(..., null, 2)`** turns the array into JSON text. The `2` adds indentation so the file is easy to read.
- **`fs.writeFileSync`** writes the text to the file, creating it if it does not exist yet.

You cannot test a POST route by typing a URL, because visiting a URL always sends a GET. You will test it through the page in Part 6.

## Part 4: The protected guestbook page

You need two things: a page route that only logged-in users can reach, and the HTML file it serves.

**Step 1.** Add the page route in `server.js`:

```js
app.get('/guestbook', requireAuth, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'guestbook.html'));
});
```

**Why a route and not just the static folder?** Files in `public` are served to anyone. Putting `requireAuth` on a route means logged-out visitors get blocked before the file is sent. Make sure this route sits **above** your `express.static` line, or the static folder will answer first.

> **Heads up:** someone could still type `/guestbook.html` and the static folder would serve the empty page. That is fine here, because the page itself holds no messages. The real protection is `requireAuth` on `/api/guestbook`, which is where the data lives.

**Step 2.** Create `public/guestbook.html` with the list and form. Add your own nav, styles and layout to match the rest of your site:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Guestbook</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <h1>Guestbook</h1>

    <ul id="guestbook-list"></ul>

    <form id="guestbook-form">
        <input type="text" name="msg" placeholder="Leave a message" required />
        <button type="submit">Post</button>
    </form>

    <script>
        // Parts 5 and 6 go here
    </script>
</body>
</html>
```

**Step 3.** Add a Guestbook link to the nav on your other pages, then log in and visit `/guestbook`. You should see the heading and the form, with an empty list.

## Part 5: Load and display messages

The page starts with an empty list. JavaScript asks your GET route for the messages and draws them.

**Step 1.** Inside the `<script>` tag, add:

```js
async function loadMessages() {
    const response = await fetch('/api/guestbook');
    const messages = await response.json();
    document.querySelector('#guestbook-list').innerHTML =
        messages.map(msg => `<li>${msg}</li>`).join('');
}

loadMessages();
```

Reading it line by line:

1. **`fetch('/api/guestbook')`** sends a GET request to your route. The browser includes your session cookie automatically, so `requireAuth` knows you are logged in.
2. **`await response.json()`** reads the response body and turns the JSON back into an array.
3. **`messages.map(...)`** turns each message into an `<li>` string, so `['hi', 'hello']` becomes `['<li>hi</li>', '<li>hello</li>']`.
4. **`.join('')`** glues those strings into one long string.
5. **`innerHTML = ...`** puts that string inside the list.
6. **`loadMessages();`** at the bottom runs the function once when the page first opens.

**Why `async` and `await`?** A network request takes time. `await` pauses this function until the answer arrives, without freezing the rest of the page.

**Step 2.** Refresh `/guestbook`. The list is still empty, but open DevTools, go to the Network tab and refresh again. You should see a request to `guestbook` returning `[]`.

## Part 6: Post new messages without reloading

Normally a form submit reloads the whole page. Instead, you will catch the submit, send the message with `fetch`, and redraw just the list.

**Step 1.** Add this inside the `<script>` tag, above the `loadMessages();` line:

```js
document.querySelector('#guestbook-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    await fetch('/api/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: e.target.msg.value })
    });
    e.target.reset();
    loadMessages(); // refresh the list without reloading the page
});
```

This is the same pattern as your login form:

- **`e.preventDefault()`** stops the browser's normal reload.
- **`method: 'POST'`** sends it to your POST route instead of the GET route.
- **`headers: { 'Content-Type': 'application/json' }`** tells the server the body is JSON, so `express.json()` knows to parse it.
- **`JSON.stringify({ msg: ... })`** packs the message into JSON. The key `msg` must match what the server reads from `req.body`.
- **`e.target`** is the form itself, so `e.target.msg.value` is what the user typed in the input named `msg`.
- **`e.target.reset()`** clears the form, and **`loadMessages()`** redraws the list with the new message included.

**Step 2.** Post a message. It should appear in the list right away, with no page reload. Open `guestbook.json` in your editor and you will see it saved there.

## Testing checklist

Check off each item before you submit.

- [ ] Logged in, `/guestbook` shows your page with the form
- [ ] Posting a message adds it to the list with no page reload
- [ ] The form clears after posting
- [ ] Refreshing the whole page still shows your messages (they are saved to a file, not memory)
- [ ] Restarting the server still shows your messages
- [ ] `guestbook.json` contains your messages as a JSON array
- [ ] Logged out, visiting `/guestbook` is blocked with a `401`
- [ ] Logged out, visiting `/api/guestbook` directly returns a `401`

## Stretch goal: filter bad words

Use the `bad-words` package to clean or reject messages before they are saved.

**Step 1.** Install it, if it is not already in your `package.json`:

```bash
npm install bad-words
```

**Step 2.** Require it at the top of `server.js` and create a filter:

```js
const { Filter } = require('bad-words');
const filter = new Filter();
```

If you get an error like "Filter is not a constructor," check the package's README on npm. The import style has changed between versions.

**Step 3.** In your POST route, before `messages.push(msg)`, choose one approach:

- **Clean it:** replace bad words with asterisks, using `const cleanMsg = filter.clean(msg);` and then push `cleanMsg` instead.
- **Reject it:** if `filter.isProfane(msg)` is `true`, return a `400` with an error message and save nothing.

Be ready to explain which approach you picked and why.

## Submit

Publish your updated code to the web server you already have on Render. Do not create a new service.

1. **Check your `.gitignore`** includes `node_modules` and `.env`, so your secrets never go to GitHub.
2. **Commit and push** your changes to the same GitHub repo your Render service uses.
3. **Wait for Render to redeploy.** Watch the Logs tab until you see your "Server live" message.
4. **Test the live site** using the testing checklist above.
5. **Send your teacher the Render URL.**

> **Note:** on Render's free plan, files written by your server (like `guestbook.json`) are erased whenever the service restarts or redeploys. If your messages disappear, your code is not broken. Fixing this for real is one reason we will move to a database later.
Displaying Guestbook Shared Messages.md.