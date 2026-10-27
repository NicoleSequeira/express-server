const guestbookForm = document.querySelector('#guestbook-form');
const guestbookList = document.querySelector('#guestbook-list');
const formError = document.querySelector('#form-error');
const listError = document.querySelector('#list-error');

let currentUser = null;

async function deleteEntry(id) {
    if (!confirm('Delete this message?')) return;

    listError.textContent = '';

    try {
        const response = await fetch(
            `/api/guestbook/${encodeURIComponent(id)}`,
            {
                method: 'DELETE'
            }
        );

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            listError.textContent =
                data.error || 'Could not delete that message.';
            return;
        }

        loadMessages();
    } catch (error) {
        listError.textContent =
            'Could not reach the server. Check your connection.';
    }
}

async function saveEdit(entry, newMsg) {
    listError.textContent = '';

    try {
        const response = await fetch(
            `/api/guestbook/${encodeURIComponent(entry.id)}`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ msg: document.querySelector('#msg').value })
            }
        );

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            listError.textContent =
                data.error || 'Could not save your changes.';
            return;
        }

        loadMessages();
    } catch (error) {
        listError.textContent =
            'Could not reach the server. Check your connection.';
    }
}

function startEdit(li, entry) {
    li.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.value = entry.msg;
    textarea.maxLength = 280;
    textarea.required = true;

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => {
        saveEdit(entry, textarea.value);
    });

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', loadMessages);

    li.append(textarea, saveButton, cancelButton);
    textarea.focus();
}

function createEntryElement(entry) {
    const li = document.createElement('li');

    const name = document.createElement('strong');
    name.textContent = entry.name;

    const date = document.createElement('small');
    date.textContent = ` ${new Date(entry.createdAt).toLocaleString()}`;

    const message = document.createElement('p');
    message.textContent = entry.msg;

    li.append(name, date, message);

    if (entry.updatedAt) {
        const edited = document.createElement('small');
        edited.textContent = ' (edited)';
        li.append(edited);
    }

    const canEdit =
        entry.authorId === currentUser.userId ||
        currentUser.role === 'admin';

    if (canEdit) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.textContent = 'Edit';
        editButton.addEventListener('click', () => {
            startEdit(li, entry);
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => {
            deleteEntry(entry.id);
        });

        li.append(editButton, deleteButton);
    }

    return li;
}

async function loadMessages() {

    if (!currentUser) {
        currentUser = await (await fetch('/api/whoami')).json();
    }

    listError.textContent = '';

    try {
        const response = await fetch('/api/guestbook');
        const data = await response.json().catch(() => []);

        if (!response.ok) {
            listError.textContent =
                data.error || 'Could not load messages.';
            return;
        }

        guestbookList.innerHTML = '';

        [...data].reverse().forEach((entry) => {
            guestbookList.append(createEntryElement(entry));
        });
    } catch (error) {
        listError.textContent =
            'Could not reach the server. Check your connection.';
    }
}

guestbookForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    formError.textContent = '';

    const messageInput = document.querySelector('#msg');
    const msg = messageInput.value.trim();

    try {
        const response = await fetch('/api/guestbook', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ msg: document.querySelector('#msg').value })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            formError.textContent =
                data.error || 'Could not post your message.';
            return;
        }

        guestbookForm.reset();
        await loadMessages();
    } catch (error) {
        formError.textContent =
            'Could not reach the server. Check your connection.';
    }
});

loadMessages();