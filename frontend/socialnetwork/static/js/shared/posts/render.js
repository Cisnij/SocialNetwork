import { authFetch } from "../../authenticate/auth.js";
import { API, POST_ENDPOINTS, DEFAULT_AVATAR, profileUrl, shareLink } from "../config.js";
import { openSharersModal } from "./sharers-modal.js";
import { showToast } from "../toast.js";
import { formatRelativeTime, cls } from "../ui.js";
import { openEditModal } from "../post-edit.js";
import { openCommentsModal } from "../comments-panel.js";
import { openShareModal } from "../share-modal.js";
import { showReportModal } from "../pin-report.js";
import {
  REACTIONS,
  createReactionBar,
  getTotalReactions,
  updateReactionButton,
  applyReactionResponse,
  buildReactionCountContent,
} from "./reactions.js";
import { reactToPost } from "./api.js";

/**
 * Unified post card renderer for feed and user page.
 * @param {object} post
 * @param {object} options
 * @param {number|null} options.currentUserId - Profile id of logged-in user
 * @param {(postId: number) => void} options.onDelete
 * @param {(postId: number, isPinned: boolean, cardEl: HTMLElement) => void} [options.onPin]
 * @param {(postId: number) => void} options.onOpenReactions
 * @param {(urls: string[], index: number, caption: string) => void} options.onOpenPhotos
 */
