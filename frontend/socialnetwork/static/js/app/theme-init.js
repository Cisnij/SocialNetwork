import { bootstrapTheme } from "../shared/theme.js";

function startTheme() {
  bootstrapTheme();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startTheme, { once: true });
} else {
  startTheme();
}
