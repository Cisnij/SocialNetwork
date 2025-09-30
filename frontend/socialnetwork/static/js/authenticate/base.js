import { RedirectIfNotAuth } from './auth.js';
RedirectIfNotAuth();
function toggleDropdown() {
    const menu = document.getElementById("dropdownMenu");
    menu.classList.toggle("hidden");
  }

  document.getElementById("avatarBtn").addEventListener("click", toggleDropdown);

  // Đóng menu khi click ra ngoài
  document.addEventListener("click", function (event) {
    const avatar = document.getElementById("avatarBtn");
    const dropdown = document.getElementById("dropdownMenu");
    if (!avatar.contains(event.target) && !dropdown.contains(event.target)) {
      dropdown.classList.add("hidden");
    }
  });

  //logout
const logoutLink = document.getElementById("logoutLink");
logoutLink.addEventListener('click', (e) => {
    e.preventDefault();
    fetch('http://localhost:8000/api/auth/web/logout/', {
      method: 'POST',
      credentials: 'include'
    })
    .then(() => {
      localStorage.removeItem('accessToken');
      window.location.href = '/login';
    });
});
