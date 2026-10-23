const registerForm = document.querySelector('#register-form');
const registerMessage = document.querySelector('#register-message');

registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const username = document.querySelector('#username').value;
    const password = document.querySelector('#password').value;
    const confirmPassword = document.querySelector('#confirmPassword').value;

    if (password !== confirmPassword) {
        registerMessage.textContent = 'Passwords do not match.';
        return;
    }

    try {
        const response = await fetch(registerForm.action, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        });

        const data = await response
            .json()
            .catch(() => ({ success: false, error: 'Registration failed.' }));

        if (!response.ok || !data.success) {
            registerMessage.textContent = data.error || 'Registration failed.';
            return;
        }

        registerMessage.textContent = 'Registration successful! Redirecting...';
        registerForm.reset();
        window.location.href = '/guestbook';
    } catch (error) {
        console.error('Registration failed:', error);
        registerMessage.textContent = 'Unable to register right now. Please try again.';
    }
});
