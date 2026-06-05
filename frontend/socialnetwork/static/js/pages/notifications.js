import { authFetch } from "../authenticate/auth.js";
import { markAllNotificationsRead } from "../app/nav.js";
import { API, buildListUrl } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { formatDate, showEmpty, showSpinner, fullName } from "../shared/ui.js";
import { DEFAULT_AVATAR } from "../shared/config.js";
import { fetchPage } from "../shared/paginated-list.js";

const list = document.getElementById("notificationsList");
const markAll = document.getElementById("markAllReadBtn");

let nextUrl = buildListUrl(API.notifications(), 20);
let loading = false;
let notifWs = null;
let notifWsReconnectTimer = null;

function notificationTarget(n) {
  if (n.post_id) return `/post/${n.post_id}/`;
  if (n.object_id && String(n.type || "").toLowerCase().includes("post")) {
    return `/post/${n.object_id}/`;
  }
  if (n.link) return n.link;
  return null;
}

function prependNotification(n) {
  if (!list) return;
  // Remove empty state placeholder if present
  list.querySelector(".text-center")?.remove();
  const card = buildCard(n);
  list.prepend(card);
  // Brief highlight animation to draw attention
  card.style.transition = "background 0.4s";
  card.style.background = "rgba(24,119,242,0.08)";
  setTimeout(() => { card.style.background = ""; }, 1200);
}

function buildCard(n) {
  const wrapper = document.createElement("div");
  wrapper.className = "relative mb-3";
  wrapper.dataset.notifId = n.id;

  const card = document.createElement("button");
  card.type = "button";
  card.className = `w-full text-left p-4 rounded-xl shadow-sm flex gap-3 transition hover:bg-fb-secondary dark:hover:bg-fb-hover ${
    n.is_read
      ? "bg-white dark:bg-[#242526]"
      : "bg-blue-50 dark:bg-[#263951] border border-blue-100 dark:border-blue-900/40"
  }`;

  const img = document.createElement("img");
  img.src = n.actor_avatar || DEFAULT_AVATAR;
  img.className = "w-12 h-12 rounded-full object-cover shrink-0 border-2 border-white dark:border-fb-card";
  img.alt = "";
  img.onerror = () => { img.src = DEFAULT_AVATAR; };

  const body = document.createElement("div");
  body.className = "flex-1 min-w-0";
  const msg = document.createElement("p");
  msg.className = "text-sm text-gray-800 dark:text-fb-text leading-snug";
  const actorName = n.actor || fullName(n.actor_profile) || "Ai đó";
  msg.innerHTML = `<strong class="text-fb-primary">${actorName}</strong> ${n.message || n.type || ""}`;
  const time = document.createElement("p");
  time.className = "text-xs text-gray-400 dark:text-fb-muted mt-1";
  time.textContent = formatDate(n.created_at);
  body.append(msg, time);
  card.append(img, body);

  card.onclick = async () => {
    await authFetch(API.notificationsMarkRead(), { method: "POST" });
    card.classList.remove(
      "bg-blue-50", "dark:bg-[#263951]", "border",
      "border-blue-100", "dark:border-blue-900/40"
    );
    card.classList.add("bg-white", "dark:bg-[#242526]");
    const href = notificationTarget(n);
    if (href) window.location.href = href;
  };

  // ─── Delete button (X) ───────────────────────────────────────────
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.title = "Xóa thông báo";
  delBtn.className =
    "absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-full " +
    "bg-gray-200 dark:bg-[#3a3b3c] text-gray-500 dark:text-fb-muted " +
    "hover:bg-red-100 dark:hover:bg-red-900/40 hover:text-red-500 " +
    "text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity";
  delBtn.textContent = "✕";
  delBtn.onclick = async (e) => {
    e.stopPropagation();
    if (!n.id) return;
    delBtn.disabled = true;
    try {
      const res = await authFetch(API.notificationDelete(n.id), { method: "DELETE" });
      if (res.ok || res.status === 204) {
        wrapper.remove();
        if (!list.querySelector("[data-notif-id]")) {
          showEmpty(list, "Không có thông báo.");
        }
      } else {
        showToast("Không xóa được thông báo", "red");
        delBtn.disabled = false;
      }
    } catch {
      showToast("Lỗi mạng", "red");
      delBtn.disabled = false;
    }
  };

  wrapper.classList.add("group");
  wrapper.append(card, delBtn);
  return wrapper;
}

markAll?.addEventListener("click", async () => {
  await authFetch(API.notificationsMarkRead(), { method: "POST" });
  showToast("Đã đánh dấu đã đọc");
  nextUrl = buildListUrl(API.notifications(), 20);
  list.replaceChildren();
  load(true);
});

// ─── WebSocket: real-time new notifications on /notifications/ page ──
function connectNotifPageWs() {
  if (notifWsReconnectTimer) {
    clearTimeout(notifWsReconnectTimer);
    notifWsReconnectTimer = null;
  }
  if (notifWs) {
    notifWs.onclose = null;
    notifWs.close();
  }

  notifWs = new WebSocket(API.wsNotifications());

  notifWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);

      // Ping-pong
      if (data.type === "ping") {
        notifWs.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // Backend sends: { unread_count, id, type, message, object_id,
      //                  post_id, actor_id, actor_name, actor_avatar }
      // Only prepend when a real new notification arrives (has message field)
      if (data.message && data.id) {
        prependNotification({
          id: data.id,
          actor: data.actor_name,
          actor_avatar: data.actor_avatar,
          message: data.message,
          type: data.type,
          post_id: data.post_id,
          object_id: data.object_id,
          created_at: new Date().toISOString(),
          is_read: false,
        });
      }
    } catch (_) {}
  };

  notifWs.onclose = () => {
    if (!notifWsReconnectTimer) {
      notifWsReconnectTimer = setTimeout(() => {
        notifWsReconnectTimer = null;
        connectNotifPageWs();
      }, 3000);
    }
  };

  notifWs.onerror = () => {};
}

async function load(initial = false) {
  if (!nextUrl || loading) return;
  loading = true;
  if (initial) {
    list.replaceChildren();
    showSpinner(list);
  }
  try {
    const data = await fetchPage(nextUrl);
    if (initial) list.replaceChildren();
    const items = data.results || [];
    if (initial && !items.length) showEmpty(list, "Không có thông báo.");
    items.forEach((n) => list.appendChild(buildCard(n)));
    nextUrl = data.next;
  } catch {
    if (initial) showEmpty(list, "Không tải được thông báo.");
  } finally {
    loading = false;
  }
}

window.addEventListener("scroll", () => {
  if (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 200
  ) {
    load(false);
  }
});

connectNotifPageWs();
markAllNotificationsRead()
  .catch(() => {})
  .finally(() => load(true));
