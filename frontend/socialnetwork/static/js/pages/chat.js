import { authFetch } from "../authenticate/auth.js";
import { fetchUserProfileShared } from "../app/profile.js";
import { API, withPageSize, DEFAULT_AVATAR } from "../shared/config.js";
import { uploadChatFiles, sendChatWsMessage } from "../shared/chat-upload.js";
import { el, img, textEl } from "../shared/dom.js";
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
let activeConvMeta = null;
let firstMessageInConv = null;
let tempIdCounter = 0;

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

// ========= WS PING WATCHDOG =========
const PING_WATCHDOG_MS = 70 * 1000;
let chatPingWatchdog = null;
let convPingWatchdog = null;

function resetChatPingWatchdog(convId) {
  if (chatPingWatchdog) clearTimeout(chatPingWatchdog);
  chatPingWatchdog = setTimeout(() => {
    console.warn("[chat] Ping watchdog fired — reconnecting chatWs");
    if (Number(activeConvId) === Number(convId)) connectChatWs(convId);
  }, PING_WATCHDOG_MS);
}

function resetConvPingWatchdog() {
  if (convPingWatchdog) clearTimeout(convPingWatchdog);
  convPingWatchdog = setTimeout(() => {
    console.warn("[chat] Ping watchdog fired — reconnecting convWs");
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

function $(id) {
  return document.getElementById(id);
}

// ========= REPLY HELPERS =========
function setReply(msgId, content) {
  replyToId = msgId;
  replyToContent = content;
  if (replyPreviewBar) {
    replyPreviewBar.classList.remove("hidden");
    replyPreviewBar.classList.add("flex");
  }
  if (replyPreviewText) {
    replyPreviewText.textContent =
      content && content.length > 100 ? content.slice(0, 100) + "…" : content || "";
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

// ========= SCROLL HELPERS =========
function scrollToBottom(smooth = false) {
  if (!messagesEl) return;
  if (smooth) {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
  } else {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

function scrollToBottomDeferred() {
  // Two-frame defer so DOM is fully painted before measuring scrollHeight
  requestAnimationFrame(() => {
    requestAnimationFrame(() => scrollToBottom(false));
  });
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
    friendsStrip.appendChild(
      textEl("p", "text-xs text-gray-400 px-2 shrink-0", "Chưa có bạn bè")
    );
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
    imgEl.className =
      "w-14 h-14 rounded-full object-cover ring-2 ring-fb-primary ring-offset-2 dark:ring-offset-[#242526] group-hover:scale-105 transition";
    imgEl.alt = "";
    const label = document.createElement("span");
    label.className =
      "text-[10px] text-gray-600 dark:text-fb-muted truncate w-full text-center";
    label.textContent = (profile.first_name || "").split(" ")[0] || "Bạn";
    btn.append(imgEl, label);
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
  conv._startedByMe = true;
  history.replaceState(null, "", "/chat/");
  await loadConversations();
  openConversation(conv, name);
}

// ========= CONV LIST WS =========
function connectConvListWs() {
  if (convWsReconnectTimer) {
    clearTimeout(convWsReconnectTimer);
    convWsReconnectTimer = null;
  }
  try {
    if (convWs) {
      convWs.onclose = null;
      convWs.close();
    }
    convWs = new WebSocket(API.wsConversations());

    convWs.onopen = () => {
      resetConvPingWatchdog();
    };

    convWs.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "ping") {
          convWs.send(JSON.stringify({ type: "pong" }));
          resetConvPingWatchdog();
          return;
        }
        if (data.conversation_id) bumpConversation(data);
      } catch (_) {}
    };

    convWs.onclose = () => {
      if (convPingWatchdog) clearTimeout(convPingWatchdog);
      if (!convWsReconnectTimer) {
        convWsReconnectTimer = setTimeout(() => {
          convWsReconnectTimer = null;
          connectConvListWs();
        }, 3000);
      }
    };

    convWs.onerror = (e) => console.error("[chat] convWs error", e);
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
    if (preview) {
      const type = event.message_type;
      if (type === "file" || (!event.last_message && type)) {
        preview.textContent = "📎 File đính kèm";
      } else {
        preview.textContent = event.last_message || "Tin nhắn mới";
      }
    }
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
    convListEl.appendChild(
      textEl("p", "text-sm text-gray-400 p-4 text-center", "Chưa có tin nhắn")
    );
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
  const wrap = el("button", "w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-fb-secondary dark:hover:bg-white/10 transition-colors cursor-pointer group relative text-left mb-0.5", {
    type: "button",
  });

  wrap.append(
    img(other?.picture || DEFAULT_AVATAR, "w-12 h-12 rounded-full object-cover shrink-0 shadow-sm border border-transparent dark:border-white/10", "")
  );

  const body = el("div", "flex-1 min-w-0 conv-body");
  body.append(
    textEl("p", "font-semibold text-sm truncate dark:text-slate-100", name),
    textEl("p", "text-xs text-gray-500 dark:text-slate-400 truncate conv-preview", messagePreview(c))
  );
  wrap.append(body);

  if (c.status === "pending") {
    wrap.appendChild(
      textEl("span", "text-[10px] text-amber-500 font-semibold shrink-0", "Chờ")
    );
  }
  if (c.unread_count > 0) {
    wrap.appendChild(
      textEl(
        "span",
        "bg-fb-primary dark:bg-indigo-500 text-white text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 shadow-sm dark:shadow-indigo-500/30",
        String(c.unread_count)
      )
    );
  }

  const menuBtn = textEl("span", "conv-menu hidden group-hover:inline text-xl px-1 shrink-0", "⋯");
  wrap.appendChild(menuBtn);

  wrap.addEventListener("click", (e) => {
    if (e.target.closest(".conv-menu")) return;
    openConversation(c, name);
  });

  menuBtn.addEventListener("click", (e) => {
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
    "block w-full text-left px-4 py-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] text-red-500 dark:text-red-400";
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

async function fetchFirstMessage(convId) {
  try {
    const url = `${API.messages(convId)}?ordering=created_at&page_size=1`;
    const res = await authFetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.results || [])[0] || null;
  } catch {
    return null;
  }
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
    pendingBanner.appendChild(
      textEl(
        "p",
        "text-sm text-amber-900 dark:text-amber-100 flex-1",
        firstMessageInConv
          ? "Đang chờ người nhận phản hồi. Họ cần chấp nhận yêu cầu trước khi trả lời."
          : "Gửi tin nhắn đầu tiên để gửi yêu cầu trò chuyện."
      )
    );
    chatForm?.classList.remove("opacity-50", "pointer-events-none");
    return;
  }

  if (!firstMessageInConv) {
    pendingBanner.appendChild(
      textEl(
        "p",
        "text-sm text-amber-900 dark:text-amber-100 flex-1",
        "Chưa có tin nhắn yêu cầu."
      )
    );
    chatForm?.classList.add("opacity-50", "pointer-events-none");
    return;
  }

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className =
    "px-4 py-2 bg-fb-primary dark:bg-[#1877f2] text-white rounded-lg text-sm font-semibold hover:bg-fb-primary-hover dark:hover:bg-[#166fe5]";
  accept.textContent = "Chấp nhận";
  accept.onclick = async () => {
    const res = await authFetch(API.acceptConv(conv.id), { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "Không chấp nhận được", "red");
      return;
    }
    pendingBanner.classList.add("hidden");
    pendingConv = false;
    conv.status = "accept";
    chatForm?.classList.remove("opacity-50", "pointer-events-none");
    showToast("Đã chấp nhận", "green");
    loadConversations();
  };
  const reject = document.createElement("button");
  reject.type = "button";
  reject.className =
    "px-4 py-2 rounded-lg text-sm font-semibold bg-gray-200 dark:bg-[#4e4f50] text-gray-900 dark:text-[#e4e6eb] hover:opacity-90";
  reject.textContent = "Từ chối";
  reject.onclick = async () => {
    const res = await authFetch(API.rejectConv(conv.id), { method: "POST" });
    if (!res.ok) showToast("Không từ chối được", "red");
    else showToast("Đã từ chối");
    pendingBanner.classList.add("hidden");
    pendingConv = false;
    loadConversations();
    messagesEl?.replaceChildren();
    activeConvId = null;
  };
  pendingBanner.append(accept, reject);
  chatForm?.classList.add("opacity-50", "pointer-events-none");
}

async function openConversation(conv, titleName) {
  if (!messagesEl) return;
  activeConvId = conv.id;
  activeConvMeta = conv;
  clearReply();

  const panel = $("chatPanel");
  panel?.classList.remove("hidden");
  panel?.classList.add("flex");
  if (chatTitle) chatTitle.textContent = titleName || getConvTitle(conv);

  messagesEl.replaceChildren();

  // Show loading indicator
  const loader = document.createElement("div");
  loader.className = "flex items-center justify-center h-full gap-2";
  const spinner = document.createElement("div");
  spinner.className = "w-5 h-5 border-3 border-fb-primary border-t-transparent rounded-full animate-spin";
  loader.appendChild(spinner);
  const loadText = document.createElement("p");
  loadText.className = "text-sm text-gray-500 dark:text-fb-muted";
  loadText.textContent = "Đang tải...";
  loader.appendChild(loadText);
  messagesEl.appendChild(loader);

  pendingBanner?.classList.add("hidden");
  const typingIndicator = document.getElementById("chatTypingIndicator");
  if (typingIndicator) {
    typingIndicator.textContent = "";
    typingIndicator.classList.remove("typing-active");
  }
  pendingConv = conv.status === "pending";
  firstMessageInConv = null;

  connectChatWs(conv.id);
  messagesNext = API.messages(conv.id);
  await loadMessages(true);

  if (pendingConv) {
    firstMessageInConv = await fetchFirstMessage(conv.id);
    await applyPendingUI(conv);
  } else {
    chatForm?.classList.remove("opacity-50", "pointer-events-none");
  }

  try {
    await authFetch(API.seenMessage(conv.id), { method: "POST" });
  } catch (e) {
    console.warn("[chat] seen", e);
  }

  // Init "Đã xem" state based on OTHER member's last_read_message
  const otherMem = (conv.members || []).find(
    (m) => Number(m.user?.id) !== Number(myProfileId)
  );
  if (otherMem && otherMem.last_read_message) {
    markSeenMessages(otherMem.last_read_message);
  }
}

// ========= CHAT WS =========
function connectChatWs(convId) {
  if (chatWsReconnectTimer) {
    clearTimeout(chatWsReconnectTimer);
    chatWsReconnectTimer = null;
  }
  if (chatWs) {
    chatWs.onclose = null;
    chatWs.onmessage = null;
    chatWs.close();
  }
  if (chatPingWatchdog) clearTimeout(chatPingWatchdog);

  try {
    chatWs = new WebSocket(API.wsChat(convId));

    chatWs.onopen = () => {
      console.log("[chat] WebSocket connected for conv", convId);
      resetChatPingWatchdog(convId);
    };

    chatWs.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.type === "ping") {
          chatWs.send(JSON.stringify({ type: "pong" }));
          resetChatPingWatchdog(convId);
          return;
        }

        if (data.type === "seen_message") {
          // Only update when OTHER person reads (not myself)
          if (Number(data.user_id) !== Number(myUserId)) {
            markSeenMessages(data.last_message_id);
          }
          return;
        }

        if (data.type === "typing") {
          handleTypingEvent(data);
          return;
        }

        if (data.type === "message_deleted") {
          document.querySelector(`[data-msg-id="${data.id}"]`)?.remove();
          return;
        }

        if (data.type === "message_updated") {
          const elUpdated = document.querySelector(
            `[data-msg-id="${data.id}"] .msg-text`
          );
          if (elUpdated) elUpdated.textContent = `${data.content} (đã sửa)`;
          return;
        }

        // New chat message
        if (data.id != null && (data.message != null || data.attachments != null)) {
          appendMessage(
            {
              id: data.id,
              content: data.message ?? data.content ?? "",
              message: data.message ?? "",
              sender_id: data.sender_id,
              attachments: data.attachments || [],
              reply_to_id: data.reply_to_id,
              reply_to_id_content: data.reply_to_id_content,
            },
            true
          );
          if (pendingConv && activeConvMeta && !firstMessageInConv) {
            fetchFirstMessage(activeConvId).then((m) => {
              firstMessageInConv = m;
              applyPendingUI(activeConvMeta);
            });
          }

          // If from other person and we're actively viewing → mark seen
          if (Number(data.sender_id) !== Number(myUserId) && !document.hidden) {
            authFetch(API.seenMessage(activeConvId), { method: "POST" }).catch(() => {});
          }
        }
      } catch (err) {
        console.error("[chat] WebSocket message error:", err);
      }
    };

    chatWs.onerror = (err) => {
      console.error("[chat] WebSocket error:", err);
    };

    chatWs.onclose = () => {
      if (chatPingWatchdog) clearTimeout(chatPingWatchdog);
      if (Number(activeConvId) !== Number(convId)) return;
      if (!chatWsReconnectTimer) {
        chatWsReconnectTimer = setTimeout(() => {
          chatWsReconnectTimer = null;
          if (Number(activeConvId) === Number(convId)) connectChatWs(convId);
        }, 3000);
      }
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
    if (reset) {
      messagesEl.replaceChildren();
      items.forEach((m) => appendMessage(m, false, false));
      // Scroll to bottom after full paint
      scrollToBottomDeferred();
    } else {
      const prevHeight = messagesEl.scrollHeight;
      for (let i = items.length - 1; i >= 0; i--) {
        appendMessage(items[i], false, true);
      }
      const newHeight = messagesEl.scrollHeight;
      messagesEl.scrollTop += newHeight - prevHeight;
    }
    messagesNext = data.next;
  } finally {
    loadingMessages = false;
  }
}

function appendMessage(m, scroll = true, prepend = false) {
  // sender_id from WS = Django User ID; REST m.sender.user = Django User ID
  const sid = m.sender?.user ?? m.sender?.id ?? m.sender_id;
  const mine =
    (myUserId != null && Number(sid) === Number(myUserId)) ||
    (myProfileId != null && Number(sid) === Number(myProfileId));

  const wrap = document.createElement("div");
  wrap.className = `flex ${mine ? "justify-end" : "justify-start"} mb-1 chat-msg-wrap`;
  wrap.dataset.msgId = m.id;

  // ─── Reply button (visible on hover) ─────────────────────────────
  const replyBtn = document.createElement("button");
  replyBtn.type = "button";
  replyBtn.title = "Trả lời";
  replyBtn.className =
    "chat-reply-btn self-center shrink-0 mx-1 " +
    "transition-opacity text-gray-400 dark:text-fb-muted hover:text-fb-primary " +
    "dark:hover:text-indigo-400 text-base leading-none";
  replyBtn.textContent = "↩";
  const msgContent = m.content || m.message || "";
  replyBtn.onclick = () => setReply(m.id, msgContent);

  // Show/hide reply button on hover
  wrap.addEventListener("mouseenter", () => { replyBtn.style.opacity = "1"; });
  wrap.addEventListener("mouseleave", () => { replyBtn.style.opacity = "0"; });
  replyBtn.style.opacity = "0";

  const bubble = document.createElement("div");
  bubble.className = `max-w-[75%] px-3 py-2 rounded-2xl text-sm transition-all ${
    mine
      ? "bg-fb-primary dark:bg-gradient-to-br dark:from-blue-600 dark:to-indigo-600 dark:border dark:border-indigo-500/50 dark:shadow-lg dark:shadow-indigo-500/25 text-white rounded-br-sm"
      : "bg-fb-secondary dark:bg-white/10 dark:backdrop-blur-md dark:border dark:border-white/10 dark:text-white dark:shadow-sm rounded-bl-sm"
  }`;

  // ─── Reply quote bubble ──────────────────────────────────────────
  const replyContent = m.reply_to_id_content ?? m.reply_to?.content;
  if (replyContent) {
    const quote = document.createElement("div");
    quote.className = `mb-1.5 px-2 py-1 rounded-lg border-l-2 text-xs opacity-75 cursor-pointer ${
      mine
        ? "border-white/60 bg-white/10 hover:bg-white/20"
        : "border-fb-primary/60 dark:border-indigo-400 bg-gray-200 dark:bg-white/5 hover:bg-gray-300 dark:hover:bg-white/10"
    }`;
    quote.textContent =
      replyContent.length > 80 ? replyContent.slice(0, 80) + "…" : replyContent;
    // Click quote → scroll to original message
    if (m.reply_to_id) {
      quote.onclick = () => {
        const target = document.querySelector(`[data-msg-id="${m.reply_to_id}"]`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.style.transition = "background 0.3s";
          target.style.background = "rgba(24,119,242,0.12)";
          setTimeout(() => { target.style.background = ""; }, 1000);
        }
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
    if (
      a.file_type === "image" ||
      a.file_type?.startsWith("image/") ||
      a.file_url?.match(/\.(jpg|jpeg|png|gif|webp)/i)
    ) {
      const image = document.createElement("img");
      image.src = a.file_url;
      image.className = "max-w-full rounded-lg mt-1 cursor-pointer";
      image.alt = a.file_name || "";
      image.onclick = () => window.open(a.file_url, "_blank");
      bubble.appendChild(image);
    } else if (a.file_type === "video" || a.file_type?.startsWith("video/")) {
      const video = document.createElement("video");
      video.src = a.file_url;
      video.controls = true;
      video.className = "max-w-full rounded-lg mt-1";
      bubble.appendChild(video);
    } else {
      const link = document.createElement("a");
      link.href = a.file_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "block mt-1 underline text-sm";
      link.textContent = `📎 ${a.file_name || "Tải file"}`;
      bubble.appendChild(link);
    }
  });

  if (!content && !(m.attachments || []).length) {
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

  // Seen label (only for my messages)
  const seenLabel = document.createElement("p");
  seenLabel.className = "msg-seen text-[10px] text-gray-400 dark:text-[#b0b3b8] mt-0.5 text-right";
  seenLabel.textContent = "";

  // Assemble: [replyBtn] [bubble] for mine, [bubble] [replyBtn] for theirs
  if (mine) {
    wrap.append(replyBtn, bubble);
  } else {
    wrap.append(bubble, replyBtn);
  }
  if (mine) wrap.appendChild(seenLabel);

  if (prepend) messagesEl.prepend(wrap);
  else messagesEl.appendChild(wrap);

  if (scroll) {
    scrollToBottom(false);
  }
}

// ─── Seen: only show "Đã xem" on the last message seen by other ──
function markSeenMessages(lastMessageId) {
  const seenId = Number(lastMessageId);
  if (!Number.isFinite(seenId)) return;

  // Clear all existing seen labels
  document.querySelectorAll(".msg-seen").forEach((el) => {
    el.textContent = "";
    el.classList.remove("seen-check");
  });

  // Walk backwards to find the last MY message that's been seen
  const nodes = document.querySelectorAll("[data-msg-id]");
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const id = Number(node.dataset.msgId);
    if (!Number.isFinite(id)) continue;
    const seenLabelEl = node.querySelector(".msg-seen");
    if (!seenLabelEl) continue; // only my messages have .msg-seen

    if (id <= seenId) {
      seenLabelEl.textContent = "✓ Đã xem";
      seenLabelEl.classList.add("seen-check");
      break;
    }
  }
}

// ========= TYPING =========
function ensureTypingIndicator() {
  let indicator = document.getElementById("chatTypingIndicator");
  if (indicator) return indicator;
  indicator = document.createElement("div");
  indicator.id = "chatTypingIndicator";
  indicator.className = "px-4 pb-2 flex items-center gap-2 text-xs text-gray-500 dark:text-fb-muted typing-indicator-wrap";
  indicator.style.minHeight = "20px";
  indicator.innerHTML = `
    <span class="typing-name"></span>
    <span class="typing-dots hidden">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </span>
  `;

  if (!document.getElementById("typingDotsStyle")) {
    const style = document.createElement("style");
    style.id = "typingDotsStyle";
    style.textContent = `
      .typing-dots { display: inline-flex; gap: 3px; align-items: center; }
      .typing-dots.hidden { display: none !important; }
      .typing-dots .dot {
        width: 6px; height: 6px; border-radius: 50%;
        background: currentColor; opacity: 0.4;
        animation: typingBounce 1.2s infinite ease-in-out;
      }
      .typing-dots .dot:nth-child(1) { animation-delay: 0s; }
      .typing-dots .dot:nth-child(2) { animation-delay: 0.2s; }
      .typing-dots .dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes typingBounce {
        0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
        30% { transform: translateY(-5px); opacity: 1; }
      }
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

  if (!data.is_typing) {
    if (nameEl) nameEl.textContent = "";
    if (dotsEl) dotsEl.classList.add("hidden");
    return;
  }

  if (nameEl) nameEl.textContent = `${data.sender || "Người dùng"} đang nhập`;
  if (dotsEl) dotsEl.classList.remove("hidden");

  if (typingIndicatorTimeout) clearTimeout(typingIndicatorTimeout);
  typingIndicatorTimeout = setTimeout(() => {
    if (nameEl) nameEl.textContent = "";
    if (dotsEl) dotsEl.classList.add("hidden");
  }, 3000);
}

function setTyping(isTyping) {
  if (!chatWs || chatWs.readyState !== WebSocket.OPEN) return;
  if (isTyping && !typingSent) {
    typingSent = true;
    chatWs.send(JSON.stringify({ type: "typing", is_typing: true }));
  }
  if (typingStopTimeout) clearTimeout(typingStopTimeout);
  typingStopTimeout = setTimeout(() => {
    if (!chatWs || chatWs.readyState !== WebSocket.OPEN) return;
    if (typingSent) {
      typingSent = false;
      chatWs.send(JSON.stringify({ type: "typing", is_typing: false }));
    }
  }, isTyping ? 1200 : 0);
}

function bindEvents() {
  chatForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canSendWhilePending()) {
      showToast("Chấp nhận yêu cầu tin nhắn trước khi trả lời", "red");
      return;
    }
    const text = chatInput?.value.trim();
    if (!text || !chatWs || chatWs.readyState !== WebSocket.OPEN) {
      showToast("Không gửi được — kiểm tra kết nối", "red");
      return;
    }

    const payload = { message: text, message_type: "text" };
    if (replyToId) payload.reply_to_id = replyToId;

    chatWs.send(JSON.stringify(payload));
    setTyping(false);
    clearReply();
    if (chatInput) chatInput.value = "";

    if (pendingConv && activeConvMeta && canSendWhilePending()) {
      fetchFirstMessage(activeConvId).then((m) => {
        firstMessageInConv = m;
        applyPendingUI(activeConvMeta);
      });
    }
  });

  cancelReplyBtn?.addEventListener("click", clearReply);

  // Mobile back button
  const backToChatList = $("backToChatList");
  const chatPanel = $("chatPanel");
  backToChatList?.addEventListener("click", () => {
    if (chatPanel) chatPanel.classList.add("hidden");
    if (chatPanel) chatPanel.classList.remove("flex");
  });

  chatInput?.addEventListener("input", () => {
    if (!chatWs || chatWs.readyState !== WebSocket.OPEN || !activeConvId) return;
    setTyping(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activeConvId && !pendingConv) {
      authFetch(API.seenMessage(activeConvId), { method: "POST" }).catch(() => {});
    }
  });

  $("chatFileInput")?.addEventListener("change", async (e) => {
    const input = e.target;
    if (!activeConvId) {
      showToast("Chọn hội thoại trước", "red");
      input.value = "";
      return;
    }
    if (!canSendWhilePending()) {
      showToast("Chấp nhận yêu cầu tin nhắn trước khi gửi file", "red");
      input.value = "";
      return;
    }
    const files = input.files;
    if (!files?.length) return;

    const attachBtn = input.closest("label");
    if (attachBtn) attachBtn.classList.add("opacity-50", "pointer-events-none");

    try {
      const ids = await uploadChatFiles(activeConvId, files);
      sendChatWsMessage(chatWs, { text: "", attachmentIds: ids });
      showToast("Đã gửi tệp đính kèm");
    } catch (err) {
      console.error("[chat] upload", err);
      showToast(err.message || "Upload thất bại", "red");
    } finally {
      input.value = "";
      attachBtn?.classList.remove("opacity-50", "pointer-events-none");
    }
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
        const item = document.createElement("div");
        item.className =
          "flex items-center justify-between p-3 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] rounded-lg dark:text-[#e4e6eb]";

        const name = document.createElement("span");
        name.className = "flex-1";
        name.textContent = getConvTitle(c);

        const actions = document.createElement("div");
        actions.className = "flex gap-2";

        const unhideBtn = document.createElement("button");
        unhideBtn.type = "button";
        unhideBtn.className =
          "px-3 py-1 bg-fb-primary dark:bg-[#1877f2] text-white rounded text-sm hover:bg-fb-primary-hover dark:hover:bg-[#166fe5]";
        unhideBtn.textContent = "Hiện lại";
        unhideBtn.onclick = async () => {
          await authFetch(API.hideConv(c.id), { method: "PATCH" });
          item.remove();
          showToast("Đã hiện lại đoạn chat");
          loadConversations();
        };

        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.className = "text-fb-primary text-sm font-semibold hover:underline";
        openBtn.textContent = "Mở";
        openBtn.onclick = () => {
          modal?.classList.add("hidden");
          openConversation(c);
        };

        actions.appendChild(unhideBtn);
        actions.appendChild(openBtn);
        item.appendChild(name);
        item.appendChild(actions);
        list?.appendChild(item);
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
  replyPreviewBar = $("replyPreviewBar");
  replyPreviewText = $("replyPreviewText");
  cancelReplyBtn = $("cancelReplyBtn");

  if (!convListEl) {
    console.error("[chat] #chatConvList not found — wrong page template?");
    return;
  }

  if (!messagesEl) {
    console.error("[chat] #chatMessages not found — wrong page template?");
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
      const errBox = el("div", "text-sm text-red-500 p-4 text-center");
      errBox.appendChild(textEl("p", "", "Lỗi tải dữ liệu."));
      const retry = el("button", "underline text-fb-primary mt-2", {
        type: "button",
        text: "Thử lại",
      });
      retry.addEventListener("click", () => initChat());
      errBox.appendChild(retry);
      convListEl.appendChild(errBox);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initChat());
} else {
  initChat();
}
