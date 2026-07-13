import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl } from "./config.js";
import { showToast } from "./toast.js";
import { fullName } from "./ui.js";
import { confirmDialog } from "./confirm.js";
import { getCurrentUserId, fetchUserProfileShared } from "../app/profile.js";
import { fetchPage } from "./paginated-list.js";
import { initPostModals, openReactionsModal } from "./posts/modals.js";
import { showReportModal } from "./pin-report.js";
import {
  createReactionBar,
  getTotalReactions,
  updateReactionButton,
  applyReactionResponse,
  reactToComment,
} from "./posts/reactions.js";

let postId = null;
let postOwnerId = null;
let myId = null;
let nextUrl = null;
let loading = false;
let mentionFriends = null;
let selectedTaggedUserIds = new Set();

export function initCommentsPanel() {
  initPostModals();

  document.getElementById("closeCommentsModal")?.addEventListener("click", () => {
    document.getElementById("commentsModal")?.classList.add("hidden");
  });
  document.getElementById("submitCommentBtn")?.addEventListener("click", submitComment);
  document.getElementById("commentInput")?.addEventListener("input", handleMentionInput);

  const list = document.getElementById("commentsList");
  const sentinel = document.getElementById("commentsSentinel");
  if (sentinel && list) {
    new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) loadMore(false);
    }).observe(sentinel);
  }
}

export async function openCommentsModal(id, ownerProfileId = null) {
  postId = id;
  postOwnerId = ownerProfileId;
  myId = await getCurrentUserId().catch(() => null);
  const modal = document.getElementById("commentsModal");
  const list = document.getElementById("commentsList");
  modal?.classList.remove("hidden");
  list.replaceChildren();
  resetCommentComposer();
  nextUrl = buildListUrl(API.comments(postId), 15);
  await loadMore(true);
}

async function loadMore(reset) {
  if (!nextUrl || loading) return;
  loading = true;
  try {
    const data = await fetchPage(nextUrl);
    if (reset && !(data.results || []).length) {
      document.getElementById("commentsList").innerHTML =
        '<p class="text-center text-gray-500 dark:text-[#b0b3b8] text-sm py-6">Chưa có bình luận</p>';
    }
    (data.results || []).forEach((c) =>
      document
        .getElementById("commentsList")
        .appendChild(renderComment(c, 0, postOwnerId))
    );
    nextUrl = data.next;
  } catch {
    showToast("Không tải bình luận", "red");
  }
  loading = false;
}

function syncReactionCountBtn(btn, comment) {
  const total = getTotalReactions(comment.reactions);
  btn.textContent = total > 0 ? `${total} lượt thích` : "";
  if (total === 0) {
    btn.classList.add("hidden");
  } else {
    btn.classList.remove("hidden");
  }
}

function buildCommentReactionUI(comment, meta) {
  const reactionCountBtn = document.createElement("button");
  reactionCountBtn.type = "button";
  reactionCountBtn.className =
    "text-xs text-gray-500 dark:text-[#b0b3b8] hover:underline font-medium !bg-transparent border-none p-0 hover:!bg-transparent dark:hover:!bg-transparent";
  syncReactionCountBtn(reactionCountBtn, comment);
  reactionCountBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openReactionsModal(comment.id, "comment");
  });

  const reactionWrapper = document.createElement("div");
  reactionWrapper.className = "relative inline-block";

  const reactBtn = document.createElement("button");
  reactBtn.type = "button";
  reactBtn.className =
    "text-xs font-semibold hover:text-fb-primary dark:hover:text-[#e4e6eb] transition px-0 !bg-transparent border-none hover:!bg-transparent dark:hover:!bg-transparent";
  updateReactionButton(reactBtn, comment.user_is_reaction || "", true);

  const reactionCtx = {
    targetId: comment.id,
    reactFn: reactToComment,
    reactBtn,
    wrapper: reactionWrapper,
    reactionCount: reactionCountBtn,
    entity: comment,
    onApplied: () => syncReactionCountBtn(reactionCountBtn, comment),
  };

  const reactionBar = createReactionBar(reactionCtx);
  reactionWrapper.append(reactBtn, reactionBar);

  reactBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const current = reactBtn.dataset.reaction;
    try {
      const res = await reactToComment(comment.id, current || "like");
      if (res) applyReactionResponse(reactionCtx, res, "like");
    } catch (err) {
      console.error("[comment] react", err);
      showToast("Không gửi được cảm xúc", "red");
    }
  });

  meta.append(reactionWrapper);

  return reactionCountBtn;
}

