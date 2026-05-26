import { authFetch } from "../authenticate/auth.js";
import { POST_ENDPOINTS } from "../shared/config.js";
import { renderPostCard } from "../shared/posts/render.js";
import { getCurrentUserId } from "../app/profile.js";
import {
  initPostModals,
  openPhotoModal,
  openReactionsModal,
  requestDeletePost,
} from "../shared/posts/modals.js";
import { initCommentsPanel } from "../shared/comments-panel.js";
import { initShareModal } from "../shared/share-modal.js";

const postId = window.POST_ID;
const container = document.getElementById("postDetailContainer");

initPostModals();
initCommentsPanel();
initShareModal();

async function load() {
  if (!postId || !container) return;
  try {
    const res = await authFetch(POST_ENDPOINTS.post(postId));
    if (!res.ok) {
      container.innerHTML =
        '<p class="text-center py-12 text-gray-500">Không thể xem bài viết.</p>';
      return;
    }
    const post = await res.json();
    const currentUserId = await getCurrentUserId().catch(() => null);
    container.replaceChildren();
    container.classList.remove("flex", "items-center", "justify-center");
    container.appendChild(
      renderPostCard(post, {
        currentUserId,
        onDelete: () => {
          requestDeletePost(postId);
          setTimeout(() => {
            window.location.href = "/";
          }, 500);
        },
        onOpenReactions: openReactionsModal,
        onOpenPhotos: openPhotoModal,
      })
    );
  } catch {
    container.innerHTML =
      '<p class="text-center py-12 text-red-500">Lỗi tải bài viết.</p>';
  }
}

load();
