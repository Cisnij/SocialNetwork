import { authFetch } from "../authenticate/auth.js";
import { API, POST_ENDPOINTS, buildListUrl } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { formatDate, showEmpty, showSpinner, fullName } from "../shared/ui.js";
import { DEFAULT_AVATAR } from "../shared/config.js";
import { fetchPage } from "../shared/paginated-list.js";
import { renderPostCard } from "../shared/posts/render.js";
import { getCurrentUserId } from "../app/profile.js";
import { openCommentsModal, initCommentsPanel } from "../shared/comments-panel.js";

const list = document.getElementById("notificationsList");
const markAll = document.getElementById("markAllReadBtn");

// Khởi tạo panel bình luận để nút close hoạt động
initCommentsPanel();

let nextUrl = buildListUrl(API.notifications(), 20);
let loading = false;
let notifWs = null;
let notifWsReconnectTimer = null;

function notificationTarget(n) {
  const type = String(n.type || "").toLowerCase();

  // ── 1. Bạn bè / Follow ──────────────────────────────────────────────
  // Bấm vào → trang cá nhân của người gửi thông báo
  if (
    type === "follow" ||
    type === "friend_request" ||
    type === "accepted_friend_request"
  ) {
    return n.actor_id ? `/profile/${n.actor_id}/` : null;
  }

  // ── 2. Group admin / quản trị ────────────────────────────────────────
  if (
    type === "group_request_accepted" ||
    type === "group_admin_added" ||
    type === "group_owner_transfer"
  ) {
    const gId = n.group_id;
    return gId ? `/group/${gId}/` : null;
  }

  // ── 3. Bài viết trong Group được duyệt / từ chối ─────────────────────
  if (type === "group_post_accepted" || type === "group_post_declined") {
    const gId = n.group_id;
    if (n.post_id && gId) return `/group/${gId}/post/${n.post_id}/`;
    if (gId) return `/group/${gId}/`;
    return null;
  }

  // ── 4. Admin phát thông báo qua post trong group (group_notification) ─
  if (type === "group_notification") {
    const gId = n.group_id;
    if (n.post_id && gId) return `/group/${gId}/post/${n.post_id}/`;
    if (gId) return `/group/${gId}/`;
    return null;
  }

  // ── 5. Sự kiện trong Group ──────────────────────────────────────────
  if (type === "group_event_create") {
    const gId = n.group_id;
    if (n.event_id && gId) return `/group/${gId}/event/${n.event_id}/`;
    if (gId) return `/group/${gId}/`;
    return null;
  }

  // ── 6. Vote trong Group ─────────────────────────────────────────────
  if (type === "group_vote_create") {
    const gId = n.group_id;
    if (n.vote_id && gId) return `/group/${gId}/vote/${n.vote_id}/`;
    if (gId) return `/group/${gId}/`;
    return null;
  }

  // ── 7. Nhắc nhở event (event_reminder) ─────────────────────────────
  // group_id có → event thuộc Group; conv_id có → event thuộc Chat
  if (type === "event_reminder") {
    if (n.group_id && n.event_id) return `/group/${n.group_id}/event/${n.event_id}/`;
    if (n.conv_id && n.event_id) return `/chat/${n.conv_id}/?event=${n.event_id}`;
    if (n.group_id) return `/group/${n.group_id}/`;
    return null;
  }

  // ── 8. Share bài viết (share_post) ─────────────────────────────────
  // object_id = share_id → trang chi tiết share
  if (type === "share_post") {
    if (n.post_id && n.group_id) return `/group/${n.group_id}/post/${n.post_id}/`;
    if (n.post_id) return `/post/${n.post_id}/`;
    return null;
  }

  // ── 9. Comment / Reply / Tag / Reaction ─────────────────────────────
  // post_id luôn có, group_id phân biệt group post vs normal post
  if (n.post_id) {
    if (n.group_id) return `/group/${n.group_id}/post/${n.post_id}/`;
    return `/post/${n.post_id}/`;
  }

  // ── 10. Fallback ─────────────────────────────────────────────────────
  if (n.link) return n.link;
  return null;
}