/**
 * Render nội dung comment với @mention inline thành link click được — chuẩn Facebook.
 * Sort tên dài trước để tránh match @Nghị trước @Nghị Chí.
 */
function renderContentWithMentions(content, taggedUsers) {
  const p = document.createElement("p");
  p.className = "text-sm post-comment-text whitespace-pre-wrap dark:text-[#e4e6eb]";

  if (!taggedUsers?.length) {
    p.textContent = content;
    return p;
  }

  // Sort tên dài trước → tránh match ngắn trước
  const sorted = [...taggedUsers].sort((a, b) => b.full_name.length - a.full_name.length);

  let remaining = content;
  while (remaining.length) {
    let earliest = null;
    let matchedUser = null;

    sorted.forEach((u) => {
      const idx = remaining.indexOf(`@${u.full_name}`);
      if (idx !== -1 && (earliest === null || idx < earliest)) {
        earliest = idx;
        matchedUser = u;
      }
    });

    if (earliest === null) {
      // Không còn mention → append phần còn lại
      p.appendChild(document.createTextNode(remaining));
      break;
    }

    // Text trước @mention
    if (earliest > 0) {
      p.appendChild(document.createTextNode(remaining.slice(0, earliest)));
    }

    // @mention → link
    const a = document.createElement("a");
    a.href = `/profile/${matchedUser.id}/`;
    a.className = "text-fb-primary font-semibold hover:underline cursor-pointer";
    a.textContent = `@${matchedUser.full_name}`;
    a.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      window.location.href = `/profile/${matchedUser.id}/`;
    };
    p.appendChild(a);

    remaining = remaining.slice(earliest + `@${matchedUser.full_name}`.length);
  }

  return p;
}

/**
 * Chỉ 1 cấp reply: parent_id luôn là comment gốc (depth 0), kể cả khi bấm Trả lời trên reply con.
 * @param {number|null} threadParentId - id comment cha (cấp 0) của thread
 */
