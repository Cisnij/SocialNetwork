import { authFetch } from "../../authenticate/auth.js";
import { API, DEFAULT_AVATAR, profileUrl, shareLink } from "../config.js";
import { openSharersModal } from "./sharers-modal.js";
import { showToast } from "../toast.js";
import { formatRelativeTime, cls } from "../ui.js";
import { openEditModal } from "../post-edit.js";
import { openCommentsModal } from "../comments-panel.js";
import { openShareModal } from "../share-modal.js";
import {
  REACTIONS,
  createReactionBar,
  getTotalReactions,
  updateReactionButton,
  applyReactionResponse,
} from "./reactions.js";
import { reactToPost } from "./api.js";

/**
 * Unified post card renderer for feed and user page.
 * @param {object} post
 * @param {object} options
 * @param {number|null} options.currentUserId - Profile id of logged-in user
 * @param {(postId: number) => void} options.onDelete
 * @param {(postId: number) => void} options.onOpenReactions
 * @param {(urls: string[], index: number, caption: string) => void} options.onOpenPhotos
 */
export function renderPostCard(post, options = {}) {
  const {
    currentUserId = null,
    onDelete,
    onOpenReactions,
    onOpenPhotos,
  } = options;

  const article = document.createElement("article");
  article.className = `post-card p-4 ${cls.card}`;
  article.dataset.postId = post.post_id;

  // --- Header ---
  const header = document.createElement("div");
  header.className = "flex items-center justify-between mb-3";

  const left = document.createElement("div");
  left.className = "flex items-center gap-3";

  const userId = post.user?.id;
  const profileLink = document.createElement("a");
  profileLink.href = profileUrl(userId);
  profileLink.className = "flex items-center gap-3 hover:opacity-90 transition";

  const avatar = document.createElement("img");
  avatar.className = "w-10 h-10 rounded-full object-cover";
  avatar.src = post.user?.picture || DEFAULT_AVATAR;
  avatar.alt = "avatar";

  const info = document.createElement("div");
  const name = document.createElement("h2");
  name.className = `font-semibold text-sm sm:text-base ${cls.text}`;
  name.textContent =
    `${post?.user?.first_name || ""} ${post?.user?.last_name || ""}`.trim() ||
    "Người dùng";

  const time = document.createElement("p");
  time.className = `text-xs ${cls.textMuted}`;
  time.textContent = formatRelativeTime(post.created_at);
  time.title = new Date(post.created_at).toLocaleString("vi-VN");

  info.append(name, time);
  profileLink.append(avatar, info);
  left.appendChild(profileLink);

  const menuWrapper = document.createElement("div");
  menuWrapper.className = "relative";

  const isOwner =
    currentUserId != null && Number(post.user?.id) === Number(currentUserId);

  if (isOwner) {
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className =
      "text-gray-500 dark:text-[#b0b3b8] hover:text-gray-800 dark:hover:text-[#e4e6eb] text-2xl font-bold px-2 rounded-full";
    menuBtn.setAttribute("aria-label", "Tùy chọn bài viết");
    menuBtn.textContent = "⋯";

    const menuDropdown = document.createElement("div");
    menuDropdown.className =
      `absolute right-0 mt-2 w-44 ${cls.menu} rounded-lg shadow-lg hidden z-50`;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className =
      `block w-full text-left px-4 py-2 ${cls.text} ${cls.hoverRow}`;
    editBtn.textContent = "✏️ Chỉnh sửa";

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className =
      "block w-full text-left px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30";
    deleteBtn.textContent = "🗑️ Xóa bài viết";

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle("hidden");
    });

    const closeMenu = () => menuDropdown.classList.add("hidden");
    document.addEventListener("click", closeMenu, { once: false });

    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      openEditModal(post);
    });

    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      onDelete?.(post.post_id);
    });

    menuDropdown.append(editBtn, deleteBtn);
    menuWrapper.append(menuBtn, menuDropdown);
  }

  header.append(left, menuWrapper);

  // --- Title ---
  const title = document.createElement("p");
  title.className = `post-title mb-3 whitespace-pre-wrap ${cls.text}`;
  title.textContent = post.title || "";

  // --- Photos ---
  const photoSection = buildPhotoSection(post, onOpenPhotos);

  // --- Counts container (reaction + share) ---
  const countsContainer = document.createElement("div");
  countsContainer.className = "flex items-center justify-between mb-2 text-sm min-h-[20px]";

  // --- Reaction count ---
  const totalReactions = getTotalReactions(post.reactions);
  const reactionCount = document.createElement("button");
  reactionCount.type = "button";
  reactionCount.className =
    "text-gray-600 dark:text-fb-muted hover:underline font-medium";
  reactionCount.textContent =
    totalReactions > 0 ? `${totalReactions} lượt thích` : "";
  reactionCount.classList.toggle("hidden", totalReactions === 0);
  reactionCount.addEventListener("click", () =>
    onOpenReactions?.(post.post_id)
  );

  // --- Share count ---
  let shareCount = null;
  if ((post.share_count || 0) > 0) {
    shareCount = document.createElement("button");
    shareCount.type = "button";
    shareCount.className = "text-gray-500 dark:text-fb-muted hover:underline font-medium";
    shareCount.textContent = `${post.share_count} lượt chia sẻ`;
    shareCount.addEventListener("click", () => openSharersModal(post.post_id));
  }

  countsContainer.appendChild(reactionCount);
  if (shareCount) countsContainer.appendChild(shareCount);

  // --- Actions ---
  const actions = document.createElement("div");
  actions.className =
    `flex justify-between flex-wrap gap-1 ${cls.textSub} border-t border-gray-200 dark:border-[#3e4042] pt-3 mt-1`;

  const reactionWrapper = document.createElement("div");
  reactionWrapper.className = "relative inline-block group";

  const reactBtn = document.createElement("button");
  reactBtn.type = "button";
  reactBtn.className =
    `flex items-center gap-2 hover:text-fb-primary ${cls.hoverRow} px-2 py-1 rounded-md transition`;
  updateReactionButton(reactBtn, post.user_is_reaction || "");

  const reactionCtx = {
    targetId: post.post_id,
    reactFn: reactToPost,
    reactBtn,
    wrapper: reactionWrapper,
    reactionCount,
    entity: post,
  };

  const reactionBar = createReactionBar(reactionCtx);

  reactBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const current = reactBtn.dataset.reaction;
    try {
      const res = await reactToPost(post.post_id, current || "like");
      if (res) applyReactionResponse(reactionCtx, res, "like");
    } catch (err) {
      console.error("[post] react", err);
    }
  });

  reactionWrapper.append(reactBtn, reactionBar);

  const commentBtn = document.createElement("button");
  commentBtn.type = "button";
  commentBtn.className =
    `flex items-center gap-2 hover:text-fb-primary ${cls.hoverRow} px-2 py-1 rounded-md transition`;
  commentBtn.textContent = "🗨️ Bình luận";
  commentBtn.addEventListener("click", () =>
    openCommentsModal(post.post_id, post.user?.id)
  );

  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className =
    `flex items-center gap-2 hover:text-fb-primary ${cls.hoverRow} px-2 py-1 rounded-md transition`;
  shareBtn.textContent = "🔂 Chia sẻ";
  shareBtn.addEventListener("click", () => openShareModal(post.post_id));

  if (post.share_code) {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className =
      "flex items-center gap-1.5 text-sm text-gray-600 hover:bg-fb-secondary dark:hover:bg-gray-700 px-2 py-1 rounded-md";
    copyBtn.innerHTML = "🔗 <span>Sao chép liên kết</span>";
    copyBtn.addEventListener("click", async () => {
      const link = shareLink(post.share_code);
      await navigator.clipboard.writeText(link);
      showToast("Đã sao chép liên kết chia sẻ");
    });
    actions.appendChild(copyBtn);
  }

  if (isOwner) {
    const privacyWrap = document.createElement("select");
    privacyWrap.className =
      `text-xs border border-gray-200 dark:border-[#3e4042] rounded px-2 py-1 ml-auto bg-white dark:bg-[#3a3b3c] ${cls.textSub}`;
    ["public", "friends", "private"].forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent =
        p === "public" ? "Công khai" : p === "friends" ? "Bạn bè" : "Riêng tư";
      if (post.privacy === p) opt.selected = true;
      privacyWrap.appendChild(opt);
    });
    privacyWrap.addEventListener("change", async () => {
      try {
        const res = await authFetch(API.postPrivacy(post.post_id), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ privacy_type: privacyWrap.value }),
        });
        if (res.ok) showToast("Đã cập nhật quyền xem");
        else showToast("Cập nhật thất bại", "red");
      } catch {
        showToast("Lỗi kết nối", "red");
      }
    });
    actions.appendChild(privacyWrap);
  }

  actions.append(reactionWrapper, commentBtn, shareBtn);

  article.append(header, title);
  if (photoSection) article.appendChild(photoSection);
  article.append(countsContainer, actions);

  return article;
}

