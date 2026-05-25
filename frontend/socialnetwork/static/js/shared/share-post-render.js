import { authFetch } from "../authenticate/auth.js";
import { API, DEFAULT_AVATAR, profileUrl } from "./config.js";
import { showToast } from "./toast.js";
import { confirmDialog } from "./confirm.js";
import { formatDate, fullName } from "./ui.js";
import { openCommentsModal } from "./comments-panel.js";

/**
 * Facebook-style shared-post card (feed shares tab + profile shares tab).
 */
export function renderShareCard(share, currentProfileId) {
  const post = share.post || {};
  const isOwner =
    currentProfileId != null && Number(share.user?.id) === Number(currentProfileId);

  const article = document.createElement("article");
  article.className =
    "bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4 border dark:border-gray-700";

  const header = document.createElement("div");
  header.className = "flex items-center gap-3 mb-2";
  const av = document.createElement("img");
  av.src = share.user?.picture || DEFAULT_AVATAR;
  av.className = "w-10 h-10 rounded-full object-cover";
  const meta = document.createElement("div");
  const nameLink = document.createElement("a");
  nameLink.href = profileUrl(share.user?.id);
  nameLink.className = "font-semibold text-sm hover:underline text-fb-primary";
  nameLink.textContent = fullName(share.user);
  const time = document.createElement("p");
  time.className = "text-xs text-gray-500";
  time.textContent = formatDate(share.created_at);
  meta.append(nameLink, time);
  header.append(av, meta);

  if (share.content) {
    const note = document.createElement("p");
    note.className = "text-sm text-gray-800 dark:text-gray-200 mb-3 whitespace-pre-wrap";
    note.textContent = share.content;
    article.appendChild(note);
  }

  const embed = document.createElement("div");
  embed.className =
    "border dark:border-gray-600 rounded-lg p-3 bg-fb-bg dark:bg-gray-900 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition";
  embed.onclick = () => {
    if (post.post_id) openCommentsModal(post.post_id, post.user?.id);
  };
  const embedTitle = document.createElement("p");
  embedTitle.className = "font-medium text-sm text-gray-900 dark:text-gray-100 line-clamp-3";
  embedTitle.textContent = post.title || "Bài viết gốc";
  embed.appendChild(embedTitle);
  if (post.photos?.[0]) {
    const img = document.createElement("img");
    img.src = post.photos[0].photo;
    img.className = "mt-2 rounded-lg max-h-56 w-full object-cover";
    img.alt = "";
    embed.appendChild(img);
  }
  article.append(header, embed);

  const actions = document.createElement("div");
  actions.className = "flex flex-wrap gap-2 mt-3 pt-3 border-t dark:border-gray-700 items-center";

  if (isOwner) {
    const privacy = document.createElement("select");
    privacy.className =
      "text-xs border dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700";
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
    del.className = "text-sm text-red-600 font-semibold hover:underline ml-auto";
    del.textContent = "Xóa chia sẻ";
    del.onclick = async () => {
      if (!(await confirmDialog("Xóa bài chia sẻ này?"))) return;
      const res = await authFetch(API.shareDelete(share.id), { method: "DELETE" });
      if (res.ok) {
        article.remove();
        showToast("Đã xóa");
      } else showToast("Xóa thất bại", "red");
    };
    actions.appendChild(del);
  }

  article.appendChild(actions);
  return article;
}
