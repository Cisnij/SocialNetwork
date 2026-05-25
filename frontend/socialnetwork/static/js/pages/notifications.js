import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { formatDate, showEmpty, showSpinner, fullName } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";

const list = document.getElementById("notificationsList");
const markAll = document.getElementById("markAllReadBtn");

let nextUrl = buildListUrl(API.notifications(), 20);
let loading = false;
let notifWs = null;

function prependNotification(n) {
  if (!list) return;
  const empty = list.querySelector(".text-center");
  if (empty) empty.remove();
  list.prepend(buildCard(n));
}

function buildCard(n) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = `w-full text-left p-4 rounded-xl shadow-sm mb-3 flex gap-3 transition hover:bg-fb-secondary dark:hover:bg-gray-700 ${
    n.is_read ? "bg-white dark:bg-gray-800" : "bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800"
  }`;
  const img = document.createElement("img");
  img.src = n.actor_avatar || "/static/default-avatar.png";
  img.className = "w-10 h-10 rounded-full object-cover shrink-0";
  const body = document.createElement("div");
  body.className = "flex-1 min-w-0";
  const msg = document.createElement("p");
  msg.className = "text-sm text-gray-800 dark:text-gray-200";
  msg.innerHTML = `<strong>${n.actor || fullName(n.actor_profile) || "Ai đó"}</strong> ${n.message || n.type || ""}`;
  const time = document.createElement("p");
  time.className = "text-xs text-gray-400 mt-1";
  time.textContent = formatDate(n.created_at);
  body.append(msg, time);
  card.append(img, body);
  card.onclick = async () => {
    await authFetch(API.notificationsMarkRead(), { method: "POST" });
    card.classList.remove("bg-blue-50", "dark:bg-blue-900/20", "border", "border-blue-100");
    card.classList.add("bg-white", "dark:bg-gray-800");
    if (n.link) window.location.href = n.link;
  };
  return card;
}

markAll?.addEventListener("click", async () => {
  await authFetch(API.notificationsMarkRead(), { method: "POST" });
  showToast("Đã đánh dấu đã đọc");
  nextUrl = buildListUrl(API.notifications(), 20);
  list.replaceChildren();
  load(true);
});

function connectNotifPageWs() {
  notifWs = new WebSocket(API.wsNotifications());
  notifWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "ping") {
        notifWs.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (data.notification) prependNotification(data.notification);
      if (data.message && !data.notification) {
        prependNotification({
          actor: data.actor,
          message: data.message,
          created_at: new Date().toISOString(),
          is_read: false,
        });
      }
    } catch (_) {}
  };
  notifWs.onclose = () => setTimeout(connectNotifPageWs, 3000);
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
load(true);
