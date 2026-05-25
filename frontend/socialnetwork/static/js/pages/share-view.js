import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";
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

const container = document.getElementById("sharePostContainer");
const code = window.SHARE_CODE;

initPostModals();
initCommentsPanel();
initShareModal();

async function load() {
  if (!code || !container) return;
  try {
    const res = await authFetch(API.shareDetail(code));
    if (!res.ok) {
      container.innerHTML =
        '<p class="text-center py-12 text-gray-500">Không thể xem bài viết này.</p>';
      return;
    }
    const post = await res.json();
    const currentUserId = await getCurrentUserId().catch(() => null);
    container.replaceChildren(
      renderPostCard(post, {
        currentUserId,
        onDelete: (id) => requestDeletePost(id),
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
