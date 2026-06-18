import { authFetch } from "../authenticate/auth.js";
import { fetchUserProfileShared } from "../app/profile.js";
import { API, withPageSize, DEFAULT_AVATAR } from "../shared/config.js";
import { uploadChatFiles, sendChatWsMessage } from "../shared/chat-upload.js";
import { el, img, textEl } from "../shared/dom.js";
import { showToast } from "../shared/toast.js";
import { fullName } from "../shared/ui.js";
import { confirmDialog } from "../shared/confirm.js";

let myProfileId = null;
let myUserId = null;
let activeConvId = null;
let chatWs = null;
let convWs = null;
const convMap = new Map();
let messagesNext = null;
let pendingConv = false;
let loadingMessages = false;
let activeConvMeta = null;
let activeConvMembers = [];
let firstMessageInConv = null;

// ========= REPLY STATE =========
let replyToId = null;
let replyToContent = null;

// ========= TYPING STATE =========
let typingIndicatorTimeout = null;
let typingStopTimeout = null;
let typingSent = false;

// ========= WS RECONNECT GUARDS =========
let chatWsReconnectTimer = null;
let convWsReconnectTimer = null;
let chatWsGeneration = 0;

// ========= WS PING WATCHDOG =========
const PING_WATCHDOG_MS = 70 * 1000;
let chatPingWatchdog = null;
let convPingWatchdog = null;

function resetChatPingWatchdog(convId, gen) {
  if (chatPingWatchdog) clearTimeout(chatPingWatchdog);
  chatPingWatchdog = setTimeout(() => {
    if (gen !== chatWsGeneration) return;
    if (Number(activeConvId) === Number(convId)) connectChatWs(convId);
  }, PING_WATCHDOG_MS);
}

function resetConvPingWatchdog() {
  if (convPingWatchdog) clearTimeout(convPingWatchdog);
  convPingWatchdog = setTimeout(() => {
    connectConvListWs();
  }, PING_WATCHDOG_MS);
}

/** DOM refs */
let convListEl;
let friendsStrip;
let messagesEl;
let chatTitle;
let chatForm;
let chatInput;
let pendingBanner;
let replyPreviewBar;
let replyPreviewText;
let cancelReplyBtn;
let chatHeaderActions;

function $(id) { return document.getElementById(id); }

// ==================== REPLY HELPERS ====================
function setReply(msgId, content) {
  replyToId = msgId;
  replyToContent = content;
  if (replyPreviewBar) {
    replyPreviewBar.classList.remove("hidden");
    replyPreviewBar.classList.add("flex");
  }
  if (replyPreviewText) {
    replyPreviewText.textContent = content && content.length > 100 ? content.slice(0, 100) + "…" : content || "";
  }
  chatInput?.focus();
}

function clearReply() {
  replyToId = null;
  replyToContent = null;
  if (replyPreviewBar) {
    replyPreviewBar.classList.add("hidden");
    replyPreviewBar.classList.remove("flex");
  }
  if (replyPreviewText) replyPreviewText.textContent = "";
}

// ==================== SCROLL HELPERS ====================
function scrollToBottom(smooth = false) {
  if (!messagesEl) return;
  if (smooth) messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  else messagesEl.scrollTop = messagesEl.scrollHeight;
}

function scrollToBottomDeferred() {
  requestAnimationFrame(() => requestAnimationFrame(() => scrollToBottom(false)));
}

function messagePreview(conv) {
  const lm = conv.last_message;
  if (!lm) return "Chưa có tin nhắn";
  if (lm.message_type === 'file') return 'File đính kèm';
  return lm.content || lm.message || "Tin nhắn mới";
}

function otherMember(conv) {
  return (conv.members || []).find((m) => Number(m.user?.id) !== Number(myProfileId))?.user;
}

function getConvTitle(conv) {
  if (conv.is_group) return conv.name || "Nhóm";
  const other = otherMember(conv);
  return other ? fullName(other) : "Chat";
}

function isCurrentUserAdmin() {
  return (activeConvMembers || []).some(
    (m) => Number(m.user?.id) === Number(myProfileId) && m.role === 'admin'
  );
}

async function loadCurrentUser() {
  const p = await fetchUserProfileShared();
  myProfileId = p.id;
  myUserId = p.user;
}

// ==================== FRIENDS STRIP ====================
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
    friendsStrip.appendChild(textEl("p", "text-xs text-gray-400 px-2 shrink-0", "Chưa có bạn bè"));
    return;
  }

  friends.forEach((f) => {
    const profile = f.user;
    if (!profile?.id) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flex flex-col items-center gap-1 shrink-0 w-16 group";
    btn.title = fullName(profile);
    const imgEl = document.createElement("img");
    imgEl.src = profile.picture || DEFAULT_AVATAR;
    imgEl.className = "w-14 h-14 rounded-full object-cover ring-2 ring-fb-primary ring-offset-2 dark:ring-offset-[#242526] group-hover:scale-105 transition";
    imgEl.alt = "";
    const label = document.createElement("span");
    label.className = "text-[10px] text-gray-600 dark:text-fb-muted truncate w-full text-center";
    label.textContent = (profile.first_name || "").split(" ")[0] || "Bạn";
    btn.append(imgEl, label);
    btn.onclick = () => startChatWith(profile.id, fullName(profile));
    friendsStrip.appendChild(btn);
  });
}

async function startChatWith(profileId, name) {
  const res = await authFetch(API.startChat(profileId), { method: "POST" });
  if (!res.ok) { showToast("Không mở được chat", "red"); return; }
  const conv = await res.json();
  conv._startedByMe = true;
  history.replaceState(null, "", "/chat/");
  await loadConversations();
  openConversation(conv, name);
}

// ==================== CONV LIST WS ====================
function connectConvListWs() {
  if (convWsReconnectTimer) { clearTimeout(convWsReconnectTimer); convWsReconnectTimer = null; }
  try {
    if (convWs) { convWs.onclose = null; convWs.close(); }
    convWs = new WebSocket(API.wsConversations());

    convWs.onopen = () => { resetConvPingWatchdog(); };

    convWs.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "ping") { convWs.send(JSON.stringify({ type: "pong" })); resetConvPingWatchdog(); return; }
        if (data.conversation_id) bumpConversation(data);
      } catch (_) { }
    };

    convWs.onclose = () => {
      if (convPingWatchdog) clearTimeout(convPingWatchdog);
      if (!convWsReconnectTimer) {
        convWsReconnectTimer = setTimeout(() => { convWsReconnectTimer = null; connectConvListWs(); }, 3000);
      }
    };
    convWs.onerror = (e) => console.error("[chat] convWs error", e);
  } catch (e) { console.error("[chat] conv ws", e); }
}

function bumpConversation(event) {
  if (!convListEl) return;
  const id = Number(event.conversation_id);
  const item = convMap.get(id);
  if (item) {
    convListEl.prepend(item.el);
    const preview = item.el.querySelector(".conv-preview");
    if (preview) {
      const type = event.message_type;
      if (type === "file" || (!event.last_message && type)) preview.textContent = "File đính kèm";
      else preview.textContent = event.last_message || "Tin nhắn mới";
    }
    const unread = item.el.querySelector(".conv-unread-dot");
    if (Number(event.sender_id) === Number(myUserId)) {
      unread?.remove();
    } else if (!unread && Number(activeConvId) !== id) {
      item.el.appendChild(textEl("span", "conv-unread-dot bg-fb-primary dark:bg-indigo-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 shadow-sm", "Mới"));
    }
  } else {
    loadConversations();
  }
}