/**
 * Gọi các API liên quan tới loại notification trước khi điều hướng.
 * Mục đích: prefetch dữ liệu để server/cache cập nhật kịp thời.
 */
async function fetchNotifRelatedData(n) {
  const type = String(n.type || "").toLowerCase();
  const calls = [];

  switch (type) {
    // ── comment vào post bình thường / group ────────────────────────────
    case "comment_on_post":
      if (n.object_id) calls.push(authFetch(API.commentDetail(n.object_id)));
      if (n.group_id && n.post_id) {
        calls.push(authFetch(API.groupPostDetail(n.group_id, n.post_id)));
      } else if (n.post_id) {
        calls.push(authFetch(POST_ENDPOINTS.post(n.post_id)));
      }
      break;

    // ── reply vào comment ────────────────────────────────────────────────
    case "reply_on_comment":
      if (n.object_id) {
        calls.push(authFetch(API.comment(n.object_id)));
        calls.push(authFetch(API.nestedComments(n.object_id)));
      }
      if (n.post_id) calls.push(authFetch(POST_ENDPOINTS.post(n.post_id)));
      break;

    // ── được nhắc đến trong reply ────────────────────────────────────────
    case "tagged_in_reply":
      if (n.object_id) calls.push(authFetch(API.commentDetail(n.object_id)));
      if (n.post_id) calls.push(authFetch(POST_ENDPOINTS.post(n.post_id)));
      break;

    // ── reaction vào post ────────────────────────────────────────────────
    case "reaction_on_post":
      if (n.post_id) calls.push(authFetch(POST_ENDPOINTS.post(n.post_id)));
      if (n.group_id) {
        calls.push(authFetch(API.groupDetail(n.group_id)));
        if (n.post_id) calls.push(authFetch(API.groupPostDetail(n.group_id, n.post_id)));
      }
      break;

    // ── reaction vào comment ─────────────────────────────────────────────
    case "reaction_on_comment":
      if (n.object_id) calls.push(authFetch(API.commentDetail(n.object_id)));
      if (n.post_id) calls.push(authFetch(POST_ENDPOINTS.post(n.post_id)));
      break;

    // ── bạn bè / follow ──────────────────────────────────────────────────
    case "friend_request":
    case "follow":
    case "accepted_friend_request":
      if (n.actor_id) calls.push(authFetch(API.profileUserpage(n.actor_id)));
      break;

    // ── share post ───────────────────────────────────────────────────────
    case "share_post":
      if (n.post_id) calls.push(authFetch(POST_ENDPOINTS.post(n.post_id)));
      break;

    // ── event reminder ───────────────────────────────────────────────────
    case "event_reminder":
      if (n.group_id) calls.push(authFetch(API.groupDetail(n.group_id)));
      // conv_id → chat page, không cần gọi thêm API group
      break;

    // ── group – post được duyệt (có bài viết cụ thể) ─────────────────────
    case "group_post_accepted":
    case "group_notification":
      if (n.group_id) {
        calls.push(authFetch(API.groupDetail(n.group_id)));
        if (n.post_id) calls.push(authFetch(API.groupPostDetail(n.group_id, n.post_id)));
      }
      break;

    // ── group – các trường hợp chỉ cần detail group ──────────────────────
    case "group_request_accepted":
    case "group_post_declined":
    case "group_owner_transfer":
    case "group_admin_added":
    case "group_vote_create":
    case "group_event_create":
      if (n.group_id) calls.push(authFetch(API.groupDetail(n.group_id)));
      break;

    default:
      break;
  }

  if (calls.length) {
    await Promise.allSettled(calls);
  }
}

