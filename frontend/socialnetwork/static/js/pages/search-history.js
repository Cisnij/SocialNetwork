import { API, withPageSize } from "../shared/config.js";
import { el, textEl } from "../shared/dom.js";
import { showToast } from "../shared/toast.js";
import { showEmpty } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";

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
    "button",
    "w-full flex items-center justify-between p-4 hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] transition text-left",
    { type: "button" }
  );

  const left = el("div", "flex items-center gap-3 min-w-0");
  left.appendChild(textEl("span", "text-xl shrink-0", "🔍"));
  left.appendChild(
    textEl("span", "dark:text-[#e4e6eb] truncate", item.content || "")
  );
  row.append(left);
  row.appendChild(
    textEl(
      "span",
      "text-xs text-gray-500 dark:text-fb-muted shrink-0 ml-2",
      formatTime(item.created_at)
    )
  );

  row.addEventListener("click", () => {
    const q = (item.content || "").trim();
    if (q) window.location.href = `/search/?q=${encodeURIComponent(q)}`;
  });

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
  if (clearAllBtn) clearAllBtn.hidden = true;

  const moreBtn = document.getElementById("loadMoreHistoryBtn");
  moreBtn?.addEventListener("click", () => load(false));

  load(true);
});
