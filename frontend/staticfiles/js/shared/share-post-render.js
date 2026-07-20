import { authFetch } from "../authenticate/auth.js";
import { API, DEFAULT_AVATAR, profileUrl } from "./config.js";
import { showToast } from "./toast.js";
import { confirmDialog } from "./confirm.js";
import { formatRelativeTime, fullName, cls } from "./ui.js";
import { openCommentsModal } from "./comments-panel.js";

/**
 * Facebook-style share card: sharer on top → optional note → embedded original post.
 */
export function renderShareCard(share, currentProfileId) {
  const post = share.post || {};
  const originalUser = post.user || {};
  const sharer = share.user || {};
  const isOwner =
    currentProfileId != null && Number(sharer.id) === Number(currentProfileId);

  const article = document.createElement("article");
  article.className = `${cls.cardBorder} rounded-xl shadow-sm mb-4 overflow-hidden`;

  // --- Sharer header (top) ---
  const header = document.createElement("div");
  header.className = "flex items-start gap-3 p-4 pb-2";
  const sharerAv = document.createElement("img");
  sharerAv.src = sharer.picture || DEFAULT_AVATAR;
  sharerAv.className = "w-10 h-10 rounded-full object-cover shrink-0";
  const sharerMeta = document.createElement("div");
  const sharerName = document.createElement("a");
  sharerName.href = profileUrl(sharer.id);
  sharerName.className = "font-semibold text-[15px] hover:underline text-gray-900 dark:text-fb-text";
  sharerName.textContent = fullName(sharer);
  const sharerSub = document.createElement("p");
  sharerSub.className = "text-xs text-gray-500 dark:text-fb-muted";
  sharerSub.textContent = `${formatRelativeTime(share.created_at)} · đã chia sẻ một bài viết`;
  sharerSub.title = new Date(share.created_at).toLocaleString("vi-VN");
  sharerMeta.append(sharerName, sharerSub);
  header.append(sharerAv, sharerMeta);

  const body = document.createElement("div");
  body.className = "px-4 pb-4";

  if (share.content) {
    const note = document.createElement("p");
    note.className =
      "text-[15px] text-gray-900 dark:text-fb-text mb-3 whitespace-pre-wrap leading-snug";
    note.textContent = share.content;
    body.appendChild(note);
  }

  // --- Embedded original post (gray box) ---
  const embed = document.createElement("div");
  embed.className =
    "border border-gray-300 dark:border-fb-divider rounded-lg overflow-hidden bg-fb-bg dark:bg-[#3a3b3c] cursor-pointer hover:opacity-95 transition";

  const embedHeader = document.createElement("div");
  embedHeader.className = "flex items-center gap-2 p-3 pb-2";
  const origAv = document.createElement("img");
  origAv.src = originalUser.picture || DEFAULT_AVATAR;
  origAv.className = "w-8 h-8 rounded-full object-cover";
  const origName = document.createElement("a");
  origName.href = profileUrl(originalUser.id);
  origName.className = "font-semibold text-sm text-fb-primary hover:underline";
  origName.textContent = fullName(originalUser);
  origName.onclick = (e) => e.stopPropagation();
  embedHeader.append(origAv, origName);

  const embedBody = document.createElement("div");
  embedBody.className = "px-3 pb-3";
  const embedTitle = document.createElement("p");
  embedTitle.className =
    "text-sm text-gray-900 dark:text-fb-text whitespace-pre-wrap line-clamp-6";
  embedTitle.textContent = post.title || "";
  embedBody.appendChild(embedTitle);

  if (post.photos?.[0]) {
    const img = document.createElement("img");
    img.src = post.photos[0].photo;
    img.className = "w-full max-h-80 object-cover mt-2 border-t dark:border-fb-divider";
    img.alt = "";
    embedBody.appendChild(img);
  }

  embed.append(embedHeader, embedBody);
  embed.onclick = () => {
    if (post.post_id) openCommentsModal(post.post_id, originalUser.id);
  };
  body.appendChild(embed);

  const actions = document.createElement("div");
  actions.className =
    "flex flex-wrap gap-2 mt-3 pt-3 border-t dark:border-fb-divider items-center px-4 pb-4";

  if (isOwner) {
    const privacy = document.createElement("select");
    privacy.className =
      "text-xs border dark:border-fb-divider rounded-lg px-2 py-1 bg-white dark:bg-[#3a3b3c] text-gray-800 dark:text-[#e4e6eb]";
    ["public", "friends", "private"].forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent =
        p === "public" ? "Công khai" : p === "friends" ? "Bạn bè" : "Riêng tư";
      if ((share.privacy || "public") === p) opt.selected = true;
      privacy.appendChild(opt);
    });
    privacy.addEventListener("change", async () => {
      const res = await authFetch(API.sharePrivacy(share.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ privacy_type: privacy.value }),
      });
      if (res.ok) showToast("Đã cập nhật quyền xem");
      else showToast("Cập nhật thất bại", "red");
    });
    actions.appendChild(privacy);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "text-sm text-red-500 font-semibold hover:underline ml-auto";
    del.textContent = "Xóa chia sẻ";
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!(await confirmDialog("Xóa bài chia sẻ này?"))) return;
      const res = await authFetch(API.shareDelete(share.id), { method: "DELETE" });
      if (res.ok) {
        article.remove();
        showToast("Đã xóa");
      } else showToast("Xóa thất bại", "red");
    };
    actions.appendChild(del);
  }

  article.append(header, body);
  if (isOwner) article.appendChild(actions);
  return article;
}

