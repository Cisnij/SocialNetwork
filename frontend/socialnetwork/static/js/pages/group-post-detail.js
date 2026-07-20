import { authFetch } from "../authenticate/auth.js";
import { API, POST_ENDPOINTS, profileUrl } from "../shared/config.js";
import { getCurrentUserId } from "../app/profile.js";
import {
  initPostModals,
  openReactionsModal,
} from "../shared/posts/modals.js";
import { initCommentsPanel } from "../shared/comments-panel.js";
import { initShareModal } from "../shared/share-modal.js";

const postId = window.POST_ID;
const groupId = window.GROUP_ID;
const container = document.getElementById("postDetailContainer");

initPostModals();
initCommentsPanel();
initShareModal();

async function load() {
  if (!postId || !groupId || !container) return;

  try {
    const [postRes, currentUser] = await Promise.all([
      authFetch(API.groupPostDetail(groupId, postId)),
      getCurrentUserId().catch(() => null),
    ]);

    if (!postRes.ok) {
      container.innerHTML = '<p class="text-center py-12 text-gray-500">Không thể xem bài viết.</p>';
      return;
    }

    const post = await postRes.json();
    const user = post.user || {};
    const avatar = user.picture || "";
    const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Unknown";
    const time = new Date(post.created_at).toLocaleString("vi-VN");
    const photos = post.photos || [];

    const photosHtml = photos.length
      ? `<div class="mt-3 rounded-xl overflow-hidden ${photos.length === 1 ? "max-h-96" : "grid grid-cols-2 gap-1"}">${photos
          .slice(0, 4)
          .map(
            (ph) =>
              `<img src="${ph.photo}" class="w-full object-cover ${photos.length > 1 ? "h-48" : "max-h-96"} cursor-pointer hover:opacity-95 transition" loading="lazy">`
          )
          .join("")}</div>`
      : "";

    let isAdmin = false;
    try {
      const groupRes = await authFetch(API.groupDetail(groupId));
      if (groupRes.ok) {
        const groupData = await groupRes.json();
        isAdmin = groupData.role === "owner" || groupData.role === "admin";
      }
    } catch {
      isAdmin = false;
    }

    const isOwner = currentUser != null && (Number(user.user) === Number(currentUser) || Number(user.id) === Number(currentUser));
    const canDelete = isOwner || isAdmin;

    const menuHtml = canDelete
      ? `<div class="relative inline-block">
          <button id="groupPostMenuBtn" type="button" class="text-gray-500 hover:text-gray-800 text-2xl font-bold px-2 rounded-full">⋯</button>
          <div id="groupPostMenu" class="absolute right-0 mt-2 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-lg hidden z-50 border border-gray-200 dark:border-gray-700">
            ${isOwner ? `<button id="btnEditGroupPost" class="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700">Chỉnh sửa</button>` : ""}
            ${canDelete ? `<button id="btnDeleteGroupPost" class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30">Xóa bài viết</button>` : ""}
            ${isAdmin ? `<button id="btnHighlightGroupPost" class="block w-full text-left px-4 py-2 text-sm text-purple-600 hover:bg-purple-50">Thông báo nổi bật</button>` : ""}
          </div>
        </div>`
      : "";

    container.replaceChildren();
    container.classList.remove("flex", "items-center", "justify-center");

    container.innerHTML = `
      <div class="glass-card rounded-2xl shadow-sm border border-white/40 dark:border-white/5 overflow-hidden post-card">
        <div class="p-4">
          <div class="flex items-center gap-3 mb-3">
            <a href="${profileUrl(user.id || user.user)}" class="shrink-0">
              <img src="${avatar}" class="w-11 h-11 rounded-full object-cover shadow-sm border border-gray-100 dark:border-gray-700">
            </a>
            <div class="min-w-0 flex-1">
              <h5 class="font-bold text-gray-900 dark:text-white flex items-center flex-wrap">
                <a href="${profileUrl(user.id || user.user)}" class="hover:underline">${name}</a>
              </h5>
              <p class="text-xs text-gray-500">${time}</p>
            </div>
            ${menuHtml}
          </div>
          <p class="text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed mb-3">${post.title || ""}</p>
          ${photosHtml}
        </div>
        <div class="border-t border-gray-200 dark:border-[#3e4042] pt-3 px-4 pb-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1">
              <span id="reactionSummary" class="text-sm text-gray-600 dark:text-fb-muted"></span>
            </div>
          </div>
          <div class="flex justify-between mt-2">
            <button id="btnReact" type="button" class="flex items-center gap-2 hover:text-fb-primary px-2 py-1 rounded-md transition text-sm">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m0 0h6m-6 0H3"/></svg>
              Thích
            </button>
            <button id="btnComment" type="button" class="flex items-center gap-2 hover:text-fb-primary px-2 py-1 rounded-md transition text-sm">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
              Bình luận
            </button>
            <button id="btnShare" type="button" class="flex items-center gap-2 hover:text-fb-primary px-2 py-1 rounded-md transition text-sm">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
              Chia sẻ
            </button>
          </div>
        </div>
      </div>
    `;

    const card = container.querySelector(".post-card");
    card.style.transition = "background 0.4s";
    card.style.background = "rgba(24,119,242,0.08)";
    setTimeout(() => {
      card.style.background = "";
    }, 1200);

    document.getElementById("btnReact")?.addEventListener("click", async () => {
      try {
        const res = await authFetch(POST_ENDPOINTS.react(postId), { method: "POST" });
        if (res.ok) {
          showToast("Đã thích bài viết", "green");
          loadReactions();
        }
      } catch {
        showToast("Lỗi", "red");
      }
    });

    document.getElementById("btnComment")?.addEventListener("click", () => {
      openCommentsModal(post.post_id, user.id || user.user);
    });

    document.getElementById("btnShare")?.addEventListener("click", () => {
      openShareModal(post.post_id);
    });

    document.getElementById("btnEditGroupPost")?.addEventListener("click", () => {
      const newContent = prompt("Chỉnh sửa bài viết:", post.title || "");
      if (newContent === null) return;
      if (!newContent.trim()) {
        showToast("Nội dung không được để trống", "red");
        return;
      }
      authFetch(API.groupUpdatePost(groupId, postId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newContent.trim() }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("update failed");
          showToast("Đã cập nhật bài viết", "green");
          load();
        })
        .catch(() => showToast("Không thể cập nhật", "red"));
    });

    document.getElementById("btnDeleteGroupPost")?.addEventListener("click", async () => {
      if (!confirm("Bạn có chắc muốn xóa bài viết này?")) return;
      try {
        const res = await authFetch(API.groupDeletePost(groupId, postId), {
          method: "DELETE",
        });
        if (!res.ok) throw new Error("delete failed");
        showToast("Đã xóa bài viết", "green");
        setTimeout(() => {
          window.location.href = `/group/${groupId}/`;
        }, 500);
      } catch {
        showToast("Không thể xóa bài viết", "red");
      }
    });

    document.getElementById("btnHighlightGroupPost")?.addEventListener("click", async () => {
      try {
        const res = await authFetch(API.groupHighlightPost(groupId, postId), {
          method: "POST",
        });
        if (res.ok) showToast("Đã gửi thông báo nổi bật", "green");
        else showToast("Thất bại", "red");
      } catch {
        showToast("Lỗi kết nối", "red");
      }
    });

    document.getElementById("groupPostMenuBtn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("groupPostMenu")?.classList.toggle("hidden");
    });

    document.addEventListener("click", () => {
      document.getElementById("groupPostMenu")?.classList.add("hidden");
    });

    loadReactions();
  } catch {
    container.innerHTML = '<p class="text-center py-12 text-red-500">Lỗi tải bài viết.</p>';
  }
}

async function loadReactions() {
  const summary = document.getElementById("reactionSummary");
  if (!summary) return;
  try {
    const res = await authFetch(POST_ENDPOINTS.reactions(postId));
    if (!res.ok) return;
    const data = await res.json();
    const reactions = data.reactions || [];
    const total = reactions.reduce((sum, r) => sum + (r.total || 0), 0);
    if (total > 0) {
      summary.textContent = `${total} lượt thích`;
      summary.style.cursor = "pointer";
      summary.addEventListener("click", () => openReactionsModal(postId, "post", reactions));
    }
  } catch {
    // ignore
  }
}

function showToast(msg, type = "green") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg z-[80] max-w-sm toast toast-${type}`;
  toast.classList.remove("hidden");
  void toast.offsetWidth;
  toast.classList.add("animate-slide-up");
  setTimeout(() => toast.classList.add("hidden"), 3000);
}

load();

