
## Overview

By the end of this extension, every guestbook entry will have a name, a message, a timestamp and an ID, and your page will be safe from a real attack that works on it right now.

You will practice three things:

- **Structured data:** storing objects instead of plain strings.
- **Server-side validation:** never trusting what the browser sends.
- **Safe rendering:** putting user text on the page without letting it run as code.

Files you will change: `server.js` and `public/guestbook.html`.

## Before you start

1. **Commit your current work** with Git (or copy your project folder) so you can go back if something breaks.
2. **Make sure your server runs** with `npm start` and that you can log in and post a guestbook message.
3. **Open DevTools** in your browser (F12 or right-click, then Inspect). You will use the Console and Network tabs a lot in this extension.

## Part 1: Spot the security hole

Your guestbook currently runs any HTML that someone types into it. Try it on your own server before you fix anything.

1. Log in and go to your guestbook page.
2. Post this message: `<b>Am I bold?</b>`
3. Notice the text shows up **bold**. The browser treated your message as HTML, not as text.
4. Now post this message: `<img src="x" onerror="alert('You have been hacked')">`
5. An alert pops up. Refresh the page and it pops up again, for **every** visitor, forever.

**Why this happens:** your page builds the list with `innerHTML`, which tells the browser "read this string as HTML." A broken image fires its `onerror` code, so an attacker's JavaScript runs in everyone's browser. This attack is called **stored XSS** (Cross-Site Scripting).

An `alert` is harmless, but real attackers use the same trick to steal login sessions or redirect users to fake sites.

**Clean up:** stop your server, delete `guestbook.json`, and restart. We are also changing the data format in Part 2, so the old file needs to go anyway.

> Only test attacks on your own server. Trying this on someone else's site without permission is illegal.

## Part 2: Store entries as objects

Each entry becomes an object with four fields instead of a bare string:

```json
{
  "id": "3b241101-e2bb-4255-8caf-4136c566a962",
  "name": "Maya",
  "msg": "Cool site!",
  "createdAt": "2026-09-28T14:03:12.511Z"
}
```

| Field | Who sets it | Why |
| --- | --- | --- |
| `id` | Server | A unique label so we can delete or edit one entry later |
| `name` | User | Who wrote it |
| `msg` | User | The message itself |
| `createdAt` | Server | When it was posted, as an ISO date string |

The server sets `id` and `createdAt` itself. Never let the browser choose these, or users could fake dates or copy someone else's ID.

**Step 1.** At the top of `server.js`, next to your other `require` lines, add Node's built-in crypto module. No `npm install` is needed.

```js
const crypto = require('crypto');
```

**Step 2.** Replace your `POST /api/guestbook` route with this version:

```js
app.post('/api/guestbook', requireAuth, (req, res) => {
    const { name, msg } = req.body;

    // Validation goes here in Part 3

    const entry = {
        id: crypto.randomUUID(),
        name: name,
        msg: msg,
        createdAt: new Date().toISOString()
    };

    const messages = getGuestbookMessages();
    messages.push(entry);
    fs.writeFileSync(GUESTBOOK_FILE, JSON.stringify(messages.slice(-50), null, 2));

    res.status(201).json(entry);
});
```

Two things changed besides the object:

- **Status 201** means "Created." It is the standard response when a POST makes something new.
- **We send back the new entry** instead of `{ success: true }`, so the frontend could show it right away without asking again.

**Step 3.** Test it before touching the frontend. Log in, then paste this into the browser Console on your site:

```js
fetch('/api/guestbook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test', msg: 'Hello from the console' })
}).then(r => r.json()).then(console.log);
```

You should see your new entry printed, with an `id` and `createdAt`. Open `guestbook.json` and confirm it was saved there too.

## Part 3: Validate on the server

Right now your server saves whatever it receives: an empty name, a 10,000-word message, or even a number instead of text. The server must check every value itself, because anyone can send requests without using your form.

Your rules:

| Field | Rule | Error message |
| --- | --- | --- |
| `name` | Must be text, 1 to 40 characters after trimming spaces | Name must be 1 to 40 characters. |
| `msg` | Must be text, 1 to 280 characters after trimming spaces | Message must be 1 to 280 characters. |

**Step 1.** Add this helper function above your routes, near `getGuestbookMessages`:

```js
// Returns an error message string, or null if the entry is valid
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
```

**Why check `typeof` first?** A JSON body can hold numbers, arrays or objects. If someone sends `{ "name": 5 }`, calling `name.trim()` would crash your route.

**Step 2.** Replace the `// Validation goes here in Part 3` comment in your POST route with:

```js
const error = validateEntry(name, msg);
if (error) {
    return res.status(400).json({ error: error });
}
```

**Step 3.** Save the trimmed values, so `"   Maya   "` is stored as `"Maya"`. Update the entry object:

```js
name: name.trim(),
msg: msg.trim(),
```

**Step 4.** Test each rule from the Console. Each of these should come back with status 400 and your error message:

```js
const send = (body) => fetch('/api/guestbook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
}).then(async r => console.log(r.status, await r.json()));

send({ name: '', msg: 'hi' });              // empty name
send({ name: '     ', msg: 'hi' });         // only spaces
send({ name: 'Maya', msg: 'x'.repeat(300) }); // too long
send({ name: 42, msg: 'hi' });              // not text
send({ msg: 'hi' });                        // missing name
```

One valid request should still come back with 201:

```js
send({ name: 'Maya', msg: 'Validation works!' });
```

## Part 4: Add a name field to the form

In `guestbook.html`, replace your form with this version. Style and arrange it however fits your design.

```html
<form id="guestbook-form">
    <label for="name">Name</label>
    <input id="name" type="text" name="name" maxlength="40" required />

    <label for="msg">Message</label>
    <textarea id="msg" name="msg" maxlength="280" required></textarea>

    <button type="submit">Post</button>
</form>
<p id="form-error" role="alert"></p>
```

What is new:

- A **`<label>`** for each field, linked by `for` and `id`. This helps screen readers, and clicking the label focuses the input.
- **`maxlength`** stops the user from typing past the limit.
- A **`<textarea>`** for the message, since 280 characters is too long for a one-line input.
- A **`#form-error`** paragraph where Part 6 will show errors from the server.

Then update the `fetch` inside your submit handler to send both fields:

```js
body: JSON.stringify({
    name: document.querySelector('#name').value,
    msg: document.querySelector('#msg').value
})
```

> **Watch out:** `e.target.name.value` will not work here. A form element already has its own built-in `name` property, so `e.target.name` gives you the form's name, not your input. Selecting inputs by `id` avoids the clash.

### Think about it: why validate twice?

`required` and `maxlength` already stop bad input in the form. So why did we write server validation in Part 3?

Because the browser belongs to the user, not to you. You already proved this in Part 3 by sending invalid data from the Console, which skipped the form completely. **Frontend validation is for convenience. Server validation is for security.** You always need the server version; the frontend version is a bonus.

## Part 5: Render entries safely

This is the fix for the attack from Part 1. Instead of building an HTML string, you will create each element with JavaScript and fill it with `textContent`.

| Method | How the browser treats the string | Safe for user input? |
| --- | --- | --- |
| `innerHTML` | Reads it as HTML and runs any tags or event handlers | No |
| `textContent` | Shows it as plain text, exactly as typed | Yes |

**Step 1.** Replace your `loadMessages` function with this version:

```js
async function loadMessages() {
    const response = await fetch('/api/guestbook');
    const entries = await response.json();

    const list = document.querySelector('#guestbook-list');
    list.innerHTML = ''; // Clearing with an empty string is safe

    // Newest first: copy the array, then reverse the copy
    [...entries].reverse().forEach(entry => {
        const li = document.createElement('li');

        const name = document.createElement('strong');
        name.textContent = entry.name;

        const date = document.createElement('small');
        date.textContent = new Date(entry.createdAt).toLocaleString();

        const msg = document.createElement('p');
        msg.textContent = entry.msg;

        li.append(name, ' ', date, msg);
        list.append(li);
    });
}
```

Key ideas in this code:

- **`document.createElement('li')`** makes a new, empty element in memory. It is not on the page until you `append` it.
- **`textContent`** is where user text goes. The browser will never run it as code.
- **`new Date(entry.createdAt).toLocaleString()`** turns the stored ISO string into a readable date in the visitor's own time zone.
- **`[...entries].reverse()`** makes a copy first, because `.reverse()` changes the original array.

**Step 2.** Prove the fix works. Post `<img src="x" onerror="alert('hacked')">` again. This time it should appear on the page as plain text, with no alert.

**Rule to remember:** if the text came from a user, it goes in `textContent`, never `innerHTML`. You can still use `innerHTML` for HTML that you wrote yourself.

## Part 6: Show server errors on the page

When the server rejects a post, the user should see why. Right now your submit handler ignores the response completely.

Replace your submit handler with this version:

