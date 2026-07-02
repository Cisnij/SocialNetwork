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

// ======= NOTIFICATION POPUP =======
let notifPopupTimeout = null;
let lastNotifCount = 0;

const NOTIF_TYPE_LABELS = {
  comment_on_post: "đã bình luận bài viết của bạn",
  reply_on_comment: "đã trả lời bình luận của bạn",
  tagged_in_reply: "đã nhắc đến bạn trong một bình luận",
  reaction_on_post: "đã cảm xúc bài viết của bạn",
  reaction_on_comment: "đã cảm xúc bình luận của bạn",
  friend_request: "đã gửi lời mời kết bạn",
  follow: "đã theo dõi bạn",
};

/**
 * Show FB-style notification popup with data from WS event.
 * @param {object} notif - { actor_name, actor_avatar, message, type }
 */
function showNotifPopup(notif) {
  const popup = document.getElementById("notifPopup");
  if (!popup) return;

  // Build avatar element
  const iconEl = document.getElementById("notifPopupIcon");
  if (iconEl) {
    if (notif.actor_avatar) {
      iconEl.innerHTML = "";
      iconEl.style.backgroundImage = `url('${notif.actor_avatar}')`;
      iconEl.style.backgroundSize = "cover";
      iconEl.style.backgroundPosition = "center";
    } else {
      iconEl.style.backgroundImage = "";
      iconEl.innerHTML = "🔔";
    }
  }

  // Name
  const nameEl = document.getElementById("notifPopupName");
  if (nameEl) nameEl.textContent = notif.actor_name || "Ai đó";

  // Sub-text: use message field, fall back to type label
  const subText = notif.message || NOTIF_TYPE_LABELS[notif.type] || "Thông báo mới";
  const subEl = document.getElementById("notifPopupSub");
  if (subEl) subEl.textContent = subText;

  popup.classList.remove("hidden");

  // Re-trigger slide-in animation
  popup.style.animation = "none";
  void popup.offsetWidth; // force reflow
  popup.style.animation = "slideInRight 0.3s ease";

  // Re-trigger shrink bar animation
  const bar = document.getElementById("notifPopupProgress");
  if (bar) {
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "shrinkBar 5s linear forwards";
  }

  if (notifPopupTimeout) clearTimeout(notifPopupTimeout);
  notifPopupTimeout = setTimeout(() => popup.classList.add("hidden"), 5000);
}

document.getElementById("closeNotifPopup")?.addEventListener("click", () => {
  document.getElementById("notifPopup")?.classList.add("hidden");
  if (notifPopupTimeout) clearTimeout(notifPopupTimeout);
});

// ======= INCOMING CALL =======
let pendingCallConvId = null;

function showIncomingCall(data) {
  const modal = document.getElementById("incomingCallModal");
  if (!modal) return;
  const avatarEl = document.getElementById("incomingCallerAvatar");
  const nameEl = document.getElementById("incomingCallerName");
  if (avatarEl) avatarEl.src = data.caller_avatar || "";
  if (nameEl) nameEl.textContent = data.caller_name || "Cuộc gọi đến";
  pendingCallConvId = data.conv_id;
  modal.classList.remove("hidden");
  if (window._callDismissTimer) clearTimeout(window._callDismissTimer);
  window._callDismissTimer = setTimeout(() => modal.classList.add("hidden"), 30000);
}

document.getElementById("declineCallBtn")?.addEventListener("click", async () => {
  document.getElementById("incomingCallModal")?.classList.add("hidden");
  if (pendingCallConvId) {
    try { await authFetch(API.declineCall(pendingCallConvId), { method: "POST" }); } catch (_) {}
    pendingCallConvId = null;
  }
});

