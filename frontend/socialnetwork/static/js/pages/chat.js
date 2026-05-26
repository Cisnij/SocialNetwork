import { authFetch } from "../authenticate/auth.js";
import { fetchUserProfileShared } from "../app/profile.js";
import { API, withPageSize, DEFAULT_AVATAR } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { fullName } from "../shared/ui.js";

let myProfileId = null;
let myUserId = null;
let activeConvId = null;
let chatWs = null;
let convWs = null;
const convMap = new Map();
let messagesNext = null;
let pendingConv = false;
let loadingMessages = false;

/** DOM refs — resolved on boot, not at import time */
let convListEl;
let friendsStrip;
let messagesEl;
let chatTitle;
let chatForm;
let chatInput;
let pendingBanner;

function $(id) {
  return document.getElementById(id);
}

function messagePreview(conv) {
  const lm = conv.last_message;
  if (!lm) return "Chưa có tin nhắn";
  return lm.content || lm.message || "Tin nhắn mới";
}

function otherMember(conv) {
  return (conv.members || []).find(
    (m) => Number(m.user?.id) !== Number(myProfileId)
  )?.user;
}

function getConvTitle(conv) {
  const other = otherMember(conv);
  return other ? fullName(other) : "Chat";
}

async function loadCurrentUser() {
  const p = await fetchUserProfileShared();
  myProfileId = p.id;
  myUserId = p.user;
}

async function loadFriendsStrip() {
  if (!friendsStrip) return;
  friendsStrip.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "text-xs text-gray-400 px-2 shrink-0";
  loading.textContent = "Đang tải bạn bè...";
  friendsStrip.appendChild(loading);

  const res = await authFetch(withPageSize(API.friends(), 40));
  if (!res.ok) throw new Error(`friends ${res.status}`);
  const data = await res.json();
  friendsStrip.replaceChildren();

  const friends = data.results || [];
  if (!friends.length) {
    friendsStrip.innerHTML =
      '<p class="text-xs text-gray-400 px-2 shrink-0">Chưa có bạn bè</p>';
    return;
  }

  friends.forEach((f) => {
    const profile = f.user;
    if (!profile?.id) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flex flex-col items-center gap-1 shrink-0 w-16 group";
    btn.title = fullName(profile);
    const img = document.createElement("img");
    img.src = profile.picture || DEFAULT_AVATAR;
    img.className =
      "w-14 h-14 rounded-full object-cover ring-2 ring-fb-primary ring-offset-2 dark:ring-offset-[#242526] group-hover:scale-105 transition";
    img.alt = "";
    const label = document.createElement("span");
    label.className =
      "text-[10px] text-gray-600 dark:text-fb-muted truncate w-full text-center";
    label.textContent = (profile.first_name || "").split(" ")[0] || "Bạn";
    btn.append(img, label);
    btn.onclick = () => startChatWith(profile.id, fullName(profile));
    friendsStrip.appendChild(btn);
  });
}

async function startChatWith(profileId, name) {
  const res = await authFetch(API.startChat(profileId), { method: "POST" });
  if (!res.ok) {
    showToast("Không mở được chat", "red");
    return;
  }
  const conv = await res.json();
  history.replaceState(null, "", "/chat/");
  await loadConversations();
  openConversation(conv, name);
}

function connectConvListWs() {
  try {
    convWs?.close();
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
  } catch (e) {
    console.error("[chat] conv ws", e);
  }
}

function bumpConversation(event) {
  if (!convListEl) return;
  const id = Number(event.conversation_id);
  const item = convMap.get(id);
  if (item) {
    convListEl.prepend(item.el);
    const preview = item.el.querySelector(".conv-preview");
    if (preview) preview.textContent = event.last_message || "Tin nhắn mới";
  } else {
    loadConversations();
  }
}

async function loadConversations() {
  if (!convListEl) return;
  convListEl.replaceChildren();
  const spin = document.createElement("p");
  spin.className = "text-sm text-gray-400 p-4 text-center";
  spin.textContent = "Đang tải hội thoại...";
  convListEl.appendChild(spin);

  const res = await authFetch(withPageSize(API.conversations(), 30));
  if (!res.ok) throw new Error(`conversations ${res.status}`);
  const data = await res.json();
  convListEl.replaceChildren();
  convMap.clear();

  const items = data.results || [];
  if (!items.length) {
    convListEl.innerHTML =
      '<p class="text-sm text-gray-400 p-4 text-center">Chưa có tin nhắn</p>';
  } else {
    items.forEach((c) => convListEl.appendChild(renderConvItem(c)));
  }

  const userParam = new URLSearchParams(location.search).get("user");
  if (userParam) {
    history.replaceState(null, "", "/chat/");
    const startRes = await authFetch(API.startChat(userParam), { method: "POST" });
    if (startRes.ok) {
      const conv = await startRes.json();
      openConversation(conv);
    } else {
      showToast("Không mở được hội thoại", "red");
    }
  }
}

