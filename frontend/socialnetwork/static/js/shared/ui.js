import { DEFAULT_AVATAR, profileUrl } from "./config.js";

export function showSpinner(container, text = "Đang tải...") {
  const el = document.createElement("div");
  el.className = "text-center py-6 flex flex-col items-center";
  el.innerHTML = `
    <div class="animate-spin h-7 w-7 border-4 border-indigo-500 border-t-transparent rounded-full"></div>
    <p class="text-gray-500 mt-2 text-sm">${text}</p>`;
  container.appendChild(el);
  return el;
}

export function showEmpty(container, message) {
  const p = document.createElement("p");
  p.className =
    "text-center py-10 text-gray-500 bg-white rounded-xl shadow text-sm";
  p.textContent = message;
  container.appendChild(p);
}

export function showError(container, message, onRetry) {
  const box = document.createElement("div");
  box.className = "text-center py-8 text-red-600 text-sm";
  box.textContent = message;
  if (onRetry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "mt-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm";
    btn.textContent = "Thử lại";
    btn.onclick = onRetry;
    box.appendChild(btn);
  }
  container.appendChild(box);
}

export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("vi-VN");
  } catch {
    return "";
  }
}

export function fullName(profile) {
  return `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
    "Người dùng";
}

/** @param {object} profile - ProfileSerializer shape */
export function createUserRow(profile, options = {}) {
  const { subtitle = "", actions = null, href = profileUrl(profile?.id) } =
    options;
  const row = document.createElement("div");
  row.className =
    "flex items-center gap-3 p-3 bg-white rounded-xl shadow-sm hover:shadow transition";

  const link = document.createElement("a");
  link.href = href;
  link.className = "flex items-center gap-3 flex-1 min-w-0";

  const img = document.createElement("img");
  img.src = profile?.picture || DEFAULT_AVATAR;
  img.className = "w-11 h-11 rounded-full object-cover shrink-0";
  img.alt = "";

  const info = document.createElement("div");
  info.className = "min-w-0";
  const name = document.createElement("p");
  name.className = "font-semibold text-gray-800 truncate";
  name.textContent = fullName(profile);
  info.appendChild(name);
  if (subtitle) {
    const sub = document.createElement("p");
    sub.className = "text-xs text-gray-500 truncate";
    sub.textContent = subtitle;
    info.appendChild(sub);
  }
  link.append(img, info);
  row.appendChild(link);
  if (actions) {
    const act = document.createElement("div");
    act.className = "flex gap-2 shrink-0";
    act.appendChild(actions);
    row.appendChild(act);
  }
  return row;
}

export function btn(text, className = "") {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.className =
    className ||
    "px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700";
  return b;
}
