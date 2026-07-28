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

// convWs is shared from nav.js (window.navConvWs) — no second connection opened here

const convMap = new Map();

let messagesNext = null;

let pendingConv = false;

let loadingMessages = false;

let activeConvMeta = null;

let activeConvMembers = [];

let firstMessageInConv = null;

let lastMsgTimestampISO = null;

// ========= REPLY STATE =========

let replyToId = null;

let replyToContent = null;



// ========= TYPING STATE =========

let typingIndicatorTimeout = null;

let typingStopTimeout = null;

let typingSent = false;

// ========= MESSAGE SEARCH STATE =========

let isSearching = false;
let currentSearchQuery = "";
let originalMessagesContent = null;
let searchDebounceTimer = null;

let chatSearchBtn;
let chatSearchBar;
let chatSearchInput;
let closeChatSearch;





// ========= WS RECONNECT GUARDS (chat only) =========

let chatWsReconnectTimer = null;

let chatWsGeneration = 0;

const PING_WATCHDOG_MS = 70 * 1000;

let chatPingWatchdog = null;

function resetChatPingWatchdog(convId, gen) {

  if (chatPingWatchdog) clearTimeout(chatPingWatchdog);

  chatPingWatchdog = setTimeout(() => {

    if (gen !== chatWsGeneration) return;

    if (Number(activeConvId) === Number(convId)) connectChatWs(convId);

  }, PING_WATCHDOG_MS);

}

// convWs reconnect is managed by nav.js global WS

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
// Reuses the global convWs from nav.js — no second connection opened.
// nav.js will call window.navBumpConversation(data) whenever a new message arrives.


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



  const avatarUrl = c.is_group ? (c.avatar || DEFAULT_AVATAR) : (other?.picture || DEFAULT_AVATAR);
  const avatarClasses = "w-12 h-12 rounded-full object-cover shrink-0 shadow-sm border border-transparent dark:border-white/10";
  if (!c.is_group && other?.is_online) {
    const container = el("div", "avatar-container", {});
    container.appendChild(img(avatarUrl, avatarClasses, ""));
    const dot = el("span", "online-dot", {});
    container.appendChild(dot);
    wrap.append(container);
  } else {
    wrap.append(img(avatarUrl, avatarClasses, ""));
  }



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

  // Close message search when opening a new conversation
  closeMessageSearch();

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
  lastMsgTimestampISO = null;

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


  // Search button
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";
  searchBtn.title = "Tìm kiếm tin nhắn";
  searchBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>`;
  searchBtn.onclick = () => toggleChatSearch();
  chatHeaderActions.appendChild(searchBtn);


  // Members & Files button for all chats

  const infoBtn = document.createElement("button");

  infoBtn.type = "button";

  infoBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";

  infoBtn.title = "Thông tin & tệp";

  infoBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

  infoBtn.onclick = () => showConvInfoModal(conv.id, conv);

  chatHeaderActions.appendChild(infoBtn);



  // Video Call Button
  const callBtn = document.createElement("button");
  callBtn.type = "button";
  callBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";
  callBtn.title = "Video Call";
  callBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
  callBtn.onclick = () => initVideoCall(conv.id);
  chatHeaderActions.appendChild(callBtn);

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

  // Event Button
  const eventBtn = document.createElement("button");
  eventBtn.type = "button";
  eventBtn.className = "p-2 rounded-full hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors";
  eventBtn.title = "Sự kiện";
  eventBtn.innerHTML = `<svg class="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`;
  eventBtn.onclick = () => showEventModal(conv.id);
  chatHeaderActions.appendChild(eventBtn);





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

        ${conv.is_group ? `
        <button type="button" data-tab="tasks" class="info-tab-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">Công việc</button>

        <button type="button" data-tab="votes" class="info-tab-btn text-xs px-3 py-1.5 rounded-full bg-fb-secondary dark:bg-white/10 dark:text-white">Bình chọn</button>
        ` : ''}

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

            created_at: data.created_at || new Date().toISOString(),

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
function dateDayKey(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function formatMsgTime(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  const now = new Date();

  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();

  const timeStr = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return timeStr;
  if (isYesterday) return `Hôm qua lúc ${timeStr}`;

  const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return `${days[d.getDay()]} lúc ${timeStr}`;
  }

  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  if (d.getFullYear() === now.getFullYear()) {
    return `${day} Thg ${month} lúc ${timeStr}`;
  }
  return `${day}/${month}/${d.getFullYear()} lúc ${timeStr}`;
}

function createDateDivider(label) {
  const div = document.createElement("div");
  div.className = "flex items-center gap-3 my-5 px-2";
  div.innerHTML = `
    <div class="flex-1 h-px bg-gray-200 dark:bg-white/10"></div>
    <span class="text-[11px] text-gray-400 dark:text-gray-500 font-semibold whitespace-nowrap shrink-0">${label}</span>
    <div class="flex-1 h-px bg-gray-200 dark:bg-white/10"></div>
  `;
  return div;
}

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

  // Look up sender profile from members list or message.sender object
  const senderProfile = m.sender || (activeConvMembers || []).find(
    (mem) => Number(mem.user?.user) === Number(sid) || Number(mem.user?.id) === Number(sid)
  )?.user || null;
  const senderName = senderProfile
    ? ((senderProfile.first_name || "") + " " + (senderProfile.last_name || "")).trim() || "?"
    : "?";
  const senderPicture = senderProfile?.picture || null;

  // Check if the previous message is from the same sender (to collapse avatar)
  const isGroup = activeConvMeta?.is_group;
  const prevWrap = prepend ? null : messagesEl.lastElementChild;
  const prevSenderId = prevWrap?.dataset?.senderId;
  const sameAsPrev = !prepend && prevSenderId && String(prevSenderId) === String(sid);

  // If same sender, hide the previous message's avatar placeholder visibility
  if (sameAsPrev && !mine) {
    const prevAvatar = prevWrap?.querySelector(".msg-sender-avatar");
    if (prevAvatar) prevAvatar.style.visibility = "hidden";
  }

  // ---- Date/Time divider (only when appending, not prepending old messages) ----
  const msgTimestamp = m.created_at || null;
  if (!prepend && msgTimestamp) {
    let shouldAddDivider = false;

    if (!lastMsgTimestampISO) {
      shouldAddDivider = true;
    } else {
      const curr = new Date(msgTimestamp);
      const prev = new Date(lastMsgTimestampISO);
      const diffMins = (curr - prev) / (1000 * 60);
      const dayKeyCurr = dateDayKey(msgTimestamp);
      const dayKeyPrev = dateDayKey(lastMsgTimestampISO);

      if (dayKeyCurr !== dayKeyPrev) {
        shouldAddDivider = true;
      }
    }

    if (shouldAddDivider) {
      lastMsgTimestampISO = msgTimestamp;
      const label = formatMsgTime(msgTimestamp);
      if (label) messagesEl.appendChild(createDateDivider(label));
    }
  }

  const wrap = document.createElement("div");

  wrap.className = `flex ${mine ? "justify-end" : "justify-start"} mb-1 chat-msg-wrap items-end gap-1.5 group`;

  wrap.dataset.msgId = m.id;
  wrap.dataset.senderId = String(sid ?? "");



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

  messageCol.className = "flex flex-col max-w-[70%]";

  bubble.classList.remove("max-w-[75%]");

  bubble.classList.add("w-fit", mine ? "self-end" : "self-start");

  messageCol.appendChild(bubble);



  const seenContainer = document.createElement("div");

  seenContainer.className = "msg-seen-container flex justify-end gap-0.5 mt-0.5 min-h-[16px]";

  messageCol.appendChild(seenContainer);



  if (!content && !(m.attachments || []).length && !mine) bubble.appendChild(text);


  let moreWrap = null;

  if (mine) {

    moreWrap = document.createElement("div");

    moreWrap.className = "relative shrink-0 self-end opacity-0 group-hover:opacity-100 transition-opacity duration-200";

    const moreBtn = document.createElement("button");

    moreBtn.type = "button";

    moreBtn.textContent = "⋯";

    moreBtn.className = "px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition text-sm font-semibold leading-none";

    moreBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle("hidden"); };

    const menu = document.createElement("div");

    menu.className = "hidden absolute left-0 bottom-full mb-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 min-w-[120px] z-30";

    menu.addEventListener("click", (e) => e.stopPropagation());

    const unsendItem = document.createElement("button");

    unsendItem.type = "button";

    unsendItem.textContent = "Thu hồi";

    unsendItem.className = "w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors";

    unsendItem.onclick = async () => { await authFetch(API.unsendMessage(m.id), { method: "DELETE" }); wrap.remove(); menu.classList.add("hidden"); };

    const editItem = document.createElement("button");

    editItem.type = "button";

    editItem.textContent = "Sửa";

    editItem.className = "w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors";

    editItem.onclick = () => { menu.classList.add("hidden"); showInlineEdit(m.id, text, bubble, editItem); };

    menu.append(unsendItem, editItem);

    moreWrap.append(moreBtn, menu);

  }


  const timeHoverEl = document.createElement("span");
  timeHoverEl.className = "text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap self-center mx-1";
  timeHoverEl.textContent = m.created_at ? formatMsgTime(m.created_at) : "";

  if (mine) { wrap.append(timeHoverEl, replyBtn, moreWrap, messageCol); } else {
    // --- Avatar column for received messages ---
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "msg-sender-avatar shrink-0 w-8 h-8 rounded-full overflow-hidden self-end mb-1";
    avatarWrap.title = senderName;

    if (senderPicture) {
      const avi = document.createElement("img");
      avi.src = senderPicture;
      avi.alt = senderName;
      avi.className = "w-full h-full object-cover";
      avatarWrap.appendChild(avi);
    } else {
      // Fallback: colored circle with first letter of name
      const initials = senderName.charAt(0).toUpperCase();
      avatarWrap.style.cssText = "background: linear-gradient(135deg,#667eea,#764ba2); display:flex; align-items:center; justify-content:center; color:#fff; font-size:13px; font-weight:700;";
      avatarWrap.textContent = initials;
    }

    // In group: show sender name label above bubble on first msg of group
    if (isGroup && !sameAsPrev) {
      const nameLabel = document.createElement("div");
      nameLabel.className = "text-[10px] font-semibold text-gray-500 dark:text-gray-400 mb-0.5 ml-1";
      nameLabel.textContent = senderName;
      messageCol.prepend(nameLabel);
    }

    wrap.append(avatarWrap, messageCol, replyBtn, timeHoverEl);
  }



  if (prepend) messagesEl.prepend(wrap); else messagesEl.appendChild(wrap);

  if (scroll) scrollToBottom(false);

  return wrap;
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

        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-lg dark:text-white">📋 Công việc</h2>
          <div class="flex gap-2">
            <button type="button" id="refreshTaskBtn_${convId}" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-sm hover:bg-slate-200 transition-colors" title="Làm mới">🔄</button>
            <button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl">&times;</button>
          </div>
        </div>

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

      <div>
        <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Mức độ ưu tiên</label>
        <select id="taskPriorityInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm"><option value="medium">Trung bình</option><option value="low">Thấp</option><option value="high">Cao</option></select>
      </div>
      <div>
        <label class="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Hạn chót</label>
        <input id="taskDeadlineInput_${convId}" type="datetime-local" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm">
      </div>

      <button type="button" id="submitCreateTask_${convId}" class="w-full rounded-lg bg-fb-primary text-white font-semibold py-2 text-sm">Tạo</button>

    </div>
    <div class="mb-2">
      <input type="text" id="taskSearchInput_${convId}" placeholder="Tìm kiếm task..." class="w-full text-xs rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white border dark:border-white/10 input-glow">
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

  let taskSearchTimeout = null;
  contentEl.querySelector(`#taskSearchInput_${convId}`)?.addEventListener("input", () => {
    if (taskSearchTimeout) clearTimeout(taskSearchTimeout);
    taskSearchTimeout = setTimeout(() => loadTaskList(convId, contentEl), 500);
  });

  const refreshBtn = containerOverride ? containerOverride.querySelector(`#refreshTaskBtn_${convId}`) : modal?.querySelector(`#refreshTaskBtn_${convId}`);
  refreshBtn?.addEventListener("click", () => {
    loadTaskList(convId, contentEl);
  });
}

