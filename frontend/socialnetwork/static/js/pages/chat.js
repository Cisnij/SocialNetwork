import { authFetch, authFetchCache } from "../authenticate/auth.js";

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

  if (lm.message_type === 'file' || (lm.attachments && lm.attachments.length > 0 && !lm.content)) return 'File đính kèm';

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



function isCurrentUserActiveMember() {

  return (activeConvMembers || []).some(

    (m) => Number(m.user?.id) === Number(myProfileId) && m.is_active !== false

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



  try {

    await authFetchCache(withPageSize(API.friends(), 40), {}, (data, isCache) => {

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

    });

  } catch (err) {

    console.error("Failed to load friends", err);

  }

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

  let chatbotItem = null;

  const normalItems = [];



  items.forEach(c => {

    if (c.is_chatbot) chatbotItem = c;

    else normalItems.push(c);

  });



  if (chatbotItem) {

    const wrap = renderConvItem(chatbotItem);

    wrap.classList.add("sticky", "top-0", "z-10", "bg-white", "dark:bg-[#242526]", "border-b", "dark:border-white/10", "rounded-none", "rounded-t-lg");

    convListEl.appendChild(wrap);

  }



  if (!normalItems.length && !chatbotItem) {

    convListEl.appendChild(textEl("p", "text-sm text-gray-400 p-4 text-center", "Chưa có tin nhắn"));

  } else {

    normalItems.forEach((c) => convListEl.appendChild(renderConvItem(c)));

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



  if (!c.is_chatbot) {

    const menuBtn = textEl("span", "conv-menu hidden group-hover:inline text-xl px-1 shrink-0", "⋮");

    wrap.appendChild(menuBtn);



    menuBtn.addEventListener("click", (e) => {

      e.stopPropagation();

      showConvMenu(c.id, wrap, c);

    });

  }



  wrap.addEventListener("click", (e) => {

    if (e.target.closest(".conv-menu")) return;

    wrap.querySelector(".conv-unread-dot")?.remove();

    openConversation(c, name);

  });



  convMap.set(c.id, { el: wrap, data: c });

  return wrap;

}



// ==================== CONTEXT MENU FIXED ====================

function showConvMenu(convId, anchor, conv) {

  if (conv?.is_chatbot) return;

  document.querySelectorAll(".conv-context-menu").forEach((m) => m.remove());



  const menu = document.createElement("div");

  menu.className = "conv-context-menu fixed bg-white dark:bg-[#242526] shadow-xl rounded-lg z-[9999] py-1 text-sm min-w-[180px] border dark:border-fb-divider";



  const rect = anchor.getBoundingClientRect();

  let top = rect.top;

  let left = rect.right - 180;

  if (left < 10) left = 10;

  if (top + 200 > window.innerHeight) top = window.innerHeight - 220;

  if (top < 10) top = 10;

  menu.style.top = top + "px";

  menu.style.left = left + "px";



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



  if (conv?.is_group) {

    menu.appendChild(el("hr", "border-t dark:border-white/10 my-1", {}));

    const members = document.createElement("button");

    members.type = "button";

    members.className = "block w-full text-left px-4 py-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c]";

    members.textContent = "👥 Xem thành viên";

    members.onclick = async () => { menu.remove(); showGroupMembersModal(convId); };

    menu.appendChild(members);



    const leave = document.createElement("button");

    leave.type = "button";

    leave.className = "block w-full text-left px-4 py-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] text-red-500";

    leave.textContent = "🚪 Rời nhóm";

    leave.onclick = async () => { await showLeaveGroupModal(convId); menu.remove(); };

    menu.appendChild(leave);

  }



  document.body.appendChild(menu);

  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);

}



// ==================== GROUP MEMBERS MODAL ====================

async function showGroupMembersModal(convId) {

  const members = await fetchConversationMembers(convId);

  const modal = document.createElement("div");

  modal.className = "fixed inset-0 modal-backdrop z-[85] flex items-center justify-center p-4";

  modal.innerHTML = `

    <div class="glass-card rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-4">

      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">👥 Thành viên nhóm</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>

      <div id="groupMembersList" class="flex-1 overflow-y-auto space-y-2"></div>

    </div>`;

  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());

  document.body.appendChild(modal);



  const list = modal.querySelector("#groupMembersList");

  const isAdmin = members.some((m) => Number(m.user?.id) === Number(myProfileId) && m.role === 'admin');

  members.forEach((m) => {

    if (!m.user) return;

    const row = document.createElement("div");

    row.className = "flex items-center gap-3 p-2 rounded-lg hover:bg-fb-secondary dark:hover:bg-white/10";

    const avatar = document.createElement("img");

    avatar.src = m.user.picture || DEFAULT_AVATAR;

    avatar.className = "w-10 h-10 rounded-full object-cover";

    const info = document.createElement("div");

    info.className = "flex-1";

    info.innerHTML = `<p class="text-sm font-semibold dark:text-white">${fullName(m.user)} ${m.role === 'admin' ? '👑' : ''}</p>`;

    row.append(avatar, info);



    // Kick button for admin

    if (isAdmin && Number(m.user?.id) !== Number(myProfileId) && m.role !== 'admin') {

      const kickBtn = document.createElement("button");

      kickBtn.type = "button";

      kickBtn.className = "text-xs px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600 hover:bg-red-200";

      kickBtn.textContent = "Kick";

      kickBtn.onclick = async () => {

        if (!await confirmDialog(`Kick ${fullName(m.user)} khỏi nhóm?`)) return;

        const res = await authFetch(API.kickGroupMember(convId, m.user.id), { method: "POST" });

        if (res.ok) { showToast("Đã kick", "green"); row.remove(); } else showToast("Kick thất bại", "red");

      };

      row.appendChild(kickBtn);

    }

    list?.appendChild(row);

  });

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

  if (!firstMessageInConv) return true;

  if (conv && conv.created_by && myUserId != null && Number(conv.created_by) === Number(myUserId)) return true;

  return !!conv?._startedByMe;

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

  userLastReadMap.clear();

  clearReply();



  const panel = $("chatPanel");

  panel?.classList.remove("hidden"); panel?.classList.add("flex");

  if (chatTitle) chatTitle.textContent = titleName || getConvTitle(conv);



  messagesEl.replaceChildren();



  // Show left-group message if member is inactive

  const memberCheck = await checkMembershipStatus(conv.id);

  if (!memberCheck || !memberCheck.is_active) {

    if (chatForm) {

      chatForm.classList.add("hidden");

    }

    const leftBanner = document.getElementById("leftGroupBanner");

    if (!leftBanner) {

      const banner = document.createElement("div");

      banner.id = "leftGroupBanner";

      banner.className = "p-4 sm:p-5 border-t border-slate-200 dark:border-white/10 flex justify-center items-center bg-white/95 dark:bg-white/10 backdrop-blur-xl z-20 shadow-lg";

      banner.innerHTML = `<p class="text-slate-500 dark:text-slate-400 font-medium bg-slate-100 dark:bg-white/10 px-6 py-3 rounded-2xl w-full text-center">Bạn không còn trong nhóm này</p>`;

      if (chatForm && chatForm.parentNode) {

        chatForm.parentNode.insertBefore(banner, chatForm.nextSibling);

      }

    } else {

      leftBanner.classList.remove("hidden");

    }

  } else {

    if (chatForm) chatForm.classList.remove("hidden");

    const leftBanner = document.getElementById("leftGroupBanner");

    if (leftBanner) leftBanner.classList.add("hidden");

  }



  const loader = document.createElement("div"); loader.className = "flex items-center justify-center h-full gap-2";

  const spinner = document.createElement("div"); spinner.className = "w-5 h-5 border-3 border-fb-primary border-t-transparent rounded-full animate-spin"; loader.appendChild(spinner);

  const loadText = document.createElement("p"); loadText.className = "text-sm text-gray-500 dark:text-fb-muted"; loadText.textContent = "Đang tải..."; loader.appendChild(loadText);

  messagesEl.appendChild(loader);



  pendingBanner?.classList.add("hidden");

  const typingIndicator = document.getElementById("chatTypingIndicator");

  if (typingIndicator) { typingIndicator.textContent = ""; typingIndicator.classList.remove("typing-active"); }

  pendingConv = conv.status === "pending";

  firstMessageInConv = null;

  loadingMessages = false; // Reset to allow loadMessages to run



  connectChatWs(conv.id);

  messagesNext = API.messages(conv.id);

  await loadMessages(true);

  activeConvMembers = await fetchConversationMembers(conv.id);

  if (activeConvMembers.length) activeConvMeta.members = activeConvMembers;



  if (pendingConv) { firstMessageInConv = await fetchFirstMessage(conv.id); await applyPendingUI(conv); }

  else chatForm?.classList.remove("opacity-50", "pointer-events-none");



  try { await authFetch(API.seenMessage(conv.id), { method: "POST" }); } catch (e) { console.warn("[chat] seen", e); }



  // Update seen based on other members' last_read_message

  const otherMems = (activeConvMembers.length ? activeConvMembers : (conv.members || [])).filter((m) => Number(m.user?.id) !== Number(myProfileId));

  otherMems.forEach((m) => {

    if (m.last_read_message) markSeenMessages(m.last_read_message, m.user);

  });



  updateChatHeaderActions(conv);

}



