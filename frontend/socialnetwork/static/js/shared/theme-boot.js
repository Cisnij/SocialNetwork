// File này chỉ để khởi tạo theme cơ bản trước khi các module khác load
// Logic chính sẽ được xử lý bởi bootstrapTheme() trong theme-init.js
(function () {
  try {
    // Chỉ đọc localStorage để avoid flash of wrong theme
    // Logic chính sẽ được bootstrapTheme() xử lý sau
    const isDark = localStorage.getItem("fb_darkmode") === "1";
    if (isDark) {
      document.documentElement.classList.add("dark");
    }
  } catch (_) {}
})();