function renderComment(c, depth = 0, ownerId = postOwnerId, threadParentId = null) {
  const wrap = document.createElement("div");
  wrap.className = `py-3 ${depth ? "ml-8 border-l-2 border-fb-secondary dark:border-[#3e4042] pl-3" : "border-b dark:border-gray-700"}`;
  wrap.dataset.commentId = c.id;
  const replyParentId = depth === 0 ? c.id : threadParentId;
  if (replyParentId != null) wrap.dataset.replyParentId = String(replyParentId);

  const row = document.createElement("div");
  row.className = "flex gap-2";
  const av = document.createElement("img");
  av.src = c.user?.picture || "/static/default-avatar.png";
  av.className = "w-8 h-8 rounded-full object-cover shrink-0";

  const body = document.createElement("div");
  body.className = "flex-1 min-w-0";
  const bubble = document.createElement("div");
  bubble.className =
    "bg-fb-secondary dark:bg-[#3a3b3c] rounded-2xl px-3 py-2 inline-block max-w-full";
  const author = document.createElement("p");
  author.className = "font-semibold text-xs text-fb-primary";
  author.textContent = fullName(c.user);
  const textNode = renderContentWithMentions(c.content, c.tagged_users_info);
  bubble.append(author, textNode);
  if (c.is_pinned) {
    const pin = document.createElement("span");
    pin.className = "text-[10px] text-amber-600 block mt-1";
    pin.textContent = "📌 Đã ghim";
    bubble.appendChild(pin);
  }
  body.appendChild(bubble);

  const countsRow = document.createElement("div");
  countsRow.className = "flex items-center gap-2 mt-1 min-h-[18px]";

  const meta = document.createElement("div");
  meta.className =
    "flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500 dark:text-[#b0b3b8] font-semibold";

  const reactionCountBtn = buildCommentReactionUI(c, meta);
  countsRow.appendChild(reactionCountBtn);

  const reply = document.createElement("button");
  reply.type = "button";
  reply.textContent = "Trả lời";
  reply.className = "hover:underline !bg-transparent border-none p-0 text-gray-500 dark:text-[#b0b3b8] hover:!bg-transparent dark:hover:!bg-transparent";
  reply.onclick = () => {
    const parentInput = document.getElementById("commentParentId");
    const hint = document.getElementById("commentParentHint");
    parentInput.value = replyParentId != null ? String(replyParentId) : "";
    hint.textContent =
      depth === 0
        ? `Trả lời ${fullName(c.user)}`
        : `Trả lời ${fullName(c.user)} · trong luồng bình luận`;
    document.getElementById("commentInput")?.focus();
  };
  meta.appendChild(reply);

  if (ownerId != null && Number(myId) === Number(ownerId)) {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.textContent = c.is_pinned ? "Bỏ ghim" : "Ghim";
    pin.className = "hover:underline !bg-transparent border-none p-0 text-gray-500 dark:text-[#b0b3b8] hover:!bg-transparent dark:hover:!bg-transparent";
    pin.onclick = async () => {
      const res = await authFetch(API.pinComment(c.id), { method: "PATCH" });
      if (res.ok) {
        const { is_pinned } = await res.json();
        showToast(is_pinned ? "Đã ghim" : "Đã bỏ ghim");
        nextUrl = buildListUrl(API.comments(postId), 15);
        document.getElementById("commentsList").replaceChildren();
        await loadMore(true);
      }
    };
    meta.appendChild(pin);
  }

  // Report comment button (for non-owners) — FB-style modal
  if (Number(c.user?.id) !== Number(myId)) {
    const reportBtn = document.createElement("button");
    reportBtn.type = "button";
    reportBtn.textContent = "Báo cáo";
    reportBtn.className = "text-red-400 hover:text-red-600 !bg-transparent border-none p-0 hover:underline hover:!bg-transparent dark:hover:!bg-transparent";
    reportBtn.onclick = (e) => {
      e.stopPropagation();
      showReportModal(c.id, "comment");
    };
    meta.appendChild(reportBtn);
  }

  if (Number(c.user?.id) === Number(myId)) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Sửa";
    edit.className = "hover:underline !bg-transparent border-none p-0 text-gray-500 dark:text-[#b0b3b8] hover:!bg-transparent dark:hover:!bg-transparent";
    edit.onclick = () => showInlineCommentEdit(c.id, textNode, bubble, edit);
    meta.appendChild(edit);

    const del = document.createElement("button");
    del.type = "button";
    del.textContent = "Xóa";
    del.className = "text-red-500 hover:text-red-700 !bg-transparent border-none p-0 hover:underline hover:!bg-transparent dark:hover:!bg-transparent";
    del.onclick = async () => {
      if (!await confirmDialog("Xóa bình luận này?")) return;
      const res = await authFetch(API.comment(c.id), { method: "DELETE" });
      if (res.ok) {
        wrap.remove();
        showToast("Đã xóa bình luận");
      } else {
        showToast("Xóa thất bại", "red");
      }
    };
    meta.appendChild(del);
  }

  body.append(countsRow, meta);
  row.append(av, body);
  wrap.appendChild(row);

  if (depth === 0) {
    const repliesBox = document.createElement("div");
    repliesBox.dataset.repliesBox = "1";
    repliesBox.className = "hidden";
    wrap.appendChild(repliesBox);

    if (c.reply_count > 0) {
      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.dataset.loadRepliesBtn = "1";
      loadBtn.className = "text-xs text-fb-primary font-semibold mt-2 ml-10";
      loadBtn.textContent = `Xem ${c.reply_count} phản hồi`;
      loadBtn.onclick = async () => {
        if (repliesBox.childElementCount && !repliesBox.classList.contains("hidden")) {
          repliesBox.classList.add("hidden");
          loadBtn.textContent = `Xem ${repliesBox.childElementCount} phản hồi`;
          return;
        }
        if (!repliesBox.childElementCount) {
          const res = await authFetch(buildListUrl(API.nestedComments(c.id), 10));
          const data = await res.json();
          (data.results || []).forEach((r) =>
            repliesBox.appendChild(renderComment(r, 1, ownerId, c.id))
          );
        }
        repliesBox.classList.remove("hidden");
        loadBtn.textContent = "Ẩn phản hồi";
      };
      wrap.insertBefore(loadBtn, repliesBox);
    }
  }

  return wrap;
}

