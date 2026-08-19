import { authFetch } from "../../authenticate/auth.js";
import { API, parseApiError } from "../config.js";
import { reactToPost } from "./api.js";

export async function reactToComment(commentId, reactionType) {
  const res = await authFetch(API.commentReact(commentId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reaction_type: reactionType }),
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(parseApiError(errData, res.status));
  }
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

/**
 * Build a Facebook-style reaction count button:
 * - Shows top (up to 3) reaction emoji icons stacked/overlapping
 * - Followed by the total count number
 * @param {Array} reactions - e.g. [{settings__name: 'like', total: 5}, ...]
 * @returns {DocumentFragment} A fragment with icon spans + count span
 */
export function buildReactionCountContent(reactions) {
  const frag = document.createDocumentFragment();
  if (!Array.isArray(reactions) || !reactions.length) return frag;

  // Sort by total descending, take top 3
  const sorted = [...reactions]
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  if (!sorted.length) return frag;

  // Icons wrapper
  const iconsWrap = document.createElement("span");
  iconsWrap.className = "inline-flex items-center";

  sorted.forEach((r, idx) => {
    const reaction = REACTIONS.find((x) => x.type === r.settings__name);
    if (!reaction) return;
    const span = document.createElement("span");
    // Overlap each icon slightly to the left after the first
    span.className =
      `inline-flex items-center justify-center w-5 h-5 rounded-full text-[13px] leading-none bg-white dark:bg-[#3a3b3c] shadow-sm ring-1 ring-white dark:ring-[#242526]` +
      (idx > 0 ? " -ml-1.5" : "");
    span.title = reaction.label;
    span.textContent = reaction.icon;
    iconsWrap.appendChild(span);
  });

  frag.appendChild(iconsWrap);

  // Total count
  const total = reactions.reduce((s, r) => s + (r.total || 0), 0);
  const countSpan = document.createElement("span");
  countSpan.className = "ml-1.5";
  countSpan.textContent = total;
  frag.appendChild(countSpan);

  return frag;
}

export function updateReactionButton(reactBtn, type, isComment = false) {
  reactBtn.replaceChildren();
  reactBtn.classList.remove("text-indigo-600");
  if (!isComment) reactBtn.classList.remove("font-bold");

  if (!type) {
    reactBtn.dataset.reaction = "";
    const icon = document.createElement("span");
    icon.textContent = "👍";
    reactBtn.append(icon);
    const text = document.createElement("span");
    text.textContent = isComment ? " Thích" : " Thích";
    reactBtn.append(text);
    return;
  }

  const r = REACTIONS.find((x) => x.type === type) || REACTIONS[0];
  const icon = document.createElement("span");
  icon.textContent = r.icon;
  reactBtn.append(icon);
  const text = document.createElement("span");
  text.textContent = ` ${r.label}`;
  reactBtn.append(text);
  reactBtn.dataset.reaction = r.type;
  reactBtn.classList.add("text-indigo-600");
  if (!isComment) reactBtn.classList.add("font-bold");
}

/**
 * @param {object} ctx - { targetId, reactFn, reactBtn, wrapper, reactionCount, entity, onApplied? }
 */
export function createReactionBar(ctx) {
  const { targetId, reactFn, reactBtn, wrapper } = ctx;
  const bar = document.createElement("div");
  const positionClass = ctx.isComment ? "left-0" : "left-1/2 -translate-x-1/2";
  bar.className =
    `absolute bottom-full mb-2 ${positionClass} bg-white dark:bg-[#242526] shadow-lg rounded-full px-2 py-1 flex gap-2 z-50 hidden border border-gray-200 dark:border-[#3e4042]`;

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
  { reactBtn, reactionCount, entity, onApplied, isComment = false },
  res,
  fallbackType = ""
) {
  const activeType =
    res.status === "removed"
      ? ""
      : res.reaction_type || fallbackType || "";

  updateReactionButton(reactBtn, activeType, isComment);

  if (Array.isArray(res.count)) {
    const total = getTotalReactions(res.count);
    if (reactionCount) {
      reactionCount.classList.remove("hidden");
      if (total > 0) {
        // Rebuild the FB-style icons + count
        reactionCount.replaceChildren(buildReactionCountContent(res.count));
      } else {
        reactionCount.replaceChildren();
        reactionCount.classList.add("hidden");
      }
    }
    entity.reactions = res.count;
  }

  entity.user_is_reaction = activeType;
  reactBtn.dataset.reaction = activeType;
  onApplied?.(res);
}