function buildPhotoSection(post, onOpenPhotos) {
  if (!post.photos?.length) return null;

  const photoWrapper = document.createElement("div");
  photoWrapper.className = "post-photos mb-3";

  const openAt = (index) => {
    const urls = post.photos.map((p) => p.photo);
    onOpenPhotos?.(urls, index, post.title || "");
  };

  if (post.photos.length === 1) {
    const img = document.createElement("img");
    img.className =
      "w-full max-h-[480px] object-contain rounded-lg cursor-pointer hover:opacity-90 transition";
    img.src = post.photos[0].photo;
    img.alt = "Ảnh bài viết";
    if (post.photos[0].id) img.dataset.photoId = post.photos[0].id;
    img.addEventListener("click", () => openAt(0));
    photoWrapper.appendChild(img);
    return photoWrapper;
  }

  photoWrapper.className = "post-photos grid grid-cols-2 gap-2 mb-3";
  const maxVisible = 4;

  post.photos.slice(0, maxVisible).forEach((p, index) => {
    const imgWrapper = document.createElement("div");
    imgWrapper.className = "relative aspect-square";

    const img = document.createElement("img");
    img.className =
      "w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition";
    img.src = p.photo;
    img.alt = "Ảnh bài viết";
    if (p.id) img.dataset.photoId = p.id;
    img.addEventListener("click", () => openAt(index));

    imgWrapper.appendChild(img);

    if (index === maxVisible - 1 && post.photos.length > maxVisible) {
      const overlay = document.createElement("div");
      overlay.className =
        "absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg text-white text-2xl font-bold cursor-pointer";
      overlay.textContent = `+${post.photos.length - maxVisible}`;
      overlay.addEventListener("click", () => openAt(index));
      imgWrapper.appendChild(overlay);
    }

    photoWrapper.appendChild(imgWrapper);
  });

  return photoWrapper;
}

export { REACTIONS };
