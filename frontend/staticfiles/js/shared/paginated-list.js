import { authFetch } from "../authenticate/auth.js";

/**
 * Generic DRF page loader.
 */
export async function fetchPage(url, signal) {
  const res = await authFetch(url, { method: "GET", signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function createPaginatedLoader({ onPage, pageSize }) {
  let nextUrl = null;
  let loading = false;
  let abort = null;

  return {
    reset(initialUrl) {
      nextUrl = initialUrl;
      loading = false;
      abort?.abort();
    },
    async loadMore(initial = false) {
      if (initial) this.reset(arguments[1] || nextUrl);
      if (!nextUrl || loading) return { done: true, items: [] };
      loading = true;
      abort?.abort();
      abort = new AbortController();
      try {
        const data = await fetchPage(nextUrl, abort.signal);
        const items = data.results ?? (Array.isArray(data) ? data : []);
        nextUrl = data.next || null;
        await onPage(items, { initial });
        return { done: !nextUrl, items };
      } finally {
        loading = false;
      }
    },
    get isLoading() {
      return loading;
    },
    get hasMore() {
      return !!nextUrl;
    },
  };
}