async function checkMembershipStatus(convId) {

  try {

    const res = await authFetch(withPageSize(API.conversationMembers(convId), 100));

    if (!res.ok) return null;

    const data = await res.json();

    const members = data.results || [];

    return members.find((m) => Number(m.user?.id) === Number(myProfileId)) || null;

  } catch { return null; }

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



  // Members & Files button for all chats

  const infoBtn = document.createElement("button");

  infoBtn.type = "button";

  infoBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";

  infoBtn.title = "Thông tin & tệp";

  infoBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

  infoBtn.onclick = () => showConvInfoModal(conv.id, conv);

  chatHeaderActions.appendChild(infoBtn);



  if (!conv.is_group) return;



  // Task Button

  const taskBtn = document.createElement("button");

  taskBtn.type = "button";

  taskBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";

  taskBtn.title = "Todo Task";

  taskBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>`;

  taskBtn.onclick = () => showTaskModal(conv.id);

  chatHeaderActions.appendChild(taskBtn);



  // Vote Button

  const voteBtn = document.createElement("button");

  voteBtn.type = "button";

  voteBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";

  voteBtn.title = "Bình chọn";

  voteBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>`;

  voteBtn.onclick = () => showVoteModal(conv.id);

  chatHeaderActions.appendChild(voteBtn);



  // Group settings

  const groupSettingsBtn = document.createElement("button");

  groupSettingsBtn.type = "button";

  groupSettingsBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";

  groupSettingsBtn.title = "Cài đặt nhóm";

  groupSettingsBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`;

  groupSettingsBtn.onclick = () => showGroupSettingsModal(conv.id);

  chatHeaderActions.appendChild(groupSettingsBtn);

}



// ==================== CONVERSATION INFO MODAL ====================

function showConvInfoModal(convId, conv) {

  const modal = document.createElement("div");

  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";

  modal.innerHTML = `

    <div class="glass-card rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-4">

      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">${conv.is_group ? 'Thông tin nhóm' : 'Thông tin'}</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>

      <div class="flex gap-2 mb-3">

        <button type="button" data-tab="members" class="info-tab-btn text-xs px-3 py-1.5 rounded-full bg-fb-primary text-white">Thành viên</button>

        <button type="button" data-tab="files" class="info-tab-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">Tệp</button>

        <button type="button" data-tab="tasks" class="info-tab-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">Công việc</button>

        <button type="button" data-tab="votes" class="info-tab-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">Bình chọn</button>

      </div>

      <div id="convInfoTabContent" class="flex-1 overflow-y-auto"></div>

    </div>`;

  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());

  document.body.appendChild(modal);



  const tabContent = modal.querySelector("#convInfoTabContent");

  let currentTab = 'members';



  function switchTab(tab) {

    currentTab = tab;

    modal.querySelectorAll(".info-tab-btn").forEach((b) => {

      b.className = "text-xs px-3 py-1.5 rounded-full " + (b.dataset.tab === tab ? "bg-fb-primary text-white" : "bg-fb-secondary dark:bg-white/10 dark:text-white");

    });

    if (tab === 'members') loadConvMembersTab(convId, tabContent);

    else if (tab === 'files') loadConvFilesTab(convId, tabContent);

    else if (tab === 'tasks') showTaskModal(convId, tabContent);

    else if (tab === 'votes') showVoteModal(convId, tabContent);

  }



  modal.querySelectorAll(".info-tab-btn").forEach((btn) => {

    btn.addEventListener("click", () => switchTab(btn.dataset.tab));

  });



  switchTab('members');

}



async function loadConvMembersTab(convId, container) {

  container.innerHTML = '<p class="text-sm text-gray-400 p-4 text-center">Đang tải...</p>';

  const members = await fetchConversationMembers(convId);

  const isAdmin = isCurrentUserAdmin();

  container.replaceChildren();

  members.forEach((m) => {

    if (!m.user) return;

    const isMe = Number(m.user.id) === Number(myProfileId);

    const canKick = isAdmin && !isMe;



    const row = document.createElement("div");

    row.className = "flex items-center gap-3 p-2 rounded-lg hover:bg-fb-secondary dark:hover:bg-white/10";

    row.innerHTML = `

      <img src="${m.user.picture || DEFAULT_AVATAR}" class="w-10 h-10 rounded-full object-cover">

      <div class="flex-1">

        <p class="text-sm font-semibold dark:text-white">${fullName(m.user)} ${m.role === 'admin' ? '👑' : ''}</p>

      </div>

      ${canKick ? `<button type="button" data-kick="${m.user.user}" class="text-xs text-red-500 hover:underline px-2">Xóa</button>` : ''}

    `;

    container.appendChild(row);



    if (canKick) {

      row.querySelector("[data-kick]")?.addEventListener("click", async () => {

        if (!await confirmDialog(`Xóa ${fullName(m.user)} khỏi nhóm?`)) return;

        const res = await authFetch(API.kickGroupMember(convId, m.user.user), { method: "POST" });

        if (res.ok) {

          showToast("Đã xóa khỏi nhóm", "green");

          loadConvMembersTab(convId, container);

        } else {

          showToast("Không thể xóa", "red");

        }

      });

    }

  });

}



async function loadConvFilesTab(convId, container) {

  container.innerHTML = '<p class="text-sm text-gray-400 p-4 text-center">Đang tải...</p>';

  const url = withPageSize(API.chatFiles(convId), 30);

  const res = await authFetch(url);

  const data = res.ok ? await res.json() : { results: [] };

  container.replaceChildren();



  const mediaGrid = document.createElement("div");

  mediaGrid.className = "grid grid-cols-3 gap-1 mb-4";



  const fileList = document.createElement("div");

  fileList.className = "space-y-2";



  (data.results || []).forEach((f) => {

    const isImage = f.file_type === 'image' || f.file_type?.startsWith('image/') || f.file_url?.match(/\.(jpg|jpeg|png|gif|webp)/i);

    const isVideo = f.file_type === 'video' || f.file_type?.startsWith('video/');



    if (isImage) {

      const wrapper = document.createElement("a");

      wrapper.href = f.file_url;

      wrapper.target = "_blank";

      wrapper.className = "block aspect-square cursor-pointer hover:opacity-90 transition";

      wrapper.innerHTML = `<img src="${f.file_url}" class="w-full h-full object-cover" loading="lazy" alt="${f.file_name}">`;

      mediaGrid.appendChild(wrapper);

    } else if (isVideo) {

      const wrapper = document.createElement("div");

      wrapper.className = "block aspect-square bg-black/10 dark:bg-white/5 flex items-center justify-center relative";

      wrapper.innerHTML = `<video src="${f.file_url}" class="w-full h-full object-cover" controls preload="metadata"></video>`;

      mediaGrid.appendChild(wrapper);

    } else {

      const item = document.createElement("a");

      item.href = f.file_url;

      item.target = "_blank";

      item.className = "flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/10 transition group";



      const sizeStr = f.file_size ? `${Math.round(f.file_size / 1024)} KB` : '';

      const dateStr = new Date(f.created_at).toLocaleDateString('vi-VN');

      const uploader = f.uploaded_by?.first_name || '';



      item.innerHTML = `

        <div class="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">

          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>

        </div>

        <div class="flex-1 min-w-0">

          <p class="text-sm font-semibold dark:text-white truncate group-hover:text-blue-600 transition-colors">${f.file_name}</p>

          <p class="text-[11px] text-gray-500 dark:text-gray-400 truncate">${sizeStr ? sizeStr + ' · ' : ''}${uploader} · ${dateStr}</p>

        </div>

        <div class="shrink-0 w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center group-hover:bg-blue-100 dark:group-hover:bg-blue-500/30 text-gray-500 dark:text-gray-300 group-hover:text-blue-600 transition-colors">

          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>

        </div>

      `;

      fileList.appendChild(item);

    }

  });



  if (mediaGrid.childElementCount > 0) {

    const title = document.createElement("p");

    title.className = "text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider";

    title.textContent = "Phương tiện";

    container.appendChild(title);

    container.appendChild(mediaGrid);

  }



  if (fileList.childElementCount > 0) {

    const title = document.createElement("p");

    title.className = "text-xs font-bold text-gray-500 mb-2 mt-4 uppercase tracking-wider";

    title.textContent = "Tài liệu";

    container.appendChild(title);

    container.appendChild(fileList);

  }



  if (!(data.results || []).length) container.appendChild(textEl("p", "text-sm text-gray-400 text-center py-4", "Chưa có tệp nào."));

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

        if (data.error) { showToast(data.error, "red"); return; }

        if (data.type === "ping") { chatWs.send(JSON.stringify({ type: "pong" })); resetChatPingWatchdog(convId, gen); return; }

        if (data.type === "seen_message") {

          if (Number(data.user_id) !== Number(myUserId)) {

            // Find the user profile for seen avatar

            const seer = (activeConvMembers || []).find((m) => Number(m.user?.user) === Number(data.user_id));

            markSeenMessages(data.last_message_id, seer?.user || null);

          }

          return;

        }

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

let loadMessagesGeneration = 0;

async function loadMessages(reset) {

  if (!messagesNext || !messagesEl || loadingMessages) return;

  loadingMessages = true;

  const gen = ++loadMessagesGeneration;

  const currentConvId = activeConvId;

  try {

    const res = await authFetch(messagesNext);

    if (gen !== loadMessagesGeneration || Number(activeConvId) !== Number(currentConvId)) { loadingMessages = false; return; }

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

    if (a.file_type === "image" || a.file_type?.startsWith("image/") || a.file_url?.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)/i)) {

      const image = document.createElement("img");

      image.src = a.file_url; image.className = "max-w-full rounded-lg mt-1 cursor-pointer hover:opacity-90 transition"; image.alt = a.file_name || "";

      image.loading = "lazy";

      image.onclick = () => window.open(a.file_url, "_blank");

      bubble.appendChild(image);

    } else if (a.file_type === "video" || a.file_type?.startsWith("video/")) {

      const video = document.createElement("video");

      video.src = a.file_url; video.controls = true; video.className = "max-w-full rounded-lg mt-1";

      bubble.appendChild(video);

    } else {

      const link = document.createElement("a");

      link.href = a.file_url; link.target = "_blank"; link.rel = "noopener noreferrer";

      link.className = "block mt-1 underline text-sm flex items-center gap-1";

      link.innerHTML = `📎 ${a.file_name || "Tải file"} <span class="text-[10px] opacity-70">(${a.file_size ? Math.round(a.file_size / 1024) + 'KB' : ''})</span>`;

      bubble.appendChild(link);

    }

  });



  const messageCol = document.createElement("div");

  messageCol.className = "flex flex-col max-w-[75%]";

  bubble.classList.remove("max-w-[75%]");

  bubble.classList.add("w-fit", mine ? "self-end" : "self-start");

  messageCol.appendChild(bubble);



  const seenContainer = document.createElement("div");

  seenContainer.className = "msg-seen-container flex justify-end gap-0.5 mt-0.5 min-h-[16px]";

  messageCol.appendChild(seenContainer);



  if (!content && !(m.attachments || []).length && !mine) bubble.appendChild(text);



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



  if (mine) { wrap.append(replyBtn, messageCol); } else { wrap.append(messageCol, replyBtn); }



  if (prepend) messagesEl.prepend(wrap); else messagesEl.appendChild(wrap);

  if (scroll) scrollToBottom(false);

}



// ==================== SEEN AVATARS INSTEAD OF TEXT ====================

const userLastReadMap = new Map();



function markSeenMessages(lastMessageId, seerUser) {

  const seenId = Number(lastMessageId);

  if (!Number.isFinite(seenId) || !seerUser) return;

  const userId = seerUser.user || seerUser.id;

  const previousReadId = userLastReadMap.get(userId)?.lastMessageId;



  userLastReadMap.set(userId, { user: seerUser, lastMessageId: seenId });



  if (previousReadId && previousReadId !== seenId) {

    renderSeenForMessage(previousReadId);

  }

  renderSeenForMessage(seenId);

}



function renderSeenForMessage(msgId) {

  const node = document.querySelector(`[data-msg-id="${msgId}"]`);

  if (!node) return;

  const container = node.querySelector(".msg-seen-container");

  if (!container) return;



  const seers = [];

  userLastReadMap.forEach((data) => {

    if (data.lastMessageId === Number(msgId)) {

      const uId = data.user.user || data.user.id;

      if (Number(uId) !== Number(myUserId)) seers.push(data.user);

    }

  });



  container.replaceChildren();

  if (seers.length === 0) return;



  container.className = "msg-seen-container flex justify-end mt-0.5 min-h-[16px] -space-x-1";



  const maxDisplay = 3;

  const displaySeers = seers.slice(0, maxDisplay);

  const extraCount = seers.length - maxDisplay;

  const names = seers.map(s => fullName(s)).join(", ");



  displaySeers.forEach((seer, idx) => {

    const img = document.createElement("img");

    img.src = seer.picture || DEFAULT_AVATAR;

    img.className = "w-3.5 h-3.5 rounded-full object-cover ring-[1.5px] ring-white dark:ring-[#0b0f19] relative";

    img.style.zIndex = String(10 - idx);

    img.title = `Đã xem bởi:\n${names}`;

    container.appendChild(img);

  });



  if (extraCount > 0) {

    const extra = document.createElement("div");

    extra.className = "w-3.5 h-3.5 rounded-full bg-gray-200 dark:bg-[#3a3b3c] flex items-center justify-center text-[8px] text-gray-600 dark:text-gray-300 ring-[1.5px] ring-white dark:ring-[#0b0f19] relative font-bold";

    extra.style.zIndex = String(10 - maxDisplay);

    extra.textContent = `+${extraCount}`;

    extra.title = `Đã xem bởi:\n${names}`;

    container.appendChild(extra);

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

  const isAdmin = isCurrentUserAdmin();

  const modal = document.createElement("div");

  modal.id = "groupSettingsModal";

  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";

  modal.innerHTML = `

    <div class="glass-card rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col p-4">

      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Cài đặt nhóm</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>

      <div class="space-y-3 overflow-y-auto flex-1">

        <button type="button" data-action="modify-group" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-fb-secondary dark:hover:bg-white/10 dark:text-white">✏️ Đổi tên/ảnh nhóm</button>

        <button type="button" data-action="add-members" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-fb-secondary dark:hover:bg-white/10 dark:text-white">➕ Thêm thành viên</button>

        ${isAdmin ? `<button type="button" data-action="transfer-admin" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-fb-secondary dark:hover:bg-white/10 dark:text-white">👑 Chuyển quyền admin</button>` : ''}

        ${isAdmin ? `<button type="button" data-action="delete-group" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">🗑️ Xóa nhóm</button>` : ''}

        ${!isAdmin ? `<button type="button" data-action="leave-group" class="w-full text-left px-3 py-2.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600">👋 Rời nhóm</button>` : ''}

      </div>

    </div>`;

  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());

  document.body.appendChild(modal);



  modal.querySelector("[data-action='add-members']")?.addEventListener("click", () => { modal.remove(); showAddMembersModal(convId); });

  modal.querySelector("[data-action='modify-group']")?.addEventListener("click", () => { modal.remove(); showModifyGroupModal(convId); });



  if (isAdmin) {

    modal.querySelector("[data-action='transfer-admin']")?.addEventListener("click", () => { modal.remove(); showTransferAdminModal(convId); });

    modal.querySelector("[data-action='delete-group']")?.addEventListener("click", () => { modal.remove(); showDeleteGroupModal(convId); });

  } else {

    modal.querySelector("[data-action='leave-group']")?.addEventListener("click", () => { modal.remove(); showLeaveGroupModal(convId); });

  }

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

    const res = await authFetch(API.leaveGroupChat(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    if (res.ok) { 
      showToast("Đã rời nhóm", "green"); 
      modal.remove(); 
      loadConversations(); 
      if (Number(activeConvId) === Number(convId)) {
        if (chatForm) chatForm.classList.add("hidden");
        let leftBanner = document.getElementById("leftGroupBanner");
        if (!leftBanner) {
          leftBanner = document.createElement("div");
          leftBanner.id = "leftGroupBanner";
          leftBanner.className = "p-4 sm:p-5 border-t border-slate-200 dark:border-white/10 flex justify-center items-center bg-white/95 dark:bg-white/10 backdrop-blur-xl z-20 shadow-lg";
          leftBanner.innerHTML = `<p class="text-slate-500 dark:text-slate-400 font-medium bg-slate-100 dark:bg-white/10 px-6 py-3 rounded-2xl w-full text-center">Bạn không còn trong nhóm này</p>`;
          if (chatForm && chatForm.parentNode) chatForm.parentNode.insertBefore(leftBanner, chatForm.nextSibling);
        } else {
          leftBanner.classList.remove("hidden");
        }
      }
    }

    else { showToast("Rời nhóm thất bại", "red"); }

  });

}



// ==================== TASK MODAL ====================

async function showTaskModal(convId, containerOverride) {

  const container = containerOverride || document.getElementById("taskModal");

  if (!containerOverride) {

    document.getElementById("taskModal")?.remove();

  }

  const modal = containerOverride ? null : document.createElement("div");

  if (!modal && !containerOverride) return;



  let contentEl;

  if (containerOverride) {

    contentEl = containerOverride;

    contentEl.innerHTML = '';

    contentEl.id = "taskContent_" + convId;

  } else {

    modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";

    modal.innerHTML = `

      <div class="glass-card rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4">

        <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">📋 Công việc</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>

        <div id="taskContent_${convId}" class="flex-1 overflow-y-auto"></div>

      </div>`;

    modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());

    document.body.appendChild(modal);

    contentEl = modal.querySelector(`#taskContent_${convId}`);

  }



  contentEl.innerHTML = `

    <button type="button" id="showCreateTaskForm_${convId}" class="text-sm text-fb-primary font-semibold mb-3">+ Tạo công việc mới</button>

    <div id="createTaskForm_${convId}" class="hidden space-y-2 mb-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">

      <input id="taskTitleInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Tiêu đề">

      <textarea id="taskDescInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Mô tả" rows="2"></textarea>

      <select id="taskPriorityInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option></select>

      <input id="taskDeadlineInput_${convId}" type="datetime-local" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm">

      <button type="button" id="submitCreateTask_${convId}" class="w-full rounded-lg bg-fb-primary text-white font-semibold py-2 text-sm">Tạo</button>

    </div>

    <div class="flex gap-2 mb-3">

      <select id="taskStatusFilter_${convId}" class="text-xs rounded-lg px-2 py-1.5 bg-white dark:bg-white/10 dark:text-white border dark:border-white/10">

        <option value="">Tất cả trạng thái</option>

        <option value="todo">Cần làm</option>

        <option value="in_progress">Đang làm</option>

        <option value="done">Hoàn thành</option>

      </select>

      <select id="taskAssigneeFilter_${convId}" class="text-xs rounded-lg px-2 py-1.5 bg-white dark:bg-white/10 dark:text-white border dark:border-white/10 flex-1">

        <option value="">Tất cả thành viên</option>

      </select>

    </div>

    <div id="taskList_${convId}" class="space-y-2"></div>`;



  contentEl.querySelector(`#showCreateTaskForm_${convId}`)?.addEventListener("click", () => {

    contentEl.querySelector(`#createTaskForm_${convId}`)?.classList.toggle("hidden");

  });



  contentEl.querySelector(`#submitCreateTask_${convId}`)?.addEventListener("click", async () => {

    const title = contentEl.querySelector(`#taskTitleInput_${convId}`)?.value.trim();

    if (!title) { showToast("Nhập tiêu đề", "red"); return; }

    const body = { title, description: contentEl.querySelector(`#taskDescInput_${convId}`)?.value || "", priority: contentEl.querySelector(`#taskPriorityInput_${convId}`)?.value || "medium" };

    const deadline = contentEl.querySelector(`#taskDeadlineInput_${convId}`)?.value;

    if (deadline) body.deadline = deadline;

    const res = await authFetch(API.createTask(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

    if (res.ok) {

      showToast("Đã tạo task", "green");

      contentEl.querySelector(`#createTaskForm_${convId}`)?.classList.add("hidden");

      // After creation, show add member modal

      const taskData = await res.json();

      showAddTaskMembersModal(convId, taskData.id);

      loadTaskList(convId, contentEl);

    } else { showToast("Tạo thất bại", "red"); }

  });



  await loadTaskList(convId, contentEl);



  // Load members for filter

  const members = await fetchConversationMembers(convId);

  const assigneeFilter = contentEl.querySelector(`#taskAssigneeFilter_${convId}`);

  if (assigneeFilter) {

    members.forEach(m => {

      if (m.user) assigneeFilter.insertAdjacentHTML('beforeend', `<option value="${m.user.id}">${fullName(m.user)}</option>`);

    });

    assigneeFilter.addEventListener("change", () => loadTaskList(convId, contentEl));

  }

  contentEl.querySelector(`#taskStatusFilter_${convId}`)?.addEventListener("change", () => loadTaskList(convId, contentEl));

}



async function showAddTaskMembersModal(convId, taskId) {

  // Get existing task members first

  const existingRes = await authFetch(withPageSize(API.taskMembers(convId, taskId), 100));

  const existingData = existingRes.ok ? await existingRes.json() : { results: [] };

  const existingMemberUserIds = (existingData.results || []).map((p) => p.user);



  // Get group members for available list

  const groupMembers = await fetchConversationMembers(convId);

  const availableMembers = groupMembers.filter((m) => !existingMemberUserIds.includes(m.user?.user) && Number(m.user?.id) !== Number(myProfileId));



  if (!availableMembers.length) { showToast("Không còn thành viên để thêm vào task", "red"); return; }



  const modal = document.createElement("div");

  modal.className = "fixed inset-0 modal-backdrop z-[85] flex items-center justify-center p-4";

  modal.innerHTML = `

    <div class="glass-card rounded-2xl w-full max-w-md p-4">

      <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">Thêm thành viên vào task</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>

      <div id="addTaskMemberList" class="space-y-1 max-h-60 overflow-y-auto"></div>

      <button type="button" id="submitAddTaskMembers" class="mt-3 w-full rounded-xl bg-fb-primary text-white font-semibold py-2">Thêm</button>

    </div>`;

  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());

  document.body.appendChild(modal);



  const list = modal.querySelector("#addTaskMemberList");

  availableMembers.forEach((m) => {

    if (!m.user) return;

    const row = document.createElement("label");

    row.className = "flex items-center gap-3 rounded-xl p-2 hover:bg-fb-secondary dark:hover:bg-white/10 cursor-pointer";

    row.innerHTML = `<input type="checkbox" class="add-task-member-check" value="${m.user.user}"><img src="${m.user.picture || DEFAULT_AVATAR}" class="w-9 h-9 rounded-full object-cover"><span class="text-sm dark:text-white">${fullName(m.user)}</span>`;

    list?.appendChild(row);

  });



  modal.querySelector("#submitAddTaskMembers")?.addEventListener("click", async () => {

    const ids = [...modal.querySelectorAll(".add-task-member-check:checked")].map((i) => Number(i.value));

    if (!ids.length) { showToast("Chọn ít nhất 1 người", "red"); return; }

    const res = await authFetch(API.addTaskMembers(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tasks_id: taskId, add_member_ids: ids }) });

    if (res.ok) { showToast("Đã thêm thành viên", "green"); modal.remove(); } else { showToast("Thêm thất bại", "red"); }

  });

}



