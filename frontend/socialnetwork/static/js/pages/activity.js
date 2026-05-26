import { API, buildListUrl } from "../shared/config.js";
import { showEmpty } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";

const list = document.getElementById("activityList");
let nextUrl = buildListUrl(API.activity(), 25);
let loading = false;

async function load(reset = false) {
  if (!list || loading) return;
  if (reset) {
    nextUrl = buildListUrl(API.activity(), 25);
    list.replaceChildren();
  }
  if (!nextUrl) return;

  loading = true;
  const moreBtn = document.getElementById("loadMoreActivityBtn");
  if (moreBtn) moreBtn.disabled = true;

  try {
    const data = await fetchPage(nextUrl);
    (data.results || []).forEach((a) => {
      const row = document.createElement("div");
      row.className =
        "py-3 border-b dark:border-fb-divider text-sm text-gray-700 dark:text-fb-muted";
      row.innerHTML = `<span class="font-semibold text-gray-900 dark:text-fb-text">${a.actor || "Bạn"}</span> ${a.verb}`;
      const time = document.createElement("p");
      time.className = "text-xs text-gray-400 mt-0.5";
      time.textContent = new Date(a.timestamp).toLocaleString("vi-VN");
      row.appendChild(time);
      list.appendChild(row);
    });
    nextUrl = data.next;
    if (moreBtn) moreBtn.classList.toggle("hidden", !nextUrl);
    if (!list.childElementCount && !nextUrl) showEmpty(list, "Chưa có hoạt động.");
  } catch {
    if (reset) showEmpty(list, "Không tải hoạt động.");
  } finally {
    loading = false;
    if (moreBtn) moreBtn.disabled = false;
  }
}

document.getElementById("loadMoreActivityBtn")?.addEventListener("click", () =>
  load(false)
);

load(true);