function getCommentsListEl() {
  return document.getElementById("commentsList");
}

function removeCommentsEmptyState() {
  getCommentsListEl()
    ?.querySelector(":scope > p.text-center")
    ?.remove();
}

function updateRepliesToggleBtn(parentWrap) {
  const loadBtn = parentWrap.querySelector("[data-load-replies-btn]");
  const repliesBox = parentWrap.querySelector("[data-replies-box]");
  if (!loadBtn || !repliesBox) return;
  const n = repliesBox.childElementCount;
  if (n === 0) {
    loadBtn.classList.add("hidden");
    return;
  }
  loadBtn.classList.remove("hidden");
  loadBtn.textContent = repliesBox.classList.contains("hidden")
    ? `Xem ${n} phản hồi`
    : "Ẩn phản hồi";
}

function ensureRepliesBox(parentWrap) {
  let repliesBox = parentWrap.querySelector("[data-replies-box]");
  if (!repliesBox) {
    repliesBox = document.createElement("div");
    repliesBox.dataset.repliesBox = "1";
    repliesBox.className = "";
    parentWrap.appendChild(repliesBox);
  }
  return repliesBox;
}

function insertRootComment(comment) {
  const list = getCommentsListEl();
  if (!list) return;
  removeCommentsEmptyState();
  list.prepend(renderComment(comment, 0, postOwnerId));
}

