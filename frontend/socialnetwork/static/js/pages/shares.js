import { API, buildListUrl } from "../shared/config.js";
import { showEmpty, showSpinner } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";
import { renderShareCard } from "../shared/share-post-render.js";
import { getCurrentUserId } from "../app/profile.js";
import { initCommentsPanel } from "../shared/comments-panel.js";

const list = document.getElementById("sharesList");
let nextUrl = buildListUrl(API.sharesFeed(), 15);
let loading = false;
let currentProfileId = null;

initCommentsPanel();
getCurrentUserId()
  .then((id) => {
    currentProfileId = id;
  })
  .catch(() => {});

async function load(initial = false) {
  if (!nextUrl || loading) return;
  loading = true;
  if (initial) {
    list.replaceChildren();
    showSpinner(list);
  }
  try {
    const data = await fetchPage(nextUrl);
    if (initial) list.replaceChildren();
    const items = data.results || [];
    if (initial && !items.length) showEmpty(list, "Chưa có bài chia sẻ từ bạn bè.");
    items.forEach((share) => list.appendChild(renderShareCard(share, currentProfileId)));
    nextUrl = data.next;
  } catch {
    if (initial) showEmpty(list, "Không tải được feed chia sẻ.");
  } finally {
    loading = false;
  }
}

window.addEventListener("scroll", () => {
  if (
    window.innerHeight + window.scrollY >=
    document.documentElement.scrollHeight - 200
  ) {
    load(false);
  }
});

load(true);
