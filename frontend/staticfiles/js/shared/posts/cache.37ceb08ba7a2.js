import { POST_LIST_TTL_MS } from "../config.js";

/**
 * In-memory cache per list source (feed, userpage:123).
 * Mimics React Query stale-time + structural sharing for pages.
 */
class PostListCache {
  constructor() {
    /** @type {Map<string, { posts: object[], nextUrl: string|null, updatedAt: number }>} */
    this._stores = new Map();
  }

  get(key) {
    return this._stores.get(key) || null;
  }

  isFresh(key, ttl = POST_LIST_TTL_MS) {
    const store = this.get(key);
    if (!store || store.posts.length === 0) return false;
    return Date.now() - store.updatedAt < ttl;
  }

  set(key, { posts, nextUrl }) {
    this._stores.set(key, {
      posts: [...posts],
      nextUrl: nextUrl ?? null,
      updatedAt: Date.now(),
    });
  }

  append(key, newPosts, nextUrl) {
    const prev = this.get(key);
    const seen = new Set((prev?.posts || []).map((p) => p.post_id));
    const merged = [...(prev?.posts || [])];
    for (const p of newPosts) {
      if (!seen.has(p.post_id)) {
        seen.add(p.post_id);
        merged.push(p);
      }
    }
    this.set(key, { posts: merged, nextUrl });
  }

  invalidate(key) {
    if (key) this._stores.delete(key);
    else this._stores.clear();
  }

  prepend(key, post) {
    const prev = this.get(key);
    const posts = prev ? [post, ...prev.posts.filter((p) => p.post_id !== post.post_id)] : [post];
    this.set(key, { posts, nextUrl: prev?.nextUrl ?? null });
  }

  removePost(key, postId) {
    const prev = this.get(key);
    if (!prev) return;
    this.set(key, {
      posts: prev.posts.filter((p) => p.post_id !== postId),
      nextUrl: prev.nextUrl,
    });
  }
}

export const postListCache = new PostListCache();

