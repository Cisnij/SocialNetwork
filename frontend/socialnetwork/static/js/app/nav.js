import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";

const badge = document.getElementById("notifBadge");
let notifWs = null;

// ======= WS RECONNECT GUARD (Task 1 spam fix) =======
let notifWsReconnectTimer = null;

// ======= PING WATCHDOG (Task 5) =======
// If no ping received in 70s → assume dead connection → reconnect
const PING_WATCHDOG_MS = 70 * 1000;
let notifPingWatchdog = null;

function resetNotifPingWatchdog() {
  if (notifPingWatchdog) clearTimeout(notifPingWatchdog);
  notifPingWatchdog = setTimeout(() => {
    console.warn("[nav] Notification WS ping watchdog fired — reconnecting");
    connectNotifWs();
  }, PING_WATCHDOG_MS);
}

async function refreshBadge() {
  if (!badge) return;
  try {
    const res = await authFetch(API.notificationsCount());
    const { count } = await res.json();
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.classList.remove("hidden");
    } else badge.classList.add("hidden");
  } catch {
    badge.classList.add("hidden");
  }
}

function connectNotifWs() {
  // Cancel any pending reconnect timer first
  if (notifWsReconnectTimer) {
    clearTimeout(notifWsReconnectTimer);
    notifWsReconnectTimer = null;
  }
  // Detach old handlers before closing
  if (notifWs) {
    notifWs.onclose = null;
    notifWs.close();
  }
  if (notifPingWatchdog) clearTimeout(notifPingWatchdog);

  try {
    notifWs = new WebSocket(API.wsNotifications());

    notifWs.onopen = () => {
      resetNotifPingWatchdog();
    };

    notifWs.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        // Ping-pong (Task 5)
        if (data.type === "ping") {
          notifWs.send(JSON.stringify({ type: "pong" }));
          resetNotifPingWatchdog(); // reset watchdog on each server ping
          return;
        }

        if (typeof data.unread_count === "number") {
          if (data.unread_count > 0) {
            badge.textContent = data.unread_count > 99 ? "99+" : data.unread_count;
            badge.classList.remove("hidden");
          } else badge.classList.add("hidden");
        }
      } catch (_) {}
    };

    notifWs.onclose = () => {
      if (notifPingWatchdog) clearTimeout(notifPingWatchdog);
      // Debounced single retry — no spam
      if (!notifWsReconnectTimer) {
        notifWsReconnectTimer = setTimeout(() => {
          notifWsReconnectTimer = null;
          connectNotifWs();
        }, 3000);
      }
    };

    notifWs.onerror = (err) => console.error("[nav] notifWs error", err);
  } catch (e) {
    console.error("[nav] notifWs connect error", e);
  }
}

// ======= Search history =======
const searchInput = document.getElementById("globalSearchInput");
const searchDropdown = document.getElementById("searchHistoryDropdown");

searchInput?.addEventListener("focus", async () => {
  await loadSearchHistory();
  searchDropdown?.classList.remove("hidden");
});

document.addEventListener("click", (e) => {
  if (!searchDropdown?.contains(e.target) && e.target !== searchInput) {
    searchDropdown?.classList.add("hidden");
  }
});

async function loadSearchHistory() {
  if (!searchDropdown) return;
  try {
    const res = await authFetch(API.searchHistory());
    const data = await res.json();
    searchDropdown.replaceChildren();
    (data.results || []).slice(0, 8).forEach((h) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "block w-full text-left px-4 py-2 text-sm text-gray-900 dark:text-[#e4e6eb] hover:bg-fb-secondary dark:hover:bg-gray-700";
      btn.textContent = h.content;
      btn.onclick = () => {
        window.location.href = `/search/?q=${encodeURIComponent(h.content)}`;
      };
      searchDropdown.appendChild(btn);
    });
  } catch (_) {}
}

searchInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = searchInput.value.trim();
    if (q) window.location.href = `/search/?q=${encodeURIComponent(q)}`;
  }
});

const path = window.location.pathname;
document.querySelectorAll("[data-nav]").forEach((el) => {
  const nav = el.dataset.nav;
  if (
    (nav === "home" && path === "/") ||
    (nav === "articles" && path.startsWith("/create-article")) ||
    (nav === "shares" && path.startsWith("/shares")) ||
    (nav === "friends" && path.startsWith("/friends"))
  ) {
    el.classList.add("active");
  }
});

const navNotifLink = document.getElementById("navNotifLink");
navNotifLink?.addEventListener("click", async (e) => {
  e.preventDefault();
  const href = navNotifLink.getAttribute("href") || "/notifications/";
  try {
    const res = await authFetch(API.notificationsMarkRead(), { method: "POST" });
    if (res.ok && badge) badge.classList.add("hidden");
  } catch (_) {
    /* vẫn mở trang thông báo */
  }
  window.location.href = href;
});

export async function markAllNotificationsRead() {
  const res = await authFetch(API.notificationsMarkRead(), { method: "POST" });
  if (res.ok && badge) badge.classList.add("hidden");
  return res.ok;
}

refreshBadge();
connectNotifWs();
