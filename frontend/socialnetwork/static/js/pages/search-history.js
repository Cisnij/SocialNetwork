import { API, withPageSize } from "../shared/config.js";
import { el, textEl } from "../shared/dom.js";
import { showToast } from "../shared/toast.js";
import { showEmpty } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";
import { authFetch } from "../authenticate/auth.js";

const list = document.getElementById("searchHistoryList");
const emptyState = document.getElementById("emptyState");

let nextUrl = withPageSize(API.searchHistory(), 25);
let loading = false;

function formatTime(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const diffMins = Math.floor((now - date) / 60000);
  if (diffMins < 1) return "Vừa xong";
  if (diffMins < 60) return `${diffMins} phút trước`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} ngày trước`;
  return date.toLocaleDateString("vi-VN");
}

function renderRow(item) {
  const row = el(
    "div",
    "w-full flex items-center justify-between p-4 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] transition"
  );

  const left = el("div", "flex items-center gap-3 min-w-0 flex-1 cursor-pointer");
  left.appendChild(textEl("span", "text-xl shrink-0", "🔍"));
  left.appendChild(
    textEl("span", "dark:text-[#e4e6eb] truncate", item.content || "")
  );
  left.addEventListener("click", () => {
    const q = (item.content || "").trim();
    if (q) window.location.href = `/search/?q=${encodeURIComponent(q)}`;
  });

  const right = el("div", "flex items-center gap-2");
  right.appendChild(
    textEl(
      "span",
      "text-xs text-gray-500 dark:text-fb-muted shrink-0",
      formatTime(item.created_at)
    )
  );

  const deleteBtn = el("button", "text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20", { type: "button" });
  deleteBtn.textContent = "×";
  deleteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const res = await authFetch(API.searchHistoryDelete(item.id), { method: "DELETE" });
      if (res.ok) {
        row.remove();
        showToast("Đã xóa lịch sử tìm kiếm", "green");
        if (list.children.length === 0) {
          emptyState?.classList.remove("hidden");
        }
      } else {
        showToast("Không thể xóa", "red");
      }
    } catch (err) {
      console.error("Delete search history error:", err);
      showToast("Lỗi mạng", "red");
    }
  });

  right.appendChild(deleteBtn);
  row.append(left, right);

  return row;
}

async function load(reset = false) {
  if (!list || loading) return;
  if (reset) {
    nextUrl = withPageSize(API.searchHistory(), 25);
    list.replaceChildren();
  }
  if (!nextUrl) return;

  loading = true;
  try {
    const data = await fetchPage(nextUrl);
    const items = data.results || [];
    if (reset && !items.length) {
      emptyState?.classList.remove("hidden");
      return;
    }
    emptyState?.classList.add("hidden");
    items.forEach((item) => list.appendChild(renderRow(item)));
    nextUrl = data.next;
    const moreBtn = document.getElementById("loadMoreHistoryBtn");
    if (moreBtn) moreBtn.classList.toggle("hidden", !nextUrl);
  } catch (err) {
    console.error("[search-history]", err);
    if (reset) showEmpty(list, "Không tải được lịch sử.");
    showToast("Không tải lịch sử tìm kiếm", "red");
  } finally {
    loading = false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const clearAllBtn = document.getElementById("clearAllBtn");
  if (clearAllBtn) {
    clearAllBtn.hidden = false;
    clearAllBtn.addEventListener("click", async () => {
      try {
        const res = await authFetch(API.searchHistoryDeleteAll(), { method: "DELETE" });
        if (res.ok) {
          showToast("Đã xóa tất cả lịch sử tìm kiếm", "green");
          load(true);
        } else {
          showToast("Không thể xóa tất cả", "red");
        }
      } catch (err) {
        console.error("Delete all search history error:", err);
        showToast("Lỗi mạng", "red");
      }
    });
  }

  const moreBtn = document.getElementById("loadMoreHistoryBtn");
  moreBtn?.addEventListener("click", () => load(false));

  load(true);
});