function showTaskAssigneeModal(user) {
  document.getElementById("taskAssigneeModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "taskAssigneeModal";
  modal.className = "fixed inset-0 modal-backdrop z-[90] flex items-center justify-center p-4 opacity-0 transition-opacity duration-200";
  setTimeout(() => modal.classList.remove("opacity-0"), 10);

  const pic = user.picture || DEFAULT_AVATAR;
  const name = user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Thành viên';

  modal.innerHTML = `
    <div class="glass-card rounded-2xl p-6 flex flex-col items-center gap-3 animate-scale-in max-w-sm w-full relative">
      <button type="button" data-close class="absolute top-3 right-3 w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl flex items-center justify-center hover:bg-slate-200 transition-colors">&times;</button>
      <div class="w-20 h-20 rounded-full overflow-hidden border-4 border-fb-primary/20 p-1">
        <img src="${pic}" class="w-full h-full rounded-full object-cover bg-slate-200 dark:bg-slate-700" alt="Avatar">
      </div>
      <h3 class="font-bold text-lg dark:text-white">${name}</h3>
      <div class="text-sm text-gray-500 dark:text-gray-400 bg-slate-100 dark:bg-white/5 px-3 py-1 rounded-full">Người được giao việc</div>
    </div>
  `;

  const closeFn = () => {
    modal.classList.add("opacity-0");
    setTimeout(() => modal.remove(), 200);
  };

  modal.querySelector("[data-close]").addEventListener("click", closeFn);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeFn();
  });

  document.body.appendChild(modal);
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
  const searchQuery = container?.querySelector(`#taskSearchInput_${convId}`)?.value.trim() || "";
  const res = await authFetch(API.listTasks(convId, searchQuery));
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
    card.className = "p-3 rounded-xl bg-white dark:bg-white/5 border dark:border-white/10 space-y-2";

    const isCreator = t.created_by?.user === myUserId || Number(t.created_by?.id) === Number(myProfileId);
    const isAssignee = t.assigned_to?.some(u => Number(u.id) === Number(myProfileId) || Number(u.user) === Number(myUserId));
    const canEditStatus = isCreator || isAssignee;

    const isDone = t.status === 'done' || t.is_finished;

    const priorityClass = t.priority === 'high' ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
      : t.priority === 'low' ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
        : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400';

    const creatorName = t.created_by ? (t.created_by.full_name || `${t.created_by.first_name || ''} ${t.created_by.last_name || ''}`.trim()) : '';

    let statusDisplayHtml = "";
    if (canEditStatus) {
      statusDisplayHtml = `
        <select data-action="change-status" class="text-[10px] px-2 py-0.5 rounded-full font-medium cursor-pointer border-none outline-none appearance-none bg-fb-secondary dark:bg-white/10 dark:text-white" title="Đổi trạng thái">
          <option value="todo" ${t.status === 'todo' && !isDone ? 'selected' : ''}>Cần làm</option>
          <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>Đang làm</option>
          <option value="done" ${isDone ? 'selected' : ''}>Hoàn thành</option>
        </select>
      `;
    } else {
      const statusClass = isDone ? 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400'
        : t.status === 'in_progress' ? 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
          : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-400';
      const statusLabel = isDone ? 'Hoàn thành' : t.status === 'in_progress' ? 'Đang làm' : 'Cần làm';
      statusDisplayHtml = `<span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${statusClass}">${statusLabel}</span>`;
    }

    card.innerHTML = `
      <div class="flex items-start justify-between gap-2">
        <div class="flex-1 min-w-0">
          <p class="font-semibold text-sm dark:text-white ${isDone ? 'line-through opacity-60' : ''}">${t.title}</p>
          ${t.description ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">${t.description}</p>` : ''}
          <div class="flex gap-1.5 mt-1.5 flex-wrap items-center">
            <span class="text-[10px] px-2 py-0.5 rounded-full font-medium ${priorityClass}">${t.priority}</span>
            ${statusDisplayHtml}
            ${t.deadline ? `<span class="text-[10px] text-gray-400">📅 ${new Date(t.deadline).toLocaleDateString('vi-VN')}</span>` : ''}
          </div>
          ${creatorName ? `<p class="text-[10px] text-gray-400 mt-1">👤 Giao bởi: <span class="font-semibold text-gray-500 dark:text-gray-300">${creatorName}</span></p>` : ''}
          ${t.assigned_to?.length ? `<div class="flex gap-1 mt-1.5 flex-wrap">${t.assigned_to.map((u) => `<button type="button" class="task-assignee-chip text-[10px] bg-fb-secondary dark:bg-white/10 px-2 py-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-white/20 transition-colors dark:text-gray-300" data-user='${encodeURIComponent(JSON.stringify(u))}'>@${u.full_name || u.first_name || ''}</button>`).join('')}</div>` : ''}
        </div>
        <div class="flex gap-1 shrink-0 flex-col items-end">
          ${isCreator ? `<button type="button" data-action="edit" class="text-xs px-2 py-1 rounded hover:bg-fb-secondary dark:hover:bg-white/10 text-blue-500" title="Sửa">✏️</button>` : ''}
          ${isCreator ? `<button type="button" data-action="add-members" class="text-xs px-2 py-1 rounded hover:bg-fb-secondary dark:hover:bg-white/10 text-emerald-500" title="Thêm thành viên">➕</button>` : ''}
          ${isCreator ? `<button type="button" data-action="delete" class="text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Xóa">🗑️</button>` : ''}
        </div>
      </div>
    `;

    list.appendChild(card);

    const changeStatusSelect = card.querySelector('[data-action="change-status"]');
    if (changeStatusSelect) {
      changeStatusSelect.addEventListener("change", async (e) => {
        const newStatus = e.target.value;
        try {
          const ures = await authFetch(API.updateTask(convId, t.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: newStatus, is_finished: newStatus === 'done' })
          });
          if (ures.ok) {
            showToast("Đã cập nhật trạng thái", "green");
            loadTaskList(convId, container);
          } else {
            showToast("Không thể cập nhật trạng thái", "red");
            e.target.value = t.status;
          }
        } catch (error) {
          showToast("Lỗi cập nhật", "red");
          e.target.value = t.status;
        }
      });
    }

    card.querySelectorAll('.task-assignee-chip').forEach(btn => {
      btn.addEventListener("click", () => {
        try {
          const userStr = decodeURIComponent(btn.getAttribute("data-user"));
          const userObj = JSON.parse(userStr);
          showTaskAssigneeModal(userObj);
        } catch (e) {
          console.error("Error parsing assignee", e);
        }
      });
    });

    card.querySelector("[data-action='add-members']")?.addEventListener("click", () => showAddTaskMembersModal(convId, t.id));

    card.querySelector("[data-action='delete']")?.addEventListener("click", async () => {
      if (!await confirmDialog("Xóa task này?")) return;
      const r = await authFetch(API.deleteTask(convId, t.id), { method: "DELETE" });
      if (r.ok) loadTaskList(convId, container); else showToast("Xóa thất bại", "red");
    });

    card.querySelector("[data-action='edit']")?.addEventListener("click", () => {
      const dt = t.deadline ? new Date(t.deadline).toISOString().slice(0, 16) : '';
      card.innerHTML = `
        <div class="space-y-2 p-1">
          <input class="edit-title w-full rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 border dark:border-white/10 text-sm dark:text-white" value="${t.title}">
          <textarea class="edit-desc w-full rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 border dark:border-white/10 text-sm dark:text-white" rows="2">${t.description || ''}</textarea>
          <div class="flex gap-2">
            <select class="edit-priority w-1/2 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 text-sm dark:text-white border dark:border-white/10">
              <option value="medium" ${t.priority === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option>
              <option value="high" ${t.priority === 'high' ? 'selected' : ''}>High</option>
            </select>
            <input class="edit-deadline w-1/2 rounded-lg px-2 py-1.5 bg-gray-50 dark:bg-white/5 text-sm dark:text-white border dark:border-white/10" type="datetime-local" value="${dt}">
          </div>
          <div class="flex gap-2 justify-end mt-2">
            <button class="cancel-edit text-xs px-3 py-1.5 rounded-lg bg-gray-200 dark:bg-white/10 dark:text-white">Hủy</button>
            <button class="save-edit text-xs px-3 py-1.5 rounded-lg bg-fb-primary text-white font-semibold">Lưu</button>
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

        <div class="flex items-center justify-between mb-3">
          <h2 class="font-bold text-lg dark:text-white">📊 Bình chọn</h2>
          <div class="flex gap-2">
            <button type="button" id="refreshVoteBtn_${convId}" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-sm hover:bg-slate-200 transition-colors" title="Làm mới">🔄</button>
            <button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl hover:bg-slate-200 transition-colors">&times;</button>
          </div>
        </div>

        <div id="voteContent_${convId}" class="flex-1 overflow-y-auto"></div>

      </div>`;

    modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());

    document.body.appendChild(modal);

    contentEl = modal.querySelector(`#voteContent_${convId}`);

  }



  contentEl.innerHTML = `

    <div class="flex items-center justify-between mb-3">
      <button type="button" id="showCreateVoteForm_${convId}" class="text-sm text-fb-primary font-semibold">+ Tạo bình chọn mới</button>
    </div>
    <div class="mb-3">
      <input type="text" id="voteSearchInput_${convId}" placeholder="Tìm kiếm bình chọn..." class="w-full text-xs rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white border dark:border-white/10">
    </div>
    <div id="createVoteForm_${convId}" class="hidden space-y-2 mb-3 p-3 bg-slate-50 dark:bg-white/5 rounded-xl">

      <input id="voteTitleInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Câu hỏi bình chọn">

      <div id="voteOptionsInput_${convId}" class="space-y-2">

        <input class="vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Lựa chọn 1">

        <input class="vote-option-input w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm" placeholder="Lựa chọn 2">

      </div>

      <button type="button" id="addVoteOptionRow_${convId}" class="text-xs text-fb-primary font-medium">+ Thêm lựa chọn</button>

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

  const searchInput = contentEl.querySelector(`#voteSearchInput_${convId}`);
  if (searchInput) {
    searchInput.addEventListener("input", (e) => loadVoteList(convId, contentEl, e.target.value.trim()));
  }

  const refreshBtn = document.getElementById(`refreshVoteBtn_${convId}`);
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => loadVoteList(convId, contentEl, searchInput?.value?.trim() || ""));
  }

  await loadVoteList(convId, contentEl);

}



