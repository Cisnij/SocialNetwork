import { authFetch } from "../authenticate/auth.js";
import { API, groupUrl, DEFAULT_AVATAR } from "../shared/config.js";
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
  const groups = data.groups || [];
  if (!posts.length && !profiles.length && !groups.length) {
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
  if (groups.length) {
    const h = document.createElement("h2");
    h.className = "text-lg font-bold mb-3 mt-6 text-gray-800 dark:text-gray-200";
    h.textContent = "Nhóm";
    results.appendChild(h);
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
    groups.forEach((g) => {
      const avatar = g.avatar || DEFAULT_AVATAR;
      const memberCount = g.member_count || 0;
      const card = document.createElement("div");
      card.innerHTML = `
        <a href="${groupUrl(g.id)}" class="glass-card rounded-2xl overflow-hidden card-hover block group border border-white/50 dark:border-white/5 bg-white dark:bg-gray-800">
          <div class="h-32 bg-gray-200 dark:bg-gray-700 w-full relative overflow-hidden">
            <img src="${avatar}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.src='${DEFAULT_AVATAR}'">
            <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>
          </div>
          <div class="p-5 relative -mt-6">
            <div class="w-16 h-16 rounded-xl border-4 border-white dark:border-gray-800 shadow-md bg-white overflow-hidden mb-3">
              <img src="${avatar}" class="w-full h-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
            </div>
            <h4 class="font-black text-gray-900 dark:text-white truncate text-lg">${g.name}</h4>
            <div class="flex items-center gap-2 mt-2 flex-wrap">
              <p class="text-sm text-gray-500 dark:text-gray-400 font-semibold"><i class="fas fa-users mr-1"></i> ${memberCount} thành viên</p>
              ${g.is_company ? '<span class="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs px-2.5 py-1 rounded-full font-bold ml-2 border border-blue-200 dark:border-blue-800/50 flex items-center gap-1"><i class="fas fa-building text-[10px]"></i> Công ty</span>' : ''}
            </div>
            <div class="mt-4 pt-4 border-t dark:border-gray-700 flex justify-between items-center text-sm font-semibold text-gray-500 dark:text-gray-400 group-hover:text-fb-primary transition-colors">
              <span>Truy cập nhóm</span>
              <i class="fas fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity group-hover:translate-x-1"></i>
            </div>
          </div>
        </a>
      `;
      grid.appendChild(card);
    });
    results.appendChild(grid);
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
        "px-3 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-full text-sm shadow hover:bg-indigo-50";
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