export function renderPostCard(post, options = {}) {
  const {
    currentUserId = null,
    isUserPage = false,
    onDelete,
    onPin,
    onOpenReactions,
    onOpenPhotos,
    isGroupPost = !!(post.group && Number(post.group) > 0),
    showShare = true,
    showCopyLink = true,
    showPrivacy = true,
    onEditGroupPost,
    onPinGroupPost,
    onNotifyGroupPost,
    onDeleteGroupPost,
    navigateOnClick = true,
    disableInteractions = false,
  } = options;

  const article = document.createElement("article");
  article.className = `post-card p-4 mb-4 ${cls.card}`;
  article.dataset.postId = post.post_id;
  article.style.overflow = "visible";
  article.style.position = "relative";
  article.style.zIndex = "1";
  const card = article;

  const postDetailUrl =
    post.group && Number(post.group) > 0
      ? `/group/${post.group}/post/${post.post_id}/`
      : `/post/${post.post_id}/`;

  if (navigateOnClick) {
    article.style.cursor = "pointer";
    article.addEventListener("click", () => {
      window.location.href = postDetailUrl;
    });
  }

  // --- Header ---
  const header = document.createElement("div");
  header.className = "flex items-center justify-between mb-3";
  header.style.overflow = "visible";

  const left = document.createElement("div");
  left.className = "flex items-center gap-3";
  left.style.overflow = "visible";

  const userId = post.user?.id;

  const profileLink = document.createElement("a");
  profileLink.href = profileUrl(userId);
  profileLink.className = "shrink-0";
  profileLink.addEventListener("click", (e) => e.stopPropagation());

  const avatar = document.createElement("img");
  avatar.className = "w-10 h-10 rounded-full object-cover";
  avatar.src = post.user?.picture || DEFAULT_AVATAR;
  avatar.alt = "avatar";
  profileLink.appendChild(avatar);

  const info = document.createElement("div");
  const name = document.createElement("a");
  name.href = profileUrl(userId);
  name.className = `font-semibold text-sm sm:text-base ${cls.text} hover:underline`;
  name.addEventListener("click", (e) => e.stopPropagation());
  name.textContent =
    `${post?.user?.first_name || ""} ${post?.user?.last_name || ""}`.trim() ||
    "Người dùng";

  const groupName = document.createElement("a");
  groupName.href = post.group ? `/group/${post.group}/` : "#";
  groupName.className =
    "block text-xs text-fb-primary hover:underline mb-0.5";
  groupName.innerHTML = `<svg class="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>${post.group_name || ""}`;
  groupName.addEventListener("click", (e) => e.stopPropagation());
  if (!post.group_name) {
    groupName.classList.add("hidden");
  }

  // Pin badge — always rendered on userpage, shown/hidden based on is_pinned
  if (isUserPage) {
    const pinBadge = document.createElement("span");
    pinBadge.className =
      "pin-badge inline-flex items-center gap-1 text-[10px] font-semibold " +
      "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 " +
      "rounded px-1.5 py-0.5 mb-0.5" +
      (post.is_pinned ? "" : " hidden");
    pinBadge.innerHTML = `<svg class="w-3 h-3 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg> Đã ghim`;
    info.appendChild(pinBadge);
  }

  const time = document.createElement("p");
  time.className = `text-xs ${cls.textMuted}`;
  time.textContent = formatRelativeTime(post.created_at);
  time.title = new Date(post.created_at).toLocaleString("vi-VN");

  info.append(name, groupName, time);
  left.append(profileLink, info);

  const menuWrapper = document.createElement("div");
  menuWrapper.className = "relative";
  menuWrapper.style.overflow = "visible";
  menuWrapper.style.zIndex = "10";

  const isOwner =
    currentUserId != null && (Number(post.user?.user) === Number(currentUserId) || Number(post.user?.id) === Number(currentUserId));

  {
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className =
      "text-gray-500 dark:text-[#b0b3b8] hover:text-gray-800 dark:hover:text-[#e4e6eb] text-2xl font-bold px-2 rounded-full";
    menuBtn.setAttribute("aria-label", "Tùy chọn bài viết");
    menuBtn.textContent = "⋯";

    const menuDropdown = document.createElement("div");
    menuDropdown.className =
      `absolute right-0 mt-2 w-44 ${cls.menu} rounded-lg shadow-lg hidden`;
    menuDropdown.style.zIndex = "99999";
    menuDropdown.style.overflow = "visible";
    menuDropdown.style.transform = "translateZ(0)";

    const appendItem = (label, className, onClick) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = className;
      item.innerHTML = label;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        closeMenu();
        onClick?.();
      });
      menuDropdown.appendChild(item);
      return item;
    };

    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle("hidden");
    });

    const closeMenu = () => menuDropdown.classList.add("hidden");
    document.addEventListener("click", closeMenu, { once: false });

    // --- Group post extra menu items (pin / edit / notify) ---
    if (isGroupPost) {
      if (typeof onPinGroupPost === "function") {
        appendItem(
          post.is_pinned
            ? `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>Bỏ ghim bài`
            : `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>Ghim bài`,
          `block w-full text-left px-4 py-2 ${cls.text} ${cls.hoverRow}`,
          () => onPinGroupPost(post)
        );
      }
      if (typeof onEditGroupPost === "function") {
        appendItem(
          `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>Chỉnh sửa`,
          `block w-full text-left px-4 py-2 ${cls.text} ${cls.hoverRow}`,
          () => onEditGroupPost(post)
        );
      }
      if (typeof onNotifyGroupPost === "function") {
        appendItem(
          `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>Thông báo nhóm`,
          `block w-full text-left px-4 py-2 ${cls.text} ${cls.hoverRow}`,
          () => onNotifyGroupPost(post)
        );
      }
      if (typeof onDeleteGroupPost === "function") {
        appendItem(
          `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>Xóa bài viết`,
          "block w-full text-left px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30",
          () => onDeleteGroupPost(post.post_id)
        );
      }
    }

    const hasGroupMenu =
      isGroupPost &&
      (typeof onPinGroupPost === "function" ||
        typeof onEditGroupPost === "function" ||
        typeof onNotifyGroupPost === "function" ||
        typeof onDeleteGroupPost === "function");

    if (isOwner && !hasGroupMenu) {
      appendItem(
        `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>Chỉnh sửa`,
        `block w-full text-left px-4 py-2 ${cls.text} ${cls.hoverRow}`,
        () => openEditModal(post)
      );
      if (isUserPage) {
        appendItem(
          post.is_pinned ? `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>Bỏ ghim bài` : `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>Ghim bài`,
          `block w-full text-left px-4 py-2 ${cls.text} ${cls.hoverRow}`,
          async () => {
            closeMenu();
            try {
              const res = await authFetch(API.pinPost(post.post_id), {
                method: "PUT",
              });
              if (!res.ok) throw new Error("pin");
              const data = await res.json();
              const newPinState = data.is_pinned;
              post.is_pinned = newPinState;
              // Optimistic update: notify caller to handle DOM
              if (typeof onPin === "function") {
                onPin(post.post_id, newPinState, card);
              }
              showToast(newPinState ? "📌 Đã ghim bài viết" : "Bỏ ghim bài viết", "green");
            } catch {
              showToast("Không thể ghim bài", "red");
            }
          }
        );
      }
      appendItem(
        `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>Xóa bài viết`,
        "block w-full text-left px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30",
        () => onDelete?.(post.post_id)
      );
    } else if (isGroupPost ? !isOwner : true) {
      // Task 8: Use beautiful report modal instead of prompt()
      appendItem(
        `<svg class="w-4 h-4 inline mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 21v-8a2 2 0 012-2h14a2 2 0 012 2v8M3 21h18M5 11l7-7 7 7M5 11V9a2 2 0 012-2h14a2 2 0 012 2v2M5 11V9"/></svg>Báo cáo bài viết`,
        "block w-full text-left px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30",
        () => showReportModal(post.post_id)
      );
    }
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
  countsContainer.className = "flex items-center mb-2 text-sm min-h-[20px] w-full";

  const leftCounts = document.createElement("div");
  leftCounts.className = "flex items-center gap-2";

  const rightCounts = document.createElement("div");
  rightCounts.className = "flex items-center gap-2 ml-auto";

  // --- Reaction count ---
  const totalReactions = getTotalReactions(post.reactions);
  const reactionCount = document.createElement("button");
  reactionCount.type = "button";
  reactionCount.className =
    "flex items-center text-gray-600 dark:text-fb-muted hover:underline font-medium !bg-transparent border-none p-0 hover:!bg-transparent dark:hover:!bg-transparent";
  if (totalReactions > 0) {
    reactionCount.appendChild(buildReactionCountContent(post.reactions));
  }
  reactionCount.classList.toggle("hidden", totalReactions === 0);
  reactionCount.addEventListener("click", (e) => {
    e.stopPropagation();
    onOpenReactions?.(post.post_id, "post", post.reactions);
  });

  // --- Share count ---
  let shareCount = null;
  if ((post.share_count || 0) > 0) {
    shareCount = document.createElement("button");
    shareCount.type = "button";
    shareCount.className = "text-gray-500 dark:text-fb-muted hover:underline font-medium !bg-transparent border-none p-0 hover:!bg-transparent dark:hover:!bg-transparent";
    shareCount.textContent = `${post.share_count} lượt chia sẻ`;
    shareCount.addEventListener("click", (e) => {
      e.stopPropagation();
      openSharersModal(post.post_id);
    });
  }

  leftCounts.appendChild(reactionCount);
  if (shareCount) rightCounts.appendChild(shareCount);

  countsContainer.append(leftCounts, rightCounts);

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
    onApplied: async () => {
      try {
        const url = isGroupPost
          ? API.groupPostDetail(post.group, post.post_id)
          : API.post(post.post_id);
        await authFetch(url);
      } catch (err) {
        console.error("[post] fetch updated post error", err);
      }
    },
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
  commentBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg> Bình luận`;
  commentBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openCommentsModal(post.post_id, post.user?.id);
  });

  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className =
    `flex items-center gap-2 hover:text-fb-primary ${cls.hoverRow} px-2 py-1 rounded-md transition`;
  shareBtn.innerHTML = `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg> Chia sẻ`;
  shareBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openShareModal(post.post_id);
  });

  if (post.share_code && showCopyLink) {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className =
      "flex items-center gap-1.5 text-sm text-gray-600 hover:bg-fb-secondary dark:hover:bg-gray-700 px-2 py-1 rounded-md";
    copyBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg> <span>Sao chép liên kết</span>`;
    copyBtn.addEventListener("click", async () => {
      const link = shareLink(post.share_code);
      await navigator.clipboard.writeText(link);
      showToast("Đã sao chép liên kết chia sẻ");
    });
    actions.appendChild(copyBtn);
  }

  if (showPrivacy) {
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
      privacyWrap.addEventListener("change", async (e) => {
        e.stopPropagation();
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
    } else {
      const privacyLabel = document.createElement("span");
      privacyLabel.className =
        `text-xs border border-gray-200 dark:border-[#3e4042] rounded px-2 py-1 ml-auto bg-gray-50 dark:bg-[#3a3b3c] ${cls.textSub}`;
      const privacyText =
        post.privacy === "public"
          ? "Công khai"
          : post.privacy === "friends"
            ? "Bạn bè"
            : post.privacy === "private"
              ? "Riêng tư"
              : post.privacy;
      privacyLabel.textContent = privacyText;
      actions.appendChild(privacyLabel);
    }
  }

  if (!disableInteractions) {
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = `flex items-center gap-2 hover:text-fb-primary ${cls.hoverRow} px-2 py-1 rounded-md transition ${post.is_saved ? 'text-fb-primary' : ''}`;
    saveBtn.innerHTML = post.is_saved 
      ? `<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg> Đã lưu`
      : `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg> Lưu`;
    
    saveBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const res = await authFetch(POST_ENDPOINTS.toggleSavePost(post.post_id), { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          post.is_saved = data.is_saved;
          saveBtn.className = `flex items-center gap-2 hover:text-fb-primary ${cls.hoverRow} px-2 py-1 rounded-md transition ${post.is_saved ? 'text-fb-primary' : ''}`;
          saveBtn.innerHTML = post.is_saved 
            ? `<svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg> Đã lưu`
            : `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg> Lưu`;
          showToast(post.is_saved ? "Đã lưu bài viết" : "Đã bỏ lưu bài viết");
        }
      } catch (err) {
        showToast("Lỗi kết nối", "red");
      }
    });

    if (showShare) {
      actions.append(reactionWrapper, commentBtn, shareBtn, saveBtn);
    } else {
      actions.append(reactionWrapper, commentBtn, saveBtn);
    }
  }

  article.append(header, title);
  if (photoSection) article.appendChild(photoSection);

  const videoSection = buildVideoSection(post);
  if (videoSection) article.appendChild(videoSection);

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
    img.addEventListener("click", (e) => { e.stopPropagation(); openAt(0); });
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
    img.addEventListener("click", (e) => { e.stopPropagation(); openAt(index); });

    imgWrapper.appendChild(img);

    if (index === maxVisible - 1 && post.photos.length > maxVisible) {
      const overlay = document.createElement("div");
      overlay.className =
        "absolute inset-0 bg-black/50 flex items-center justify-center rounded-lg text-white text-2xl font-bold cursor-pointer";
      overlay.textContent = `+${post.photos.length - maxVisible}`;
      overlay.addEventListener("click", (e) => { e.stopPropagation(); openAt(index); });
      imgWrapper.appendChild(overlay);
    }

    photoWrapper.appendChild(imgWrapper);
  });

  return photoWrapper;
}

function buildVideoSection(post) {
  if (!post.videos?.length) return null;

  const videoWrapper = document.createElement("div");
  videoWrapper.className = "post-videos mb-3 flex flex-col gap-2";

  post.videos.forEach((v) => {
    const video = document.createElement("video");
    video.className = "w-full max-h-[480px] rounded-lg bg-black";
    video.src = v.video;
    video.controls = true;
    if (v.id) video.dataset.videoId = v.id;
    // Prevent event bubbling when clicking on the video (e.g. play/pause controls)
    video.addEventListener("click", (e) => e.stopPropagation());
    videoWrapper.appendChild(video);
  });

  return videoWrapper;
}

export { REACTIONS, buildPhotoSection, buildVideoSection };