async function loadVoteList(convId, container, searchQuery = "") {
  const list = container?.querySelector(`#voteList_${convId}`) || document.getElementById("voteList");
  if (!list) return;
  const res = await authFetch(API.listVotes(convId, searchQuery));
  const data = res.ok ? await res.json() : { results: [] };
  list.replaceChildren();

  for (const v of (data.results || [])) {
    const card = document.createElement("div");
    card.className = "p-3 rounded-xl bg-white dark:bg-white/5 border dark:border-white/10 relative group";
    const totalVotes = (v.options || []).reduce((s, o) => s + o.count, 0);
    const canDelete = v.created_by?.user === myUserId || Number(v.created_by?.id) === Number(myProfileId);
    const creatorName = v.created_by ? (v.created_by.full_name || `${v.created_by.first_name || ''} ${v.created_by.last_name || ''}`.trim()) : '';

    card.innerHTML = `
      ${canDelete ? `
        <button type="button" class="absolute top-3 right-12 hidden group-hover:flex w-7 h-7 bg-slate-50 dark:bg-white/10 hover:bg-blue-100 dark:hover:bg-blue-500/30 rounded-full items-center justify-center text-slate-500 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-sm" title="Sửa tiêu đề bình chọn" data-action="edit-vote" data-id="${v.id}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg>
        </button>
        <button type="button" class="absolute top-3 right-3 hidden group-hover:flex w-7 h-7 bg-slate-50 dark:bg-white/10 hover:bg-red-100 dark:hover:bg-red-500/30 rounded-full items-center justify-center text-slate-500 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors shadow-sm" title="Xóa bình chọn" data-action="delete-vote" data-id="${v.id}">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
        </button>
      ` : ''}
      <div class="flex items-start justify-between mb-2 pr-20">
        <div>
          <p class="font-semibold text-sm dark:text-white vote-title-display">${v.title}</p>
          ${creatorName ? `<p class="text-[10px] text-gray-400 mt-0.5">👤 Tạo bởi: <span class="font-semibold text-gray-500 dark:text-gray-300">${creatorName}</span></p>` : ''}
        </div>
        <div class="flex flex-col items-end gap-1">
          <span class="text-[10px] px-2 py-0.5 rounded-full ${v.is_closed ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}">${v.is_closed ? 'Đã đóng' : 'Đang mở'}</span>
          ${canDelete ? `<button type="button" data-action="toggle-vote" class="text-[10px] px-2 py-0.5 rounded border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 dark:text-gray-300 transition-colors">${v.is_closed ? 'Mở lại' : 'Đóng vote'}</button>` : ''}
        </div>
      </div>

      <div class="space-y-1">
        ${(() => {
        let optsHtml = ``;
        (v.options || []).forEach(o => {
          const pct = totalVotes ? Math.round((o.count / totalVotes) * 100) : 0;
          const myVote = (v.user_votes || []).includes(o.id);

          optsHtml += `
              <div class="vote-option-item cursor-pointer p-2 rounded-lg border border-transparent hover:border-fb-primary/30 transition-colors group/opt" data-option-id="${o.id}" data-vote-id="${v.id}">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2 flex-1 min-w-0">
                    <div class="w-4 h-4 shrink-0 rounded-full border border-gray-300 dark:border-gray-500 flex items-center justify-center ${myVote ? 'bg-fb-primary border-fb-primary' : ''}">
                      ${myVote ? `<svg class="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>` : ''}
                    </div>
                    <p class="text-sm dark:text-gray-200 truncate vote-opt-text" title="${o.text}">${o.text}</p>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <button type="button" class="text-xs text-blue-500 hover:underline px-1" data-action="view-voters" data-option-id="${o.id}" data-vote-id="${v.id}">${o.count}</button>
                    ${!v.is_closed ? `
                      <div class="hidden group-hover/opt:flex gap-1 ml-2">
                        <button type="button" class="text-xs w-5 h-5 rounded hover:bg-slate-200 dark:hover:bg-white/20 text-slate-500 dark:text-gray-400 flex items-center justify-center" data-action="edit-opt" data-option-id="${o.id}" data-option-text="${o.text}" title="Sửa">✏️</button>
                        ${v.options.length > 2 ? `<button type="button" class="text-xs w-5 h-5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 flex items-center justify-center" data-action="delete-opt" data-option-id="${o.id}" title="Xóa">🗑️</button>` : ''}
                      </div>
                    ` : ''}
                  </div>
                </div>
                <div class="w-full h-1.5 bg-slate-100 dark:bg-white/10 rounded-full overflow-hidden">
                  <div class="h-full bg-fb-primary transition-all" style="width: ${pct}%"></div>
                </div>
              </div>
            `;
        });
        optsHtml += `</div>`;
        if (!v.is_closed) {
          optsHtml += `
              <div class="mt-3 pt-3 border-t dark:border-white/10 flex gap-2">
                <input type="text" class="add-opt-input flex-1 rounded-lg px-3 py-1.5 bg-white dark:bg-white/5 dark:text-white border dark:border-white/10 text-xs" placeholder="Thêm lựa chọn mới...">
                <button type="button" class="add-opt-btn px-3 py-1.5 rounded-lg bg-fb-secondary dark:bg-white/10 text-xs font-semibold hover:bg-slate-200 dark:hover:bg-white/20 transition-colors">Thêm</button>
              </div>
            `;
        }
        return optsHtml;
      })()}

      <p class="text-[10px] text-gray-400 mt-2">Tổng: ${totalVotes} phiếu</p>
    </div>`;



    list.appendChild(card);



    if (canDelete) {

      card.querySelector("[data-action='delete-vote']")?.addEventListener("click", async (e) => {

        e.stopPropagation();

        if (!await confirmDialog("Xóa bình chọn này?")) return;

        const resp = await authFetch(API.deleteVote(convId, v.id), { method: "DELETE" });

        if (resp.ok) loadVoteList(convId, container, searchQuery);

      });

      card.querySelector("[data-action='edit-vote']")?.addEventListener("click", async (e) => {
        e.stopPropagation();
        showPromptModal("Nhập tiêu đề bình chọn mới:", v.title, async (newTitle) => {
          if (newTitle && newTitle.trim() !== v.title) {
            const resp = await authFetch(API.updateVote(convId, v.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle.trim() }) });
            if (resp.ok) loadVoteList(convId, container, searchQuery);
          }
        });
      });

      card.querySelectorAll("[data-action='toggle-vote']").forEach(btn => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const resp = await authFetch(API.updateVote(convId, v.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_closed: !v.is_closed }) });
          if (resp.ok) loadVoteList(convId, container, searchQuery);
        });
      });
    }

    card.querySelectorAll("[data-action='edit-opt']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const optionId = btn.dataset.optionId;
        const oldText = btn.dataset.optionText;
        showPromptModal("Sửa lựa chọn:", oldText, async (newText) => {
          if (newText && newText.trim() !== oldText) {
            const resp = await authFetch(API.updateVoteOption(convId, v.id, optionId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: newText.trim() }) });
            if (resp.ok) loadVoteList(convId, container, searchQuery);
          }
        });
      });
    });

    card.querySelectorAll("[data-action='delete-opt']").forEach(btn => {

      btn.addEventListener("click", async (e) => {

        e.stopPropagation();

        const optionId = btn.dataset.optionId;

        const resp = await authFetch(API.deleteVoteOption(convId, v.id, optionId), { method: "DELETE" });

        if (resp.ok) loadVoteList(convId, container, searchQuery);

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
        if (resp.ok) loadVoteList(convId, container, searchQuery);
      });
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

  // ========= MESSAGE SEARCH EVENT LISTENERS =========
  chatSearchBtn?.addEventListener("click", toggleChatSearch);
  closeChatSearch?.addEventListener("click", closeMessageSearch);
  chatSearchInput?.addEventListener("input", (e) => {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => searchMessages(e.target.value), 300);
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
  chatSearchBtn = $("chatSearchBtn");
  chatSearchBar = $("chatSearchBar");
  chatSearchInput = $("chatSearchInput");
  closeChatSearch = $("closeChatSearch");



  if (!convListEl) { console.error("[chat] #chatConvList not found"); return; }

  if (!messagesEl) { console.error("[chat] #chatMessages not found"); return; }



  bindEvents();

  addCreateGroupButton();

  initConversationSearch();

  initResizer();



  try {

    await loadCurrentUser();

    // Hook into the global convWs from nav.js — no second connection needed
    window.navBumpConversation = (data) => {
      if (data.conversation_id) bumpConversation(data);
    };

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



// ==================== MESSAGE SEARCH ====================

function toggleChatSearch() {
  if (!chatSearchBar) return;
  if (!activeConvId) {
    showToast("Chọn hội thoại trước", "red");
    return;
  }
  isSearching = !isSearching;
  if (isSearching) {
    chatSearchBar.classList.remove("hidden");
    chatSearchInput.focus();
    // Save original messages content if not already saved
    if (!originalMessagesContent && messagesEl) {
      originalMessagesContent = Array.from(messagesEl.childNodes);
    }
  } else {
    closeMessageSearch();
  }
}

function closeMessageSearch() {
  if (!chatSearchBar || !messagesEl) return;
  isSearching = false;
  currentSearchQuery = "";
  chatSearchBar.classList.add("hidden");
  if (chatSearchInput) chatSearchInput.value = "";
  // Restore original messages
  if (originalMessagesContent) {
    messagesEl.replaceChildren(...originalMessagesContent);
    originalMessagesContent = null;
  }
}

function renderMessageSearchState(message, tone = "muted") {
  if (!messagesEl) return;
  const state = document.createElement("div");
  const toneClass =
    tone === "error"
      ? "text-red-500 dark:text-red-400"
      : "text-gray-500 dark:text-slate-400";
  state.className = `h-full flex items-center justify-center text-sm font-medium ${toneClass}`;
  state.textContent = message;
  messagesEl.replaceChildren(state);
}

async function searchMessages(query) {
  currentSearchQuery = query.trim();
  if (!activeConvId || !messagesEl) return;
  
  // If query is empty, show all messages (restore if we have saved)
  if (!currentSearchQuery) {
    if (originalMessagesContent) {
      messagesEl.replaceChildren(...originalMessagesContent);
    }
    return;
  }

  // Fetch messages with search query
  try {
    renderMessageSearchState(`Đang tìm "${currentSearchQuery}"...`);

    // Note: the API already supports search via search_fields = ['content']
    // So we can just add &search=query to the messages endpoint!
    const url = `${API.messages(activeConvId)}?search=${encodeURIComponent(currentSearchQuery)}&page_size=100`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error(`search failed ${res.status}`);
    const data = await res.json();
    const results = [...(data.results || [])].reverse();

    // Clear messages and show only matching ones
    messagesEl.replaceChildren();
    if (!results.length) {
      renderMessageSearchState(`Không tìm thấy tin nhắn chứa "${currentSearchQuery}"`);
      return;
    }
    results.forEach(m => {
      const msgEl = appendMessage(m, false, false);
      // Make the message clickable
      if (msgEl) {
        msgEl.style.cursor = "pointer";
        msgEl.addEventListener("click", (e) => {
          // Don't trigger if clicking on interactive elements (buttons, links, images, etc.)
          const interactiveElements = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'VIDEO', 'IMG'];
          if (interactiveElements.includes(e.target.tagName) || e.target.closest('button') || e.target.closest('a')) {
            return;
          }
          goToMessage(m.id);
        });
      }
    });
  } catch (err) {
    console.error("Search messages failed:", err);
    renderMessageSearchState("Không thể tìm kiếm tin nhắn", "error");
    showToast("Tìm kiếm thất bại", "red");
  }
}

async function goToMessage(messageId) {
  // Close search
  closeMessageSearch();
  
  // Load the normal conversation
  if (!activeConvId || !messagesEl) return;

  // Reset and load messages normally
  messagesNext = API.messages(activeConvId);
  await loadMessages(true);

  // Function to check and scroll
  const checkAndScroll = async () => {
    let targetEl = document.querySelector(`[data-msg-id="${messageId}"]`);
    let attempts = 0;
    const maxAttempts = 10; // Prevent infinite loop

    while (!targetEl && messagesNext && attempts < maxAttempts) {
      await loadMessages(false); // Load older messages
      targetEl = document.querySelector(`[data-msg-id="${messageId}"]`);
      attempts++;
    }

    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      // Highlight effect
      targetEl.style.transition = "background-color 0.5s ease";
      targetEl.style.backgroundColor = "rgba(59, 130, 246, 0.2)";
      setTimeout(() => {
        targetEl.style.backgroundColor = "";
      }, 2000);
    } else {
      showToast("Không tìm thấy tin nhắn", "red");
    }
  };

  // Wait a bit for initial load, then start checking
  setTimeout(checkAndScroll, 500);
}

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

// ==================== EVENT MODAL ====================
async function showEventModal(convId) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 modal-backdrop z-[80] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="glass-card rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col p-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="font-bold text-lg dark:text-white">📅 Sự kiện</h2>
        <div class="flex gap-2">
          <button type="button" id="refreshEventBtn_${convId}" class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 flex items-center justify-center text-sm hover:bg-slate-200 transition-colors" title="Làm mới">🔄</button>
          <button type="button" data-close class="w-8 h-8 rounded-full bg-slate-100 dark:bg-white/10 text-xl hover:bg-slate-200 transition-colors">&times;</button>
        </div>
      </div>
      <div id="eventContent_${convId}" class="flex-1 overflow-y-auto space-y-3 pr-1">
        <div class="mb-2">
          <input type="text" id="eventSearchInput_${convId}" placeholder="Tìm kiếm sự kiện..." class="w-full text-xs rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white border dark:border-white/10 input-glow">
        </div>
        <button type="button" id="showCreateEventForm_${convId}" class="text-sm text-fb-primary font-semibold">+ Tạo sự kiện mới</button>
        <div id="createEventForm_${convId}" class="hidden space-y-2 p-3 bg-slate-50 dark:bg-white/5 rounded-xl border dark:border-white/10">
          <input id="eventTitleInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm border dark:border-white/10" placeholder="Tên sự kiện">
          <textarea id="eventDescInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm border dark:border-white/10" placeholder="Mô tả" rows="2"></textarea>
          <input id="eventLocationInput_${convId}" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm border dark:border-white/10" placeholder="Địa điểm">
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="text-[10px] text-gray-500 mb-1 block">Bắt đầu</label>
              <input id="eventStartInput_${convId}" type="datetime-local" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm border dark:border-white/10">
            </div>
            <div class="flex-1">
              <label class="text-[10px] text-gray-500 mb-1 block">Kết thúc</label>
              <input id="eventEndInput_${convId}" type="datetime-local" class="w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm border dark:border-white/10">
            </div>
          </div>
          <button type="button" id="submitCreateEvent_${convId}" class="w-full rounded-lg bg-fb-primary text-white font-semibold py-2 text-sm mt-2">Tạo sự kiện</button>
        </div>
        <div id="eventList_${convId}" class="space-y-3"></div>
      </div>
    </div>`;

  modal.querySelector("[data-close]")?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);

  modal.querySelector(`#showCreateEventForm_${convId}`)?.addEventListener("click", () => {
    modal.querySelector(`#createEventForm_${convId}`)?.classList.toggle("hidden");
  });

  modal.querySelector(`#submitCreateEvent_${convId}`)?.addEventListener("click", async () => {
    const title = modal.querySelector(`#eventTitleInput_${convId}`).value.trim();
    if (!title) { showToast("Nhập tên sự kiện", "red"); return; }
    const start = modal.querySelector(`#eventStartInput_${convId}`).value;
    const end = modal.querySelector(`#eventEndInput_${convId}`).value;
    if (!start) { showToast("Nhập thời gian bắt đầu", "red"); return; }

    const body = {
      title,
      description: modal.querySelector(`#eventDescInput_${convId}`).value.trim(),
      location: modal.querySelector(`#eventLocationInput_${convId}`).value.trim(),
      start_time: start,
    };
    if (end) body.end_time = end;

    const res = await authFetch(API.createEvent(convId), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      showToast("Đã tạo sự kiện", "green");
      modal.querySelector(`#createEventForm_${convId}`).classList.add("hidden");
      loadEventList(convId, modal);
    } else {
      showToast("Tạo thất bại", "red");
    }
  });

  modal.querySelector(`#refreshEventBtn_${convId}`)?.addEventListener("click", () => loadEventList(convId, modal));

  let eventSearchTimeout = null;
  modal.querySelector(`#eventSearchInput_${convId}`)?.addEventListener("input", () => {
    if (eventSearchTimeout) clearTimeout(eventSearchTimeout);
    eventSearchTimeout = setTimeout(() => loadEventList(convId, modal), 500);
  });

  await loadEventList(convId, modal);
}

