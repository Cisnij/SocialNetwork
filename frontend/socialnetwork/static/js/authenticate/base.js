import { RedirectIfNotAuth, logout } from "./auth.js";

RedirectIfNotAuth();

function toggleDropdown() {
  const menu = document.getElementById("dropdownMenu");
  menu?.classList.toggle("hidden");
}

document.getElementById("avatarBtn")?.addEventListener("click", toggleDropdown);

document.addEventListener("click", (event) => {
  const avatar = document.getElementById("avatarBtn");
  const dropdown = document.getElementById("dropdownMenu");
  if (!avatar || !dropdown) return;
  if (!avatar.contains(event.target) && !dropdown.contains(event.target)) {
    dropdown.classList.add("hidden");
  }
});

document.getElementById("logoutLink")?.addEventListener("click", (e) => {
  e.preventDefault();
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

    const headers = {};
    const csrfToken = getCSRFToken();
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }

    fetch("http://localhost:8000/api/auth/web/logout/", {
      method: "POST",
      credentials: "include",
      headers: headers,
    }).then(() => {
    localStorage.removeItem("accessToken");
    logout();
  });
});
