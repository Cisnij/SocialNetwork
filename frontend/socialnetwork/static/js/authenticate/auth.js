var accessToken = localStorage.getItem('accessToken');

async function refreshAccessToken() { // hàm này sẽ được gọi khi accessToken hết hạn
  const res = await fetch('http://localhost:8000/api/auth/web/token/refresh/', {
    method: 'POST',
    credentials: 'include', // gửi cookie HTTP-only và dùng refresh đổi access token
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error('Refresh token expired');
  }

  const data = await res.json();
  accessToken = data.access;
  localStorage.setItem('accessToken', accessToken);
}

function buildAuthHeaders(options = {}) {
  const headers = {
    ...options.headers,
    Authorization: `Bearer ${accessToken}`,
  };
  // FormData: browser must set multipart boundary — never force Content-Type
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  return headers;
}

async function authFetch(url, options = {}) { // hàm này dùng để sau này fetch cần kiểm tra authentic k, nếu có mới cho post, options dùng để lấy ra method là POST hay GET...
  if (!accessToken) { //chưa đăng nhập
    try {
      await refreshAccessToken();
    } catch (error) {
      logout();
      throw error;
    }
  }
    //có token thì gọi fetch kèm token, nếu fetch lỗi thì token hết hạn và gọi tạo lại token và fetch lần nữa
  let res = await fetch(url, {
    ...options,
    headers: buildAuthHeaders(options),
    credentials: 'include',
  });

  if (res.status === 401) { //hết hạn access
    try {
      await refreshAccessToken();
    } catch (e) {
      logout(); //hết hạn refresh
      throw e;
    }

    res = await fetch(url, {
      ...options,
      headers: buildAuthHeaders(options),
      credentials: 'include',
    });
  }

  return res;
}

function checkLogin() {
  return !!localStorage.getItem('accessToken');
}
function RedirectIfAuth() {
  if (checkLogin()) {
    window.location.href = 'http://localhost:3000/';
  }
}
function RedirectIfNotAuth() {
  if (!checkLogin()) {
    window.location.href = 'http://localhost:3000/login/';
  }
}

export { refreshAccessToken, authFetch, RedirectIfAuth,RedirectIfNotAuth };