async function loadEventList(convId, modal) {
  const list = modal.querySelector(`#eventList_${convId}`);
  if (!list) return;
  const searchQuery = modal.querySelector(`#eventSearchInput_${convId}`)?.value.trim() || "";
  const res = await authFetch(API.listEvents(convId, searchQuery));
  const data = res.ok ? await res.json() : { results: [] };
  list.replaceChildren();

  const events = data.results || [];
  if (!events.length) {
    list.innerHTML = `<p class="text-sm text-gray-400 text-center py-4">Chưa có sự kiện nào.</p>`;
    return;
  }

  events.forEach(e => {
    const card = document.createElement("div");
    card.className = "group p-3 rounded-xl bg-white dark:bg-white/5 border dark:border-white/10 relative";
    const startStr = new Date(e.start_time).toLocaleString('vi-VN');
    const endStr = e.end_time ? new Date(e.end_time).toLocaleString('vi-VN') : '';
    const creatorName = e.created_by_name || '';
    const isCreator = (e.created_by === myUserId);

    const statuses = e.participant_statuses || {};
    const myStatus = e.is_accepted || null;
    const isExpired = e.is_expired === true;

    const countAccept = (e.participants || []).filter(p => p.status === 'accept').length;
    const countDecline = (e.participants || []).filter(p => p.status === 'decline').length;

    // Build creator action buttons
    let creatorBtns = '';
    if (isCreator) {
      if (!isExpired) {
        creatorBtns += '<button type="button" class="w-6 h-6 flex items-center justify-center rounded bg-gray-100 hover:bg-gray-200 text-gray-600 dark:bg-white/10 dark:hover:bg-white/20 dark:text-gray-300 transition-colors" data-action="edit-event" title="Sửa sự kiện"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/></svg></button>';
      }
      creatorBtns += '<button type="button" class="w-6 h-6 flex items-center justify-center rounded bg-red-50 hover:bg-red-100 text-red-500 dark:bg-red-900/20 dark:hover:bg-red-900/40 transition-colors" data-action="delete-event" title="Xóa sự kiện"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>';
    }

    // Build member response buttons
    let memberBtns = '';
    if (!isCreator && !isExpired) {
      if (myStatus === 'accept') {
        memberBtns = '<button type="button" class="flex-1 text-[10px] py-1 rounded border font-medium transition-colors border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" data-action="update-status" data-status="decline" data-event-id="' + e.id + '">Hủy tham gia</button>';
      } else if (myStatus === 'decline') {
        memberBtns = '<button type="button" class="flex-1 text-[10px] py-1 rounded border font-medium transition-colors border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30" data-action="update-status" data-status="accept" data-event-id="' + e.id + '">Tham gia lại</button>';
      } else {
        memberBtns = '<button type="button" class="flex-1 text-[10px] py-1 rounded border font-medium transition-colors border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/30" data-action="update-status" data-status="accept" data-event-id="' + e.id + '">Tham gia</button>'
          + '<button type="button" class="flex-1 text-[10px] py-1 rounded border font-medium transition-colors border-red-500 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30" data-action="update-status" data-status="decline" data-event-id="' + e.id + '">Từ chối</button>';
      }
    }
    const memberButtonsHtml = memberBtns ? '<div class="mt-2 flex gap-1 pt-2 border-t dark:border-white/10">' + memberBtns + '</div>' : '';
    const creatorBtnsHtml = creatorBtns ? '<div class="flex flex-col gap-1 shrink-0">' + creatorBtns + '</div>' : '';

    card.innerHTML = `
      <div class="flex items-start justify-between">
        <div class="flex-1 pr-2">
          <h3 class="font-bold text-sm dark:text-white text-fb-primary">${e.title}</h3>
          ${creatorName ? `<p class="text-[10px] text-gray-400 mt-0.5">👤 Tạo bởi: <span class="font-semibold text-gray-500 dark:text-gray-300">${creatorName}</span></p>` : ''}
          ${isExpired ? '<span class="text-[10px] text-red-400 font-semibold">⏰ Đã kết thúc</span>' : ''}
        </div>
        ${creatorBtnsHtml}
      </div>
      ${e.description ? `<p class="text-xs text-gray-600 dark:text-gray-300 mt-1">${e.description}</p>` : ''}
      <div class="text-[10px] text-gray-500 mt-2 space-y-0.5">
        <p>🕒 Bắt đầu: <span class="font-medium text-gray-700 dark:text-gray-300">${startStr}</span></p>
        ${endStr ? `<p>🏁 Kết thúc: <span class="font-medium text-gray-700 dark:text-gray-300">${endStr}</span></p>` : ''}
        ${e.location ? `<p>📍 Địa điểm: <span class="font-medium text-gray-700 dark:text-gray-300">${e.location}</span></p>` : ''}
      </div>
      <div class="mt-2 pt-2 border-t dark:border-white/10 flex items-center justify-between text-[10px]">
        <div class="flex gap-2 text-gray-500 cursor-pointer hover:bg-gray-100 dark:hover:bg-white/10 p-1 rounded transition-colors" data-action="view-participants" title="Xem người tham gia">
          <span class="text-green-600 font-semibold">✔️ ${countAccept}</span>
          <span class="text-red-500 font-semibold">❌ ${countDecline}</span>
        </div>
      </div>
      <div id="event-participants-${e.id}" class="hidden mt-2 border-t dark:border-white/10 pt-2 text-[10px] text-gray-700 dark:text-gray-300 max-h-32 overflow-y-auto scrollbar-thin"></div>
      ${memberButtonsHtml}
    `;

    const delBtn = card.querySelector('[data-action="delete-event"]');
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        // Custom confirm modal
        const overlay = document.createElement("div");
        overlay.className = "fixed inset-0 z-[200] flex items-center justify-center p-4";
        overlay.style.cssText = "background:rgba(0,0,0,0.5); backdrop-filter:blur(4px);";
        overlay.innerHTML = `
          <div class="bg-white dark:bg-[#1e1e2e] rounded-2xl shadow-2xl max-w-sm w-full p-6 border dark:border-white/10 animate-[fadeInScale_0.2s_ease]">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
              </div>
              <div>
                <h3 class="font-bold text-gray-800 dark:text-white text-base">Xóa sự kiện?</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Sự kiện "<strong>${e.title}</strong>" sẽ bị xóa vĩnh viễn.</p>
              </div>
            </div>
            <div class="flex gap-2 mt-2">
              <button class="confirm-cancel-btn flex-1 rounded-xl border dark:border-white/10 text-gray-600 dark:text-gray-300 font-semibold py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">Hủy</button>
              <button class="confirm-delete-btn flex-1 rounded-xl bg-red-500 hover:bg-red-600 text-white font-semibold py-2 text-sm transition-colors">Xóa</button>
            </div>
          </div>
        `;

        const close = () => overlay.remove();
        overlay.querySelector('.confirm-cancel-btn').onclick = close;
        overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

        overlay.querySelector('.confirm-delete-btn').onclick = async () => {
          close();
          const res = await authFetch(API.eventDetail(convId, e.id), { method: "DELETE" });
          if (res.ok) {
            showToast("Đã xóa sự kiện", "green");
            loadEventList(convId, modal);
          } else {
            showToast("Xóa thất bại", "red");
          }
        };

        document.body.appendChild(overlay);
      });
    }
    const editBtn = card.querySelector('[data-action="edit-event"]');
    if (editBtn) {
      editBtn.addEventListener("click", () => {
        // Toggle inline edit form
        const existing = card.querySelector('.event-edit-form');
        if (existing) { existing.remove(); return; }

        const startVal = e.start_time ? e.start_time.slice(0, 16) : '';
        const endVal = e.end_time ? e.end_time.slice(0, 16) : '';

        const form = document.createElement('div');
        form.className = 'event-edit-form mt-3 pt-3 border-t dark:border-white/10 space-y-2';
        form.innerHTML = `
          <input class="edit-ev-title w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm border dark:border-white/10" value="${e.title || ''}">
          <textarea class="edit-ev-desc w-full rounded-lg px-3 py-2 bg-white dark:bg-white/10 dark:text-white text-sm border dark:border-white/10" rows="2" placeholder="Mô tả">${e.description || ''}</textarea>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="text-[10px] text-gray-500 mb-1 block">Bắt đầu</label>
              <input type="datetime-local" class="edit-ev-start w-full rounded-lg px-2 py-1.5 bg-white dark:bg-white/10 dark:text-white text-xs border dark:border-white/10" value="${startVal}">
            </div>
            <div class="flex-1">
              <label class="text-[10px] text-gray-500 mb-1 block">Kết thúc</label>
              <input type="datetime-local" class="edit-ev-end w-full rounded-lg px-2 py-1.5 bg-white dark:bg-white/10 dark:text-white text-xs border dark:border-white/10" value="${endVal}">
            </div>
          </div>
          <div class="flex gap-2">
            <button type="button" class="ev-save-btn flex-1 rounded-lg bg-fb-primary text-white font-semibold py-1.5 text-xs">Lưu</button>
            <button type="button" class="ev-cancel-btn flex-1 rounded-lg bg-gray-100 dark:bg-white/10 text-gray-700 dark:text-gray-300 font-semibold py-1.5 text-xs">Hủy</button>
          </div>
        `;

        form.querySelector('.ev-cancel-btn').onclick = () => form.remove();

        form.querySelector('.ev-save-btn').onclick = async () => {
          const title = form.querySelector('.edit-ev-title').value.trim();
          if (!title) { showToast("Nhập tên sự kiện", "red"); return; }
          const start = form.querySelector('.edit-ev-start').value;
          const end = form.querySelector('.edit-ev-end').value;
          if (!start) { showToast("Nhập thời gian bắt đầu", "red"); return; }
          const body = {
            title,
            description: form.querySelector('.edit-ev-desc').value.trim(),
            start_time: start,
          };
          if (end) body.end_time = end;
          const res = await authFetch(API.eventDetail(convId, e.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (res.ok) {
            showToast("Đã cập nhật sự kiện", "green");
            loadEventList(convId, modal);
          } else {
            const err = await res.json().catch(() => ({}));
            showToast(err?.start_time?.[0] || err?.detail || "Cập nhật thất bại", "red");
          }
        };

        card.appendChild(form);
      });
    }

    card.querySelectorAll("[data-action='update-status']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const s = btn.dataset.status;
        const res = await authFetch(API.updateEventStatus(convId, e.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: s }) });
        if (res.ok) loadEventList(convId, modal);
        else showToast("Cập nhật trạng thái thất bại", "red");
      });
    });

    const viewPartsBtn = card.querySelector('[data-action="view-participants"]');
    if (viewPartsBtn) {
      viewPartsBtn.addEventListener("click", async () => {
        const container = card.querySelector(`#event-participants-${e.id}`);
        if (!container.classList.contains("hidden")) {
          container.classList.add("hidden");
          return;
        }
        container.classList.remove("hidden");
        container.innerHTML = '<p class="text-center py-1">Đang tải...</p>';
        try {
          const res = await authFetch(API.eventDetail(convId, e.id) + "participants/");
          if (res.ok) {
            const data = await res.json();
            const parts = data.results || data;
            if (!parts.length) {
              container.innerHTML = '<p class="text-center text-gray-400 py-1">Chưa có ai tham gia.</p>';
              return;
            }
            container.innerHTML = parts.map(p => {
              const name = p.full_name || p.user?.profile?.full_name || "Thành viên";
              const statusStr = p.status === 'accept' ? '<span class="text-green-500">✔️</span>' : '<span class="text-red-500">❌</span>';
              return `<div class="flex justify-between items-center py-1 border-b dark:border-white/10 last:border-0">
                        <span class="font-medium">${name}</span>
                        ${statusStr}
                      </div>`;
            }).join('');
          } else {
            container.innerHTML = '<p class="text-center text-red-500 py-1">Lỗi tải danh sách</p>';
          }
        } catch (err) {
          container.innerHTML = '<p class="text-center text-red-500 py-1">Có lỗi xảy ra</p>';
        }
      });
    }

    list.appendChild(card);
  });
}

