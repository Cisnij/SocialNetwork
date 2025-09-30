  window.addEventListener('DOMContentLoaded', function () {
    const query = new URLSearchParams(window.location.search);
    const code = query.get('code');

    if (!code) {
      alert('Google login failed: no code');
      window.location.href = '/login';
      return;
    }

    fetch('http://localhost:8000/api/auth/web/google/login/', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: code,
        redirect_uri: "http://localhost:3000/google/callback/" // phải khớp với URI đã cấu hình trong Google
      })
    })
    .then(res => {
      if (!res.ok) throw new Error('Google auth failed');
      return res.json();
    })
    .then(data => {
      if (data.access) {
        localStorage.setItem('accessToken', data.access);
        window.location.href = 'http://localhost:3000/';
      } else {
        throw new Error('No token returned');
      }
    })
    .catch(err => {
      console.error(err);
      alert('Google login error');
      window.location.href = '/login';
    });
  });