// ==================== LOAD CONVERSATIONS ====================
async function loadConversations() {
  if (!convListEl) return;
  convListEl.replaceChildren();
  const spin = document.createElement("p"); spin.className = "text-sm text-gray-400 p-4 text-center"; spin.textContent = "Đang tải hội thoại..."; convListEl.appendChild(spin);

  const res = await authFetch(withPageSize(API.conversations(), 30));
  if (!res.ok) throw new Error(`conversations ${res.status}`);
  const data = await res.json();
  convListEl.replaceChildren();
  convMap.clear();

  const items = data.results || [];
  if (!items.length) {
    convListEl.appendChild(textEl("p", "text-sm text-gray-400 p-4 text-center", "Chưa có tin nhắn"));
  } else {
    items.forEach((c) => convListEl.appendChild(renderConvItem(c)));
  }

  const userParam = new URLSearchParams(location.search).get("user");
  if (userParam) {
    history.replaceState(null, "", "/chat/");
    const startRes = await authFetch(API.startChat(userParam), { method: "POST" });
    if (startRes.ok) { const conv = await startRes.json(); openConversation(conv); }
    else { showToast("Không mở được hội thoại", "red"); }
  }
}

function renderConvItem(c) {
  const other = otherMember(c);
  const name = getConvTitle(c);
  const wrap = el("button", "w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors cursor-pointer group relative text-left mb-0.5", { type: "button" });

  wrap.append(img(c.is_group ? (c.avatar || DEFAULT_AVATAR) : (other?.picture || DEFAULT_AVATAR), "w-12 h-12 rounded-full object-cover shrink-0 shadow-sm border border-transparent dark:border-white/10", ""));

  const body = el("div", "flex-1 min-w-0 conv-body");
  body.append(
    textEl("p", "font-semibold text-sm truncate dark:text-slate-100", name),
    textEl("p", "text-xs text-gray-500 dark:text-slate-400 truncate conv-preview", messagePreview(c))
  );
  wrap.append(body);

  if (c.status === "pending") {
    wrap.appendChild(textEl("span", "text-[10px] text-amber-500 font-semibold shrink-0", "Chờ"));
  }
  if (c.unread_count > 0) {
    wrap.appendChild(textEl("span", "conv-unread-dot bg-fb-primary dark:bg-indigo-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 shadow-sm dark:shadow-indigo-500/30", String(c.unread_count)));
  }

  const menuBtn = textEl("span", "conv-menu hidden group-hover:inline text-xl px-1 shrink-0", "⋮");
  wrap.appendChild(menuBtn);

  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".conv-menu")) return;
    wrap.querySelector(".conv-unread-dot")?.remove();
    openConversation(c, name);
  });

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showConvMenu(c.id, wrap, c);
  });

  convMap.set(c.id, { el: wrap, data: c });
  return wrap;
}

function showConvMenu(convId, anchor, conv) {
  document.querySelectorAll(".conv-context-menu").forEach((m) => m.remove());
  // Position relative to anchor, make anchor position:relative if needed
  if (window.getComputedStyle(anchor).position === 'static') anchor.style.position = 'relative';
  const menu = document.createElement("div");
  menu.className = "conv-context-menu absolute right-0 bottom-full mb-1 bg-white dark:bg-[#242526] shadow-xl rounded-lg z-[100] py-1 text-sm min-w-[180px] border dark:border-fb-divider";

  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "block w-full text-left px-4 py-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c]";
  hide.textContent = "Ẩn đoạn chat";
  hide.onclick = async () => { await authFetch(API.hideConv(convId), { method: "PATCH" }); menu.remove(); loadConversations(); };
  menu.appendChild(hide);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "block w-full text-left px-4 py-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] text-red-500 dark:text-red-400";
  del.textContent = "Xóa hội thoại";
  del.onclick = async () => { await authFetch(API.deleteConv(convId), { method: "PATCH" }); menu.remove(); loadConversations(); };
  menu.appendChild(del);

  // Group chat options
  if (conv?.is_group) {
    menu.appendChild(el("hr", "border-t dark:border-white/10 my-1", {}));
    const leave = document.createElement("button");
    leave.type = "button";
    leave.className = "block w-full text-left px-4 py-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] text-red-500";
    leave.textContent = "Rời nhóm";
    leave.onclick = async () => { await showLeaveGroupModal(convId); menu.remove(); };
    menu.appendChild(leave);
  }

  anchor.appendChild(menu);
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

// ==================== FETCH FIRST MESSAGE ====================
async function fetchFirstMessage(convId) {
  try {
    const url = `${API.messages(convId)}?ordering=created_at&page_size=1`;
    const res = await authFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.results || [])[0] || null;
  } catch { return null; }
}

function isFirstMessageFromMe(msg) {
  if (!msg || myUserId == null) return false;
  const uid = msg.sender?.user;
  return uid != null && Number(uid) === Number(myUserId);
}

function isPendingInitiator(conv) {
  if (isFirstMessageFromMe(firstMessageInConv)) return true;
  return !firstMessageInConv && !!conv?._startedByMe;
}

function canSendWhilePending() {
  if (!pendingConv) return true;
  return isPendingInitiator(activeConvMeta);
}

async function applyPendingUI(conv) {
  if (!pendingBanner || !pendingConv) return;
  pendingBanner.classList.remove("hidden");
  pendingBanner.replaceChildren();

  if (isPendingInitiator(conv)) {
    pendingBanner.appendChild(textEl("p", "text-sm text-amber-900 dark:text-amber-100 flex-1",
      firstMessageInConv ? "Đang chờ người nhận phản hồi. Họ cần chấp nhận yêu cầu trước khi trả lời." : "Gửi tin nhắn đầu tiên để gửi yêu cầu trò chuyện."));
    chatForm?.classList.remove("opacity-50", "pointer-events-none");
    return;
  }

  if (!firstMessageInConv) {
    pendingBanner.appendChild(textEl("p", "text-sm text-amber-900 dark:text-amber-100 flex-1", "Chưa có tin nhắn yêu cầu."));
    chatForm?.classList.add("opacity-50", "pointer-events-none");
    return;
  }

  const accept = document.createElement("button");
  accept.type = "button"; accept.className = "px-4 py-2 bg-fb-primary text-white rounded-lg text-sm font-semibold hover:bg-fb-primary-hover";
  accept.textContent = "Chấp nhận";
  accept.onclick = async () => {
    const res = await authFetch(API.acceptConv(conv.id), { method: "POST" });
    if (!res.ok) { const err = await res.json().catch(() => ({})); showToast(err.detail || "Không chấp nhận được", "red"); return; }
    pendingBanner.classList.add("hidden"); pendingConv = false; conv.status = "accept";
    chatForm?.classList.remove("opacity-50", "pointer-events-none"); showToast("Đã chấp nhận", "green"); loadConversations();
  };

  const reject = document.createElement("button");
  reject.type = "button"; reject.className = "px-4 py-2 rounded-lg text-sm font-semibold bg-gray-200 dark:bg-[#4e4f50] text-gray-900 hover:opacity-90";
  reject.textContent = "Từ chối";
  reject.onclick = async () => {
    const res = await authFetch(API.rejectConv(conv.id), { method: "POST" });
    if (!res.ok) showToast("Không từ chối được", "red"); else showToast("Đã từ chối");
    pendingBanner.classList.add("hidden"); pendingConv = false; loadConversations();
    messagesEl?.replaceChildren(); activeConvId = null;
  };
  pendingBanner.append(accept, reject);
  chatForm?.classList.add("opacity-50", "pointer-events-none");
}