// ==================== VIDEO CALL (LiveKit) ====================
let currentVideoRoom = null;
let callWs = null;
let isEndingCall = false;
let isInitingCall = false;
let ringingTimer = null;     // Timer timeout đổ chuông
let callDurationTimer = null;    // Timer đồng hồ thời gian gọi
let callStartTs = null;     // Timestamp khi bắt đầu cuộc gọi thực sự
let activeCallConvId = null; // Track convId để REST fallback khi close

let dialingToneInterval = null;
function playDialingTone() {
  if (dialingToneInterval) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const playTuuut = () => {
      try {
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        osc.type = "sine";
        osc.frequency.setValueAtTime(425, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + 1.5);
        gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 1.6);
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 1.6);
      } catch(e) {}
    };
    playTuuut();
    dialingToneInterval = setInterval(playTuuut, 3500);
  } catch (e) {
    // Trình duyệt không hỗ trợ AudioContext hoặc bị block
  }
}

function stopDialingTone() {
  if (dialingToneInterval) {
    clearInterval(dialingToneInterval);
    dialingToneInterval = null;
  }
}

// ── Đảm bảo leave call khi đóng tab ──────────────────────────
window.addEventListener('beforeunload', () => {
  const convId = activeCallConvId;
  if (callWs?.readyState === WebSocket.OPEN) {
    callWs.send(JSON.stringify({ type: 'leave_call' }));
  }
  currentVideoRoom?.disconnect();
  if (convId) {
    navigator.sendBeacon(
      API.leaveCall(convId),
      new Blob([JSON.stringify({})], { type: 'application/json' })
    );
  }
});

