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

loadMessages();