


async function deleteEntry(id) {
    if (!confirm('Delete this message?')) return;
    const listError = document.querySelector('#list-error');

    try {
        const response = await fetch(`/api/guestbook/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            listError.textContent = data.error || 'Could not delete that message.';
            return;
        }
        loadMessages();
    } catch (err) {
        listError.textContent = 'Could not reach the server. Check your connection.';
    }
}

async function saveEdit(entry, newMsg) {
    const listError = document.querySelector('#list-error');

    try {
        const response = await fetch(`/api/guestbook/${encodeURIComponent(entry.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: entry.name, msg: newMsg })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            listError.textContent = data.error || 'Could not save your changes.';
            return;
        }
        loadMessages();
    } catch (err) {
        listError.textContent = 'Could not reach the server. Check your connection.';
    }
}

async function deleteEntry(id) {
    if (!confirm('Delete this message?')) return;
    const listError = document.querySelector('#list-error');

    try {
        const response = await fetch(`/api/guestbook/${encodeURIComponent(id)}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            listError.textContent = data.error || 'Could not delete that message.';
            return;
        }
        loadMessages();
    } catch (err) {
        listError.textContent = 'Could not reach the server. Check your connection.';
    }
}

async function saveEdit(entry, newMsg) {
    const listError = document.querySelector('#list-error');

    try {
        const response = await fetch(`/api/guestbook/${encodeURIComponent(entry.id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: entry.name, msg: newMsg })
        });
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            listError.textContent = data.error || 'Could not save your changes.';
            return;
        }
        loadMessages();
    } catch (err) {
        listError.textContent = 'Could not reach the server. Check your connection.';
    }
}

function startEdit(li, entry) {
    li.innerHTML = ''; // clearing with an empty string is safe

    const textarea = document.createElement('textarea');
    textarea.value = entry.msg; // .value is safe, like textContent
    textarea.maxLength = 280;

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => saveEdit(entry, textarea.value));

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', loadMessages);

    if (entry.updatedAt) {
        const edited = document.createElement('small');
        edited.textContent = ' (edited)';
        li.append(edited);
    }

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Edit';
    editButton.addEventListener('click', () => startEdit(li, entry));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', () => deleteEntry(entry.id));

    li.append(editButton, deleteButton);
    li.append(textarea, saveButton, cancelButton);
    textarea.focus();
}

async function loadMessages() {
    const listError = document.querySelector('#list-error');
    listError.textContent = '';

    try {
        const response = await fetch('/api/guestbook');
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            listError.textContent = data.error || 'Could not load messages.';
            return;
        }

        // ...your existing code that clears the list and adds each entry from data...
    } catch (err) {
        listError.textContent = 'Could not reach the server. Check your connection.';
    }


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
    errorBox.textContent = '';

    try {
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
            return; // keep what the user typed
        }
    } catch (err) {
        errorBox.textContent = 'Could not reach the server. Check your connection.';
        return;
    }


    e.target.reset();
    loadMessages();
});

function startEdit(li, entry) {
    li.innerHTML = ''; // clearing with an empty string is safe

    const textarea = document.createElement('textarea');
    textarea.value = entry.msg; // .value is safe, like textContent
    textarea.maxLength = 280;

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => saveEdit(entry, textarea.value));

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', loadMessages);


    li.append(textarea, saveButton, cancelButton);
    textarea.focus();
}

loadMessages();