// ── UI helpers: chuyển giữa Ringing / In-Call screen ─────────
function showRingingScreen(name, avatar, statusText = 'Đang đổ chuông...') {
  document.getElementById('callRingingScreen')?.classList.remove('hidden');
  document.getElementById('callInCallScreen')?.classList.add('hidden');
  const nameEl = document.getElementById('callRemoteName');
  const avatarEl = document.getElementById('callRemoteAvatar');
  const statusEl = document.getElementById('callStatusText');
  if (nameEl) nameEl.textContent = name || 'Đang kết nối...';
  if (avatarEl) { avatarEl.src = avatar || ''; avatarEl.onerror = () => { avatarEl.style.display = 'none'; }; }
  if (statusEl) statusEl.textContent = statusText;
}

function showInCallScreen() {
  document.getElementById('callRingingScreen')?.classList.add('hidden');
  document.getElementById('callInCallScreen')?.classList.remove('hidden');
  // Bắt đầu đồng hồ
  callStartTs = Date.now();
  if (callDurationTimer) clearInterval(callDurationTimer);
  const durationEl = document.getElementById('callDurationDisplay');
  callDurationTimer = setInterval(() => {
    if (!durationEl) return;
    const secs = Math.floor((Date.now() - callStartTs) / 1000);
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    durationEl.textContent = `${m}:${s}`;
  }, 1000);
  // Hook nút thu nhỏ mỗi lần vào màn hình in-call
  _hookMinimizeCallBtn();
}

// ── Ringing ticker (0s, 1s, 2s...) ──────────────────────────
let ringTick = 0;
let ringTickTimer = null;
function startRingTicker() {
  ringTick = 0;
  if (ringTickTimer) clearInterval(ringTickTimer);
  const el = document.getElementById('callRingTimer');
  ringTickTimer = setInterval(() => {
    ringTick++;
    if (el) el.textContent = `${ringTick}s`;
  }, 1000);
}
function stopRingTicker() {
  if (ringTickTimer) { clearInterval(ringTickTimer); ringTickTimer = null; }
  const el = document.getElementById('callRingTimer');
  if (el) el.textContent = '';
}

// ── Helper: Chèn tin nhắn hệ thống vào khung chat ──────────────
function _insertSystemCallMessage(text) {
  const messagesEl = document.getElementById('chatMessages');
  if (!messagesEl) return;
  const div = document.createElement('div');
  div.className = 'flex justify-center my-2';
  div.innerHTML = `<span class="inline-flex items-center gap-1.5 text-xs text-white/70 bg-white/10 backdrop-blur-sm border border-white/15 px-3 py-1 rounded-full">${text}</span>`;
  messagesEl.appendChild(div);
  // Cuộn xuống cuối
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Minimize / Restore call modal ──────────────────────────────
let _callIsMinimized = false;
function _hookMinimizeCallBtn() {
  const minBtn = document.getElementById('minimizeCallBtn');
  if (!minBtn) return;
  const freshBtn = minBtn.cloneNode(true);
  minBtn.replaceWith(freshBtn);
  freshBtn.onclick = () => {
    const modal = document.getElementById('videoCallModal');
    if (!modal) return;
    _callIsMinimized = !_callIsMinimized;
    if (_callIsMinimized) {
      // Thu nhỏ: đưa modal về góc phải dưới
      modal.classList.remove('inset-0');
      modal.style.cssText = `
        position: fixed !important;
        bottom: 16px !important;
        right: 16px !important;
        top: auto !important;
        left: auto !important;
        width: 340px !important;
        height: 230px !important;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.7);
        z-index: 499;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.15);
        transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
      `;
      freshBtn.title = 'Phóng to cuộc gọi';
      freshBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>`;
    } else {
      // Phóng to: đưa về toàn màn hình
      modal.style.cssText = '';
      modal.classList.add('inset-0');
      freshBtn.title = 'Thu nhỏ cuộc gọi';
      freshBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"/></svg>`;
    }
  };
}

// ── Cleanup hoàn toàn ─────────────────────────────────────────
function closeVideoCall() {
  if (isEndingCall) return;
  isEndingCall = true;

  // ── REST fallback: báo server dù WS đã đóng ──────────────────
  if (activeCallConvId) {
    const _convId = activeCallConvId;
    activeCallConvId = null;
    authFetch(API.leaveCall(_convId), { method: 'POST' })
      .catch(() => {}); // fire-and-forget, không block UI
  }

  if (ringingTimer) { clearTimeout(ringingTimer); ringingTimer = null; }
  if (callDurationTimer) { clearInterval(callDurationTimer); callDurationTimer = null; }
  stopRingTicker();
  stopDialingTone();

  const modal = document.getElementById('videoCallModal');
  const grid = document.getElementById('videoTilesGrid');

  modal?.classList.add('hidden');
  document.getElementById('callRingingScreen')?.classList.add('hidden');
  // Restore modal về fullscreen nếu đang thu nhỏ
  if (_callIsMinimized) {
    const modalEl = document.getElementById('videoCallModal');
    if (modalEl) {
      modalEl.style.cssText = '';
      modalEl.classList.add('inset-0');
    }
    _callIsMinimized = false;
  }
  // Ẩn REC badge
  const recBadge = document.getElementById('recBadge');
  if (recBadge) recBadge.classList.replace('flex', 'hidden');
  // Xoá tất cả audio element của remote participants
  document.getElementById('remoteAudioContainer')?.replaceChildren();

  document.getElementById('callInCallScreen')?.classList.add('hidden');
  document.getElementById('localVideoWrap')?.classList.add('hidden');
  if (grid) grid.innerHTML = '';

  const endBtn = document.getElementById('endCallBtn');
  if (endBtn) endBtn.disabled = false;

  if (currentVideoRoom) {
    try {
      currentVideoRoom.removeAllListeners();
      currentVideoRoom.localParticipant?.trackPublications?.forEach(pub => pub.track?.stop());
      currentVideoRoom.disconnect();
    } catch (_) { }
    currentVideoRoom = null;
  }

  if (callWs) {
    callWs.onclose = null;
    callWs.close();
    callWs = null;
  }

  callStartTs = null;
  isInitingCall = false;
  setTimeout(() => { isEndingCall = false; }, 500);
}

// ── Call WebSocket (nhận sự kiện call_ended / call_user_left) ─
let callWsReconnectAttempts = 0;
const CALL_WS_MAX_RECONNECT = 10;
const CALL_WS_BASE_DELAY = 1000;

function connectCallWs(convId) {
  if (callWs) { callWs.onclose = null; callWs.close(); callWs = null; }
  callWsReconnectAttempts = 0;

  callWs = new WebSocket(API.wsCall(convId));

  callWs.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'call_ended' || data.type === 'call_cancelled') {
        const statusEl = document.getElementById('callStatusText');
        const ringingScreen = document.getElementById('callRingingScreen');
        if (statusEl && ringingScreen && !ringingScreen.classList.contains('hidden')) {
          statusEl.textContent = data.type === 'call_cancelled' ? 'Cuộc gọi bị từ chối' : 'Cuộc gọi kết thúc';
          statusEl.classList.add('text-red-400');
          setTimeout(() => {
            statusEl.classList.remove('text-red-400');
            closeVideoCall();
          }, 2500);
        } else {
          closeVideoCall();
        }
      }
      if (data.type === 'call_user_left') {
        showToast(`${data.user_name} đã rời cuộc gọi`, 'gray');
      }
      if (data.type === 'recording_started') {
        const btn = document.getElementById('toggleRecordBtn');
        if (btn) {
          btn.classList.add('bg-red-500/80');
        }
        // Hiện REC badge nhấp nháy ở topbar
        const recBadge = document.getElementById('recBadge');
        if (recBadge) recBadge.classList.replace('hidden', 'flex');
        // Tin nhắn hệ thống nổi bật trong khung chat
        const recorderName = data.recorder_name || 'Một thành viên';
        _insertSystemCallMessage(`🔴 ${recorderName} bắt đầu ghi hình cuộc gọi`);
        showToast(`🔴 ${recorderName} bắt đầu ghi hình`, 'red');

        // Lưu lại ai đang ghi – chỉ họ mới được nhấn Stop
        window._currentRecorderId = data.recorder_id;
        const myId = window._myUserId; // được gán khi vào phòng (xem bên dưới)
        if (btn && myId && String(myId) !== String(data.recorder_id)) {
          // Người khác: chỉ đổi icon sang càm biết nhưng không cho nhấn
          btn.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>`;
          btn.title = 'Đang ghi hình bởi ' + recorderName;
          btn.disabled = true;
          btn.classList.add('opacity-60', 'cursor-not-allowed');
        } else if (btn) {
          // Người ghi: đổi sang icon dừng
          btn.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
          btn.title = 'Dừng ghi hình';
        }
      }
      if (data.type === 'recording_stopped') {
        const btn = document.getElementById('toggleRecordBtn');
        if (btn) {
          btn.classList.remove('bg-red-500/80');
          btn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" stroke-width="2"/></svg>`;
          btn.title = 'Ghi hình';
          btn.disabled = false;
          btn.classList.remove('opacity-60', 'cursor-not-allowed');
        }
        // Ẩn REC badge
        const recBadge = document.getElementById('recBadge');
        if (recBadge) recBadge.classList.replace('flex', 'hidden');
        window._currentRecorderId = null;
        _insertSystemCallMessage('⏹ Đã dừng ghi hình cuộc gọi');
        showToast('Đã dừng ghi hình', 'gray');
      }
    } catch (_) { }
  };

  callWs.onclose = () => {
    callWs = null;
    if (!isEndingCall && currentVideoRoom && callWsReconnectAttempts < CALL_WS_MAX_RECONNECT) {
      const delay = CALL_WS_BASE_DELAY * Math.pow(2, callWsReconnectAttempts);
      callWsReconnectAttempts++;
      setTimeout(() => connectCallWs(convId), Math.min(delay, 30000));
    }
  };

  callWs.onerror = () => {
    if (callWs) { callWs.onclose = null; callWs.close(); callWs = null; }
  };
}