function appendReplyToThread(parentId, comment) {
  const list = getCommentsListEl();
  const parentWrap = list?.querySelector(
    `[data-comment-id="${parentId}"]`
  );
  if (!parentWrap) {
    insertRootComment(comment);
    return;
  }

  const repliesBox = ensureRepliesBox(parentWrap);
  repliesBox.classList.remove("hidden");
  const replyNode = renderComment(comment, 1, postOwnerId, parentId);
  repliesBox.appendChild(replyNode);

  let loadBtn = parentWrap.querySelector("[data-load-replies-btn]");
  if (!loadBtn) {
    loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.dataset.loadRepliesBtn = "1";
    loadBtn.className = "text-xs text-fb-primary font-semibold mt-2 ml-10";
    loadBtn.onclick = () => {
      const box = parentWrap.querySelector("[data-replies-box]");
      if (!box) return;
      const hide = !box.classList.contains("hidden");
      box.classList.toggle("hidden", hide);
      updateRepliesToggleBtn(parentWrap);
    };
    parentWrap.insertBefore(loadBtn, repliesBox);
  }
  updateRepliesToggleBtn(parentWrap);
  replyNode.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function normalizeCreatedComment(raw) {
  const c = { ...raw, reactions: raw.reactions || [], reply_count: raw.reply_count ?? 0 };
  if (!c.user) {
    try {
      c.user = await fetchUserProfileShared();
    } catch {
      /* API thường đã trả user */
    }
  }
  return c;
}

function resetCommentComposer() {
  const input = document.getElementById("commentInput");
  const parentInput = document.getElementById("commentParentId");
  const hint = document.getElementById("commentParentHint");
  if (input) input.value = "";
  if (parentInput) parentInput.value = "";
  if (hint) hint.textContent = "";
  selectedTaggedUserIds.clear();
  document.getElementById("commentMentionMenu")?.remove();
}

async function getMentionFriends() {
  if (mentionFriends) return mentionFriends;
  const res = await authFetch(API.friends());
  if (!res.ok) return [];
  const data = await res.json();
  mentionFriends = (data.results || [])
    .map((f) => f.user)
    .filter((p) => p?.user && p?.id);
  return mentionFriends;
}

async function handleMentionInput(e) {
  const input = e.target;
  const value = input.value || "";
  const match = value.match(/@([\p{L}\p{N}]{0,40})$/u);
  if (!match) {
    document.getElementById("commentMentionMenu")?.remove();
    return;
  }

  const q = match[1].trim().toLowerCase();
  const friends = await getMentionFriends();
  const matches = friends
    .filter((p) => fullName(p).toLowerCase().includes(q))
    .slice(0, 8);
  showMentionMenu(input, matches, match[0]);
}

function showMentionMenu(input, profiles, token) {
  document.getElementById("commentMentionMenu")?.remove();
  if (!profiles.length) return;

  const menu = document.createElement("div");
  menu.id = "commentMentionMenu";
  menu.className =
    "absolute z-[80] mb-2 w-64 max-h-64 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#242526] shadow-xl p-1";

  profiles.forEach((profile) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-fb-secondary dark:hover:bg-[#3a3b3c]";
    const av = document.createElement("img");
    av.src = profile.picture || "/static/default-avatar.png";
    av.className = "w-8 h-8 rounded-full object-cover";
    const name = document.createElement("span");
    name.className = "text-sm dark:text-[#e4e6eb]";
    name.textContent = fullName(profile);
    btn.append(av, name);
    btn.onclick = () => {
      selectedTaggedUserIds.add(Number(profile.user));
      const lastAt = input.value.lastIndexOf("@");
      input.value = input.value.slice(0, lastAt) + `@${fullName(profile)} `;
      menu.remove();
      input.focus();
    };
    menu.appendChild(btn);
  });

  const wrapper = input.parentElement;
  wrapper?.classList.add("relative");
  wrapper?.appendChild(menu);
  menu.style.left = "0";
  menu.style.bottom = `${input.offsetHeight + 6}px`;
}

async function submitComment() {
  const input = document.getElementById("commentInput");
  const parentInput = document.getElementById("commentParentId");
  const hint = document.getElementById("commentParentHint");
  const content = input?.value.trim();
  const parent = parentInput?.value || "";
  if (!content || !postId) return;

  const list = getCommentsListEl();
  const scrollTop = list?.scrollTop ?? 0;

  const body = { content };
  if (parent) body.parent_id = Number(parent);
  if (selectedTaggedUserIds.size) body.tagged_users = [...selectedTaggedUserIds];

  const submitBtn = document.getElementById("submitCommentBtn");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await authFetch(API.comments(postId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      showToast("Gửi thất bại", "red");
      return;
    }

    const created = await normalizeCreatedComment(await res.json());
    input.value = "";
    selectedTaggedUserIds.clear();
    document.getElementById("commentMentionMenu")?.remove();

    if (parent) {
      appendReplyToThread(Number(parent), created);
      parentInput.value = "";
      if (hint) hint.textContent = "";
    } else {
      parentInput.value = "";
      if (hint) hint.textContent = "";
      insertRootComment(created);
    }

    if (list) list.scrollTop = scrollTop;
    showToast("Đã gửi bình luận");
  } catch (e) {
    console.error("[comment] submit", e);
    showToast("Gửi thất bại", "red");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    input?.focus();
  }
}

// ==================== INLINE EDIT COMMENT ====================
export function showInlineCommentEdit(msgId, textNode, bubble, editBtn) {
  if (bubble.querySelector('.inline-edit-container')) return;
  const currentText = textNode.textContent;
  const container = document.createElement("div");
  container.className = "inline-edit-container mt-2 w-full";
  const input = document.createElement("textarea");
  input.className = "w-full text-sm rounded-lg px-2 py-1.5 bg-white/20 dark:bg-black/20 border border-fb-primary/50 focus:outline-none focus:ring-1 focus:ring-fb-primary resize-none text-inherit dark:text-white";
  input.value = currentText;
  input.rows = 2;
  input.style.minHeight = "36px";
  input.style.color = "inherit";
  const actionsRow = document.createElement("div");
  actionsRow.className = "flex gap-2 justify-end mt-1";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "text-[11px] px-2.5 py-1 rounded-full bg-gray-200/80 dark:bg-white/10 hover:bg-gray-300 dark:hover:bg-white/20 transition dark:text-white";
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
      const res = await authFetch(API.comment(msgId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: nv }) });
      if (res.ok) { textNode.textContent = nv; container.remove(); showToast("Đã sửa"); }
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