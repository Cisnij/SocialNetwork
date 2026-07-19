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
    "text-center py-10 text-gray-500 dark:text-[#b0b3b8] bg-white dark:bg-[#242526] rounded-xl shadow text-sm";
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

/** Relative time for posts: giây/phút/giờ/ngày/tuần trước; từ ~28 ngày hiển thị ngày tháng. */
export function formatRelativeTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const sec = Math.floor((now - date) / 1000);
  if (sec < 5) return "Vừa xong";
  if (sec < 60) return `${sec} giây trước`;

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;

  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} giờ trước`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;

  if (days < 28) {
    const weeks = Math.max(1, Math.floor(days / 7));
    return `${weeks} tuần trước`;
  }

  const opts = { day: "numeric", month: "short" };
  if (date.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return date.toLocaleDateString("vi-VN", opts);
}

/** Shared Tailwind classes for dark mode consistency */
export const cls = {
  card: "bg-white dark:bg-[#242526]",
  cardBorder: "bg-white dark:bg-[#242526] border border-gray-200 dark:border-[#3e4042]",
  text: "text-gray-900 dark:text-[#e4e6eb]",
  textMuted: "text-gray-500 dark:text-[#b0b3b8]",
  textSub: "text-gray-600 dark:text-[#b0b3b8]",
  hoverRow: "hover:bg-gray-50 dark:hover:bg-[#3a3b3c]",
  menu: "bg-white dark:bg-[#242526] border border-gray-200 dark:border-[#3e4042]",
  input:
    "bg-fb-secondary dark:bg-[#3a3b3c] text-gray-900 dark:text-[#e4e6eb] placeholder:text-gray-500 dark:placeholder:text-[#b0b3b8]",
};

export function fullName(profile) {
  return `${profile?.first_name || ""} ${profile?.last_name || ""}`.trim() ||
    "Người dùng";
}

export function isProfileOnline(profile) {
  return profile?.is_online === true;
}

export function onlineStatusText(isOnline) {
  return isOnline ? "Đang hoạt động" : "Ngoại tuyến";
}

/** Chấm xanh/xám góc avatar (API: ProfileSerializer.is_online). */
export function wrapAvatarWithOnlineStatus(imgEl, isOnline) {
  const wrap = document.createElement("div");
  wrap.className = "relative inline-block shrink-0";
  wrap.appendChild(imgEl);
  const dot = document.createElement("span");
  dot.className = [
    "absolute bottom-0 right-0 rounded-full border-2 border-white dark:border-[#242526]",
    isOnline ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500",
    imgEl.classList.contains("w-32") ? "w-4 h-4" : "w-3 h-3",
  ].join(" ");
  dot.title = onlineStatusText(isOnline);
  dot.setAttribute("aria-hidden", "true");
  wrap.appendChild(dot);
  return wrap;
}

/** @param {object} profile - ProfileSerializer shape */
export function createUserRow(profile, options = {}) {
  const { subtitle = "", actions = null, href = profileUrl(profile?.id) } =
    options;
  const row = document.createElement("div");
  row.className =
    "flex items-center gap-3 p-3 bg-white dark:bg-[#242526] rounded-xl shadow-sm hover:shadow transition";

  const link = document.createElement("a");
  link.href = href;
  link.className = "flex items-center gap-3 flex-1 min-w-0";

  const img = document.createElement("img");
  img.src = profile?.picture || DEFAULT_AVATAR;
  img.className = "w-11 h-11 rounded-full object-cover";
  img.alt = "";
  const avatarWrap = wrapAvatarWithOnlineStatus(
    img,
    isProfileOnline(profile)
  );

  const info = document.createElement("div");
  info.className = "min-w-0";
  const name = document.createElement("p");
  name.className = "font-semibold text-gray-800 dark:text-[#e4e6eb] truncate";
  name.textContent = fullName(profile);
  info.appendChild(name);
  const subText =
    subtitle ||
    (typeof profile?.is_online === "boolean"
      ? onlineStatusText(isProfileOnline(profile))
      : "");
  if (subText) {
    const sub = document.createElement("p");
    sub.className = "text-xs text-gray-500 dark:text-[#b0b3b8] truncate";
    sub.textContent = subText;
    info.appendChild(sub);
  }
  link.append(avatarWrap, info);
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
    "px-3 py-1.5 text-sm rounded-lg font-medium bg-fb-secondary dark:bg-[#3a3b3c] text-gray-900 dark:text-[#e4e6eb] hover:bg-gray-200 dark:hover:bg-[#4e4f50]";
  return b;
}

/** Primary action button (visible on dark backgrounds). */
export function btnPrimary(text, extra = "") {
  return btn(
    text,
    `px-4 py-2 text-sm rounded-lg font-semibold bg-fb-primary text-white dark:text-[#e4e6eb] hover:bg-fb-primary-hover ${extra}`.trim()
  );
}

/** Secondary / cancel style. */
export function btnSecondary(text, extra = "") {
  return btn(
    text,
    `px-4 py-2 text-sm rounded-lg font-semibold bg-gray-200 dark:bg-[#4e4f50] text-gray-900 dark:text-[#e4e6eb] hover:opacity-90 ${extra}`.trim()
  );
}