// ==================== OPEN CONVERSATION ====================
async function openConversation(conv, titleName) {
  if (!messagesEl) return;
  activeConvId = conv.id;
  activeConvMeta = conv;
  activeConvMembers = [];
  clearReply();

  const panel = $("chatPanel");
  panel?.classList.remove("hidden"); panel?.classList.add("flex");
  if (chatTitle) chatTitle.textContent = titleName || getConvTitle(conv);

  messagesEl.replaceChildren();
  const loader = document.createElement("div"); loader.className = "flex items-center justify-center h-full gap-2";
  const spinner = document.createElement("div"); spinner.className = "w-5 h-5 border-3 border-fb-primary border-t-transparent rounded-full animate-spin"; loader.appendChild(spinner);
  const loadText = document.createElement("p"); loadText.className = "text-sm text-gray-500 dark:text-fb-muted"; loadText.textContent = "Đang tải..."; loader.appendChild(loadText);
  messagesEl.appendChild(loader);

  pendingBanner?.classList.add("hidden");
  const typingIndicator = document.getElementById("chatTypingIndicator");
  if (typingIndicator) { typingIndicator.textContent = ""; typingIndicator.classList.remove("typing-active"); }
  pendingConv = conv.status === "pending";
  firstMessageInConv = null;

  connectChatWs(conv.id);
  messagesNext = API.messages(conv.id);
  await loadMessages(true);
  activeConvMembers = await fetchConversationMembers(conv.id);
  if (activeConvMembers.length) activeConvMeta.members = activeConvMembers;

  if (pendingConv) { firstMessageInConv = await fetchFirstMessage(conv.id); await applyPendingUI(conv); }
  else chatForm?.classList.remove("opacity-50", "pointer-events-none");

  try { await authFetch(API.seenMessage(conv.id), { method: "POST" }); } catch (e) { console.warn("[chat] seen", e); }

  // Update seen based on other member's last_read_message
  const otherMem = (activeConvMembers.length ? activeConvMembers : (conv.members || [])).find((m) => Number(m.user?.id) !== Number(myProfileId));
  if (otherMem && otherMem.last_read_message) markSeenMessages(otherMem.last_read_message);

  // Update chat header actions with group buttons
  updateChatHeaderActions(conv);
}

async function fetchConversationMembers(convId) {
  try {
    const res = await authFetch(withPageSize(API.conversationMembers(convId), 100));
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch { return []; }
}

function updateChatHeaderActions(conv) {
  if (!chatHeaderActions) return;
  chatHeaderActions.replaceChildren();
  if (!conv.is_group) return;

  if (isCurrentUserAdmin()) {
    const groupSettingsBtn = document.createElement("button");
    groupSettingsBtn.type = "button";
    groupSettingsBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";
    groupSettingsBtn.title = "Quản lý nhóm";
    groupSettingsBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;
    groupSettingsBtn.onclick = () => showGroupSettingsModal(conv.id);
    chatHeaderActions.appendChild(groupSettingsBtn);
  }

  const viewFilesBtn = document.createElement("button");
  viewFilesBtn.type = "button";
  viewFilesBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";
  viewFilesBtn.title = "Tệp đã gửi";
  viewFilesBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>`;
  viewFilesBtn.onclick = () => showGroupFilesModal(conv.id);
  chatHeaderActions.appendChild(viewFilesBtn);

  const viewTasksBtn = document.createElement("button");
  viewTasksBtn.type = "button";
  viewTasksBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";
  viewTasksBtn.title = "Công việc";
  viewTasksBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>`;
  viewTasksBtn.onclick = () => showTaskModal(conv.id);
  chatHeaderActions.appendChild(viewTasksBtn);

  const viewVotesBtn = document.createElement("button");
  viewVotesBtn.type = "button";
  viewVotesBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";
  viewVotesBtn.title = "Bình chọn";
  viewVotesBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
  viewVotesBtn.onclick = () => showVoteModal(conv.id);
  chatHeaderActions.appendChild(viewVotesBtn);
}

// ==================== CHAT WS ====================
function connectChatWs(convId) {
  if (chatWsReconnectTimer) { clearTimeout(chatWsReconnectTimer); chatWsReconnectTimer = null; }
  const gen = ++chatWsGeneration;
  if (chatWs) { chatWs.onclose = null; chatWs.onmessage = null; chatWs.onerror = null; chatWs.close(); chatWs = null; }
  if (chatPingWatchdog) clearTimeout(chatPingWatchdog);

  try {
    chatWs = new WebSocket(API.wsChat(convId));

    chatWs.onopen = () => { resetChatPingWatchdog(convId, gen); };

    chatWs.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "ping") { chatWs.send(JSON.stringify({ type: "pong" })); resetChatPingWatchdog(convId, gen); return; }
        if (data.type === "seen_message") { if (Number(data.user_id) !== Number(myUserId)) markSeenMessages(data.last_message_id); return; }
        if (data.type === "typing") { handleTypingEvent(data); return; }
        if (data.type === "system_message") { appendMessage({ id: `system-${Date.now()}`, content: data.message, message_type: data.message_type || "system" }, true); return; }
        if (data.type === "message_deleted") { document.querySelector(`[data-msg-id="${data.id}"]`)?.remove(); return; }
        if (data.type === "message_updated") { const elUpdated = document.querySelector(`[data-msg-id="${data.id}"] .msg-text`); if (elUpdated) elUpdated.textContent = `${data.content} (đã sửa)`; return; }

        if (data.id != null && (data.message != null || data.attachments != null)) {
          appendMessage({
            id: data.id, content: data.message ?? data.content ?? "", message: data.message ?? "",
            sender_id: data.sender_id, message_type: data.message_type, attachments: data.attachments || [],
            reply_to_id: data.reply_to_id, reply_to_id_content: data.reply_to_id_content,
          }, true);
          if (pendingConv && activeConvMeta && !firstMessageInConv) {
            fetchFirstMessage(activeConvId).then((m) => { firstMessageInConv = m; applyPendingUI(activeConvMeta); });
          }
          if (Number(data.sender_id) !== Number(myUserId) && !document.hidden) {
            authFetch(API.seenMessage(activeConvId), { method: "POST" }).catch(() => { });
          }
        }
      } catch (err) { console.error("[chat] WS error:", err); }
    };

    chatWs.onerror = (err) => console.error("[chat] WS error:", err);
    chatWs.onclose = () => {
      if (chatPingWatchdog) clearTimeout(chatPingWatchdog);
      if (gen !== chatWsGeneration || Number(activeConvId) !== Number(convId)) return;
      if (!chatWsReconnectTimer) { chatWsReconnectTimer = setTimeout(() => { chatWsReconnectTimer = null; if (Number(activeConvId) === Number(convId)) connectChatWs(convId); }, 3000); }
    };
  } catch (e) { console.error("[chat] ws", e); }
}

// ==================== LOAD MESSAGES ====================
async function loadMessages(reset) {
  if (!messagesNext || !messagesEl || loadingMessages) return;
  loadingMessages = true;
  try {
    const res = await authFetch(messagesNext);
    if (!res.ok) throw new Error(`messages ${res.status}`);
    const data = await res.json();
    const items = [...(data.results || [])].reverse();
    if (reset) {
      messagesEl.replaceChildren();
      items.forEach((m) => appendMessage(m, false, false));
      scrollToBottomDeferred();
    } else {
      const prevHeight = messagesEl.scrollHeight;
      for (let i = items.length - 1; i >= 0; i--) appendMessage(items[i], false, true);
      messagesEl.scrollTop += messagesEl.scrollHeight - prevHeight;
    }
    messagesNext = data.next;
  } finally { loadingMessages = false; }
}

