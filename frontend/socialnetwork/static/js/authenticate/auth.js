var accessToken = localStorage.getItem('accessToken');

function getCSRFToken() {
  // Get CSRF token from cookie
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrftoken') {
      return decodeURIComponent(value);
    }
  }
  return null;
}

async function refreshAccessToken() { // hàm này sẽ được gọi khi accessToken hết hạn
  const headers = {
    'Content-Type': 'application/json'
  };
  const csrfToken = getCSRFToken();
  if (csrfToken) {
    headers['X-CSRFToken'] = csrfToken;
  }

  const res = await fetch('http://localhost:8000/api/auth/web/token/refresh/', {
    method: 'POST',
    credentials: 'include', // gửi cookie HTTP-only và dùng refresh đổi access token
    headers: headers
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
  };
  
  // Add CSRF token for state-changing requests (POST, PUT, DELETE, PATCH)
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    const csrfToken = getCSRFToken();
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
  }
  
  // FormData: browser must set multipart boundary — never force Content-Type
  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  return headers;
}

async function authFetch(url, options = {}) { // Web uses cookie authentication
  let res = await fetch(url, {
    ...options,
    headers: buildAuthHeaders(options),
    credentials: 'include',
  });

  if (res.status === 401) { // session expired
    logout();
    throw new Error('Unauthorized');
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

function logout() {
  window.location.href = 'http://localhost:3000/login/';
}

export { refreshAccessToken, authFetch, RedirectIfAuth,RedirectIfNotAuth, logout };
