import { authFetch } from "../../authenticate/auth.js";
import { POST_ENDPOINTS } from "../config.js";

/**
 * Fetch a paginated post list page.
 * @param {string} url - Full URL (including page query from `next`)
 * @param {AbortSignal} [signal]
 */
export async function fetchPostPage(url, signal) {
  const res = await authFetch(url, { method: "GET", signal });
  if (!res.ok) {
    const err = new Error(`Cannot fetch posts (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function reactToPost(postId, reactionType) {
  const res = await authFetch(POST_ENDPOINTS.react(postId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reaction_type: reactionType }),
  });
  if (!res.ok) throw new Error("React failed");
  return res.json();
}

export async function fetchReactionsPage(url, signal) {
  const res = await authFetch(url, { method: "GET", signal });
  if (!res.ok) throw new Error("Cannot fetch reactions");
  return res.json();
}

export async function deletePostById(postId) {
  return authFetch(POST_ENDPOINTS.post(postId), { method: "DELETE" });
}

