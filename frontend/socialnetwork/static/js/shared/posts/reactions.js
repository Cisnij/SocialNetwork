import { authFetch } from "../../authenticate/auth.js";
import { API } from "../config.js";
import { reactToPost } from "./api.js";

export async function reactToComment(commentId, reactionType) {
  const res = await authFetch(API.commentReact(commentId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reaction_type: reactionType }),
  });
  if (!res.ok) throw new Error("React failed");
  return res.json();
}

export const REACTIONS = [
  { type: "like", icon: "👍", label: "Thích" },
  { type: "love", icon: "❤️", label: "Yêu thích" },
  { type: "haha", icon: "😂", label: "Haha" },
  { type: "wow", icon: "😮", label: "Wow" },
  { type: "sad", icon: "😢", label: "Buồn" },
  { type: "angry", icon: "😡", label: "Phẫn nộ" },
];

export function getTotalReactions(reactions) {
  if (!Array.isArray(reactions)) return 0;
  return reactions.reduce((sum, r) => sum + (r.total || 0), 0);
}

export function updateReactionButton(reactBtn, type) {
  reactBtn.replaceChildren();
  reactBtn.classList.remove("font-bold", "text-indigo-600");

  if (!type) {
    reactBtn.dataset.reaction = "";
    const icon = document.createElement("span");
    icon.textContent = "👍";
    const text = document.createElement("span");
    text.textContent = "Thích";
    reactBtn.append(icon, text);
    return;
  }

  const r = REACTIONS.find((x) => x.type === type) || REACTIONS[0];
  const icon = document.createElement("span");
  icon.textContent = r.icon;
  const text = document.createElement("span");
  text.textContent = r.label;
  reactBtn.append(icon, text);
  reactBtn.dataset.reaction = r.type;
  reactBtn.classList.add("font-bold", "text-indigo-600");
}

/**
 * @param {object} ctx - { targetId, reactFn, reactBtn, wrapper, reactionCount, entity, onApplied? }
 */
export function createReactionBar(ctx) {
  const { targetId, reactFn, reactBtn, wrapper } = ctx;
  const bar = document.createElement("div");
  bar.className =
    "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white dark:bg-[#242526] shadow-lg rounded-full px-2 py-1 flex gap-2 z-50 hidden border border-gray-200 dark:border-[#3e4042]";

  let hideTimeout;

  REACTIONS.forEach((r) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = r.label;
    btn.className =
      "text-xl leading-none p-1 rounded-full hover:scale-125 transition-transform outline-none";
    btn.textContent = r.icon;

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      bar.classList.add("hidden");
      try {
        const res = await reactFn(targetId, r.type);
        if (res) applyReactionResponse(ctx, res, r.type);
      } catch (err) {
        console.error("[reaction]", err);
      }
    });

    bar.appendChild(btn);
  });

  wrapper.addEventListener("mouseenter", () => {
    clearTimeout(hideTimeout);
    bar.classList.remove("hidden");
  });
  wrapper.addEventListener("mouseleave", () => {
    hideTimeout = setTimeout(() => bar.classList.add("hidden"), 80);
  });

  return bar;
}

export function applyReactionResponse(
  { reactBtn, reactionCount, entity, onApplied },
  res,
  fallbackType = ""
) {
  const activeType =
    res.status === "removed"
      ? ""
      : res.reaction_type || fallbackType || "";

  updateReactionButton(reactBtn, activeType);

  if (Array.isArray(res.count)) {
    const total = getTotalReactions(res.count);
    if (reactionCount) {
      reactionCount.textContent = total > 0 ? `${total} lượt thích` : "";
      reactionCount.classList.toggle("hidden", total === 0);
    }
    entity.reactions = res.count;
  }

  entity.user_is_reaction = activeType;
  reactBtn.dataset.reaction = activeType;
  onApplied?.(res);
}
