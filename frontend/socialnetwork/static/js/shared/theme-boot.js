/** Sync theme from localStorage before paint (no API). */
(function () {
  try {
    const isDark = localStorage.getItem("fb_darkmode") === "1";
    const root = document.documentElement;
    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    document.body?.setAttribute("data-theme", isDark ? "dark" : "light");
  } catch (_) {}
})();