// --- HÀM TẠO VÀ HIỂN THỊ MODAL NOTIFICATION ---
function showNotificationModal(title, contentEl) {
  let modal = document.getElementById("notifViewerModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "notifViewerModal";
    modal.className = "fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4";
    modal.innerHTML = `
      <div class="bg-white dark:bg-[#242526] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 id="notifViewerTitle" class="text-xl font-bold text-gray-900 dark:text-white"></h3>
          <button id="notifViewerClose" class="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-600 transition" aria-label="Đóng">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div id="notifViewerBody" class="p-4 overflow-y-auto custom-scrollbar flex-1"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  // Gắn lại sự kiện close mỗi lần mở để chắc chắn không bị lỗi click
  const closeBtn = document.getElementById("notifViewerClose");
  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.add("hidden");
  }
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add("hidden"); };
  
  document.getElementById("notifViewerTitle").textContent = title;
  const body = document.getElementById("notifViewerBody");
  body.replaceChildren();
  if (contentEl) {
    body.appendChild(contentEl);
  }
  modal.classList.remove("hidden");
}

async function renderNotificationData(n, payload) {
  const { type, commentData, postData, groupData, actorData, accessDenied } = payload;
  const currentUserId = await getCurrentUserId().catch(() => null);

  // Trường hợp bị chặn do không phải member group
  if (accessDenied && n.group_id) {
    const div = document.createElement("div");
    div.className = "text-center py-8 px-4";
    div.innerHTML = `
      ${
        groupData
          ? `<img src="${groupData.avatar || DEFAULT_AVATAR}" class="w-20 h-20 mx-auto object-cover rounded-full mb-4 shadow-md">
             <h4 class="text-lg font-bold text-gray-900 dark:text-white mb-1">${groupData.name || 'Nhóm riêng tư'}</h4>
             <p class="text-gray-500 dark:text-gray-400 text-sm mb-1">${groupData.description || ''}</p>`
          : `<div class="w-20 h-20 mx-auto rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center mb-4">
               <svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
             </div>`
      }
      <p class="text-amber-600 dark:text-amber-400 font-semibold mb-1">🔒 Nội dung trong nhóm riêng tư</p>
      <p class="text-gray-500 dark:text-gray-400 text-sm mb-4">Vui lòng gia nhập nhóm để xem nội dung này.</p>
      <a href="/group/${n.group_id}/" class="inline-block px-6 py-2 bg-fb-primary text-white rounded-lg hover:bg-blue-600 transition font-semibold">Xem nhóm &amp; Gia nhập</a>
    `;
    showNotificationModal("Nội dung bị giới hạn", div);
    return;
  }
  if (postData) {
    // Nếu là group post thì ẩn share/copy/privacy
    const isGroupPost = !!(postData.group && Number(postData.group) > 0);
    const postEl = renderPostCard(postData, {
      currentUserId,
      disableInteractions: false,
      showShare: !isGroupPost,
      showCopyLink: !isGroupPost,
      showPrivacy: !isGroupPost,
    });
    
    showNotificationModal("Chi tiết thông báo", postEl);

    // Tự động mở Comments Panel và cuộn tới/highlight comment (Giống Facebook)
    if (commentData) {
      setTimeout(() => {
        openCommentsModal(postData.post_id, postData.user?.id, commentData);
      }, 400); // Đợi modal kia hiện ra 1 chút
    }

  } else if (actorData) {
    // Thông báo liên quan tới User (friend request, follow)
    const div = document.createElement("div");
    div.className = "text-center py-8";
    div.innerHTML = `
      <img src="${actorData.picture || DEFAULT_AVATAR}" class="w-24 h-24 rounded-full mx-auto mb-4 object-cover">
      <h4 class="text-xl font-bold text-gray-900 dark:text-white">${actorData.first_name || ""} ${actorData.last_name || ""}</h4>
      <p class="text-gray-500 mb-4">Trang cá nhân của người dùng này</p>
      <a href="/profile/${actorData.id}/" class="px-6 py-2 bg-fb-primary text-white rounded-lg hover:bg-blue-600">Xem trang cá nhân</a>
    `;
    showNotificationModal("Người dùng", div);

  } else if (groupData) {
    // Thông báo liên quan tới Group (không có post)
    const div = document.createElement("div");
    div.className = "text-center py-8";
    div.innerHTML = `
      <img src="${groupData.avatar || DEFAULT_AVATAR}" class="w-24 h-24 mx-auto object-cover rounded-full mb-4 shadow-md">
      <h4 class="text-xl font-bold text-gray-900 dark:text-white">${groupData.name || "Nhóm"}</h4>
      <p class="text-gray-500 mb-4">${groupData.description || ""}</p>
      <a href="/group/${groupData.id}/" class="px-6 py-2 bg-fb-primary text-white rounded-lg hover:bg-blue-600">Truy cập nhóm</a>
    `;
    showNotificationModal("Nhóm", div);

  } else {
    // Fallback redirect
    const href = notificationTarget(n);
    if (href) window.location.href = href;
  }
}

async function loadDataForNotification(n) {
  const type = String(n.type || "").toLowerCase();
  let commentData = null;
  let postData = null;
  let groupData = null;
  let actorData = null;
  let accessDenied = false; // true khi bị chặn do không phải member group

  // Helper: khi bị 403 do group, load group detail để hiện UI "Vui lòng gia nhập nhóm"
  async function handleGroupAccessDenied() {
    accessDenied = true;
    if (n.group_id) {
      const rg = await authFetch(API.groupDetail(n.group_id));
      if (rg.ok) groupData = await rg.json();
    }
  }

  try {
    switch (type) {
      case "comment_on_post":
        if (n.group_id && n.post_id) {
          const res2 = await authFetch(API.groupPostDetail(n.group_id, n.post_id));
          if (res2.ok) {
            postData = await res2.json();
            if (n.object_id) {
              const res1 = await authFetch(API.commentDetail(n.object_id));
              if (res1.ok) commentData = await res1.json();
            }
          } else if (res2.status === 403) {
            await handleGroupAccessDenied();
          }
        } else {
          if (n.object_id) {
            const res1 = await authFetch(API.commentDetail(n.object_id));
            if (res1.ok) commentData = await res1.json();
          }
          if (n.post_id) {
            const res2 = await authFetch(POST_ENDPOINTS.post(n.post_id));
            if (res2.ok) postData = await res2.json();
          }
        }
        console.log("[Notification Data] comment_on_post:", { commentData, postData, accessDenied });
        break;

      case "reply_on_comment":
        // object_id là ID reply con, không dùng API.comment được → chỉ load post
        if (n.group_id && n.post_id) {
          const res2 = await authFetch(API.groupPostDetail(n.group_id, n.post_id));
          if (res2.ok) postData = await res2.json();
          else if (res2.status === 403) await handleGroupAccessDenied();
        } else if (n.post_id) {
          const res2 = await authFetch(POST_ENDPOINTS.post(n.post_id));
          if (res2.ok) postData = await res2.json();
        }
        console.log("[Notification Data] reply_on_comment:", { postData, accessDenied });
        break;

      case "tagged_in_reply":
        if (n.group_id && n.post_id) {
          const res2 = await authFetch(API.groupPostDetail(n.group_id, n.post_id));
          if (res2.ok) {
            postData = await res2.json();
            if (n.object_id) {
              const res1 = await authFetch(API.commentDetail(n.object_id));
              if (res1.ok) commentData = await res1.json();
            }
          } else if (res2.status === 403) {
            await handleGroupAccessDenied();
          }
        } else {
          if (n.object_id) {
            const res1 = await authFetch(API.commentDetail(n.object_id));
            if (res1.ok) commentData = await res1.json();
          }
          if (n.post_id) {
            const res2 = await authFetch(POST_ENDPOINTS.post(n.post_id));
            if (res2.ok) postData = await res2.json();
          }
        }
        console.log("[Notification Data] tagged_in_reply:", { commentData, postData, accessDenied });
        break;

      case "reaction_on_post":
        if (n.group_id && n.post_id) {
          const res1 = await authFetch(API.groupDetail(n.group_id));
          if (res1.ok) groupData = await res1.json();
          else if (res1.status === 403) await handleGroupAccessDenied();

          const res2 = await authFetch(API.groupPostDetail(n.group_id, n.post_id));
          if (res2.ok) postData = await res2.json();
          else if (res2.status === 403) await handleGroupAccessDenied();
        } else if (n.post_id) {
          const res2 = await authFetch(POST_ENDPOINTS.post(n.post_id));
          if (res2.ok) postData = await res2.json();
        }
        console.log("[Notification Data] reaction_on_post:", { postData, groupData, accessDenied });
        break;

      case "reaction_on_comment":
        if (n.group_id && n.post_id) {
          // Group post: load bài viết group trước
          const res2 = await authFetch(API.groupPostDetail(n.group_id, n.post_id));
          if (res2.ok) {
            postData = await res2.json();
            // Chỉ load comment nếu lấy post thành công
            if (n.object_id) {
              const res1 = await authFetch(API.commentDetail(n.object_id));
              if (res1.ok) commentData = await res1.json();
            }
          } else if (res2.status === 403) {
            await handleGroupAccessDenied();
          }
        } else {
          // Post thường: load comment trước, post sau
          if (n.object_id) {
            const res1 = await authFetch(API.commentDetail(n.object_id));
            if (res1.ok) commentData = await res1.json();
          }
          if (n.post_id) {
            const res2 = await authFetch(POST_ENDPOINTS.post(n.post_id));
            if (res2.ok) postData = await res2.json();
          }
        }
        console.log("[Notification Data] reaction_on_comment:", { commentData, postData, accessDenied });
        break;

      case "friend_request":
      case "follow":
      case "accepted_friend_request":
        if (n.actor_id) {
          const res = await authFetch(API.profileUserpage(n.actor_id));
          if (res.ok) actorData = await res.json();
        }
        console.log(`[Notification Data] ${type}:`, { actorData });
        break;

      case "share_post":
        if (n.post_id) {
          const res = await authFetch(POST_ENDPOINTS.post(n.post_id));
          if (res.ok) postData = await res.json();
        }
        console.log("[Notification Data] share_post:", { postData });
        break;

      case "event_reminder":
        if (n.group_id) {
          const res = await authFetch(API.groupDetail(n.group_id));
          if (res.ok) groupData = await res.json();
        }
        // Trang chat không cần gọi thêm
        console.log("[Notification Data] event_reminder:", { groupData });
        break;

      case "group_post_accepted":
      case "group_notification": {
        const gId = n.group_id;
        if (gId) {
          const res1 = await authFetch(API.groupDetail(gId));
          if (res1.ok) groupData = await res1.json();
          else if (res1.status === 403) await handleGroupAccessDenied();

          if (n.post_id) {
            const res2 = await authFetch(API.groupPostDetail(gId, n.post_id));
            if (res2.ok) postData = await res2.json();
            else if (res2.status === 403) await handleGroupAccessDenied();
          }
        }
        console.log(`[Notification Data] ${type}:`, { groupData, postData, accessDenied });
        break;
      }

      case "group_request_accepted":
      case "group_post_declined":
      case "group_owner_transfer":
      case "group_admin_added":
      case "group_vote_create":
      case "group_event_create": {
        const gId = n.group_id;
        if (gId) {
          const res = await authFetch(API.groupDetail(gId));
          if (res.ok) groupData = await res.json();
          else if (res.status === 403) await handleGroupAccessDenied();
        }
        console.log(`[Notification Data] ${type}:`, { groupData, accessDenied });
        break;
      }

      default:
        break;
    }

    // LƯU DỮ LIỆU VÀO SESSION STORAGE (phòng hờ)
    const payload = { type, commentData, postData, groupData, actorData, accessDenied };
    sessionStorage.setItem("notifData", JSON.stringify(payload));
    console.log("[Notification Data Loaded]:", payload);

    return payload;

  } catch (err) {
    console.error(`[notif] Error loading data for ${type}:`, err);
    return null;
  }
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
  card.className = `w-full text-left p-4 rounded-xl shadow-sm flex gap-3 transition hover:bg-fb-secondary dark:hover:bg-fb-hover ${n.is_read
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
  let restMessage = (n.message || n.type || "");
  // Remove actorName from the start of restMessage if it's there to avoid duplication
  if (restMessage.startsWith(actorName)) {
    restMessage = restMessage.slice(actorName.length).trim();
  }
  msg.innerHTML = `<strong class="text-fb-primary">${actorName}</strong> ${restMessage}`;
  const time = document.createElement("p");
  time.className = "text-xs text-gray-400 dark:text-fb-muted mt-1";
  time.textContent = formatDate(n.created_at);
  body.append(msg, time);
  card.append(img, body);

  card.onclick = async () => {
    // 1. Mark read (không chờ)
    authFetch(API.notificationsMarkRead(), { method: "POST" }).catch(() => {});
    card.classList.remove(
      "bg-blue-50", "dark:bg-[#263951]", "border",
      "border-blue-100", "dark:border-blue-900/40"
    );
    card.classList.add("bg-white", "dark:bg-[#242526]");

    // Hiệu ứng loading nhẹ trên card
    const originalContent = card.innerHTML;
    card.style.opacity = "0.7";

    // 2. Tải data chi tiết theo yêu cầu CỦA BẠN (load ra và lấy json)
    const payload = await loadDataForNotification(n);

    card.style.opacity = "1";

    // 3. Render Modal hiển thị data vừa tải (Không redirect để ko mất data, GIỐNG FACEBOOK)
    if (payload && (payload.postData || payload.actorData || payload.groupData)) {
      await renderNotificationData(n, payload);
    } else {
      // Fallback
      const href = notificationTarget(n);
      if (href) {
        window.location.href = href;
      } else {
        console.warn("[notif] Không có URL fallback và không có Data. Dữ liệu Notification:", n);
        // showToast("Không tìm thấy dữ liệu liên quan hoặc đã bị xóa", "yellow");
      }
    }
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
      //                  post_id, actor_id, actor_name, actor_avatar, created_at, is_read }
      // Khi nhận được unread_count, cập nhật badge (cả từ signal gửi count lẫn noti mới)
      if (typeof data.unread_count === "number") {
        const badge = document.getElementById("notifBadge");
        if (badge) {
          if (data.unread_count > 0) {
            badge.textContent = data.unread_count > 99 ? "99+" : String(data.unread_count);
            badge.classList.remove("hidden");
          } else {
            badge.classList.add("hidden");
          }
        }
      }

      // Khi có message + id → notification mới từ signal → prepend lên trang
      if (data.message && data.id) {
        prependNotification({
          id: data.id,
          actor: data.actor_name,
          actor_id: data.actor_id,
          actor_avatar: data.actor_avatar,
          message: data.message,
          type: data.type,
          post_id: data.post_id,
          group_id: data.group_id,
          event_id: data.event_id,
          vote_id: data.vote_id,
          conv_id: data.conv_id,
          object_id: data.object_id,
          created_at: data.created_at || new Date().toISOString(),
          is_read: data.is_read || false,
        });
        return;
      }

      // Payload từ tasks.py (event_reminder / group_notification) không có 'id'
      // → chỉ hiện toast/badge, không prepend vì không có DB id để xóa/đánh dấu
      if (data.type === "event_reminder" && data.message) {
        // Cập nhật badge +1
        const badge = document.getElementById("notifBadge");
        if (badge) {
          const cur = parseInt(badge.textContent, 10) || 0;
          badge.textContent = cur + 1 > 99 ? "99+" : String(cur + 1);
          badge.classList.remove("hidden");
        }
        // Prepend card không có nút xóa (không có id)
        prependNotification({
          id: null,
          actor: data.actor_name || "",
          actor_id: null,
          actor_avatar: null,
          message: data.message,
          type: data.type,
          group_id: data.group_id || null,
          event_id: data.event_id || null,
          conv_id: data.conv_id || null,
          created_at: new Date().toISOString(),
          is_read: false,
        });
        return;
      }

      if (data.type === "group_notification" && data.message) {
        const badge = document.getElementById("notifBadge");
        if (badge) {
          const cur = parseInt(badge.textContent, 10) || 0;
          badge.textContent = cur + 1 > 99 ? "99+" : String(cur + 1);
          badge.classList.remove("hidden");
        }
        prependNotification({
          id: null,
          actor: data.actor_name || "",
          actor_id: null,
          actor_avatar: null,
          message: data.message,
          type: data.type,
          group_id: data.group_id || null,
          post_id: data.post_id || null,
          created_at: new Date().toISOString(),
          is_read: false,
        });
      }
    } catch (_) { }
  };

  notifWs.onclose = () => {
    if (!notifWsReconnectTimer) {
      notifWsReconnectTimer = setTimeout(() => {
        notifWsReconnectTimer = null;
        connectNotifPageWs();
      }, 3000);
    }
  };

  notifWs.onerror = () => { };
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
