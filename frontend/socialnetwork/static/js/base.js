function toggleDropdown() {
    const menu = document.getElementById("dropdownMenu");
    menu.classList.toggle("hidden");
  }

  document.addEventListener("click", function (event) {
    const avatar = document.getElementById("avatarBtn");
    const dropdown = document.getElementById("dropdownMenu");
    if (!avatar.contains(event.target) && !dropdown.contains(event.target)) {
      dropdown.classList.add("hidden");
    }
  });



