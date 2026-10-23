const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');

const status = document.querySelector('#status');
const loginSection = document.querySelector('#login-section');
const logoutButton = document.querySelector('#logout-button');

async function checkAuthState() {
    try {
        const response = await fetch('/api/whoami');
        const data = await response.json();

        if (data.loggedIn) {
            status.textContent = '';

            const heading = document.createElement('h1');
            heading.textContent = `Welcome back, ${data.username}!`;

            const dashboardLink = document.createElement('a');
            dashboardLink.href = '/dashboard';
            dashboardLink.textContent = 'Dashboard';

            status.append(heading, dashboardLink);

            loginSection.hidden = true;
            logoutButton.hidden = false;
        } else {
            status.innerHTML = '<h1>Welcome!</h1>';
            loginSection.hidden = false;
            logoutButton.hidden = true;
        }
    } catch (error) {
        console.error('Auth check failed:', error);

        status.innerHTML = '<h1>Welcome!</h1>';
        loginSection.hidden = false;
        logoutButton.hidden = true;
    }
}

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    loginMessage.textContent = '';

    const username = document.querySelector('#username').value;
    const password = document.querySelector('#password').value;
    const rememberMe = document.querySelector('#rememberMe').checked;

    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                username,
                password,
                rememberMe
            })
        });

        const data = await response
            .json()
            .catch(() => ({}));

        if (!response.ok) {
            loginMessage.textContent =
                data.error || 'Login failed. Please try again.';
            return;
        }

        loginMessage.textContent = 'Login successful!';
        loginForm.reset();

        window.location.href = '/guestbook';
    } catch (error) {
        console.error('Login failed:', error);
        loginMessage.textContent =
            'Unable to log in. Please try again.';
    }
});

checkAuthState();