import { fetchPostPage } from "./api.js";
import { postListCache } from "./cache.js";
import { renderPostCard } from "./render.js";
import {
  initPostModals,
  openPhotoModal,
  openReactionsModal,
  requestDeletePost,
} from "./modals.js";

function showSpinner(container) {
  const wrapper = document.createElement("div");
  wrapper.className =
    "post-list-spinner text-center py-6 flex flex-col items-center";
  wrapper.setAttribute("role", "status");

  const spinner = document.createElement("div");
  spinner.className =
    "animate-spin h-7 w-7 border-4 border-indigo-500 border-t-transparent rounded-full";

  const text = document.createElement("p");
  text.className = "text-gray-500 dark:text-[#b0b3b8] mt-2 text-sm";
  text.textContent = "Đang tải bài viết...";

  wrapper.append(spinner, text);
  container.appendChild(wrapper);
  return wrapper;
}

function showError(container, message, onRetry) {
  const box = document.createElement("div");
  box.className =
    "text-center py-8 px-4 bg-white dark:bg-[#242526] rounded-xl shadow text-red-600 dark:text-red-400 text-sm";
  box.textContent = message;
  if (onRetry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "mt-3 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700";
    btn.textContent = "Thử lại";
    btn.addEventListener("click", onRetry);
    box.appendChild(btn);
  }
  container.appendChild(box);
}

function showEmpty(container) {
  const empty = document.createElement("p");
  empty.className =
    "text-center py-12 text-gray-500 dark:text-[#b0b3b8] bg-white dark:bg-[#242526] rounded-xl shadow text-sm";
  empty.textContent = "Chưa có bài viết nào.";
  container.appendChild(empty);
}

/**
 * Production-style infinite post list (cache + dedupe + abort + IO).
 */
export class PostInfiniteLoader {
  /**
   * @param {object} config
   * @param {HTMLElement} config.container
   * @param {string} config.cacheKey - e.g. 'feed' or 'userpage:42'
   * @param {string} config.initialUrl
   * @param {() => Promise<number|null>} [config.getCurrentUserId]
   */
  constructor(config) {
    this.container = config.container;
    this.cacheKey = config.cacheKey;
    this.initialUrl = config.initialUrl;
    this.getCurrentUserId = config.getCurrentUserId || (async () => null);

    this.nextUrl = config.initialUrl;
    this.isLoading = false;
    this.abortController = null;
    this.currentUserId = null;
    this.observer = null;
    this.sentinel = null;
    this._boundScrollFallback = null;
  }

  async init() {
    initPostModals({ cacheKey: this.cacheKey });
    const { initCommentsPanel } = await import("../comments-panel.js");
    const { initShareModal } = await import("../share-modal.js");
    initCommentsPanel();
    initShareModal();
    try {
      this.currentUserId = await this.getCurrentUserId();
    } catch {
      this.currentUserId = null;
    }
    this.setupInfiniteScroll();
    await this.load(true);
    this.listenNewPosts();
  }

  listenNewPosts() {
    document.addEventListener("newPostCreated", (e) => {
      const post = e.detail;
      if (!post) return;
      postListCache.prepend(this.cacheKey, post);
      const card = this._renderOne(post);
      const spinner = this.container.querySelector(".post-list-spinner");
      const first = this.container.querySelector(".post-card");
      if (first) first.before(card);
      else if (spinner) spinner.before(card);
      else this.container.prepend(card);
    });
  }

  setupInfiniteScroll() {
    this.sentinel = document.createElement("div");
    this.sentinel.className = "h-1 post-list-sentinel";
    this.sentinel.setAttribute("aria-hidden", "true");

    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) this.load(false);
      },
      { root: null, rootMargin: "200px", threshold: 0 }
    );

    this._boundScrollFallback = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 300
      ) {
        this.load(false);
      }
    };
  }

  _attachSentinel() {
    if (!this.sentinel.parentNode) {
      this.container.appendChild(this.sentinel);
    }
    this.observer?.observe(this.sentinel);
    window.addEventListener("scroll", this._boundScrollFallback, {
      passive: true,
    });
  }

  _detachSentinel() {
    this.observer?.unobserve(this.sentinel);
    window.removeEventListener("scroll", this._boundScrollFallback);
  }

  _renderOne(post) {
    return renderPostCard(post, {
      currentUserId: this.currentUserId,
      isUserPage: this.cacheKey.startsWith("userpage:"),
      onDelete: (id) => requestDeletePost(id, this.cacheKey),
      onOpenReactions: openReactionsModal,
      onOpenPhotos: openPhotoModal,
    });
  }

  _renderFromCache(store) {
    this.container.replaceChildren();
    if (!store.posts.length) {
      showEmpty(this.container);
      return;
    }
    const fragment = document.createDocumentFragment();
    store.posts.forEach((p) => fragment.appendChild(this._renderOne(p)));
    this.container.appendChild(fragment);
    this.nextUrl = store.nextUrl;
    this._attachSentinel();
  }

  async load(initial = false) {
    if (!this.container) return;
    if (!this.nextUrl && !initial) return;
    if (this.isLoading) return;

    if (initial && postListCache.isFresh(this.cacheKey)) {
      const store = postListCache.get(this.cacheKey);
      this._renderFromCache(store);
      return;
    }

    if (initial) {
      this.nextUrl = this.initialUrl;
      this.container.replaceChildren();
      postListCache.invalidate(this.cacheKey);
    }

    if (!this.nextUrl) return;

    this.isLoading = true;
    this.abortController?.abort();
    this.abortController = new AbortController();

    const spinner = showSpinner(this.container);
    this._detachSentinel();

    try {
      const data = await fetchPostPage(
        this.nextUrl,
        this.abortController.signal
      );
      spinner.remove();

      const posts = data.results || [];
      this.nextUrl = data.next || null;

      if (initial && posts.length === 0) {
        showEmpty(this.container);
        postListCache.set(this.cacheKey, { posts: [], nextUrl: null });
        return;
      }

      if (initial) {
        postListCache.set(this.cacheKey, {
          posts,
          nextUrl: this.nextUrl,
        });
      } else {
        postListCache.append(this.cacheKey, posts, this.nextUrl);
      }

      const fragment = document.createDocumentFragment();
      posts.forEach((p) => fragment.appendChild(this._renderOne(p)));
      this.container.appendChild(fragment);

      if (!this.nextUrl) {
        this.sentinel?.remove();
        this._detachSentinel();
      } else {
        this._attachSentinel();
      }
    } catch (err) {
      spinner.remove();
      if (err.name === "AbortError") return;
      console.error("Post list error:", err);
      if (initial) {
        showError(this.container, "⚠️ Không tải được bài viết.", () =>
          this.load(true)
        );
      }
    } finally {
      this.isLoading = false;
    }
  }

  destroy() {
    this.abortController?.abort();
    this._detachSentinel();
    this.observer?.disconnect();
  }

  /** Reset list (e.g. tab switch) — uses cache when fresh. */
  async refresh() {
    await this.load(true);
  }
}
