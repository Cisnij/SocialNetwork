/** Apply theme from localStorage before first paint (no network). */
(function applyThemeBoot() {
  try {
    const isDark = localStorage.getItem("fb_darkmode") === "1";
    const root = document.documentElement;
    if (isDark) root.classList.add("dark");
    else root.classList.remove("dark");
    if (document.body) {
      document.body.setAttribute("data-theme", isDark ? "dark" : "light");
    } else {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          document.body.setAttribute("data-theme", isDark ? "dark" : "light");
        },
        { once: true }
      );
    }
  } catch (_) {
    /* ignore private mode / blocked storage */
  }
})();
