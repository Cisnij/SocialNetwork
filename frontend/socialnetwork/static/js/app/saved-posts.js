import { POST_ENDPOINTS, buildListUrl, POST_PAGE_SIZE } from "../shared/config.js";
import { getCurrentUserId } from "./profile.js";
import { renderPostCard } from "../shared/posts/render.js";
import { authFetch } from "../authenticate/auth.js";
import { initCommentsPanel } from "../shared/comments-panel.js";
import { initShareModal } from "../shared/share-modal.js";
import { initPostModals } from "../shared/posts/modals.js";

let myProfileId = null;

async function init() {
  initCommentsPanel();
  initShareModal();
  initPostModals();
  try {
    myProfileId = await getCurrentUserId();
  } catch (err) {
    console.error("Failed to get user id", err);
  }
  setupPagination();
}

function setupPagination() {
  const container = document.getElementById("saved-post-container");
  const sentinel = document.getElementById("saved-sentinel");
  const loading = document.getElementById("loadingIndicator");
  const endMessage = document.getElementById("endMessage");

  let nextUrl = buildListUrl(POST_ENDPOINTS.savedPosts(), POST_PAGE_SIZE.feed);
  let isFetching = false;

  async function loadMore() {
    if (isFetching || !nextUrl) return;
    isFetching = true;
    loading.classList.remove("hidden");
    
    try {
      const res = await authFetch(nextUrl);
      if (!res.ok) throw new Error("Fetch failed");
      const data = await res.json();
      
      const posts = data.results || [];
      if (posts.length === 0 && !data.next && container.children.length === 0) {
        container.innerHTML = '<div class="text-center p-8 text-gray-500 glass-card rounded-xl">Bạn chưa lưu bài viết nào.</div>';
      } else {
        posts.forEach(post => {
          const card = renderPostCard(post, {
            currentUserId: myProfileId,
            showShare: true
          });
          container.appendChild(card);
        });
      }
      
      nextUrl = data.next;
      if (!nextUrl && posts.length > 0) {
        endMessage.classList.remove("hidden");
        sentinel.style.display = "none";
      }
    } catch (err) {
      console.error("[saved] load error", err);
    } finally {
      loading.classList.add("hidden");
      isFetching = false;
    }
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMore();
  }, { rootMargin: "200px" });

  observer.observe(sentinel);
}

document.addEventListener("DOMContentLoaded", init);
