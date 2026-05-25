import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { fullName, formatDate } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";

let myProfileId = null;
let myUserId = null;
let activeConvId = null;
let chatWs = null;
let convWs = null;
let convMap = new Map();
let messagesNext = null;

authFetch(API.user())
  .then((r) => r.json())
  .then((p) => {
    myProfileId = p.id;
    myUserId = p.user;
  })
  .catch(() => {});

const convListEl = document.getElementById("chatConvList");
const messagesEl = document.getElementById("chatMessages");
const chatTitle = document.getElementById("chatTitle");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const pendingBanner = document.getElementById("chatPendingBanner");
const headerActions = document.getElementById("chatHeaderActions");

function connectConvListWs() {
  convWs = new WebSocket(API.wsConversations());
  convWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "ping") {
        convWs.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (data.conversation_id) bumpConversation(data);
    } catch (_) {}
  };
  convWs.onclose = () => setTimeout(connectConvListWs, 3000);
}

function bumpConversation(event) {
  const id = Number(event.conversation_id);
  const item = convMap.get(id);
  if (item) {
    convListEl.prepend(item.el);
    const preview = item.el.querySelector(".conv-preview");
    if (preview) preview.textContent = event.last_message || "Tin nhắn mới";
  } else loadConversations();
}

async function loadConversations() {
  convListEl.replaceChildren();
  const data = await fetchPage(buildListUrl(API.conversations(), 30));
  (data.results || []).forEach((c) => convListEl.appendChild(renderConvItem(c)));
  const params = new URLSearchParams(location.search);
  if (params.get("user")) {
    const res = await authFetch(API.startChat(params.get("user")), { method: "POST" });
    const conv = await res.json();
    openConversation(conv);
  }
}

function renderConvItem(c) {
  const other = (c.members || []).find(
    (m) => Number(m.user?.id) !== Number(myProfileId)
  )?.user;
  const name = other ? fullName(other) : "Nhóm";
  const wrap = document.createElement("div");
  wrap.className =
    "flex items-center gap-2 p-2 hover:bg-fb-secondary dark:hover:bg-gray-700 cursor-pointer group relative";
  wrap.innerHTML = `
    <img src="${other?.picture || "/static/default-avatar.png"}" class="w-12 h-12 rounded-full object-cover">
    <div class="flex-1 min-w-0 conv-body">
      <p class="font-semibold text-sm truncate">${name}</p>
      <p class="text-xs text-gray-500 truncate conv-preview">${c.last_message?.content || c.last_message?.message || ""}</p>
    </div>
    ${c.unread_count > 0 ? `<span class="bg-fb-primary text-white text-xs px-2 rounded-full">${c.unread_count}</span>` : ""}
    <button type="button" class="conv-menu hidden group-hover:block text-xl px-1">⋯</button>`;
  wrap.onclick = (e) => {
    if (e.target.classList.contains("conv-menu")) return;
    openConversation(c, name);
  };
  const menuBtn = wrap.querySelector(".conv-menu");
  menuBtn.onclick = (e) => {
    e.stopPropagation();
    showConvMenu(c.id, menuBtn);
  };
  convMap.set(c.id, { el: wrap, data: c });
  return wrap;
}

