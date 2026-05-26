import { authFetch } from "../authenticate/auth.js";
import { API } from "./config.js";

const STORAGE_KEY = "fb_darkmode";
const SETTING_ID_KEY = "settingId";
const HEAL_SESSION_KEY = "fb_darkmode_heal_attempted";

let bootstrapPromise = null;
let saveInFlight = null;

export function parseDarkmode(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function isDarkMode() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Apply dark/light on <html> and persist to localStorage. */
export function applyDarkMode(on) {
  const enabled = !!on;
  const root = document.documentElement;
  if (enabled) root.classList.add("dark");
  else root.classList.remove("dark");
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch (_) {}
  if (document.body) {
    document.body.setAttribute("data-theme", enabled ? "dark" : "light");
  }
  root.dispatchEvent(
    new CustomEvent("fb-theme-change", { detail: { dark: enabled } })
  );
}

export function invalidateThemeCache() {
  bootstrapPromise = null;
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY && e.newValue != null) {
      applyDarkMode(e.newValue === "1");
    }
  });
}

/**
 * Load theme for every app page:
 * 1) Apply localStorage immediately (no flash).
 * 2) Sync from GET /api/user/setting/ when logged in.
 */
export function bootstrapTheme() {
  if (bootstrapPromise) return bootstrapPromise;

  applyDarkMode(isDarkMode());

  bootstrapPromise = (async () => {
    try {
      const res = await authFetch(API.userSetting());
      if (!res.ok) return null;

      const setting = await res.json();
      if (setting?.id != null) {
        localStorage.setItem(SETTING_ID_KEY, String(setting.id));
      }

      const apiDark = parseDarkmode(setting?.darkmode);
      const localDark = isDarkMode();

      if (apiDark) {
        applyDarkMode(true);
        return setting;
      }

      if (localDark && !apiDark) {
        applyDarkMode(true);
        if (!sessionStorage.getItem(HEAL_SESSION_KEY)) {
          sessionStorage.setItem(HEAL_SESSION_KEY, "1");
          saveDarkMode(true).catch(() => {});
        }
        return setting;
      }

      applyDarkMode(false);
      return setting;
    } catch {
      applyDarkMode(isDarkMode());
      return null;
    }
  })();

  return bootstrapPromise;
}

/** PATCH darkmode to server; always updates DOM + localStorage first. */
export async function saveDarkMode(on) {
  const wantDark = !!on;
  applyDarkMode(wantDark);
  sessionStorage.removeItem(HEAL_SESSION_KEY);

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
      body: JSON.stringify({ darkmode: wantDark }),
    });
    if (!patchRes.ok) {
      const err = await patchRes.json().catch(() => ({}));
      throw new Error(err.detail || err.error || "save failed");
    }

    const updated = await patchRes.json().catch(() => ({}));
    applyDarkMode(parseDarkmode(updated.darkmode ?? wantDark));
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
