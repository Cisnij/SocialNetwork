import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";
import { renderPostCard } from "../shared/posts/render.js";
import { getCurrentUserId } from "../app/profile.js";
import { createUserRow, showEmpty, showSpinner } from "../shared/ui.js";
import {
  initPostModals,
  openPhotoModal,
  openReactionsModal,
  requestDeletePost,
} from "../shared/posts/modals.js";
import { initCommentsPanel } from "../shared/comments-panel.js";
import { initShareModal } from "../shared/share-modal.js";

const form = document.getElementById("searchForm");
const input = document.getElementById("searchQuery");
const typeSelect = document.getElementById("searchType");
const results = document.getElementById("searchResults");
const historyEl = document.getElementById("searchHistory");

initPostModals();
initCommentsPanel();
initShareModal();

let currentUserId = null;
getCurrentUserId().then((id) => (currentUserId = id)).catch(() => {});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  results.replaceChildren();
  const spin = showSpinner(results);
  try {
    const res = await authFetch(API.search(q, typeSelect?.value || "all"));
    const data = await res.json();
    spin.remove();
    renderResults(data);
    await authFetch(API.searchHistory(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: q }),
    }).catch(() => {});
  } catch {
    spin.remove();
    showEmpty(results, "Tìm kiếm thất bại.");
  }
});

function renderResults(data) {
  const posts = data.posts || [];
  const profiles = data.profiles || [];
  if (!posts.length && !profiles.length) {
    showEmpty(results, "Không có kết quả.");
    return;
  }
  if (profiles.length) {
    const h = document.createElement("h2");
    h.className = "text-lg font-bold mb-3 text-gray-800";
    h.textContent = "Mọi người";
    results.appendChild(h);
    profiles.forEach((p) => {
      results.appendChild(createUserRow(p));
    });
  }
  if (posts.length) {
    const h = document.createElement("h2");
    h.className = "text-lg font-bold mb-3 mt-6 text-gray-800";
    h.textContent = "Bài viết";
    results.appendChild(h);
    posts.forEach((post) => {
      results.appendChild(
        renderPostCard(post, {
          currentUserId,
          onDelete: (id) => requestDeletePost(id),
          onOpenReactions: openReactionsModal,
          onOpenPhotos: openPhotoModal,
        })
      );
    });
  }
}

async function loadHistory() {
  if (!historyEl) return;
  try {
    const res = await authFetch(API.searchHistory());
    const data = await res.json();
    historyEl.replaceChildren();
    (data.results || []).slice(0, 10).forEach((h) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className =
        "px-3 py-1 bg-white rounded-full text-sm shadow hover:bg-indigo-50";
      chip.textContent = h.content;
      chip.onclick = () => {
        input.value = h.content;
        form.requestSubmit();
      };
      historyEl.appendChild(chip);
    });
  } catch {
    /* ignore */
  }
}

loadHistory();

if (input?.value.trim()) {
  form?.requestSubmit();
}