// ── Grid layout động theo số participant ──────────────────────
function updateGridLayout() {
  const grid = document.getElementById('videoTilesGrid');
  if (!grid) return;
  const count = grid.children.length;
  grid.style.gridTemplateColumns =
    count <= 1 ? '1fr' :
      count <= 4 ? 'repeat(2, 1fr)' :
        'repeat(3, 1fr)';
}

// ── Entry point khi user bấm nút gọi ─────────────────────────
async function initVideoCall(convId) {
  if (isInitingCall) return;

  // Đang trong phòng → hiện lại modal
  if (currentVideoRoom) {
    document.getElementById('videoCallModal')?.classList.remove('hidden');
    return;
  }

  isInitingCall = true;
  try {
    const statusRes = await authFetch(API.videoRoomStatus(convId));
    if (statusRes.ok) {
      const statusData = await statusRes.json();
      if (statusData.has_active_call) {
        // Thử tham gia cuộc gọi hiện tại
        const joinRes = await authFetch(API.joinVideoRoom(convId), { method: 'POST' });
        if (joinRes.ok) {
          const joinData = await joinRes.json();
          await startVideoCall(joinData.token, joinData.livekit_url, joinData.room_name, convId, false);
          isInitingCall = false;
          return;
        } else {
          const err = await joinRes.json().catch(() => ({}));
          if (err.detail) showToast(err.detail, 'red');
          isInitingCall = false;
          return; // Không thử tạo mới nếu join thất bại do quyền (VD: 1-1 đã từ chối)
        }
      }
    }

    const res = await authFetch(API.createVideoRoom(convId), { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = err.detail || (err.non_field_errors && err.non_field_errors[0]) || Object.values(err)[0] || 'Lỗi tạo video call';
      showToast(Array.isArray(msg) ? msg[0] : msg, 'red');
      isInitingCall = false;
      return;
    }
    const data = await res.json();
    
    if (data.is_busy) {
      const modal = document.getElementById('videoCallModal');
      if (modal) {
        modal.classList.remove('hidden');
        showRingingScreen(data.remote_name, data.remote_avatar, 'Người dùng đang bận');
        setTimeout(() => closeVideoCall(), 2500);
      }
      return;
    }

    await startVideoCall(data.token, data.livekit_url, data.room_name, convId, true, data.remote_name, data.remote_avatar);
  } catch (e) {
    console.error(e);
    showToast('Lỗi kết nối cuộc gọi', 'red');
  } finally {
    isInitingCall = false;
  }
}

// ── Main call function ─────────────────────────────────────────
// isCaller=true: mình là người gọi (caller), hiện ringing screen
// isCaller=false: mình là người nhận (callee vừa accept), kết nối thẳng vào phòng
async function startVideoCall(token, url, roomName, convId, isCaller = false, remoteName = '', remoteAvatar = '') {
  const modal = document.getElementById('videoCallModal');
  if (!modal) return;

  // Hiện modal
  modal.classList.remove('hidden');

  // Track convId để REST fallback hoạt động
  activeCallConvId = convId;

  // Kết nối WS để nhận sự kiện từ server
  connectCallWs(convId);

  // Cleanup phòng cũ
  if (currentVideoRoom) {
    currentVideoRoom.removeAllListeners();
    await currentVideoRoom.disconnect();
    currentVideoRoom = null;
  }

  const { Room, RoomEvent } = window.LivekitClient;
  const room = new Room({ adaptiveStream: true, dynacast: true });
  currentVideoRoom = room;

  // ── Hook nút cancel (ringing) ──────────────────────────────
  const cancelBtn = document.getElementById('cancelCallBtn');
  if (cancelBtn) {
    // Clone để xóa listener cũ
    const freshCancel = cancelBtn.cloneNode(true);
    cancelBtn.replaceWith(freshCancel);
    freshCancel.onclick = async () => {
      freshCancel.disabled = true;
      try {
        await authFetch(API.cancelCall(convId), { method: 'POST' });
      } catch (e) {
        console.error('Lỗi khi hủy cuộc gọi API', e);
      }

      if (callWs?.readyState === WebSocket.OPEN) {
        callWs.send(JSON.stringify({ type: 'end_call' }));
        setTimeout(() => { if (!isEndingCall) closeVideoCall(); }, 2000);
      } else {
        closeVideoCall();
      }
    };
  }

  // ── Hook nút End (in-call) ─────────────────────────────────
  const endBtn = document.getElementById('endCallBtn');
  if (endBtn) {
    const freshEnd = endBtn.cloneNode(true);
    endBtn.replaceWith(freshEnd);
    freshEnd.onclick = () => {
      freshEnd.disabled = true;
      if (callWs?.readyState === WebSocket.OPEN) {
        callWs.send(JSON.stringify({ type: 'end_call' }));
        setTimeout(() => { if (!isEndingCall) closeVideoCall(); }, 3000);
      } else {
        closeVideoCall();
      }
    };
  }
  
  // ── Hook Record Button (Group only) ───────────────────────
  const recordBtn = document.getElementById('toggleRecordBtn');
  if (recordBtn) {
    const isGroupConv = activeConvMeta?.is_group;
    if (!isGroupConv) {
      recordBtn.classList.add('hidden');
    } else {
      recordBtn.classList.remove('hidden');
      const freshRecord = recordBtn.cloneNode(true);
      recordBtn.replaceWith(freshRecord);
      freshRecord.classList.remove('bg-red-500/80');
      freshRecord.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" stroke-width="2"/></svg>`;
      freshRecord.title = 'Bắt đầu ghi hình';

      let mediaRecorder = null;
      let recordedChunks = [];
      let isRecording = false;

      freshRecord.onclick = async () => {
        if (freshRecord.disabled) return;
        freshRecord.disabled = true;

        try {
          if (!isRecording) {
            // ── Bắt đầu ghi ───────────────────────────────────
            recordedChunks = [];
            
            // Lấy media stream từ màn hình
            let combinedStream = null;
            try {
                // Chúng ta sẽ lấy toàn màn hình hoặc tab hiện tại để đảm bảo luôn có video
                const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                combinedStream = displayStream;
                
                // Khi người dùng bấm "Dừng chia sẻ" trên trình duyệt, ta cũng tự dừng record
                displayStream.getVideoTracks()[0].onended = () => {
                    if (isRecording) {
                        freshRecord.click();
                    }
                };
            } catch (err) {
                showToast('Bạn cần cấp quyền chia sẻ màn hình để ghi hình', 'red');
                freshRecord.disabled = false;
                return;
            }

            const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
              ? 'video/webm;codecs=vp9,opus'
              : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');

            mediaRecorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };

            mediaRecorder.onstop = async () => {
              combinedStream.getTracks().forEach(t => t.stop());
              const blob = new Blob(recordedChunks, { type: mimeType || 'video/webm' });
              const file = new File([blob], `recording_${Date.now()}.webm`, { type: mimeType || 'video/webm' });
              showToast('Đang tải bản ghi lên...', 'gray');

              try {
                const fd = new FormData();
                fd.append('file', file);
                // Hardcode URL để tránh lỗi cache config.js
                const uploadUrl = API.toggleRecord(convId).replace('/record/', '/upload-recording/');
                console.log('Bắt đầu gửi video lên:', uploadUrl, 'Kích thước file:', file.size);
                
                const res = await authFetch(uploadUrl, { method: 'POST', body: fd });
                if (res.ok) {
                  showToast('Bản ghi đã lưu vào chat nhóm ✓', 'green');
                } else {
                  const err = await res.json().catch(() => ({}));
                  showToast(err.detail || 'Lỗi upload bản ghi', 'red');
                }
              } catch (e) {
                showToast('Lỗi tải bản ghi lên', 'red');
              }
            };

            mediaRecorder.start(1000); // chunk mỗi 1 giây
            isRecording = true;

            // Thông báo cho mọi người
            await authFetch(API.toggleRecord(convId), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'start' })
            });

            freshRecord.classList.add('bg-red-500/80');
            freshRecord.innerHTML = `<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
            freshRecord.title = 'Dừng ghi hình';
          } else {
            // ── Dừng ghi ──────────────────────────────────────
            isRecording = false;
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            // Không set mediaRecorder = null ở đây để tránh bị Garbage Collector thu hồi sớm

            await authFetch(API.toggleRecord(convId), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'stop' })
            });

            freshRecord.classList.remove('bg-red-500/80');
            freshRecord.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" stroke-width="2"/></svg>`;
            freshRecord.title = 'Bắt đầu ghi hình';
          }
        } catch (e) {
          console.error('Record error:', e);
          showToast('Lỗi ghi hình: ' + (e.message || e), 'red');
          isRecording = false;
          mediaRecorder = null;
          freshRecord.classList.remove('bg-red-500/80');
          freshRecord.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" stroke-width="2"/></svg>`;
        } finally {
          freshRecord.disabled = false;
        }
      };
    }
  }

  const SVG_MIC_ON = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/></svg>`;
  const SVG_MIC_OFF = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const SVG_CAM_ON = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>`;
  const SVG_CAM_OFF = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

  // ── Hook Toggle Mic ────────────────────────────────────────
  const micBtn = document.getElementById('toggleMicBtn');
  if (micBtn) {
    const freshMic = micBtn.cloneNode(true);
    micBtn.replaceWith(freshMic);
    freshMic.onclick = async () => {
      if (!currentVideoRoom) return;
      try {
        const enabled = currentVideoRoom.localParticipant.isMicrophoneEnabled;
        await currentVideoRoom.localParticipant.setMicrophoneEnabled(!enabled);
        const now = currentVideoRoom.localParticipant.isMicrophoneEnabled;
        freshMic.innerHTML = now ? SVG_MIC_ON : SVG_MIC_OFF;
        freshMic.classList.toggle('bg-red-500/50', !now);
      } catch (e) { showToast('Không thể bật/tắt mic', 'red'); }
    };
    // Default icon: mic off (chưa bật)
    freshMic.innerHTML = SVG_MIC_OFF;
    freshMic.classList.add('bg-red-500/50');
  }

  // ── Hook Toggle Cam ────────────────────────────────────────
  const camBtn = document.getElementById('toggleCamBtn');
  if (camBtn) {
    const freshCam = camBtn.cloneNode(true);
    camBtn.replaceWith(freshCam);
    freshCam.onclick = async () => {
      if (!currentVideoRoom) return;
      try {
        const enabled = currentVideoRoom.localParticipant.isCameraEnabled;
        await currentVideoRoom.localParticipant.setCameraEnabled(!enabled);
        const now = currentVideoRoom.localParticipant.isCameraEnabled;
        freshCam.innerHTML = now ? SVG_CAM_ON : SVG_CAM_OFF;
        freshCam.classList.toggle('bg-red-500/50', !now);
        const localWrap = document.getElementById('localVideoWrap');
        const localVideo = document.getElementById('localVideo');
        if (now && localWrap && localVideo) {
          localWrap.classList.remove('hidden');
          currentVideoRoom.localParticipant.videoTrackPublications.forEach(p => {
            if (p.track) p.track.attach(localVideo);
          });
        } else {
          localWrap?.classList.add('hidden');
        }
      } catch (e) { showToast('Không tìm thấy camera', 'red'); }
    };
    // Default icon: cam off
    freshCam.innerHTML = SVG_CAM_OFF;
    freshCam.classList.add('bg-red-500/50');
  }

  // ── Kết nối LiveKit ────────────────────────────────────────
  try {
    await room.connect(url, token);

    const grid = document.getElementById('videoTilesGrid');

    if (isCaller) {
      // ── CALLER: Hiện ringing screen, chờ ai vào phòng ──────
      showRingingScreen(remoteName, remoteAvatar, 'Đang đổ chuông...');
      startRingTicker();
      playDialingTone();

      // Timeout 60s không ai bắt → tự end
      ringingTimer = setTimeout(() => {
        showToast('Không có người trả lời', 'gray');
        if (callWs?.readyState === WebSocket.OPEN) {
          callWs.send(JSON.stringify({ type: 'end_call' }));
          setTimeout(() => { if (!isEndingCall) closeVideoCall(); }, 2000);
        } else {
          closeVideoCall();
        }
      }, 60000);

      // Khi callee vào → chuyển sang in-call screen
      room.on(RoomEvent.ParticipantConnected, async (participant) => {
        if (ringingTimer) { clearTimeout(ringingTimer); ringingTimer = null; }
        stopRingTicker();
        stopDialingTone();
        showInCallScreen();

        // Bây giờ mới bật mic (không yêu cầu trước)
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          const mic = document.getElementById('toggleMicBtn');
          if (mic) { mic.innerHTML = SVG_MIC_ON; mic.classList.remove('bg-red-500/50'); }
        } catch (_) { }

        // Tạo tile cho callee
        _addParticipantTile(grid, participant);
        updateGridLayout();
      });

    } else {
      // ── CALLEE: Vào thẳng in-call screen ───────────────────
      showInCallScreen();

      // Bật mic ngay khi callee accept
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
        const mic = document.getElementById('toggleMicBtn');
        if (mic) { mic.innerHTML = SVG_MIC_ON; mic.classList.remove('bg-red-500/50'); }
      } catch (_) { }

      // Tạo tile cho những người đã có trong phòng
      room.remoteParticipants.forEach(p => { _addParticipantTile(grid, p); });
      updateGridLayout();

      // Caller vào (hoặc đã có sẵn)
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        _addParticipantTile(grid, participant);
        updateGridLayout();
      });
    }

    // ── Các event chung ────────────────────────────────────────
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      document.getElementById(`participant-${participant.identity}`)?.remove();
      showToast(`${participant.name || 'Người dùng'} đã rời cuộc gọi`, 'gray');
      updateGridLayout();
    });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === 'video') {
        let wrapper = document.getElementById(`participant-${participant.identity}`);
        if (!wrapper) { wrapper = _addParticipantTile(grid, participant); }
        wrapper.innerHTML = '';
        const videoEl = track.attach();
        videoEl.className = 'w-full h-full object-cover';
        const label = document.createElement('div');
        label.className = 'absolute bottom-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded-md font-medium';
        label.textContent = participant.name || participant.identity;
        wrapper.appendChild(videoEl);
        wrapper.appendChild(label);
        updateGridLayout();
      } else if (track.kind === 'audio') {
        // FIX: Attach audio track vào DOM để trình duyệt phát tiếng
        const audioEl = track.attach();
        audioEl.autoplay = true;
        audioEl.id = `audio-${participant.identity}`;
        // Bật âm lượng tối đa
        audioEl.volume = 1.0;
        
        const audioContainer = document.getElementById('remoteAudioContainer');
        if (audioContainer) {
          audioContainer.appendChild(audioEl);
        } else {
          document.body.appendChild(audioEl);
        }
        
        // Bắt buộc trình duyệt play (vì một số trình duyệt block autoplay nếu không có Element trong DOM)
        audioEl.play().catch(e => console.warn('Audio play error:', e));
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      track.detach();
      if (track.kind === 'video') {
        const wrapper = document.getElementById(`participant-${participant.identity}`);
        if (wrapper) {
          let avatarUrl = "https://res.cloudinary.com/dec8t19tm/image/upload/v1781533632/default-avatar_qprrlr.jpg";
          try {
            if (participant.metadata) {
              const md = JSON.parse(participant.metadata);
              if (md.avatar) avatarUrl = md.avatar;
            }
          } catch(e) {}
          
          wrapper.innerHTML = `
            <div class="flex flex-col items-center gap-2">
              <img src="${avatarUrl}" class="w-16 h-16 rounded-full object-cover border-2 border-white/20" alt="Avatar">
              <p class="text-white/80 text-sm font-medium">${participant.name || participant.identity}</p>
            </div>`;
        }
        updateGridLayout();
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      if (!isEndingCall) closeVideoCall();
    });

  } catch (error) {
    console.error('Lỗi kết nối LiveKit:', error);
    showToast('Không thể kết nối cuộc gọi', 'red');
    closeVideoCall();
  }
}