// ==================== APPEND MESSAGE ====================
function appendMessage(m, scroll = true, prepend = false) {
  const messageType = m.message_type || m.type || "";
  if (messageType === "system" || messageType.startsWith("system_")) {
    const wrap = document.createElement("div");
    wrap.className = "flex justify-center my-3 chat-msg-wrap";
    wrap.dataset.msgId = m.id;
    const pill = document.createElement("div");
    pill.className = "max-w-[85%] rounded-full bg-gray-200/80 dark:bg-white/10 px-3 py-1 text-[12px] text-gray-600 dark:text-fb-muted text-center";
    pill.textContent = m.content || m.message || "";
    wrap.appendChild(pill);
    if (prepend) messagesEl.prepend(wrap); else messagesEl.appendChild(wrap);
    if (scroll) scrollToBottom(false);
    return;
  }

  const sid = m.sender?.user ?? m.sender?.id ?? m.sender_id;
  const mine = (myUserId != null && Number(sid) === Number(myUserId)) || (myProfileId != null && Number(sid) === Number(myProfileId));

  const wrap = document.createElement("div");
  wrap.className = `flex ${mine ? "justify-end" : "justify-start"} mb-1 chat-msg-wrap`;
  wrap.dataset.msgId = m.id;

  const replyBtn = document.createElement("button");
  replyBtn.type = "button"; replyBtn.title = "Trả lời";
  replyBtn.className = "chat-reply-btn self-center shrink-0 mx-1 transition-opacity text-gray-400 dark:text-fb-muted hover:text-fb-primary text-base leading-none";
  replyBtn.textContent = "↩";
  const msgContent = m.content || m.message || "";
  replyBtn.onclick = () => setReply(m.id, msgContent);
  wrap.addEventListener("mouseenter", () => { replyBtn.style.opacity = "1"; });
  wrap.addEventListener("mouseleave", () => { replyBtn.style.opacity = "0"; });
  replyBtn.style.opacity = "0";

  const bubble = document.createElement("div");
  bubble.className = `max-w-[75%] px-3 py-2 rounded-2xl text-sm transition-all ${mine ? "bg-fb-primary dark:bg-gradient-to-br dark:from-blue-600 dark:to-indigo-600 text-white rounded-br-sm" : "bg-fb-secondary dark:bg-white/10 dark:text-white rounded-bl-sm"}`;

  const replyContent = m.reply_to_id_content ?? m.reply_to?.content;
  if (replyContent) {
    const quote = document.createElement("div");
    quote.className = `mb-1.5 px-2 py-1 rounded-lg border-l-2 text-xs opacity-75 cursor-pointer ${mine ? "border-white/60 bg-white/10" : "border-fb-primary/60 dark:border-indigo-400 bg-gray-200 dark:bg-white/5"}`;
    quote.textContent = replyContent.length > 80 ? replyContent.slice(0, 80) + "…" : replyContent;
    if (m.reply_to_id) {
      quote.onclick = () => {
        const target = document.querySelector(`[data-msg-id="${m.reply_to_id}"]`);
        if (target) { target.scrollIntoView({ behavior: "smooth", block: "center" }); target.style.transition = "background 0.3s"; target.style.background = "rgba(24,119,242,0.12)"; setTimeout(() => { target.style.background = ""; }, 1000); }
      };
    }
    bubble.appendChild(quote);
  }

  const text = document.createElement("p");
  text.className = "msg-text whitespace-pre-wrap";
  text.textContent = m.content || m.message || "";
  const content = (m.content || m.message || "").trim();
  if (content) bubble.appendChild(text);

  (m.attachments || []).forEach((a) => {
    if (a.file_type === "image" || a.file_type?.startsWith("image/") || a.file_url?.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
      const image = document.createElement("img");
      image.src = a.file_url; image.className = "max-w-full rounded-lg mt-1 cursor-pointer"; image.alt = a.file_name || "";
      image.onclick = () => window.open(a.file_url, "_blank");
      bubble.appendChild(image);
    } else if (a.file_type === "video" || a.file_type?.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = a.file_url; video.controls = true; video.className = "max-w-full rounded-lg mt-1";
      bubble.appendChild(video);
    } else {
      const link = document.createElement("a");
      link.href = a.file_url; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.className = "block mt-1 underline text-sm";
      link.textContent = `📎 ${a.file_name || "Tải file"}`;
      bubble.appendChild(link);
    }
  });

  if (!content && !(m.attachments || []).length) bubble.appendChild(text);

  if (mine) {
    const actions = document.createElement("div");
    actions.className = "flex gap-2 mt-1 text-[10px] opacity-80 justify-end";
    const unsend = document.createElement("button");
    unsend.type = "button"; unsend.textContent = "Thu hồi";
    unsend.onclick = async () => { await authFetch(API.unsendMessage(m.id), { method: "DELETE" }); wrap.remove(); };
    const edit = document.createElement("button");
    edit.type = "button"; edit.textContent = "Sửa";
    edit.onclick = () => showInlineEdit(m.id, text, bubble, edit);
    actions.append(unsend, edit);
    bubble.appendChild(actions);
  }

  const seenLabel = document.createElement("p");
  seenLabel.className = "msg-seen text-[10px] text-gray-400 dark:text-[#b0b3b8] mt-0.5 text-right";
  seenLabel.textContent = "";

  if (mine) { wrap.append(replyBtn, bubble); } else { wrap.append(bubble, replyBtn); }
  if (mine) wrap.appendChild(seenLabel);

  if (prepend) messagesEl.prepend(wrap); else messagesEl.appendChild(wrap);
  if (scroll) scrollToBottom(false);
}

function markSeenMessages(lastMessageId) {
  const seenId = Number(lastMessageId);
  if (!Number.isFinite(seenId)) return;
  document.querySelectorAll(".msg-seen").forEach((el) => { el.textContent = ""; el.classList.remove("seen-check"); });
  const nodes = document.querySelectorAll("[data-msg-id]");
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const id = Number(node.dataset.msgId);
    if (!Number.isFinite(id)) continue;
    const seenLabelEl = node.querySelector(".msg-seen");
    if (!seenLabelEl) continue;
    if (id <= seenId) { seenLabelEl.textContent = "Đã xem"; seenLabelEl.classList.add("seen-check"); break; }
  }
}

// ==================== TYPING ====================
function ensureTypingIndicator() {
  let indicator = document.getElementById("chatTypingIndicator");
  if (indicator) return indicator;
  indicator = document.createElement("div");
  indicator.id = "chatTypingIndicator";
  indicator.className = "px-4 pb-2 flex items-center gap-2 text-xs text-gray-500 dark:text-fb-muted typing-indicator-wrap";
  indicator.style.minHeight = "20px";
  indicator.innerHTML = `<span class="typing-name"></span><span class="typing-dots hidden"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>`;

  if (!document.getElementById("typingDotsStyle")) {
    const style = document.createElement("style");
    style.id = "typingDotsStyle";
    style.textContent = `
      .typing-dots { display: inline-flex; gap: 3px; align-items: center; }
      .typing-dots.hidden { display: none !important; }
      .typing-dots .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.4; animation: typingBounce 1.2s infinite ease-in-out; }
      .typing-dots .dot:nth-child(1) { animation-delay: 0s; }
      .typing-dots .dot:nth-child(2) { animation-delay: 0.2s; }
      .typing-dots .dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typingBounce { 0%,60%,100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-5px); opacity: 1; } }
      .msg-seen.seen-check { color: #1877f2; font-size: 10px; }
    `;
    document.head.appendChild(style);
  }

  const form = document.getElementById("chatForm");
  form?.parentElement?.insertBefore(indicator, form);
  return indicator;
}

function handleTypingEvent(data) {
  if (Number(data.sender_id) === Number(myUserId)) return;
  const indicator = ensureTypingIndicator();
  if (!indicator) return;
  const nameEl = indicator.querySelector(".typing-name");
  const dotsEl = indicator.querySelector(".typing-dots");
  if (!data.is_typing) { if (nameEl) nameEl.textContent = ""; if (dotsEl) dotsEl.classList.add("hidden"); return; }
  if (nameEl) nameEl.textContent = `${data.sender || "Người dùng"} đang nhập`;
  if (dotsEl) dotsEl.classList.remove("hidden");
  if (typingIndicatorTimeout) clearTimeout(typingIndicatorTimeout);
  typingIndicatorTimeout = setTimeout(() => { if (nameEl) nameEl.textContent = ""; if (dotsEl) dotsEl.classList.add("hidden"); }, 3000);
}

