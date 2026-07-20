  window.addEventListener('DOMContentLoaded', function () {
    const query = new URLSearchParams(window.location.search);
    const code = query.get('code');

    if (!code) {
      alert('Google login failed: no code');
      window.location.href = '/login';
      return;
    }

    // Get CSRF token
    const getCSRFToken = () => {
      const cookies = document.cookie.split(';');
      for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'csrftoken') {
          return decodeURIComponent(value);
        }
      }
      return null;
    };

    const headers = { 
      'Content-Type': 'application/json',
    };
    const csrfToken = getCSRFToken();
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }

    fetch('https://api.socialnetwork.dpdns.org/api/auth/web/google/login/', {
      method: 'POST',
      credentials: 'include',
      headers: headers,
      body: JSON.stringify({
        code: code,
        redirect_uri: "https://socialnetwork.dpdns.org/google/callback/" // phải khớp với URI đã cấu hình trong Google
      })
    })
    .then(res => {
      if (!res.ok) throw new Error('Google auth failed');
      return res.json();
    })
    .then(data => {
      if (data.access) {
        localStorage.setItem('accessToken', data.access);
        window.location.href = 'https://socialnetwork.dpdns.org/';
      } else {
        throw new Error('No token returned');
      }
    })
    .catch(err => {
      console.error(err);
      alert('Lỗi đăng nhập google hoặc đây là tài khoản phụ đã xác thực');
      window.location.href = '/login';
    });
  });