function showConvMenu(convId, anchor) {
  const menu = document.createElement("div");
  menu.className =
    "absolute right-2 top-12 bg-white dark:bg-gray-800 shadow-xl rounded-lg z-20 py-1 text-sm min-w-[140px]";
  const hide = document.createElement("button");
  hide.className = "block w-full text-left px-4 py-2 hover:bg-fb-secondary";
  hide.textContent = "Ẩn đoạn chat";
  hide.onclick = async () => {
    await authFetch(API.hideConv(convId), { method: "PATCH" });
    menu.remove();
    loadConversations();
  };
  const del = document.createElement("button");
  del.className = "block w-full text-left px-4 py-2 hover:bg-fb-secondary text-red-600";
  del.textContent = "Xóa hội thoại";
  del.onclick = async () => {
    await authFetch(API.deleteConv(convId), { method: "PATCH" });
    menu.remove();
    loadConversations();
  };
  menu.append(hide, del);
  anchor.parentElement.appendChild(menu);
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

async function openConversation(conv, titleName) {
  activeConvId = conv.id;
  document.getElementById("chatPanel")?.classList.remove("hidden");
  document.getElementById("chatPanel")?.classList.add("flex");
  chatTitle.textContent = titleName || getConvTitle(conv);
  if (!document.getElementById("chatBackBtn")) {
    const back = document.createElement("button");
    back.id = "chatBackBtn";
    back.type = "button";
    back.className = "md:hidden text-fb-primary font-semibold text-sm mr-2";
    back.textContent = "←";
    back.onclick = () => {
      document.getElementById("chatPanel")?.classList.add("hidden");
      document.getElementById("chatPanel")?.classList.remove("flex");
    };
    chatTitle.parentElement?.insertBefore(back, chatTitle);
  }
  messagesEl.replaceChildren();
  pendingBanner.classList.add("hidden");
  headerActions.replaceChildren();

  if (conv.status === "pending" || conv.status === "Pending") {
    showPendingActions(conv);
  }

  connectChatWs(conv.id);
  messagesNext = API.messages(conv.id);
  await loadMessages(true);
  await authFetch(API.seenMessage(conv.id), { method: "POST" });
}

function getConvTitle(conv) {
  const other = (conv.members || []).find((m) => m.user?.id !== myProfileId)?.user;
  return other ? fullName(other) : "Chat";
}

function showPendingActions(conv) {
  pendingBanner.classList.remove("hidden");
  pendingBanner.replaceChildren();
  const accept = document.createElement("button");
  accept.className = "px-3 py-1.5 bg-fb-primary text-white rounded-lg text-sm font-semibold";
  accept.textContent = "Chấp nhận";
  accept.onclick = async () => {
    await authFetch(API.acceptConv(conv.id), { method: "POST" });
    pendingBanner.classList.add("hidden");
    showToast("Đã chấp nhận");
  };
  const reject = document.createElement("button");
  reject.className = "px-3 py-1.5 bg-fb-secondary rounded-lg text-sm";
  reject.textContent = "Từ chối";
  reject.onclick = async () => {
    await authFetch(API.rejectConv(conv.id), { method: "POST" });
    showToast("Đã từ chối");
    loadConversations();
    messagesEl.replaceChildren();
  };
  pendingBanner.append(accept, reject);
}

function connectChatWs(convId) {
  chatWs?.close();
  chatWs = new WebSocket(API.wsChat(convId));
  chatWs.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.type === "ping") {
        chatWs.send(JSON.stringify({ type: "pong" }));
        return;
      }
      if (data.type === "seen_message") {
        document.querySelectorAll(".msg-seen").forEach((el) => {
          el.textContent = "Đã xem";
        });
        return;
      }
      if (data.type === "message_deleted") {
        document.querySelector(`[data-msg-id="${data.id}"]`)?.remove();
        return;
      }
      if (data.type === "message_updated") {
        const el = document.querySelector(`[data-msg-id="${data.id}"] .msg-text`);
        if (el) el.textContent = data.content + " (đã sửa)";
        return;
      }
      if (data.message != null || data.content != null) {
        appendMessage(
          {
            id: data.id,
            content: data.message ?? data.content,
            sender_id: data.sender_id,
            attachments: data.attachments,
          },
          true
        );
      }
    } catch (_) {}
  };
}

