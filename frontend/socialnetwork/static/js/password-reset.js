 document.addEventListener('DOMContentLoaded', () => {
      const form = document.getElementById('reset-form');
      const msg = document.getElementById('message');

      const params = new URLSearchParams(window.location.search);
      const uid = params.get('uid');
      const token = params.get('token');

      if (!uid || !token) {
        msg.textContent = 'Invalid reset link.';
        msg.classList.add('text-red-500');
        form.classList.add('hidden');
        return;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();
        msg.textContent = '';

        const new_password1 = document.getElementById('new-password1').value;
        const new_password2 = document.getElementById('new-password2').value;

        if (new_password1 !== new_password2) {
          msg.textContent = 'Passwords do not match.';
          msg.classList.add('text-red-500');
          return;
        }

        fetch('http://localhost:8000/api/auth/password/reset/confirm/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid, token, new_password1, new_password2 })
        })
        .then(res => {
          if (!res.ok) throw new Error('Reset failed');
          return res.json();
        })
        .then(data => {
          msg.textContent = 'Password reset successful!';
          msg.classList.remove('text-red-500');
          msg.classList.add('text-green-500');
          form.reset();
        })
        .catch(err => {
            if (err && err.new_password2) {
                msg.innerHTML = err.new_password2.map(line => `• ${line}`).join('<br>');
            } else {
                msg.textContent = 'Reset failed. Link may be expired.';
            }
            msg.classList.remove('text-green-500');
            msg.classList.add('text-red-500');
        });
    });
});