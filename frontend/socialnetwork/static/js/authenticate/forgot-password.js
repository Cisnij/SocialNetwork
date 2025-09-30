document.getElementById('forgot-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const message = document.getElementById('message');
    message.textContent = '';

    if (!email) {
        message.textContent = 'Please enter your email address.';
        message.classList.add('text-red-500');
        return;
    }

    fetch('http://localhost:8000/api/auth/password/reset/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    })
    .then(response => {
        if (!response.ok) {
          throw new Error('Failed to send reset email.');
        }
        return response.json();
    })
    .then(data => {
        message.textContent = 'Check your email for reset instructions.';
        message.classList.remove('text-red-500');
        message.classList.add('text-green-500');
    })
    .catch(error => {
        message.textContent = error.message;
        message.classList.add('text-red-500');
      });
    });