async function loadMessages(reset) {
  if (!messagesNext) return;
  const data = await fetchPage(messagesNext);
  const items = [...(data.results || [])].reverse();
  if (reset) messagesEl.replaceChildren();
  items.forEach((m) => appendMessage(m, false));
  messagesNext = data.next;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendMessage(m, scroll = true) {
  const sid = m.sender?.id ?? m.sender_id;
  const mine =
    (myUserId != null && Number(sid) === Number(myUserId)) ||
    (myProfileId != null && Number(sid) === Number(myProfileId));
  const wrap = document.createElement("div");
  wrap.className = `flex ${mine ? "justify-end" : "justify-start"} mb-1`;
  wrap.dataset.msgId = m.id;

  const bubble = document.createElement("div");
  bubble.className = `max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
    mine ? "bg-fb-primary text-white rounded-br-sm" : "bg-fb-secondary dark:bg-gray-700 rounded-bl-sm"
  }`;

  const text = document.createElement("p");
  text.className = "msg-text whitespace-pre-wrap";
  text.textContent = m.content || m.message || "";

  if (m.attachments?.length) {
    m.attachments.forEach((a) => {
      if (a.file_type?.startsWith("image") || a.file_url?.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
        const img = document.createElement("img");
        img.src = a.file_url;
        img.className = "max-w-full rounded-lg mt-1";
        bubble.appendChild(img);
      } else {
        const link = document.createElement("a");
        link.href = a.file_url;
        link.download = a.file_name || "file";
        link.className = "block mt-1 underline text-sm";
        link.textContent = `📎 ${a.file_name || "Tải file"}`;
        bubble.appendChild(link);
      }
    });
  } else bubble.appendChild(text);

  if (mine) {
    const actions = document.createElement("div");
    actions.className = "flex gap-2 mt-1 text-[10px] opacity-80 justify-end";
    const unsend = document.createElement("button");
    unsend.type = "button";
    unsend.textContent = "Thu hồi";
    unsend.onclick = async () => {
      await authFetch(API.unsendMessage(m.id), { method: "DELETE" });
      wrap.remove();
    };
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Sửa";
    edit.onclick = async () => {
      const nv = prompt("Sửa tin nhắn", m.content);
      if (!nv) return;
      await authFetch(API.updateMessage(m.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_content: nv }),
      });
      text.textContent = nv;
    };
    actions.append(unsend, edit);
    bubble.appendChild(actions);
  }

  const seen = document.createElement("p");
  seen.className = "msg-seen text-[10px] text-gray-400 mt-0.5 text-right";
  wrap.appendChild(bubble);
  if (mine) wrap.appendChild(seen);
  messagesEl.appendChild(wrap);
  if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
}

chatForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !chatWs || chatWs.readyState !== WebSocket.OPEN) {
    showToast("Không gửi được", "red");
    return;
  }
  chatWs.send(JSON.stringify({ message: text, message_type: "text" }));
  chatInput.value = "";
});

document.getElementById("chatFileInput")?.addEventListener("change", async (e) => {
  if (!activeConvId) return;
  const files = e.target.files;
  if (!files?.length) return;
  const fd = new FormData();
  for (const f of files) fd.append("files", f);
  const res = await authFetch(API.chatUpload(activeConvId), { method: "POST", body: fd });
  if (!res.ok) return showToast("Upload thất bại", "red");
  const uploaded = await res.json();
  const ids = (uploaded.results || uploaded || []).map((x) => x.id);
  chatWs?.send(
    JSON.stringify({ message: "", message_type: "file", attachment_ids: ids })
  );
  e.target.value = "";
});

document.getElementById("showHiddenChats")?.addEventListener("click", async () => {
  const modal = document.getElementById("hiddenChatsModal");
  const list = document.getElementById("hiddenChatsList");
  modal.classList.remove("hidden");
  list.replaceChildren();
  const data = await fetchPage(buildListUrl(API.hiddenChats(), 20));
  (data.results || []).forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "w-full text-left p-3 hover:bg-fb-secondary rounded-lg";
    btn.textContent = getConvTitle(c);
    btn.onclick = () => {
      modal.classList.add("hidden");
      openConversation(c);
    };
    list.appendChild(btn);
  });
});
document.getElementById("closeHiddenChats")?.onclick = () =>
  document.getElementById("hiddenChatsModal").classList.add("hidden");

connectConvListWs();
loadConversations();