async function loadTaskList(convId, container) {

  const list = container?.querySelector(`#taskList_${convId}`) || document.getElementById("taskList");

  if (!list) return;

  const res = await authFetch(withPageSize(API.listTasks(convId), 50));

  const data = res.ok ? await res.json() : { results: [] };

  const statusFilter = container?.querySelector(`#taskStatusFilter_${convId}`)?.value;

  const assigneeFilter = container?.querySelector(`#taskAssigneeFilter_${convId}`)?.value;

  let tasks = data.results || [];



  if (statusFilter) {

    tasks = tasks.filter(t => t.status === statusFilter || (statusFilter === 'done' && t.is_finished));

  }

  if (assigneeFilter) {

    tasks = tasks.filter(t => t.assigned_to?.some(u => Number(u.id) === Number(assigneeFilter)));

  }



  list.replaceChildren();

  tasks.forEach((t) => {

    const card = document.createElement("div");

    card.className = "p-3 rounded-xl bg-white dark:bg-white/5 border dark:border-white/10";

    const canDelete = t.created_by?.user === myUserId;

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

          ${t.assigned_to?.length ? `<div class="flex gap-1 mt-2 flex-wrap">${t.assigned_to.map((u) => `<span class="text-[10px] bg-fb-secondary dark:bg-white/10 px-2 py-0.5 rounded-full">@${u.full_name || ''}</span>`).join('')}</div>` : ''}

        </div>

        <div class="flex gap-1 shrink-0">

          ${canDelete ? `<button type="button" data-task-id="${t.id}" data-action="edit" class="text-xs px-2 py-1 rounded hover:bg-fb-secondary dark:hover:bg-white/10 text-blue-500">✏️</button>` : ''}

          ${canDelete ? `<button type="button" data-task-id="${t.id}" data-action="add-members" class="text-xs px-2 py-1 rounded hover:bg-fb-secondary dark:hover:bg-white/10">➕</button>` : ''}

          <button type="button" data-task-id="${t.id}" data-action="toggle" class="text-xs px-2 py-1 rounded hover:bg-fb-secondary dark:hover:bg-white/10 ${t.is_finished ? 'text-gray-400' : 'text-green-600'}">${t.is_finished ? '↩️' : '✅'}</button>

          ${canDelete ? `<button type="button" data-task-id="${t.id}" data-action="delete" class="text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500">🗑️</button>` : ''}

        </div>

      </div>`;

    list.appendChild(card);



    card.querySelector("[data-action='add-members']")?.addEventListener("click", () => showAddTaskMembersModal(convId, t.id));

    card.querySelector("[data-action='toggle']")?.addEventListener("click", async () => {

      const body = { is_finished: !t.is_finished, status: t.is_finished ? 'todo' : 'done' };

      await authFetch(API.updateTask(convId, t.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

      loadTaskList(convId, container);

    });

    card.querySelector("[data-action='delete']")?.addEventListener("click", async () => {

      if (!await confirmDialog("Xóa task này?")) return;

      await authFetch(API.deleteTask(convId, t.id), { method: "DELETE" });

      loadTaskList(convId, container);

    });

    card.querySelector("[data-action='edit']")?.addEventListener("click", () => {

      const dt = t.deadline ? new Date(t.deadline).toISOString().slice(0, 16) : '';

      card.innerHTML = `

        <div class="space-y-2 p-1">

          <input class="edit-title w-full rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 border dark:border-white/10 text-sm dark:text-white" value="${t.title}">

          <textarea class="edit-desc w-full rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 border dark:border-white/10 text-sm dark:text-white" rows="2">${t.description || ''}</textarea>

          <div class="flex gap-2">

            <select class="edit-priority w-1/2 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 text-sm dark:text-white">

              <option value="medium" ${t.priority === 'medium' ? 'selected' : ''}>Medium</option>

              <option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option>

              <option value="high" ${t.priority === 'high' ? 'selected' : ''}>High</option>

            </select>

            <input class="edit-deadline w-1/2 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 text-sm dark:text-white" type="datetime-local" value="${dt}">

          </div>

          <div class="flex gap-2 justify-end mt-2">

            <button class="cancel-edit text-xs px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-white/10 dark:text-white">Hủy</button>

            <button class="save-edit text-xs px-3 py-1.5 rounded-lg bg-fb-primary text-white">Lưu</button>

          </div>

        </div>

      `;

      card.querySelector(".cancel-edit").onclick = () => loadTaskList(convId, container);

      card.querySelector(".save-edit").onclick = async () => {

        const body = {

          title: card.querySelector(".edit-title").value.trim(),

          description: card.querySelector(".edit-desc").value.trim(),

          priority: card.querySelector(".edit-priority").value,

        };

        const dl = card.querySelector(".edit-deadline").value;

        if (dl) body.deadline = dl;

        else body.deadline = null;

        await authFetch(API.updateTask(convId, t.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

        loadTaskList(convId, container);

      };

    });

  });

  if (!(data.results || []).length) list.appendChild(textEl("p", "text-sm text-gray-400 text-center py-4", "Chưa có công việc nào."));

}



// ==================== VOTE MODAL ====================

function showPromptModal(title, defaultValue, onSave) {
  const modalId = "promptModal_" + Date.now();
  const modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "fixed inset-0 modal-backdrop z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
  modal.innerHTML = `
    <div class="glass-card bg-white dark:bg-[#242526] rounded-2xl w-full max-w-sm p-5 shadow-2xl animate-scale-in border border-slate-200 dark:border-white/10">
      <h3 class="font-bold text-lg dark:text-white mb-3">${title}</h3>
      <input type="text" id="promptInput_${modalId}" class="w-full rounded-xl px-4 py-2.5 bg-slate-100 dark:bg-white/10 dark:text-white mb-5 outline-none focus:ring-2 focus:ring-fb-primary transition-all text-sm" value="${defaultValue || ''}">
      <div class="flex gap-2 justify-end">
        <button id="cancelPrompt_${modalId}" class="px-4 py-2 rounded-xl text-gray-600 dark:text-gray-400 hover:bg-slate-100 dark:hover:bg-white/10 font-medium text-sm transition-colors">Hủy</button>
        <button id="savePrompt_${modalId}" class="px-4 py-2 rounded-xl bg-fb-primary hover:bg-blue-600 text-white font-medium text-sm transition-colors">Lưu</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  
  const inputEl = modal.querySelector(`#promptInput_${modalId}`);
  inputEl.focus();
  inputEl.select();

  modal.querySelector(`#cancelPrompt_${modalId}`).onclick = () => modal.remove();
  modal.querySelector(`#savePrompt_${modalId}`).onclick = () => {
    const val = inputEl.value;
    onSave(val);
    modal.remove();
  };
}

function showVotersModal(title, usersData) {
  const modalId = "votersModal_" + Date.now();
  const modal = document.createElement("div");
  modal.id = modalId;
  modal.className = "fixed inset-0 modal-backdrop z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
  
  let listHtml = "";
  if (!usersData || !usersData.length) {
    listHtml = `<p class="text-sm text-gray-500 text-center py-6">Chưa có ai bình chọn.</p>`;
  } else {
    listHtml = usersData.map(u => {
      const p = u.created_by || u.user || u;
      return `<div class="flex items-center gap-3 p-3 hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl transition-colors">
        <img src="${p.picture || DEFAULT_AVATAR}" class="w-10 h-10 rounded-full object-cover border border-slate-200 dark:border-white/10">
        <span class="text-sm font-semibold dark:text-white">${fullName(p)}</span>
      </div>`;
    }).join("");
  }

  modal.innerHTML = `
    <div class="glass-card bg-white dark:bg-[#242526] rounded-2xl w-full max-w-sm flex flex-col max-h-[80vh] shadow-2xl animate-scale-in border border-slate-200 dark:border-white/10">
      <div class="flex items-center justify-between p-4 border-b border-slate-200 dark:border-white/10">
        <h3 class="font-bold text-base dark:text-white truncate pr-2 flex-1">${title}</h3>
        <button id="closeVoters_${modalId}" class="w-8 h-8 shrink-0 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-xl hover:bg-slate-200 dark:hover:bg-white/20 transition-colors dark:text-white">&times;</button>
      </div>
      <div class="p-2 overflow-y-auto scrollbar-thin flex-1 space-y-1">
        ${listHtml}
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector(`#closeVoters_${modalId}`).onclick = () => modal.remove();
}

async function showVoteModal(convId, containerOverride) {

  const container = containerOverride || document.getElementById("voteModal");

  if (!containerOverride) {

    document.getElementById("voteModal")?.remove();

  }

  const modal = containerOverride ? null : document.createElement("div");

  if (!modal && !containerOverride) return;



  let contentEl;

  if (containerOverride) {

    contentEl = containerOverride;

    contentEl.innerHTML = '';

    contentEl.id = "voteContent_" + convId;

  } else {

    modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";

    modal.innerHTML = `

      <div class="glass-card rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4">

        <div class="flex items-center justify-between mb-3"><h2 class="font-bold text-lg dark:text-white">📊 Bình chọn</h2><button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button></div>

        <div id="voteContent_${convId}" class="flex-1 overflow-y-auto"></div>

      </div>`;

    modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());

    document.body.appendChild(modal);

    contentEl = modal.querySelector(`#voteContent_${convId}`);

  }



  contentEl.innerHTML = `

    <button type="button" id="showCreateVoteForm_${convId}" class="text-sm text-fb-primary font-semibold mb-3">+ Tạo bình chọn mới</button>

    <div id="createVoteForm_${convId}" class="hidden space-y-2 mb-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">

      <input id="voteTitleInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Câu hỏi">

      <div id="voteOptionsInput_${convId}" class="space-y-1">

        <input class="vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Lựa chọn 1">

        <input class="vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Lựa chọn 2">

      </div>

      <button type="button" id="addVoteOptionRow_${convId}" class="text-xs text-fb-primary">+ Thêm lựa chọn</button>

      <button type="button" id="submitCreateVote_${convId}" class="w-full rounded-lg bg-fb-primary text-white font-semibold py-2 text-sm">Tạo bình chọn</button>

    </div>

    <div id="voteList_${convId}" class="space-y-3"></div>`;



  contentEl.querySelector(`#showCreateVoteForm_${convId}`)?.addEventListener("click", () => {

    contentEl.querySelector(`#createVoteForm_${convId}`)?.classList.toggle("hidden");

  });



  contentEl.querySelector(`#addVoteOptionRow_${convId}`)?.addEventListener("click", () => {

    const container = contentEl.querySelector(`#voteOptionsInput_${convId}`);

    const input = document.createElement("input");

    input.className = "vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm";

    input.placeholder = `Lựa chọn ${container.children.length + 1}`;

    container.appendChild(input);

  });



  contentEl.querySelector(`#submitCreateVote_${convId}`)?.addEventListener("click", async () => {

    const title = contentEl.querySelector(`#voteTitleInput_${convId}`)?.value.trim();

    if (!title) { showToast("Nhập câu hỏi", "red"); return; }

    const options = [...contentEl.querySelectorAll(".vote-option-input")].map((i) => i.value.trim()).filter(Boolean);

    if (options.length < 2) { showToast("Cần ít nhất 2 lựa chọn", "red"); return; }

    const res = await authFetch(API.createVote(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, options }) });

    if (res.ok) { showToast("Đã tạo bình chọn", "green"); contentEl.querySelector(`#createVoteForm_${convId}`)?.classList.add("hidden"); loadVoteList(convId, contentEl); }

    else { showToast("Tạo thất bại", "red"); }

  });



  await loadVoteList(convId, contentEl);

}