```js
document.querySelector('#guestbook-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorBox = document.querySelector('#form-error');
    errorBox.textContent = ''; // Clear any old error

    const response = await fetch('/api/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: document.querySelector('#name').value,
            msg: document.querySelector('#msg').value
        })
    });

    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        errorBox.textContent = data.error || 'Something went wrong. Please try again.';
        return; // Stop here, and keep what the user typed
    }

    e.target.reset();
    loadMessages();
});
```

Key ideas:

- **`response.ok`** is `true` for status codes 200 to 299 and `false` for errors like 400 or 401. **`fetch` does not throw on a 400,** so you have to check this yourself.
- On an error we **`return` before `reset()`**, so the user does not lose their message.
- The error text goes in **`textContent`**, following the rule from Part 5.

**Test it:** your form's `maxlength` and `required` will block most bad input, so try a name of only spaces. The browser accepts it, but your server should reject it and your error message should appear.

## Testing checklist

Check off each item before you submit.

- [ ] Posting through the form shows the new entry at the top with name, date and message
- [ ] `guestbook.json` holds objects with `id`, `name`, `msg` and `createdAt`
- [ ] The `<img onerror>` message from Part 1 displays as plain text with no alert
- [ ] `<b>Am I bold?</b>` displays as plain text, not bold
- [ ] A name of only spaces shows your error message on the page
- [ ] All five invalid Console requests from Part 3 return status 400
- [ ] A valid Console request returns status 201 and the new entry
- [ ] After an error, the text you typed is still in the form
- [ ] Logged out, `/api/guestbook` still returns 401

## Stretch goals

Pick one or more once the checklist is done.

1. **Character counter.** Show "143 / 280" under the message box and update it on every keystroke with the `input` event.
2. **Relative times.** Show "5 minutes ago" instead of a full date. Hint: subtract `createdAt` from `Date.now()` to get milliseconds.
3. **Guestbook stats.** Add `guestbookCount` to your `/api/stats` route and display it on your dashboard with a `fetch`.
4. **Handle old data.** Instead of deleting the old file, make `getGuestbookMessages` convert any plain-string entries into objects with the name "Anonymous".
5. **Show the new entry instantly.** The POST route already returns the new entry. Add it to the top of the list from that response instead of calling `loadMessages()` again.

## Looking ahead: databases

What you built here is already shaped like a database table. Later this year you will move this data into PostgreSQL, where each entry object becomes one **row** and each field becomes a **column**.

| Your JSON field | Future database column |
| --- | --- |
| `id` | A unique ID the database creates for you |
| `name` | A text column limited to 40 characters |
| `msg` | A text column limited to 280 characters |
| `createdAt` | A timestamp column the database fills in automatically |

The habits from this extension carry over directly: the server creates IDs and dates, the server validates every value, and user text is always displayed with `textContent`.

## Submit

1. **Commit and push** your changes to the same GitHub repo your Render service uses.
2. **Wait for Render to redeploy,** then run through the testing checklist on your **live** site.
3. **Send your teacher the Render URL.**

> Render's free plan erases `guestbook.json` when the service restarts, so old messages may disappear from your live site. Your code is not broken.

## Grading rubric (10 points)

| Criterion | Points | Full credit | Partial credit |
| --- | --- | --- | --- |
| **Live deployment** | 1 | Render URL submitted, the guestbook works on the live site, and `.env` is not in the GitHub repo | — |
| **Structured entries** | 2 | Each entry is an object with `id`, `name`, `msg` and `createdAt`; the **server** sets `id` and `createdAt`; POST returns `201` with the new entry | 1 pt: entries are objects, but `id` or `createdAt` is missing or comes from the browser |
| **Server validation** | 2 | `validateEntry` rejects missing, non-text, blank and too-long names and messages with `400`, and saves trimmed values | 1 pt: some rules are missing, or blank-after-trimming values are accepted |
| **Form fields** | 1 | Form has labeled name and message fields with `maxlength` limits and a `#form-error` area | — |
| **Safe rendering** | 2 | Entries are built with `createElement` and `textContent`; posting `<img src="x" onerror="alert(1)">` shows plain text with no alert | 1 pt: the message is safe, but another field (like the name) still uses `innerHTML` |
| **Entry display** | 1 | Newest entries appear first, each showing name, readable date and message | — |
| **Error display** | 1 | Server errors appear on the page, and the user's typed text stays in the form | — |
| **Total** | **10** |  |  |

> **Grading tips:** on the live site, post a message with a name of only spaces (should show an error), then post the `<img onerror>` test message (should appear as text with no alert). Together those two tests check validation, error display and safe rendering in under a minute.
Displaying Extension 2 Upgrading the Guestbook.md.