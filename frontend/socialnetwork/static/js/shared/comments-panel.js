import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl } from "./config.js";
import { showToast } from "./toast.js";
import { fullName, formatDate } from "./ui.js";
import { getCurrentUserId } from "../app/profile.js";
import { fetchPage } from "./paginated-list.js";
import { reactToPost } from "./posts/api.js";
import { REACTIONS, getTotalReactions } from "./posts/reactions.js";

let postId = null;
let postOwnerId = null;
let myId = null;
let nextUrl = null;
let loading = false;

export function initCommentsPanel() {
  document.getElementById("closeCommentsModal")?.addEventListener("click", () => {
    document.getElementById("commentsModal")?.classList.add("hidden");
  });
  document.getElementById("submitCommentBtn")?.addEventListener("click", submitComment);

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
        '<p class="text-center text-gray-500 text-sm py-6">Chưa có bình luận</p>';
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

function renderComment(c, depth = 0, ownerId = postOwnerId) {
  const wrap = document.createElement("div");
  wrap.className = `py-3 ${depth ? "ml-8 border-l-2 border-fb-secondary pl-3" : "border-b dark:border-gray-700"}`;
  wrap.dataset.commentId = c.id;

  const row = document.createElement("div");
  row.className = "flex gap-2";
  const av = document.createElement("img");
  av.src = c.user?.picture || "/static/default-avatar.png";
  av.className = "w-8 h-8 rounded-full object-cover shrink-0";

  const body = document.createElement("div");
  body.className = "flex-1 min-w-0";
  const bubble = document.createElement("div");
  bubble.className = "bg-fb-secondary dark:bg-gray-700 rounded-2xl px-3 py-2 inline-block max-w-full";
  const author = document.createElement("p");
  author.className = "font-semibold text-xs text-fb-primary";
  author.textContent = fullName(c.user);
  const text = document.createElement("p");
  text.className = "text-sm post-comment-text whitespace-pre-wrap";
  text.textContent = c.content;
  bubble.append(author, text);
  if (c.is_pinned) {
    const pin = document.createElement("span");
    pin.className = "text-[10px] text-amber-600 block mt-1";
    pin.textContent = "📌 Đã ghim";
    bubble.appendChild(pin);
  }
  body.appendChild(bubble);

  const meta = document.createElement("div");
  meta.className = "flex flex-wrap gap-3 mt-1 text-xs text-gray-500 font-semibold";
  const like = document.createElement("button");
  like.type = "button";
  like.textContent = "Thích";
  like.onclick = async () => {
    await authFetch(API.commentReact(c.id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction_type: "like" }),
    });
  };
  const reply = document.createElement("button");
  reply.type = "button";
  reply.textContent = "Trả lời";
  reply.onclick = () => {
    document.getElementById("commentParentHint").textContent = `Trả lời ${fullName(c.user)}`;
    document.getElementById("commentParentId").value = c.id;
  };
  meta.append(like, reply);

  if (ownerId != null && Number(myId) === Number(ownerId)) {
    const pin = document.createElement("button");
    pin.type = "button";
    pin.textContent = c.is_pinned ? "Bỏ ghim" : "Ghim";
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

  if (Number(c.user?.id) === Number(myId)) {
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Sửa";
    edit.onclick = async () => {
      const nv = prompt("Sửa bình luận", c.content);
      if (!nv) return;
      const res = await authFetch(API.comment(c.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: nv }),
      });
      if (res.ok) {
        text.textContent = nv;
        showToast("Đã cập nhật");
      }
    };
    meta.appendChild(edit);
  }

  const total = getTotalReactions(c.reactions);
  if (total > 0) {
    const rc = document.createElement("button");
    rc.type = "button";
    rc.textContent = `${total} cảm xúc`;
    rc.onclick = () => openCommentReactions(c.id);
    meta.appendChild(rc);
  }

  body.append(meta);
  row.append(av, body);
  wrap.appendChild(row);

  if (c.reply_count > 0 && depth === 0) {
    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "text-xs text-fb-primary font-semibold mt-2 ml-10";
    loadBtn.textContent = `Xem ${c.reply_count} phản hồi`;
    const repliesBox = document.createElement("div");
    repliesBox.className = "hidden";
    loadBtn.onclick = async () => {
      if (repliesBox.childElementCount) {
        repliesBox.classList.toggle("hidden");
        return;
      }
      const res = await authFetch(buildListUrl(API.nestedComments(c.id), 10));
      const data = await res.json();
      (data.results || []).forEach((r) =>
        repliesBox.appendChild(renderComment(r, 1, ownerId))
      );
      repliesBox.classList.remove("hidden");
      wrap.appendChild(repliesBox);
    };
    wrap.appendChild(loadBtn);
  }

  return wrap;
}

async function openCommentReactions(commentId) {
  const modal = document.getElementById("reactionsModal");
  const list = document.getElementById("reactionsList");
  list.replaceChildren();
  modal.classList.remove("hidden");
  try {
    const data = await fetchPage(buildListUrl(API.commentReactions(commentId), 20));
    (data.results || []).forEach((r) => {
      const row = document.createElement("div");
      row.className = "flex items-center gap-2 py-2";
      row.innerHTML = `<img src="${r.user?.picture}" class="w-8 h-8 rounded-full"><span>${fullName(r.user)}</span><span>${r.slug}</span>`;
      list.appendChild(row);
    });
  } catch (_) {}
}

async function submitComment() {
  const content = document.getElementById("commentInput").value.trim();
  const parent = document.getElementById("commentParentId").value;
  if (!content || !postId) return;
  const body = { content };
  if (parent) body.parent_id = Number(parent);
  const res = await authFetch(API.comments(postId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return showToast("Gửi thất bại", "red");
  document.getElementById("commentInput").value = "";
  document.getElementById("commentParentId").value = "";
  document.getElementById("commentParentHint").textContent = "";
  nextUrl = buildListUrl(API.comments(postId), 15);
  document.getElementById("commentsList").replaceChildren();
  await loadMore(true);
  showToast("Đã gửi bình luận");
}
