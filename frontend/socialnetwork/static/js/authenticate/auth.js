function getCSRFToken() {
  const cookies = document.cookie.split(";");

  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split("=");

    if (name === "csrftoken") {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function getAccessToken() {
  return localStorage.getItem("accessToken");
}

async function refreshAccessToken() {
  const headers = {
    "Content-Type": "application/json",
  };

  const csrfToken = getCSRFToken();

  if (csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
  }

  const res = await fetch(
    "http://localhost:8000/api/auth/web/token/refresh/",
    {
      method: "POST",
      credentials: "include",
      headers,
    }
  );

  if (!res.ok) {
    throw new Error("Refresh token expired");
  }

  const data = await res.json();

  localStorage.setItem("accessToken", data.access);

  return data.access;
}

function buildAuthHeaders(options = {}) {
  const headers = {
    ...options.headers,
  };

  const accessToken = getAccessToken();

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const method = (options.method || "GET").toUpperCase();

  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrfToken = getCSRFToken();

    if (csrfToken) {
      headers["X-CSRFToken"] = csrfToken;
    }
  }

  if (options.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }

  return headers;
}

async function authFetch(url, options = {}) {
  let res = await fetch(url, {
    ...options,
    headers: buildAuthHeaders(options),
    credentials: "include",
  });

  if (res.status !== 401) {
    return res;
  }

  try {
    await refreshAccessToken();
  } catch (error) {
    logout();
    throw error;
  }

  return fetch(url, {
    ...options,
    headers: buildAuthHeaders(options),
    credentials: "include",
  });
}

function checkLogin() {
  return !!localStorage.getItem("accessToken");
}

function RedirectIfAuth() {
  if (checkLogin()) {
    window.location.href = "http://localhost:3000/";
  }
}

function RedirectIfNotAuth() {
  if (!checkLogin()) {
    window.location.href = "http://localhost:3000/login/";
  }
}

function logout() {
  localStorage.removeItem("accessToken");

  window.location.href = "http://localhost:3000/login/";
}
'Với GET: trả dữ liệu cache ngay để UI hiện nhanh, sau đó âm thầm gọi API lấy dữ liệu mới và cập nhật nếu có thay đổi.\n' +
'Với POST/PUT/DELETE...: không cache, gọi API bình thường.'
async function authFetchCache(url, options = {}, onData) {
  if (options.method && options.method.toUpperCase() !== "GET") {
    const res = await authFetch(url, options);
    if (res.ok) {
      const data = await res.json();
      if (onData) onData(data, false);
    }
    return res;
  }

  const cacheKey = `authCache_${url}`;
  const cachedData = sessionStorage.getItem(cacheKey);

  if (cachedData && onData) {
    try {
      const parsed = JSON.parse(cachedData);
      onData(parsed, true);
    } catch (e) {
      console.error("Cache parse error", e);
    }
  }

  try {
    const res = await authFetch(url, options);
    if (res.ok) {
      const data = await res.json();
      const newDataStr = JSON.stringify(data);
      if (newDataStr !== cachedData) {
        sessionStorage.setItem(cacheKey, newDataStr);
        if (onData) onData(data, false);
      }
    }
    return res;
  } catch (error) {
    console.error("Background fetch failed", error);
    throw error;
  }
}

export {
  refreshAccessToken,
  authFetch,
  authFetchCache,
  RedirectIfAuth,
  RedirectIfNotAuth,
  logout,
};