function renderConvItem(c) {
  const other = otherMember(c);
  const name = other ? fullName(other) : "Nhóm";
  const wrap = document.createElement("button");
  wrap.type = "button";
  wrap.className =
    "w-full flex items-center gap-2 p-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] cursor-pointer group relative text-left";
  const preview = messagePreview(c);
  wrap.innerHTML = `
    <img src="${other?.picture || DEFAULT_AVATAR}" class="w-12 h-12 rounded-full object-cover shrink-0" alt="">
    <div class="flex-1 min-w-0 conv-body">
      <p class="font-semibold text-sm truncate dark:text-[#e4e6eb]">${name}</p>
      <p class="text-xs text-gray-500 dark:text-fb-muted truncate conv-preview">${preview}</p>
    </div>
    ${c.status === "pending" ? '<span class="text-[10px] text-amber-500 font-semibold shrink-0">Chờ</span>' : ""}
    ${c.unread_count > 0 ? `<span class="bg-fb-primary text-white text-xs px-2 rounded-full shrink-0">${c.unread_count}</span>` : ""}
    <span class="conv-menu hidden group-hover:inline text-xl px-1 shrink-0" role="presentation">⋯</span>`;

  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".conv-menu")) return;
    openConversation(c, name);
  });

  const menuBtn = wrap.querySelector(".conv-menu");
  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    showConvMenu(c.id, wrap);
  });

  convMap.set(c.id, { el: wrap, data: c });
  return wrap;
}

function showConvMenu(convId, anchor) {
  document.querySelectorAll(".conv-context-menu").forEach((m) => m.remove());
  const menu = document.createElement("div");
  menu.className =
    "conv-context-menu absolute right-2 top-12 bg-white dark:bg-[#242526] shadow-xl rounded-lg z-20 py-1 text-sm min-w-[140px] border dark:border-fb-divider";
  const hide = document.createElement("button");
  hide.type = "button";
  hide.className =
    "block w-full text-left px-4 py-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c]";
  hide.textContent = "Ẩn đoạn chat";
  hide.onclick = async () => {
    await authFetch(API.hideConv(convId), { method: "PATCH" });
    menu.remove();
    loadConversations();
  };
  const del = document.createElement("button");
  del.type = "button";
  del.className =
    "block w-full text-left px-4 py-2 hover:bg-fb-secondary text-red-500";
  del.textContent = "Xóa hội thoại";
  del.onclick = async () => {
    await authFetch(API.deleteConv(convId), { method: "PATCH" });
    menu.remove();
    loadConversations();
  };
  menu.append(hide, del);
  anchor.appendChild(menu);
  setTimeout(
    () => document.addEventListener("click", () => menu.remove(), { once: true }),
    0
  );
}

async function openConversation(conv, titleName) {
  if (!messagesEl) return;
  activeConvId = conv.id;
  const panel = $("chatPanel");
  panel?.classList.remove("hidden");
  panel?.classList.add("flex");
  if (chatTitle) chatTitle.textContent = titleName || getConvTitle(conv);

  let back = $("chatBackBtn");
  if (!back && chatTitle?.parentElement) {
    back = document.createElement("button");
    back.id = "chatBackBtn";
    back.type = "button";
    back.className = "md:hidden text-fb-primary font-semibold text-sm mr-2";
    back.textContent = "←";
    back.onclick = () => {
      panel?.classList.add("hidden");
      panel?.classList.remove("flex");
    };
    chatTitle.parentElement.insertBefore(back, chatTitle);
  }

  messagesEl.replaceChildren();
  pendingBanner?.classList.add("hidden");

  pendingConv = conv.status === "pending";
  if (pendingConv) {
    showPendingActions(conv);
    chatForm?.classList.add("opacity-50", "pointer-events-none");
  } else {
    chatForm?.classList.remove("opacity-50", "pointer-events-none");
  }

  connectChatWs(conv.id);
  messagesNext = API.messages(conv.id);
  await loadMessages(true);
  try {
    await authFetch(API.seenMessage(conv.id), { method: "POST" });
  } catch (e) {
    console.warn("[chat] seen", e);
  }
}

function showPendingActions(conv) {
  if (!pendingBanner) return;
  pendingBanner.classList.remove("hidden");
  pendingBanner.replaceChildren();
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className =
    "px-3 py-1.5 bg-fb-primary text-white rounded-lg text-sm font-semibold";
  accept.textContent = "Chấp nhận";
  accept.onclick = async () => {
    const res = await authFetch(API.acceptConv(conv.id), { method: "POST" });
    if (!res.ok) return showToast("Không chấp nhận được", "red");
    pendingBanner.classList.add("hidden");
    pendingConv = false;
    chatForm?.classList.remove("opacity-50", "pointer-events-none");
    conv.status = "accept";
    showToast("Đã chấp nhận");
  };
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "px-3 py-1.5 bg-fb-secondary rounded-lg text-sm";
  reject.textContent = "Từ chối";
  reject.onclick = async () => {
    await authFetch(API.rejectConv(conv.id), { method: "POST" });
    showToast("Đã từ chối");
    loadConversations();
    messagesEl?.replaceChildren();
  };
  pendingBanner.append(accept, reject);
}

