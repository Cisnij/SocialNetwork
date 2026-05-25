import { authFetch } from "../authenticate/auth.js";
import { API, API_BASE_URL } from "./config.js";

const STORAGE_KEY = "fb_darkmode";
const SETTING_ID_KEY = "settingId";

export function isDarkMode() {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function applyDarkMode(on) {
  document.documentElement.classList.toggle("dark", !!on);
  localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

/** Discover setting id + sync darkmode from API (all pages). */
export async function bootstrapTheme() {
  try {
    // Gọi API userSetting để lấy setting của user hiện tại
    const response = await authFetch(API.userSetting());
    if (!response.ok) {
      console.error('Failed to fetch user setting, using localStorage fallback');
      // Nếu API thất bại, sử dụng localStorage
      const localStorageDarkmode = localStorage.getItem(STORAGE_KEY) === "1";
      applyDarkMode(localStorageDarkmode);
      return;
    }
    
    const setting = await response.json();
    
    // Lưu setting ID vào localStorage để sử dụng sau này
    if (setting && setting.id) {
      localStorage.setItem(SETTING_ID_KEY, String(setting.id));
    }
    
    // Áp dụng darkmode từ setting (ưu tiên API)
    if (setting?.darkmode) applyDarkMode(true);
    else if (setting && !setting.darkmode) applyDarkMode(false);
  } catch (error) {
    console.error('Error fetching user setting:', error, 'using localStorage fallback');
    // Nếu có lỗi, sử dụng localStorage
    const localStorageDarkmode = localStorage.getItem(STORAGE_KEY) === "1";
    applyDarkMode(localStorageDarkmode);
  }
}

export async function saveDarkMode(on) {
  // Áp dụng ngay lập tức lên UI và localStorage
  applyDarkMode(on);
  
  const settingId = localStorage.getItem(SETTING_ID_KEY);
  if (!settingId) {
    console.error('No setting ID found, trying to fetch setting first');
    // Nếu không có setting ID, thử fetch lại
    try {
      const response = await authFetch(API.userSetting());
      if (response.ok) {
        const setting = await response.json();
        if (setting && setting.id) {
          localStorage.setItem(SETTING_ID_KEY, String(setting.id));
          // Gọi API để cập nhật
          await updateSettingAPI(setting.id, on);
        }
      }
    } catch (error) {
      console.error('Error fetching setting:', error);
    }
    return;
  }
  
  await updateSettingAPI(settingId, on);
}

async function updateSettingAPI(settingId, darkmode) {
  try {
    const response = await authFetch(API.setting(settingId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ darkmode: darkmode }),
    });
    
    if (response.ok) {
      console.log('Dark mode setting saved successfully to database');
    } else {
      console.error('Failed to save dark mode setting to database');
    }
  } catch (error) {
    console.error('Error saving dark mode setting:', error);
  }
}

export function getSettingId() {
  return localStorage.getItem(SETTING_ID_KEY);
}