// ==================== INLINE EDIT ====================
function showInlineEdit(msgId, textEl, bubble, editBtn) {
  if (bubble.querySelector('.inline-edit-container')) return;
  const currentText = textEl.textContent;
  const container = document.createElement("div");
  container.className = "inline-edit-container mt-1";
  const input = document.createElement("textarea");
  input.className = "w-full text-sm rounded-lg px-2 py-1.5 bg-white/20 dark:bg-black/20 border border-fb-primary/50 focus:outline-none focus:ring-1 focus:ring-fb-primary resize-none text-inherit";
  input.value = currentText;
  input.rows = 2;
  input.style.minHeight = "36px";
  input.style.color = "inherit";
  const actionsRow = document.createElement("div");
  actionsRow.className = "flex gap-2 justify-end mt-1";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "text-[11px] px-2.5 py-1 rounded-full bg-gray-200/80 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 transition";
  cancelBtn.textContent = "Hủy";
  cancelBtn.onclick = () => container.remove();
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "text-[11px] px-2.5 py-1 rounded-full bg-fb-primary text-white hover:bg-fb-primary-hover transition font-semibold";
  saveBtn.textContent = "Lưu";
  saveBtn.onclick = async () => {
    const nv = input.value.trim();
    if (!nv || nv === currentText) { container.remove(); return; }
    try {
      const res = await authFetch(API.updateMessage(msgId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_content: nv }) });
      if (res.ok) { textEl.textContent = nv; container.remove(); showToast("Đã sửa"); }
      else showToast("Sửa thất bại", "red");
    } catch { showToast("Lỗi mạng", "red"); }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveBtn.click(); } });
  actionsRow.append(cancelBtn, saveBtn);
  container.append(input, actionsRow);
  bubble.appendChild(container);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function setTyping(isTyping) {
  if (!chatWs || chatWs.readyState !== WebSocket.OPEN) return;
  if (isTyping && !typingSent) { typingSent = true; chatWs.send(JSON.stringify({ type: "typing", is_typing: true })); }
  if (typingStopTimeout) clearTimeout(typingStopTimeout);
  typingStopTimeout = setTimeout(() => {
    if (!chatWs || chatWs.readyState !== WebSocket.OPEN) return;
    if (typingSent) { typingSent = false; chatWs.send(JSON.stringify({ type: "typing", is_typing: false })); }
  }, isTyping ? 1200 : 0);
}

// ==================== GROUP CHAT SETTINGS MODAL ====================
async function showGroupSettingsModal(convId) {
  document.getElementById("groupSettingsModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "groupSettingsModal";
  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Quản lý nhóm</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <div class="space-y-3 overflow-y-auto flex-1">
        <button type="button" data-action="add-members" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-fb-secondary dark:hover:bg-white/10 dark:text-white">➕ Thêm thành viên</button>
        <button type="button" data-action="transfer-admin" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-fb-secondary dark:hover:bg-white/10 dark:text-white">👑 Chuyển quyền admin</button>
        <button type="button" data-action="modify-group" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-fb-secondary dark:hover:bg-white/10 dark:text-white">✏️ Đổi tên/ảnh nhóm</button>
        <button type="button" data-action="delete-group" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">🗑️ Xóa nhóm</button>
      </div>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  modal.querySelector("[data-action='add-members']")?.addEventListener("click", () => { modal.remove(); showAddMembersModal(convId); });
  modal.querySelector("[data-action='transfer-admin']")?.addEventListener("click", () => { modal.remove(); showTransferAdminModal(convId); });
  modal.querySelector("[data-action='modify-group']")?.addEventListener("click", () => { modal.remove(); showModifyGroupModal(convId); });
  modal.querySelector("[data-action='delete-group']")?.addEventListener("click", () => { modal.remove(); showDeleteGroupModal(convId); });
}

async function showAddMembersModal(convId) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 modal-backdrop z-[85] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Thêm thành viên</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <p class="text-xs text-gray-500 mb-2">Chọn bạn bè chưa có trong nhóm:</p>
      <div id="addMemberList" class="flex-1 overflow-y-auto space-y-1 min-h-[200px]"></div>
      <button type="button" id="submitAddMembers" class="mt-3 w-full rounded-xl bg-fb-primary text-white font-semibold py-2">Thêm vào nhóm</button>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  const list = modal.querySelector("#addMemberList");
  const res = await authFetch(withPageSize(API.friendsAvailableForGroup(convId), 100));
  const data = res.ok ? await res.json() : { results: [] };
  (data.results || []).forEach((f) => {
    const profile = f.user;
    if (!profile?.user) return;
    const row = document.createElement("label");
    row.className = "flex items-center gap-3 rounded-xl p-2 hover:bg-fb-secondary dark:hover:bg-white/10 cursor-pointer";
    row.innerHTML = `<input type="checkbox" class="add-member-check" value="${profile.user}"><img src="${profile.picture || DEFAULT_AVATAR}" class="w-9 h-9 rounded-full object-cover"><span class="text-sm dark:text-white">${fullName(profile)}</span>`;
    list?.appendChild(row);
  });

  modal.querySelector("#submitAddMembers")?.addEventListener("click", async () => {
    const ids = [...modal.querySelectorAll(".add-member-check:checked")].map((i) => Number(i.value));
    if (!ids.length) { showToast("Chọn ít nhất 1 người", "red"); return; }
    const res = await authFetch(API.addGroupMembers(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_members: ids }) });
    if (res.ok) { showToast("Đã thêm thành viên", "green"); modal.remove(); } else { showToast("Thêm thất bại", "red"); }
  });
}

async function showTransferAdminModal(convId) {
  const members = await fetchConversationMembers(convId);
  const nonAdminMembers = members.filter((m) => m.role !== 'admin');
  if (!nonAdminMembers.length) { showToast("Không có thành viên khác để chuyển admin", "red"); return; }

  const modal = document.createElement("div");
  modal.className = "fixed inset-0 modal-backdrop z-[85] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-md p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Chuyển quyền admin</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <div id="transferMemberList" class="space-y-1 max-h-60 overflow-y-auto"></div>
      <button type="button" id="submitTransferAdmin" class="mt-3 w-full rounded-xl bg-amber-500 text-white font-semibold py-2">Chuyển admin</button>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  const list = modal.querySelector("#transferMemberList");
  let selectedId = null;
  nonAdminMembers.forEach((m) => {
    if (!m.user) return;
    const row = document.createElement("label");
    row.className = "flex items-center gap-3 rounded-xl p-2 hover:bg-fb-secondary dark:hover:bg-white/10 cursor-pointer";
    row.innerHTML = `<input type="radio" name="new-admin" class="transfer-admin-radio" value="${m.user.id}"><img src="${m.user.picture || DEFAULT_AVATAR}" class="w-9 h-9 rounded-full object-cover"><span class="text-sm dark:text-white">${fullName(m.user)}</span>`;
    list?.appendChild(row);
  });

  modal.querySelector("#submitTransferAdmin")?.addEventListener("click", async () => {
    const radio = modal.querySelector(".transfer-admin-radio:checked");
    if (!radio) { showToast("Chọn người kế thừa", "red"); return; }
    const res = await authFetch(API.transferGroupAdmin(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_admin_id: Number(radio.value) }) });
    if (res.ok) { showToast("Đã chuyển admin", "green"); modal.remove(); } else { showToast("Chuyển admin thất bại", "red"); }
  });
}

async function showModifyGroupModal(convId) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 modal-backdrop z-[85] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-md p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Sửa nhóm</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <input id="modifyGroupName" class="w-full rounded-xl px-3 py-2 bg-slate-100 dark:bg-white/10 dark:text-white mb-3" placeholder="Tên nhóm mới">
      <label class="block text-sm text-gray-500 mb-1">Ảnh nhóm:</label>
      <input type="file" id="modifyGroupAvatar" accept="image/*" class="mb-3 block text-sm dark:text-white">
      <button type="button" id="submitModifyGroup" class="w-full rounded-xl bg-fb-primary text-white font-semibold py-2">Lưu thay đổi</button>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  modal.querySelector("#submitModifyGroup")?.addEventListener("click", async () => {
    const name = modal.querySelector("#modifyGroupName")?.value.trim();
    const avatarFile = modal.querySelector("#modifyGroupAvatar")?.files?.[0];
    if (!name && !avatarFile) { showToast("Nhập tên hoặc chọn ảnh", "red"); return; }
    const fd = new FormData();
    if (name) fd.append("name", name);
    if (avatarFile) fd.append("group_avatar", avatarFile);
    const res = await authFetch(API.modifyGroupChat(convId), { method: "PATCH", body: fd });
    if (res.ok) { showToast("Đã cập nhật nhóm", "green"); modal.remove(); loadConversations(); } else { showToast("Cập nhật thất bại", "red"); }
  });
}

