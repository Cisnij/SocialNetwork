window.addEventListener('DOMContentLoaded', function () {
  let accessToken = localStorage.getItem('accessToken'); // 👈 Sử dụng localStorage thay vì sessionStorage

  const fetchUser = (token) => {
    return fetch('http://localhost:8000/api/auth/user/', {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      }
    });
  };

  const tryRefresh = () => {
    return fetch('http://localhost:8000/api/token/refresh/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include', // cookie chứa refresh token
      body: JSON.stringify({})
    })
    .then(res => {
      if (!res.ok) throw new Error('Refresh token thất bại');
      return res.json();
    })
    .then(data => {
      accessToken = data.access;
      localStorage.setItem('accessToken', accessToken); // 👈 Lưu accessToken mới vào localStorage
      return fetchUser(accessToken);
    });
  };

  if (!accessToken) {
    window.location.href = '/login';
    return;
  }

  fetchUser(accessToken)
    .then(res => {
      if (res.ok) return res.json();
      if (res.status === 401) return tryRefresh();
      throw new Error('Không xác thực được');
    })
    .then(userData => {
      console.log('Đăng nhập thành công:', userData);
    })
    .catch(err => {
      console.warn('Token không hợp lệ hoặc hết hạn:', err);
      window.location.href = '/login';
    });
});