document.getElementById("acceptCallBtn")?.addEventListener("click", async () => {
  document.getElementById("incomingCallModal")?.classList.add("hidden");
  if (!pendingCallConvId) return;
  try {
    const res = await authFetch(API.joinVideoRoom(pendingCallConvId), { method: "POST" });
    if (!res.ok) { alert("Cuộc gọi đã kết thúc"); return; }
    const callData = await res.json();
    if (window.startVideoCall) await window.startVideoCall(callData.token, callData.livekit_url, callData.room_name, pendingCallConvId);
  } catch (e) { console.error("[nav] join call error", e); }
  pendingCallConvId = null;
});

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

    notifWs.onmessage = async (ev) => {
      try {
        const data = JSON.parse(ev.data);

        // Ping-pong
        if (data.type === "ping") {
          notifWs.send(JSON.stringify({ type: "pong" }));
          resetNotifPingWatchdog(); // reset watchdog on each server ping
          return;
        }

        // Incoming call
        if (data.type === "incoming_call") {
          showIncomingCall(data);
          return;
        }

        // Bị hủy cuộc gọi trước khi bắt máy (Caller bấm tắt)
        if (data.type === "call_cancelled") {
          const modal = document.getElementById("incomingCallModal");
          if (modal) modal.classList.add("hidden");
          if (pendingCallConvId === data.conv_id) {
            pendingCallConvId = null;
          }
          if (window._callDismissTimer) {
            clearTimeout(window._callDismissTimer);
            window._callDismissTimer = null;
          }
          return;
        }

        if (typeof data.unread_count === "number") {
          const newCount = data.unread_count;
          if (newCount > 0) {
            badge.textContent = newCount > 99 ? "99+" : newCount;
            badge.classList.remove("hidden");
            // Show popup only on NEW notifications — use WS data directly (no extra REST call)
            if (newCount > lastNotifCount && data.message) {
              showNotifPopup(data);
            }
          } else {
            badge.classList.add("hidden");
          }
          lastNotifCount = newCount;
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
    (nav === "friends" && path.startsWith("/friends")) ||
    (nav === "finance" && path.startsWith("/finance"))
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

// ======= Mobile Menu =======
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const closeMobileMenu = document.getElementById("closeMobileMenu");
const mobileMenu = document.getElementById("mobileMenu");
const mobileLogoutBtn = document.getElementById("mobileLogoutBtn");
const logoutLink = document.getElementById("logoutLink");

mobileMenuBtn?.addEventListener("click", () => {
  mobileMenu?.classList.remove("hidden");
});

closeMobileMenu?.addEventListener("click", () => {
  mobileMenu?.classList.add("hidden");
});

mobileMenu?.addEventListener("click", (e) => {
  if (e.target === mobileMenu) {
    mobileMenu?.classList.add("hidden");
  }
});

mobileLogoutBtn?.addEventListener("click", () => {
  if (logoutLink) logoutLink.click();
});

// ======= Mobile Create Post Button =======
const openPostModal = document.getElementById("openPostModal");
const openPostModalMobile = document.getElementById("openPostModalMobile");

openPostModalMobile?.addEventListener("click", () => {
  if (openPostModal) openPostModal.click();
});

// ======= Mobile Search =======
const mobileSearchBtn = document.getElementById("mobileSearchBtn");
mobileSearchBtn?.addEventListener("click", () => {
  searchInput?.focus();
  // On mobile, we could show a modal or expand search
  // For now, just focus the search input if it's visible
  if (searchInput && window.innerWidth >= 640) {
    searchInput.focus();
  } else {
    // On mobile, show a simple prompt or redirect to search page
    const query = prompt("Tìm kiếm:");
    if (query) {
      window.location.href = `/search/?q=${encodeURIComponent(query)}`;
    }
  }
});

// ======= CONVERSATION NOTIFICATION (Chat Badge) =======
const chatBadge = document.getElementById("chatBadge");
let convWs = null;
let convWsReconnectTimer = null;
let convPingWatchdog = null;

function resetConvPingWatchdog() {
  if (convPingWatchdog) clearTimeout(convPingWatchdog);
  convPingWatchdog = setTimeout(() => {
    console.warn("[nav] Conv WS ping watchdog fired — reconnecting");
    connectConvWs();
  }, PING_WATCHDOG_MS);
}

function connectConvWs() {
  if (convWsReconnectTimer) {
    clearTimeout(convWsReconnectTimer);
    convWsReconnectTimer = null;
  }
  if (convWs) {
    convWs.onclose = null;
    convWs.close();
  }
  if (convPingWatchdog) clearTimeout(convPingWatchdog);

  try {
    convWs = new WebSocket(API.wsConversations());

    convWs.onopen = () => {
      resetConvPingWatchdog();
    };

    convWs.onmessage = async (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "ping") {
          convWs.send(JSON.stringify({ type: "pong" }));
          resetConvPingWatchdog();
          return;
        }

        // New message arrived in a conversation
        if (data.conversation_id && data.last_message) {
          if (String(data.sender_id) !== String(window.user_id)) {
            // Show red badge (on non-chat pages)
            if (chatBadge && window.location.pathname !== "/chat/") {
              chatBadge.classList.remove("hidden");
            }
            // Show chat message popup (only outside of /chat/)
            if (window.location.pathname !== "/chat/") {
              showChatMsgPopup(data);
            }
          }
          // Notify chat.js if it's listening
          if (typeof window.navBumpConversation === "function") {
            window.navBumpConversation(data);
          }
        }
      } catch (e) {}
    };

    convWs.onclose = () => {
      if (convPingWatchdog) clearTimeout(convPingWatchdog);
      if (!convWsReconnectTimer) {
        convWsReconnectTimer = setTimeout(() => {
          convWsReconnectTimer = null;
          connectConvWs();
        }, 3000);
      }
    };

    convWs.onerror = (err) => console.error("[nav] convWs error", err);
  } catch (e) {
    console.error("[nav] convWs connect error", e);
  }

  // expose so chat.js can reuse the same socket
  window.navConvWs = convWs;
}

// Hide chat badge when clicking chat link
const navChatLinkObj = document.getElementById("navChatLink");
navChatLinkObj?.addEventListener("click", () => {
  if (chatBadge) chatBadge.classList.add("hidden");
});

// ======= CHAT MESSAGE POPUP =======
let chatMsgPopupTimeout = null;

function showChatMsgPopup(data) {
  const popup = document.getElementById("chatMsgPopup");
  if (!popup) return;

  // Avatar
  const avatarEl = document.getElementById("chatMsgPopupAvatar");
  if (avatarEl) {
    if (data.sender_avatar) {
      avatarEl.innerHTML = "";
      avatarEl.style.backgroundImage = `url('${data.sender_avatar}')`;
      avatarEl.style.backgroundSize = "cover";
      avatarEl.style.backgroundPosition = "center";
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.innerHTML = "💬";
    }
  }

  // Sender name
  const nameEl = document.getElementById("chatMsgPopupName");
  if (nameEl) nameEl.textContent = data.sender_name || "Tin nhắn mới";

  // Last message preview
  const textEl = document.getElementById("chatMsgPopupText");
  if (textEl) {
    const msg = data.last_message || "";
    textEl.textContent = msg.length > 80 ? msg.slice(0, 80) + "…" : msg;
  }

  // Link to conversation
  const linkEl = document.getElementById("chatMsgPopupLink");
  if (linkEl && data.conversation_id) {
    linkEl.href = `/chat/?conv=${data.conversation_id}`;
  }

  popup.classList.remove("hidden");

  // Re-trigger slide-in animation
  popup.style.animation = "none";
  void popup.offsetWidth;
  popup.style.animation = "slideInRight 0.3s ease";

  // Progress bar
  const bar = document.getElementById("chatMsgPopupProgress");
  if (bar) {
    bar.style.animation = "none";
    void bar.offsetWidth;
    bar.style.animation = "shrinkBar 5s linear forwards";
  }

  if (chatMsgPopupTimeout) clearTimeout(chatMsgPopupTimeout);
  chatMsgPopupTimeout = setTimeout(() => popup.classList.add("hidden"), 5000);
}

document.getElementById("closeChatMsgPopup")?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById("chatMsgPopup")?.classList.add("hidden");
  if (chatMsgPopupTimeout) clearTimeout(chatMsgPopupTimeout);
});

refreshBadge();
connectNotifWs();
connectConvWs();