async function showDeleteGroupModal(convId) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 modal-backdrop z-[85] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-md p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Xóa nhóm</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <p class="text-sm text-red-600 mb-3">Hành động này không thể hoàn tác!</p>
      <input type="password" id="deleteGroupPassword" class="w-full rounded-xl px-3 py-2 bg-slate-100 dark:bg-white/10 dark:text-white mb-3" placeholder="Nhập mật khẩu">
      <button type="button" id="submitDeleteGroup" class="w-full rounded-xl bg-red-600 text-white font-semibold py-2">Xóa nhóm</button>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  modal.querySelector("#submitDeleteGroup")?.addEventListener("click", async () => {
    const password = modal.querySelector("#deleteGroupPassword")?.value;
    const body = {};
    if (password) body.password = password;
    const res = await authFetch(API.deleteGroupChat(convId), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { showToast("Đã xóa nhóm", "green"); modal.remove(); activeConvId = null; messagesEl?.replaceChildren(); chatTitle ? chatTitle.textContent = "Chọn hội thoại" : null; $("chatPanel")?.classList.add("hidden"); loadConversations(); }
    else { const err = await res.json().catch(() => ({})); showToast(err.error || "Xóa thất bại", "red"); }
  });
}

async function showLeaveGroupModal(convId) {
  const members = await fetchConversationMembers(convId);
  const isAdmin = members.some((m) => Number(m.user?.id) === Number(myProfileId) && m.role === 'admin');
  const otherMembers = members.filter((m) => Number(m.user?.id) !== Number(myProfileId));

  if (isAdmin && otherMembers.length === 0) { showToast("Không thể rời nhóm vì bạn là admin duy nhất. Hãy xóa nhóm.", "red"); return; }

  const modal = document.createElement("div");
  modal.className = "fixed inset-0 modal-backdrop z-[85] flex items-center justify-center p-4";
  let html = `<div class="glass-card rounded-2xl w-full max-w-md p-4"><div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Rời nhóm</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>`;

  if (isAdmin) {
    html += `<p class="text-sm text-gray-600 mb-3">Bạn là admin. Vui lòng chọn người kế thừa quyền admin:</p><div id="leaveAdminTransferList" class="space-y-1 max-h-40 overflow-y-auto mb-3"></div>`;
  }
  html += `<button type="button" id="submitLeaveGroup" class="w-full rounded-xl bg-red-500 text-white font-semibold py-2">Rời nhóm</button></div>`;

  modal.innerHTML = html;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  if (isAdmin) {
    const list = modal.querySelector("#leaveAdminTransferList");
    otherMembers.forEach((m) => {
      if (!m.user) return;
      const row = document.createElement("label");
      row.className = "flex items-center gap-3 rounded-xl p-2 hover:bg-fb-secondary dark:hover:bg-white/10 cursor-pointer";
      row.innerHTML = `<input type="radio" name="leave-admin" class="leave-admin-radio" value="${m.user.id}"><img src="${m.user.picture || DEFAULT_AVATAR}" class="w-9 h-9 rounded-full object-cover"><span class="text-sm dark:text-white">${fullName(m.user)}</span>`;
      list?.appendChild(row);
    });
  }

  modal.querySelector("#submitLeaveGroup")?.addEventListener("click", async () => {
    const body = {};
    if (isAdmin) {
      const radio = modal.querySelector(".leave-admin-radio:checked");
      if (!radio) { showToast("Chọn người kế thừa admin", "red"); return; }
      body.next_admin_user_id = Number(radio.value);
    }
    const res = await authFetch(API.leaveGroupChat(convId), { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { showToast("Đã rời nhóm", "green"); modal.remove(); activeConvId = null; messagesEl?.replaceChildren(); chatTitle ? chatTitle.textContent = "Chọn hội thoại" : null; $("chatPanel")?.classList.add("hidden"); loadConversations(); }
    else { showToast("Rời nhóm thất bại", "red"); }
  });
}

// ==================== TASK MODAL ====================
async function showTaskModal(convId) {
  document.getElementById("taskModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "taskModal";
  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">📋 Công việc</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <button type="button" id="showCreateTaskForm" class="text-sm text-fb-primary font-semibold mb-3">+ Tạo công việc mới</button>
      <div id="createTaskForm" class="hidden space-y-2 mb-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
        <input id="taskTitleInput" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Tiêu đề">
        <textarea id="taskDescInput" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Mô tả" rows="2"></textarea>
        <select id="taskPriorityInput" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option></select>
        <input id="taskDeadlineInput" type="datetime-local" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm">
        <button type="button" id="submitCreateTask" class="w-full rounded-lg bg-fb-primary text-white font-semibold py-2 text-sm">Tạo</button>
      </div>
      <div id="taskList" class="flex-1 overflow-y-auto space-y-2"></div>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  modal.querySelector("#showCreateTaskForm")?.addEventListener("click", () => {
    const form = modal.querySelector("#createTaskForm");
    form.classList.toggle("hidden");
  });

  modal.querySelector("#submitCreateTask")?.addEventListener("click", async () => {
    const title = modal.querySelector("#taskTitleInput")?.value.trim();
    if (!title) { showToast("Nhập tiêu đề", "red"); return; }
    const body = { title, description: modal.querySelector("#taskDescInput")?.value || "", priority: modal.querySelector("#taskPriorityInput")?.value || "medium" };
    const deadline = modal.querySelector("#taskDeadlineInput")?.value;
    if (deadline) body.deadline = deadline;
    const res = await authFetch(API.createTask(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) { showToast("Đã tạo task", "green"); modal.querySelector("#createTaskForm")?.classList.add("hidden"); loadTaskList(convId); }
    else { showToast("Tạo thất bại", "red"); }
  });

  await loadTaskList(convId);
}

async function loadTaskList(convId) {
  const list = document.getElementById("taskList");
  if (!list) return;
  const res = await authFetch(withPageSize(API.listTasks(convId), 50));
  const data = res.ok ? await res.json() : { results: [] };
  list.replaceChildren();
  (data.results || []).forEach((t) => {
    const card = document.createElement("div");
    card.className = "p-3 rounded-xl bg-white dark:bg-white/5 border dark:border-white/10";
    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sm dark:text-white ${t.is_finished ? 'line-through opacity-60' : ''}">${t.title}</p>
          ${t.description ? `<p class="text-xs text-gray-500 mt-1">${t.description}</p>` : ''}
          <div class="flex gap-2 mt-1 flex-wrap">
            <span class="text-[10px] px-2 py-0.5 rounded-full ${t.priority === 'high' ? 'bg-red-100 text-red-600' : t.priority === 'low' ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-700'}">${t.priority}</span>
            <span class="text-[10px] px-2 py-0.5 rounded-full ${t.status === 'done' ? 'bg-green-100 text-green-600' : t.status === 'in_progress' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}">${t.status}</span>
            ${t.deadline ? `<span class="text-[10px] text-gray-400">📅 ${new Date(t.deadline).toLocaleDateString('vi-VN')}</span>` : ''}
          </div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button type="button" data-task-id="${t.id}" data-action="toggle" class="text-xs px-2 py-1 rounded hover:bg-fb-secondary dark:hover:bg-white/10 ${t.is_finished ? 'text-gray-400' : 'text-green-600'}">${t.is_finished ? '↩️' : '✅'}</button>
          <button type="button" data-task-id="${t.id}" data-action="delete" class="text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">🗑️</button>
        </div>
      </div>
      ${t.assigned_to?.length ? `<div class="flex gap-1 mt-2 flex-wrap">${t.assigned_to.map((u) => `<span class="text-[10px] bg-fb-secondary dark:bg-white/10 px-2 py-0.5 rounded-full">@${u.full_name || ''}</span>`).join('')}</div>` : ''}`;
    list.appendChild(card);

    card.querySelector("[data-action='toggle']")?.addEventListener("click", async () => {
      const body = { is_finished: !t.is_finished, status: t.is_finished ? 'todo' : 'done' };
      await authFetch(API.updateTask(convId, t.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      loadTaskList(convId);
    });
    card.querySelector("[data-action='delete']")?.addEventListener("click", async () => {
      if (!await confirmDialog("Xóa task này?")) return;
      await authFetch(API.deleteTask(convId, t.id), { method: "DELETE" });
      loadTaskList(convId);
    });
  });
}

// ==================== VOTE MODAL ====================
async function showVoteModal(convId) {
  document.getElementById("voteModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "voteModal";
  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">📊 Bình chọn</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <button type="button" id="showCreateVoteForm" class="text-sm text-fb-primary font-semibold mb-3">+ Tạo bình chọn mới</button>
      <div id="createVoteForm" class="hidden space-y-2 mb-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">
        <input id="voteTitleInput" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Câu hỏi">
        <div id="voteOptionsInput" class="space-y-1">
          <input class="vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Lựa chọn 1">
          <input class="vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Lựa chọn 2">
        </div>
        <button type="button" id="addVoteOptionRow" class="text-xs text-fb-primary">+ Thêm lựa chọn</button>
        <button type="button" id="submitCreateVote" class="w-full rounded-lg bg-fb-primary text-white font-semibold py-2 text-sm">Tạo bình chọn</button>
      </div>
      <div id="voteList" class="flex-1 overflow-y-auto space-y-3"></div>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  modal.querySelector("#showCreateVoteForm")?.addEventListener("click", () => {
    modal.querySelector("#createVoteForm")?.classList.toggle("hidden");
  });

  modal.querySelector("#addVoteOptionRow")?.addEventListener("click", () => {
    const container = modal.querySelector("#voteOptionsInput");
    const input = document.createElement("input");
    input.className = "vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm";
    input.placeholder = `Lựa chọn ${container.children.length + 1}`;
    container.appendChild(input);
  });

  modal.querySelector("#submitCreateVote")?.addEventListener("click", async () => {
    const title = modal.querySelector("#voteTitleInput")?.value.trim();
    if (!title) { showToast("Nhập câu hỏi", "red"); return; }
    const options = [...modal.querySelectorAll(".vote-option-input")].map((i) => i.value.trim()).filter(Boolean);
    if (options.length < 2) { showToast("Cần ít nhất 2 lựa chọn", "red"); return; }
    const res = await authFetch(API.createVote(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, options }) });
    if (res.ok) { showToast("Đã tạo bình chọn", "green"); modal.querySelector("#createVoteForm")?.classList.add("hidden"); loadVoteList(convId); }
    else { showToast("Tạo thất bại", "red"); }
  });

  await loadVoteList(convId);
}

async function loadVoteList(convId) {
  const list = document.getElementById("voteList");
  if (!list) return;
  const res = await authFetch(API.listVotes(convId));
  const data = res.ok ? await res.json() : { results: [] };
  list.replaceChildren();
  for (const v of (data.results || [])) {
    const card = document.createElement("div");
    card.className = "p-3 rounded-xl bg-white dark:bg-white/5 border dark:border-white/10";
    const totalVotes = (v.options || []).reduce((s, o) => s + o.count, 0);

    card.innerHTML = `
      <div class="flex items-start justify-between mb-2">
        <p class="font-semibold text-sm dark:text-white">${v.title}</p>
        <span class="text-[10px] px-2 py-0.5 rounded-full ${v.is_closed ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}">${v.is_closed ? 'Đã đóng' : 'Đang mở'}</span>
      </div>
      <div class="space-y-1">
        ${(v.options || []).map((o) => {
      const pct = totalVotes > 0 ? Math.round((o.count / totalVotes) * 100) : 0;
      return `<div class="vote-option-item ${v.is_closed ? '' : 'cursor-pointer hover:bg-fb-secondary dark:hover:bg-white/5'} rounded-lg p-2 ${o.is_voted ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' : ''}" data-vote-id="${v.id}" data-option-id="${o.id}">
            <div class="flex justify-between text-xs"><span class="dark:text-white">${o.text}</span><span class="text-gray-500">${o.count} phiếu (${pct}%)</span></div>
            <div class="w-full h-1.5 bg-gray-200 dark:bg-white/10 rounded-full mt-1"><div class="h-1.5 rounded-full transition-all ${o.is_voted ? 'bg-fb-primary' : 'bg-gray-400 dark:bg-white/30'}" style="width:${pct}%"></div></div>
            ${o.is_voted ? '<span class="text-[10px] text-fb-primary">✓ Đã bình chọn</span>' : ''}
          </div>`;
    }).join('')}
      </div>
      <p class="text-[10px] text-gray-400 mt-2">Tổng: ${totalVotes} phiếu</p>`;

    list.appendChild(card);

    if (!v.is_closed) {
      card.querySelectorAll(".vote-option-item").forEach((el) => {
        el.addEventListener("click", async () => {
          const voteId = el.dataset.voteId;
          const optionId = el.dataset.optionId;
          const res = await authFetch(API.userVote(convId, voteId, optionId), { method: "POST" });
          if (res.ok) { loadVoteList(convId); } else { showToast("Bình chọn thất bại", "red"); }
        });
      });
    }
  }
}

// ==================== GROUP FILES MODAL ====================
async function showGroupFilesModal(convId) {
  document.getElementById("groupFilesModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "groupFilesModal";
  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">📁 Tệp đã gửi</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <div class="flex gap-2 mb-3">
        <button type="button" data-filter="all" class="file-filter-btn text-xs px-3 py-1.5 rounded-full bg-fb-primary text-white">Tất cả</button>
        <button type="button" data-filter="image" class="file-filter-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">Ảnh</button>
        <button type="button" data-filter="file" class="file-filter-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">File</button>
        <button type="button" data-filter="video" class="file-filter-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">Video</button>
      </div>
      <div id="groupFilesList" class="flex-1 overflow-y-auto space-y-2"></div>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  let currentFilter = 'all';
  modal.querySelectorAll(".file-filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      modal.querySelectorAll(".file-filter-btn").forEach((b) => { b.className = "text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white"; });
      btn.className = "text-xs px-3 py-1.5 rounded-full bg-fb-primary text-white";
      currentFilter = btn.dataset.filter;
      loadGroupFiles(convId, currentFilter);
    });
  });

  await loadGroupFiles(convId, 'all');
}

async function loadGroupFiles(convId, filter) {
  const list = document.getElementById("groupFilesList");
  if (!list) return;
  let url = withPageSize(API.chatFiles(convId), 30);
  if (filter !== 'all') url += `&file_type=${filter}`;
  const res = await authFetch(url);
  const data = res.ok ? await res.json() : { results: [] };
  list.replaceChildren();
  (data.results || []).forEach((f) => {
    const item = document.createElement("div");
    item.className = "flex items-center gap-3 p-2 rounded-lg hover:bg-fb-secondary dark:hover:bg-white/5";
    const icon = f.file_type === 'image' ? '🖼️' : f.file_type === 'video' ? '🎬' : '📄';
    item.innerHTML = `<span class="text-lg">${icon}</span><div class="flex-1 min-w-0"><p class="text-sm dark:text-white truncate">${f.file_name}</p><p class="text-[10px] text-gray-400">${f.uploaded_by?.first_name || ''} · ${new Date(f.created_at).toLocaleDateString('vi-VN')}</p></div><a href="${f.file_url}" target="_blank" class="text-xs text-fb-primary shrink-0">Tải</a>`;
    list.appendChild(item);
  });
  if (!(data.results || []).length) list.appendChild(textEl("p", "text-sm text-gray-400 text-center py-4", "Chưa có tệp nào."));
}

// ==================== BIND EVENTS ====================
function bindEvents() {
  chatForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canSendWhilePending()) { showToast("Chấp nhận yêu cầu tin nhắn trước khi trả lời", "red"); return; }
    const text = chatInput?.value.trim();
    if (!text || !chatWs || chatWs.readyState !== WebSocket.OPEN) { showToast("Không gửi được", "red"); return; }
    const payload = { message: text, message_type: "text" };
    if (replyToId) payload.reply_to_id = replyToId;
    chatWs.send(JSON.stringify(payload));
    setTyping(false); clearReply();
    if (chatInput) chatInput.value = "";
    if (pendingConv && activeConvMeta && canSendWhilePending()) {
      fetchFirstMessage(activeConvId).then((m) => { firstMessageInConv = m; applyPendingUI(activeConvMeta); });
    }
  });

  cancelReplyBtn?.addEventListener("click", clearReply);

  const backToChatList = $("backToChatList");
  const chatPanel = $("chatPanel");
  backToChatList?.addEventListener("click", () => { if (chatPanel) { chatPanel.classList.add("hidden"); chatPanel.classList.remove("flex"); } });

  chatInput?.addEventListener("input", () => { if (!chatWs || chatWs.readyState !== WebSocket.OPEN || !activeConvId) return; setTyping(true); });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activeConvId && !pendingConv) authFetch(API.seenMessage(activeConvId), { method: "POST" }).catch(() => { });
  });

  $("chatFileInput")?.addEventListener("change", async (e) => {
    const input = e.target;
    if (!activeConvId) { showToast("Chọn hội thoại trước", "red"); input.value = ""; return; }
    if (!canSendWhilePending()) { showToast("Chấp nhận yêu cầu tin nhắn trước khi gửi file", "red"); input.value = ""; return; }
    const files = input.files;
    if (!files?.length) return;
    const attachBtn = input.closest("label");
    if (attachBtn) attachBtn.classList.add("opacity-50", "pointer-events-none");
    try {
      const ids = await uploadChatFiles(activeConvId, files);
      sendChatWsMessage(chatWs, { text: "", attachmentIds: ids });
      showToast("Đã gửi tệp đính kèm");
    } catch (err) { showToast(err.message || "Upload thất bại", "red"); }
    finally { input.value = ""; attachBtn?.classList.remove("opacity-50", "pointer-events-none"); }
  });

  messagesEl?.addEventListener("scroll", () => {
    if (!messagesEl || !messagesNext || loadingMessages) return;
    if (messagesEl.scrollTop < 80) loadMessages(false);
  });

  $("showHiddenChats")?.addEventListener("click", async () => {
    const modal = $("hiddenChatsModal");
    const list = $("hiddenChatsList");
    modal?.classList.remove("hidden"); list?.replaceChildren();
    try {
      const res = await authFetch(withPageSize(API.hiddenChats(), 20));
      const data = await res.json();
      (data.results || []).forEach((c) => {
        const item = document.createElement("div");
        item.className = "flex items-center justify-between p-3 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] rounded-lg dark:text-[#e4e6eb]";
        const name = document.createElement("span"); name.className = "flex-1"; name.textContent = getConvTitle(c);
        const actions = document.createElement("div"); actions.className = "flex gap-2";
        const unhideBtn = document.createElement("button");
        unhideBtn.type = "button"; unhideBtn.className = "px-3 py-1 bg-fb-primary dark:bg-[#1877f2] text-white rounded text-sm hover:bg-fb-primary-hover";
        unhideBtn.textContent = "Hiện lại";
        unhideBtn.onclick = async () => { await authFetch(API.hideConv(c.id), { method: "PATCH" }); item.remove(); showToast("Đã hiện lại đoạn chat"); loadConversations(); };
        const openBtn = document.createElement("button");
        openBtn.type = "button"; openBtn.className = "text-fb-primary text-sm font-semibold hover:underline"; openBtn.textContent = "Mở";
        openBtn.onclick = () => { modal?.classList.add("hidden"); openConversation(c); };
        actions.appendChild(unhideBtn); actions.appendChild(openBtn); item.appendChild(name); item.appendChild(actions);
        list?.appendChild(item);
      });
    } catch { showToast("Không tải tin nhắn ẩn", "red"); }
  });

  $("closeHiddenChats")?.addEventListener("click", () => $("hiddenChatsModal")?.classList.add("hidden"));
}

function addCreateGroupButton() {
  const header = document.querySelector("#chatPageRoot aside > div");
  if (!header || document.getElementById("createGroupChatBtn")) return;
  const btn = document.createElement("button");
  btn.id = "createGroupChatBtn";
  btn.type = "button";
  btn.className = "text-sm px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-500/30 transition-all shadow-sm";
  btn.textContent = "Tạo nhóm";
  btn.addEventListener("click", showCreateGroupModal);
  header.appendChild(btn);
}

async function showCreateGroupModal() {
  document.getElementById("createGroupModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "createGroupModal";
  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-4">
      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Tạo nhóm chat</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>
      <input id="groupNameInput" class="w-full rounded-xl px-3 py-2 bg-slate-100 dark:bg-white/10 dark:text-white mb-3" placeholder="Tên nhóm">
      <div id="groupFriendList" class="flex-1 overflow-y-auto space-y-1 min-h-[220px]"></div>
      <button type="button" id="submitCreateGroup" class="mt-3 w-full rounded-xl bg-fb-primary text-white font-semibold py-2">Tạo nhóm</button>
    </div>`;
  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  const list = modal.querySelector("#groupFriendList");
  const res = await authFetch(withPageSize(API.friends(), 100));
  const data = res.ok ? await res.json() : { results: [] };
  (data.results || []).forEach((f) => {
    const profile = f.user;
    if (!profile?.user) return;
    const row = document.createElement("label");
    row.className = "flex items-center gap-3 rounded-xl p-2 hover:bg-fb-secondary dark:hover:bg-white/10 cursor-pointer";
    row.innerHTML = `<input type="checkbox" class="group-member-check" value="${profile.user}"><img src="${profile.picture || DEFAULT_AVATAR}" class="w-9 h-9 rounded-full object-cover"><span class="text-sm dark:text-white">${fullName(profile)}</span>`;
    list?.appendChild(row);
  });

  modal.querySelector("#submitCreateGroup")?.addEventListener("click", async () => {
    const name = modal.querySelector("#groupNameInput")?.value.trim();
    const members = [...modal.querySelectorAll(".group-member-check:checked")].map((i) => Number(i.value));
    if (!name || members.length < 2) { showToast("Nhập tên nhóm và chọn ít nhất 2 bạn bè", "red"); return; }
    const createRes = await authFetch(API.createGroupChat(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, members }) });
    if (!createRes.ok) { showToast("Không tạo được nhóm", "red"); return; }
    const conv = await createRes.json();
    modal.remove();
    await loadConversations();
    openConversation(conv, conv.name);
  });
}

async function initChat() {
  convListEl = $("chatConvList");
  friendsStrip = $("chatFriendsStrip");
  messagesEl = $("chatMessages");
  chatTitle = $("chatTitle");
  chatForm = $("chatForm");
  chatInput = $("chatInput");
  pendingBanner = $("chatPendingBanner");
  replyPreviewBar = $("replyPreviewBar");
  replyPreviewText = $("replyPreviewText");
  cancelReplyBtn = $("cancelReplyBtn");
  chatHeaderActions = $("chatHeaderActions");

  if (!convListEl) { console.error("[chat] #chatConvList not found"); return; }
  if (!messagesEl) { console.error("[chat] #chatMessages not found"); return; }

  bindEvents();
  addCreateGroupButton();

  try {
    await loadCurrentUser();
    connectConvListWs();
    await Promise.all([loadFriendsStrip(), loadConversations()]);
  } catch (e) {
    console.error("[chat] init failed", e);
    showToast("Không tải được Messenger", "red");
    if (convListEl) {
      const errBox = el("div", "text-sm text-red-500 p-4 text-center");
      errBox.appendChild(textEl("p", "", "Lỗi tải dữ liệu."));
      const retry = el("button", "underline text-fb-primary mt-2", { type: "button", text: "Thử lại" });
      retry.addEventListener("click", () => initChat());
      errBox.appendChild(retry);
      convListEl.appendChild(errBox);
    }
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => initChat());
else initChat();