async function loadVoteList(convId, container) {

  const list = container?.querySelector(`#voteList_${convId}`) || document.getElementById("voteList");

  if (!list) return;

  const res = await authFetch(API.listVotes(convId));

  const data = res.ok ? await res.json() : { results: [] };

  list.replaceChildren();

  for (const v of (data.results || [])) {

    const card = document.createElement("div");

    card.className = "p-3 rounded-xl bg-white dark:bg-white/5 border dark:border-white/10 relative group";

    const totalVotes = (v.options || []).reduce((s, o) => s + o.count, 0);

    const canDelete = v.created_by?.user === myUserId;



    card.innerHTML = `

      ${canDelete ? `
        <button type="button" class="absolute top-3 right-12 hidden group-hover:flex w-7 h-7 bg-slate-50 dark:bg-white/10 hover:bg-blue-100 dark:hover:bg-blue-500/30 rounded-full items-center justify-center text-slate-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-sm" title="Sửa tiêu đề bình chọn" data-action="edit-vote" data-id="${v.id}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
        </button>
        <button type="button" class="absolute top-3 right-3 hidden group-hover:flex w-7 h-7 bg-slate-50 dark:bg-white/10 hover:bg-red-100 dark:hover:bg-red-500/30 rounded-full items-center justify-center text-slate-500 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors shadow-sm" title="Xóa bình chọn" data-action="delete-vote" data-id="${v.id}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      ` : ''}

      <div class="flex items-start justify-between mb-3 pr-20">

        <p class="font-semibold text-sm dark:text-white vote-title-display">${v.title}</p>

        <span class="text-[10px] px-2 py-0.5 rounded-full ${v.is_closed ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}">${v.is_closed ? 'Đã đóng' : 'Đang mở'}</span>

      </div>

      <div class="space-y-1">

        ${(v.options || []).map((o) => {

      const pct = totalVotes > 0 ? Math.round((o.count / totalVotes) * 100) : 0;

      return `<div class="vote-option-item relative group/opt ${v.is_closed ? '' : 'cursor-pointer hover:bg-fb-secondary dark:hover:bg-white/5'} rounded-lg p-2 pr-20 ${o.is_voted ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800' : ''}" data-vote-id="${v.id}" data-option-id="${o.id}">

            <div class="flex justify-between text-xs"><span class="dark:text-white vote-opt-text">${o.text}</span>

              <div class="flex items-center gap-2">

                <span class="text-gray-500">${o.count} phiếu (${pct}%)</span>

                ${o.count > 0 ? `<button type="button" data-action="view-voters" class="text-fb-primary hover:underline px-1 z-10" data-vote-id="${v.id}" data-option-id="${o.id}">👥</button>` : ''}

              </div>

            </div>

            <div class="w-full h-1.5 bg-gray-200 dark:bg-white/10 rounded-full mt-1"><div class="h-1.5 rounded-full transition-all ${o.is_voted ? 'bg-fb-primary' : 'bg-gray-400 dark:bg-white/30'}" style="width:${pct}%"></div></div>

            ${o.is_voted ? '<span class="text-[10px] text-fb-primary mt-1 inline-block">✓ Đã bình chọn</span>' : ''}

            ${!v.is_closed ? `
              <div class="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover/opt:flex items-center gap-1 z-10 bg-white/90 dark:bg-[#242526]/90 p-1 rounded-lg shadow-sm border border-slate-200 dark:border-white/10 backdrop-blur-sm">
                <button type="button" class="w-7 h-7 rounded-md hover:bg-blue-50 dark:hover:bg-blue-500/20 text-blue-500 flex items-center justify-center transition-colors" data-action="edit-opt" data-option-id="${o.id}" data-option-text="${o.text}" title="Sửa lựa chọn">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
                </button>
                ${canDelete ? `
                <button type="button" class="w-7 h-7 rounded-md hover:bg-red-50 dark:hover:bg-red-500/20 text-red-500 flex items-center justify-center transition-colors" data-action="delete-opt" data-option-id="${o.id}" title="Xóa lựa chọn">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
                ` : ''}
              </div>` : ''}

          </div>`;

    }).join('')}

        ${!v.is_closed ? `

          <div class="flex gap-2 mt-2" onclick="event.stopPropagation()">

            <input class="add-opt-input flex-1 text-xs px-2 py-1.5 rounded bg-gray-50 dark:bg-white/5 dark:text-white border dark:border-white/10" placeholder="Lựa chọn mới">

            <button class="add-opt-btn text-xs px-3 py-1.5 bg-fb-primary text-white rounded font-medium">Thêm</button>

          </div>

        ` : ''}

      </div>

      <p class="text-[10px] text-gray-400 mt-2">Tổng: ${totalVotes} phiếu</p>
    </div>`;



    list.appendChild(card);



    if (canDelete) {

      card.querySelector("[data-action='delete-vote']")?.addEventListener("click", async (e) => {

        e.stopPropagation();

        if (!await confirmDialog("Xóa bình chọn này?")) return;

        const resp = await authFetch(API.deleteVote(convId, v.id), { method: "DELETE" });

        if (resp.ok) loadVoteList(convId, container);

      });

      card.querySelector("[data-action='edit-vote']")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        showPromptModal("Nhập tiêu đề bình chọn mới:", v.title, async (newTitle) => {
          if (newTitle && newTitle.trim() !== v.title) {
            const resp = await authFetch(API.updateVote(convId, v.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle.trim() }) });
            if (resp.ok) loadVoteList(convId, container);
          }
        });
      });

      card.querySelectorAll("[data-action='edit-opt']").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const optionId = btn.dataset.optionId;
          const oldText = btn.dataset.optionText;
          showPromptModal("Sửa lựa chọn:", oldText, async (newText) => {
            if (newText && newText.trim() !== oldText) {
              const resp = await authFetch(API.updateVoteOption(convId, v.id, optionId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: newText.trim() }) });
              if (resp.ok) loadVoteList(convId, container);
            }
          });
        });
      });

      card.querySelectorAll("[data-action='delete-opt']").forEach(btn => {

        btn.addEventListener("click", async (e) => {

          e.stopPropagation();

          const optionId = btn.dataset.optionId;

          const resp = await authFetch(API.deleteVoteOption(convId, v.id, optionId), { method: "DELETE" });

          if (resp.ok) loadVoteList(convId, container);

        });

      });

      const addBtn = card.querySelector(".add-opt-btn");

      if (addBtn) {

        addBtn.addEventListener("click", async (e) => {

          e.stopPropagation();

          const inp = card.querySelector(".add-opt-input");

          const text = inp.value.trim();

          if (!text) return;

          const resp = await authFetch(API.addVoteOptions(convId, v.id), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ options: [text] }) });

          if (resp.ok) loadVoteList(convId, container);

        });

      }

    }



    card.querySelectorAll("[data-action='view-voters']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const optionId = btn.dataset.optionId;
        const voteId = btn.dataset.voteId;
        const optTextEl = btn.closest(".vote-option-item")?.querySelector(".vote-opt-text");
        const optName = optTextEl ? optTextEl.textContent : "Lựa chọn này";
        
        const res = await authFetch(API.listUserVotes(convId, voteId, optionId));
        const data = res.ok ? await res.json() : { results: [] };
        showVotersModal(`Những người chọn "${optName}"`, data.results || []);
      });
    });



    if (!v.is_closed) {

      card.querySelectorAll(".vote-option-item").forEach((el) => {

        el.addEventListener("click", async (e) => {

          if (e.target.closest('button') || e.target.closest('input')) return;

          const voteId = el.dataset.voteId;

          const optionId = el.dataset.optionId;

          const res = await authFetch(API.userVote(convId, voteId, optionId), { method: "POST" });

          if (res.ok) { loadVoteList(convId, container); } else { showToast("Bình chọn thất bại", "red"); }

        });

      });

    }

  }

  if (!(data.results || []).length) list.appendChild(textEl("p", "text-sm text-gray-400 text-center py-4", "Chưa có bình chọn nào."));

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



    const spinnerId = `upload-${Date.now()}`;

    if (messagesEl) {

      const spinnerWrap = document.createElement("div");

      spinnerWrap.id = spinnerId;

      spinnerWrap.className = "flex justify-end my-2 chat-msg-wrap";

      spinnerWrap.innerHTML = `

        <div class="px-4 py-2 rounded-2xl bg-fb-primary/20 dark:bg-white/10 flex items-center gap-2 text-sm dark:text-white">

          <svg class="animate-spin w-4 h-4 text-fb-primary" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>

          Đang gửi ${files.length} tệp...

        </div>`;

      messagesEl.appendChild(spinnerWrap);

      scrollToBottom(true);

    }



    try {

      const ids = await uploadChatFiles(activeConvId, files);

      sendChatWsMessage(chatWs, { text: "", attachmentIds: ids });

      showToast("Đã gửi tệp đính kèm");

    } catch (err) { showToast(err.message || "Upload thất bại", "red"); }

    finally {

      input.value = "";

      attachBtn?.classList.remove("opacity-50", "pointer-events-none");

      document.getElementById(spinnerId)?.remove();

    }

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



// ==================== CONVERSATION SEARCH ====================

function initConversationSearch() {

  const input = $("convSearchInput");

  if (!input) return;

  let timeout = null;

  input.addEventListener("input", (e) => {

    if (timeout) clearTimeout(timeout);

    const query = e.target.value.trim();

    timeout = setTimeout(() => {

      searchConversations(query);

    }, 400);

  });

}



async function searchConversations(query) {

  if (!query) {

    loadConversations();

    return;

  }

  if (!convListEl) return;

  convListEl.replaceChildren();

  const spin = document.createElement("p"); spin.className = "text-sm text-gray-400 p-4 text-center"; spin.textContent = "Đang tìm kiếm..."; convListEl.appendChild(spin);



  try {

    const res = await authFetch(API.searchConversations(query));

    if (!res.ok) throw new Error(`search ${res.status}`);

    const data = await res.json();

    convListEl.replaceChildren();



    const items = data.results || [];

    if (!items.length) {

      convListEl.appendChild(textEl("p", "text-sm text-gray-400 p-4 text-center", "Không tìm thấy kết quả"));

    } else {

      items.forEach((c) => {

        // Avoid setting to convMap directly to not mess up normal bump updates or we can set it and it's fine.

        convListEl.appendChild(renderConvItem(c));

      });

    }

  } catch (e) {

    console.error("Search conv error", e);

    convListEl.replaceChildren();

    convListEl.appendChild(textEl("p", "text-sm text-red-500 p-4 text-center", "Lỗi tìm kiếm"));

  }

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

  initConversationSearch();

  initResizer();



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



function initResizer() {

  const sidebar = document.getElementById("chatSidebar");

  const resizer = document.getElementById("sidebarResizer");

  if (!sidebar || !resizer) return;



  let isResizing = false;



  resizer.addEventListener("mousedown", (e) => {

    isResizing = true;

    document.body.style.cursor = "col-resize";

  });



  document.addEventListener("mousemove", (e) => {

    if (!isResizing) return;

    const newWidth = e.clientX;

    if (newWidth >= 250 && newWidth <= window.innerWidth * 0.6) {

      sidebar.style.width = `${newWidth}px`;

    }

  });



  document.addEventListener("mouseup", () => {

    if (isResizing) {

      isResizing = false;

      document.body.style.cursor = "";

    }

  });

}
