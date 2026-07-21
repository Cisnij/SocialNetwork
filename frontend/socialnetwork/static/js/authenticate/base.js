import { RedirectIfNotAuth, logout, authFetch } from "./auth.js";

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

document.getElementById("logoutLink")?.addEventListener("click", async (e) => {
  e.preventDefault();

  try {
    await authFetch("http://localhost:8000/api/auth/web/logout/", {
      method: "POST",
    });
    localStorage.removeItem("accessToken");
    logout();
  } catch (error) {
    // Even if logout fails, clear local state and redirect
    localStorage.removeItem("accessToken");
    logout();
  }
});
