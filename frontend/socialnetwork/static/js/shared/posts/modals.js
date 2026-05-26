import { API, buildListUrl, POST_ENDPOINTS } from "../config.js";
import { fetchReactionsPage } from "./api.js";
import { deletePostById } from "./api.js";
import { REACTIONS } from "./reactions.js";
import { showToast } from "../toast.js";
import { postListCache } from "./cache.js";

let photosList = [];
let currentPhotoIndex = 0;

let nextReactionsUrl = null;
let currentReactionId = null;
let currentReactionKind = "post";
let loadingReactions = false;
let reactionsAbort = null;

let postToDeleteId = null;
let deleteCallbacks = { onDeleted: null, cacheKey: null };

let modalsInitialized = false;

export function initPostModals(options = {}) {
  if (modalsInitialized) return;
  modalsInitialized = true;

  deleteCallbacks.onDeleted = options.onPostDeleted;

  setupPhotoModal();
  setupReactionsModal();
  setupDeleteModal();
}

function setupPhotoModal() {
  const closeBtn = document.getElementById("closeModal");
  const nextBtn = document.getElementById("nextPhoto");
  const prevBtn = document.getElementById("prevPhoto");
  const modal = document.getElementById("photoModal");

  closeBtn?.addEventListener("click", () => modal?.classList.add("hidden"));

  nextBtn?.addEventListener("click", () => {
    if (!photosList.length) return;
    currentPhotoIndex = (currentPhotoIndex + 1) % photosList.length;
    document.getElementById("photoModalImg").src = photosList[currentPhotoIndex];
  });

  prevBtn?.addEventListener("click", () => {
    if (!photosList.length) return;
    currentPhotoIndex =
      (currentPhotoIndex - 1 + photosList.length) % photosList.length;
    document.getElementById("photoModalImg").src = photosList[currentPhotoIndex];
  });

  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") modal?.classList.add("hidden");
  });
}

export function openPhotoModal(photos, index = 0, caption = "") {
  photosList = photos;
  currentPhotoIndex = index;
  const modal = document.getElementById("photoModal");
  const img = document.getElementById("photoModalImg");
  const captionEl = document.getElementById("photoModalCaption");
  if (!modal || !img) return;
  img.src = photosList[currentPhotoIndex];
  if (captionEl) captionEl.textContent = caption;
  modal.classList.remove("hidden");
}

function setupReactionsModal() {
  const closeBtn = document.getElementById("closeReactionsModal");
  const modal = document.getElementById("reactionsModal");

  closeBtn?.addEventListener("click", () => modal?.classList.add("hidden"));
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  const scrollRoot =
    modal?.querySelector(".overflow-y-auto") || modal;
  scrollRoot?.addEventListener("scroll", () => {
    if (
      scrollRoot.scrollTop + scrollRoot.clientHeight >=
      scrollRoot.scrollHeight - 80
    ) {
      loadReactions(currentReactionId, currentReactionKind, false);
    }
  });
}

/** @param {'post'|'comment'} kind */
export function openReactionsModal(targetId, kind = "post") {
  const modal = document.getElementById("reactionsModal");
  if (!modal) return;
  loadReactions(targetId, kind, true);
  modal.classList.remove("hidden");
}

async function loadReactions(targetId, kind = "post", initial = true) {
  const list = document.getElementById("reactionsList");
  if (!list) return;

  if (initial) {
    reactionsAbort?.abort();
    reactionsAbort = new AbortController();
    nextReactionsUrl =
      kind === "comment"
        ? buildListUrl(API.commentReactions(targetId), 20)
        : POST_ENDPOINTS.reactions(targetId);
    list.replaceChildren();
    currentReactionId = targetId;
    currentReactionKind = kind;
  }

  if (!nextReactionsUrl || loadingReactions) return;

  loadingReactions = true;
  try {
    const data = await fetchReactionsPage(
      nextReactionsUrl,
      reactionsAbort?.signal
    );
    const fragment = document.createDocumentFragment();
    (data.results || []).forEach((r) => {
      const item = document.createElement("div");
      item.className =
        "flex items-center gap-3 py-2 px-1 hover:bg-gray-50 dark:hover:bg-[#3a3b3c] rounded";

      const img = document.createElement("img");
      img.src = r.user?.picture || "/static/default-avatar.png";
      img.className = "w-8 h-8 rounded-full object-cover";

      const name = document.createElement("span");
      name.className =
        "font-medium flex-1 truncate text-gray-900 dark:text-[#e4e6eb]";
      name.textContent = `${r.user?.first_name || ""} ${r.user?.last_name || ""}`.trim();

      const emoji = document.createElement("span");
      const found = REACTIONS.find((x) => x.type === r.slug);
      emoji.textContent = found ? found.icon : "👍";
      emoji.className = "text-xl";

      item.append(img, name, emoji);
      fragment.appendChild(item);
    });

    list.appendChild(fragment);

    nextReactionsUrl = data.next;
  } catch (err) {
    if (err.name !== "AbortError") console.error("Reactions load error:", err);
  } finally {
    loadingReactions = false;
  }
}

function setupDeleteModal() {
  const cancelBtn = document.getElementById("cancelDelete");
  const confirmBtn = document.getElementById("confirmDelete");
  const modal = document.getElementById("deleteModal");

  cancelBtn?.addEventListener("click", () => {
    postToDeleteId = null;
    modal?.classList.add("hidden");
  });

  confirmBtn?.addEventListener("click", async () => {
    if (!postToDeleteId) return;
    try {
      const res = await deletePostById(postToDeleteId);
      if (res.ok) {
        document
          .querySelector(`[data-post-id="${postToDeleteId}"]`)
          ?.remove();
        if (deleteCallbacks.cacheKey) {
          postListCache.removePost(
            deleteCallbacks.cacheKey,
            postToDeleteId
          );
        }
        deleteCallbacks.onDeleted?.(postToDeleteId);
        showToast("✅ Đã xóa bài viết");
      } else {
        showToast("⚠️ Không thể xóa bài viết", "red");
      }
    } catch (err) {
      console.error(err);
      showToast("⚠️ Lỗi khi xóa bài viết", "red");
    } finally {
      postToDeleteId = null;
      modal?.classList.add("hidden");
    }
  });
}

export function requestDeletePost(postId, cacheKey = null) {
  postToDeleteId = postId;
  deleteCallbacks.cacheKey = cacheKey;
  document.getElementById("deleteModal")?.classList.remove("hidden");
}