function connectChatWs(convId) {
  chatWs?.close();
  try {
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
          const el = document.querySelector(
            `[data-msg-id="${data.id}"] .msg-text`
          );
          if (el) el.textContent = `${data.content} (đã sửa)`;
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
  } catch (e) {
    console.error("[chat] message ws", e);
  }
}

async function loadMessages(reset) {
  if (!messagesNext || !messagesEl || loadingMessages) return;
  loadingMessages = true;
  try {
    const res = await authFetch(messagesNext);
    if (!res.ok) throw new Error(`messages ${res.status}`);
    const data = await res.json();
    const items = [...(data.results || [])].reverse();
    if (reset) messagesEl.replaceChildren();
    items.forEach((m) => appendMessage(m, false));
    messagesNext = data.next;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } finally {
    loadingMessages = false;
  }
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
    mine
      ? "bg-fb-primary text-white rounded-br-sm"
      : "bg-fb-secondary dark:bg-[#3a3b3c] dark:text-[#e4e6eb] rounded-bl-sm"
  }`;

  const text = document.createElement("p");
  text.className = "msg-text whitespace-pre-wrap";
  text.textContent = m.content || m.message || "";

  if (m.attachments?.length) {
    m.attachments.forEach((a) => {
      if (
        a.file_type?.startsWith("image") ||
        a.file_url?.match(/\.(jpg|jpeg|png|gif|webp)/i)
      ) {
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
  } else {
    bubble.appendChild(text);
  }

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

function bindEvents() {
  chatForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (pendingConv) {
      showToast("Chấp nhận tin nhắn trước khi trả lời", "red");
      return;
    }
    const text = chatInput?.value.trim();
    if (!text || !chatWs || chatWs.readyState !== WebSocket.OPEN) {
      showToast("Không gửi được — kiểm tra kết nối", "red");
      return;
    }
    chatWs.send(JSON.stringify({ message: text, message_type: "text" }));
    if (chatInput) chatInput.value = "";
  });

  $("chatFileInput")?.addEventListener("change", async (e) => {
    if (!activeConvId) return;
    const files = e.target.files;
    if (!files?.length) return;
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const res = await authFetch(API.chatUpload(activeConvId), {
      method: "POST",
      body: fd,
    });
    if (!res.ok) return showToast("Upload thất bại", "red");
    const uploaded = await res.json();
    const ids = (uploaded.results || uploaded || []).map((x) => x.id);
    chatWs?.send(
      JSON.stringify({
        message: "",
        message_type: "file",
        attachment_ids: ids,
      })
    );
    e.target.value = "";
  });

  messagesEl?.addEventListener("scroll", () => {
    if (!messagesEl || !messagesNext || loadingMessages) return;
    if (messagesEl.scrollTop < 80) loadMessages(false);
  });

  $("showHiddenChats")?.addEventListener("click", async () => {
    const modal = $("hiddenChatsModal");
    const list = $("hiddenChatsList");
    modal?.classList.remove("hidden");
    list?.replaceChildren();
    try {
      const res = await authFetch(withPageSize(API.hiddenChats(), 20));
      const data = await res.json();
      (data.results || []).forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "w-full text-left p-3 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] rounded-lg dark:text-[#e4e6eb]";
        btn.textContent = getConvTitle(c);
        btn.onclick = () => {
          modal?.classList.add("hidden");
          openConversation(c);
        };
        list?.appendChild(btn);
      });
    } catch {
      showToast("Không tải tin nhắn ẩn", "red");
    }
  });

  $("closeHiddenChats")?.addEventListener("click", () =>
    $("hiddenChatsModal")?.classList.add("hidden")
  );
}

async function initChat() {
  convListEl = $("chatConvList");
  friendsStrip = $("chatFriendsStrip");
  messagesEl = $("chatMessages");
  chatTitle = $("chatTitle");
  chatForm = $("chatForm");
  chatInput = $("chatInput");
  pendingBanner = $("chatPendingBanner");

  if (!convListEl) {
    console.error("[chat] #chatConvList not found — wrong page template?");
    return;
  }

  bindEvents();

  try {
    await loadCurrentUser();
    connectConvListWs();
    await Promise.all([loadFriendsStrip(), loadConversations()]);
  } catch (e) {
    console.error("[chat] init failed", e);
    showToast("Không tải được Messenger", "red");
    if (convListEl) {
      convListEl.innerHTML =
        '<p class="text-sm text-red-500 p-4 text-center">Lỗi tải dữ liệu. <button type="button" id="chatRetryBtn" class="underline text-fb-primary">Thử lại</button></p>';
      $("chatRetryBtn")?.addEventListener("click", () => initChat());
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initChat());
} else {
  initChat();
}