function _addParticipantTile(grid, participant) {
  if (document.getElementById(`participant-${participant.identity}`)) return;
  const wrapper = document.createElement('div');
  wrapper.id = `participant-${participant.identity}`;
  wrapper.className = 'relative rounded-xl overflow-hidden aspect-video bg-gray-800 flex items-center justify-center';
  
  let avatarUrl = "https://res.cloudinary.com/dec8t19tm/image/upload/v1781533632/default-avatar_qprrlr.jpg";
  try {
    if (participant.metadata) {
      const md = JSON.parse(participant.metadata);
      if (md.avatar) avatarUrl = md.avatar;
    }
  } catch(e) {}

  wrapper.innerHTML = `
    <div class="flex flex-col items-center gap-2">
      <img src="${avatarUrl}" class="w-16 h-16 rounded-full object-cover border-2 border-white/20" alt="Avatar">
      <p class="text-white/80 text-sm font-medium">${participant.name || participant.identity}</p>
    </div>`;
  grid.appendChild(wrapper);
  return wrapper;
}

// Expose để notification consumer gọi khi callee bấm Accept
window.startVideoCall = startVideoCall;

// Auto-resume call if redirected from another page
setTimeout(() => {
  const pendingCallStr = sessionStorage.getItem("pendingVideoCall");
  if (pendingCallStr) {
    sessionStorage.removeItem("pendingVideoCall");
    try {
      const pc = JSON.parse(pendingCallStr);
      startVideoCall(pc.token, pc.url, pc.roomName, pc.convId);
    } catch(e) {
      console.error("Failed to resume video call", e);
    }
  }
}, 300);
