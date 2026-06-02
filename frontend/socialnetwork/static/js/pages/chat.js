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
const pendingMessages = new Map();
let tempIdCounter = 0;

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
  conv._startedByMe = true;
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
  const wrap = el("button", "w-full flex items-center gap-2 p-2 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] cursor-pointer group relative text-left", {
    type: "button",
  });

  wrap.append(
    img(other?.picture || DEFAULT_AVATAR, "w-12 h-12 rounded-full object-cover shrink-0", "")
  );

  const body = el("div", "flex-1 min-w-0 conv-body");
  body.append(
    textEl("p", "font-semibold text-sm truncate dark:text-[#e4e6eb]", name),
    textEl("p", "text-xs text-gray-500 dark:text-fb-muted truncate conv-preview", messagePreview(c))
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
        "bg-fb-primary dark:bg-[#1877f2] text-white text-xs px-2 rounded-full shrink-0",
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
  
  // Show loading indicator
  const loader = document.createElement("div");
  loader.className = "flex items-center justify-center h-full gap-2";
  const spinner = document.createElement("div");
  spinner.className = "w-5 h-5 border-3 border-fb-primary border-t-transparent rounded-full animate-spin";
  loader.appendChild(spinner);
  const text = document.createElement("p");
  text.className = "text-sm text-gray-500 dark:text-fb-muted";
  text.textContent = "Đang tải...";
  loader.appendChild(text);
  messagesEl.appendChild(loader);
  
  pendingBanner?.classList.add("hidden");
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
          const messageContent = data.message ?? data.content;
          const isMyMessage = Number(data.sender_id) === Number(myUserId) || Number(data.sender_id) === Number(myProfileId);
          
          // Kiểm tra xem có pending message trùng không (cho tin nhắn của chính mình)
          if (isMyMessage && pendingMessages.size > 0) {
            // Đơn giản hóa: lấy pending message đầu tiên (user thường chỉ gửi 1 message tại 1 thời điểm)
            const [matchedTempId, pending] = pendingMessages.entries().next().value;
            
            if (matchedTempId) {
              console.log('[chat] Matched pending message:', matchedTempId, 'with server message:', data.id);
              
              // Cancel timeout trước khi xóa pending message
              if (pending?.timeoutId) {
                clearTimeout(pending.timeoutId);
              }
              
              // Replace pending message với message thực từ server
              const pendingEl = document.querySelector(`[data-temp-id="${matchedTempId}"]`);
              if (pendingEl) {
                pendingEl.remove();
              }
              pendingMessages.delete(matchedTempId);
            }
          }
          
          appendMessage(
            {
              id: data.id,
              content: messageContent,
              sender_id: data.sender_id,
              attachments: data.attachments,
            },
            true
          );
          if (pendingConv && activeConvMeta && !firstMessageInConv) {
            fetchFirstMessage(activeConvId).then((m) => {
              firstMessageInConv = m;
              applyPendingUI(activeConvMeta);
            });
          }
        }
      } catch (err) {
        console.error("[chat] WebSocket message error:", err);
      }
    };
    
    chatWs.onopen = () => {
      console.log("[chat] WebSocket connected for conv", convId);
    };
    
    chatWs.onerror = (err) => {
      console.error("[chat] WebSocket error:", err);
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
    }
    items.forEach((m) => appendMessage(m, false));
    messagesNext = data.next;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } finally {
    loadingMessages = false;
  }
}

function appendMessage(m, scroll = true, isPending = false) {
  const sid = m.sender?.id ?? m.sender_id;
  const mine =
    (myUserId != null && Number(sid) === Number(myUserId)) ||
    (myProfileId != null && Number(sid) === Number(myProfileId));

  const wrap = document.createElement("div");
  wrap.className = `flex ${mine ? "justify-end" : "justify-start"} mb-1`;
  wrap.dataset.msgId = m.id;
  if (isPending) {
    wrap.dataset.tempId = m.id;
    wrap.classList.add('opacity-70');
  }

  const bubble = document.createElement("div");
  bubble.className = `max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
    mine
      ? "bg-fb-primary dark:bg-[#1877f2] text-white rounded-br-sm"
      : "bg-fb-secondary dark:bg-[#3a3b3c] dark:text-[#e4e6eb] rounded-bl-sm"
  }`;

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
      image.className = "max-w-full rounded-lg mt-1";
      image.alt = a.file_name || "";
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

  if (mine && !isPending) {
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
  seen.textContent = isPending ? "⏳ Đang gửi..." : (mine ? "⏳" : "");
  wrap.appendChild(bubble);
  if (mine) wrap.appendChild(seen);
  messagesEl.appendChild(wrap);
  if (scroll) messagesEl.scrollTop = messagesEl.scrollHeight;
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
    
    // Optimistic UI: hiển thị tin nhắn ngay với temp ID
    const tempId = `temp_${++tempIdCounter}`;
    const timeoutId = setTimeout(() => {
      if (pendingMessages.has(tempId)) {
        const pendingEl = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (pendingEl) {
          const seenEl = pendingEl.querySelector('.msg-seen');
          if (seenEl) {
            seenEl.textContent = "❌ Gửi thất bại";
            seenEl.classList.add('text-red-500');
          }
          pendingEl.classList.remove('opacity-70');
          pendingEl.classList.add('opacity-50');
        }
        pendingMessages.delete(tempId);
      }
    }, 10000);
    
    pendingMessages.set(tempId, { content: text, timeoutId });
    
    appendMessage(
      {
        id: tempId,
        content: text,
        sender_id: myUserId || myProfileId,
      },
      true,
      true  // isPending
    );
    
    chatWs.send(JSON.stringify({ message: text, message_type: "text" }));
    if (chatInput) chatInput.value = "";
    if (pendingConv && activeConvMeta && canSendWhilePending()) {
      fetchFirstMessage(activeConvId).then((m) => {
        firstMessageInConv = m;
        applyPendingUI(activeConvMeta);
      });
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
      
      // Optimistic UI: hiển thị tin nhắn file ngay với temp ID
      const tempId = `temp_file_${++tempIdCounter}`;
      const fileName = files[0].name;
      const timeoutId = setTimeout(() => {
        if (pendingMessages.has(tempId)) {
          const pendingEl = document.querySelector(`[data-temp-id="${tempId}"]`);
          if (pendingEl) {
            const seenEl = pendingEl.querySelector('.msg-seen');
            if (seenEl) {
              seenEl.textContent = "❌ Gửi thất bại";
              seenEl.classList.add('text-red-500');
            }
            pendingEl.classList.remove('opacity-70');
            pendingEl.classList.add('opacity-50');
          }
          pendingMessages.delete(tempId);
        }
      }, 15000);
      
      pendingMessages.set(tempId, { attachmentIds: ids, fileName, timeoutId });
      
      appendMessage(
        {
          id: tempId,
          content: `📎 ${fileName}`,
          sender_id: myUserId || myProfileId,
        },
        true,
        true  // isPending
      );
      
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
