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
      credentials:'include',
      body: JSON.stringify({ uid, token, new_password1, new_password2 })
    })
    .then(async res => {
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        console.error("Không thể parse JSON:", err);
      }

      if (res.ok) {
        msg.textContent = 'Password reset successful';
        msg.classList.remove('text-red-500');
        msg.classList.add('text-green-500');
        form.reset();
        setTimeout(() => {
          window.location.href = 'http://localhost:3000/reset-password-done/';
        }, 1000);
      } else {
        let message = '';
        for (let field in data) {
          message += data[field].join(',') + '\n';
        }
        msg.textContent = message.trim() || 'Đã có lỗi';
        msg.classList.remove('text-green-500');
        msg.classList.add('text-red-500');
      }
    })
  });
});
