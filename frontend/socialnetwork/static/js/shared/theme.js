import { authFetch } from "../authenticate/auth.js";
import { API } from "./config.js";

const STORAGE_KEY = "fb_darkmode";
const SETTING_ID_KEY = "settingId";

let bootstrapPromise = null;
let saveInFlight = null;

export function parseDarkmode(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function isDarkMode() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

/** Apply dark/light immediately (no API). */
export function applyDarkMode(on) {
  const enabled = !!on;
  const root = document.documentElement;
  if (enabled) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  document.body?.setAttribute("data-theme", enabled ? "dark" : "light");
}

export function invalidateThemeCache() {
  bootstrapPromise = null;
}

/**
 * Load user setting once per page load (deduped). API wins over localStorage.
 */
export function bootstrapTheme() {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      const res = await authFetch(API.userSetting());
      if (!res.ok) {
        applyDarkMode(isDarkMode());
        return null;
      }
      const setting = await res.json();
      if (setting?.id != null) {
        localStorage.setItem(SETTING_ID_KEY, String(setting.id));
      }
      const dark = parseDarkmode(setting?.darkmode);
      applyDarkMode(dark);
      return setting;
    } catch {
      applyDarkMode(isDarkMode());
      return null;
    }
  })();

  return bootstrapPromise;
}

/** Persist dark mode to API; always refresh setting id from GET first. */
export async function saveDarkMode(on) {
  applyDarkMode(on);

  if (saveInFlight) {
    try {
      await saveInFlight;
    } catch (_) {}
  }

  saveInFlight = (async () => {
    const getRes = await authFetch(API.userSetting());
    if (!getRes.ok) throw new Error("cannot load setting");
    const setting = await getRes.json();
    const settingId = setting.id;
    if (settingId == null) throw new Error("no setting id");

    localStorage.setItem(SETTING_ID_KEY, String(settingId));

    const patchRes = await authFetch(API.setting(settingId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ darkmode: !!on }),
    });
    if (!patchRes.ok) {
      const err = await patchRes.json().catch(() => ({}));
      throw new Error(err.detail || err.error || "save failed");
    }

    const updated = await patchRes.json().catch(() => ({}));
    const savedDark = parseDarkmode(updated.darkmode ?? on);
    applyDarkMode(savedDark);
    invalidateThemeCache();
  })();

  try {
    await saveInFlight;
  } finally {
    saveInFlight = null;
  }
}

export function getSettingId() {
  return localStorage.getItem(SETTING_ID_KEY);
}
