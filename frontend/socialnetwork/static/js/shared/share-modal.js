import { authFetch } from "../authenticate/auth.js";
import { API, parseApiError } from "./config.js";
import { showToast } from "./toast.js";

let sharePostId = null;

export function initShareModal() {
  document.getElementById("closeShareModal")?.addEventListener("click", () => {
    document.getElementById("shareModal")?.classList.add("hidden");
  });
  document.getElementById("confirmShareBtn")?.addEventListener("click", submitShare);
}

export function openShareModal(postId) {
  sharePostId = postId;
  document.getElementById("shareContent").value = "";
  document.getElementById("sharePrivacy").value = "public";
  document.getElementById("shareModal")?.classList.remove("hidden");
}

async function submitShare() {
  if (!sharePostId) return;
  const content = document.getElementById("shareContent").value.trim();
  const privacy = document.getElementById("sharePrivacy").value;
  try {
    const res = await authFetch(API.postShares(sharePostId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, privacy }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(parseApiError(errData, res.status));
    }
    showToast("Đã chia sẻ bài viết");
    document.getElementById("shareModal")?.classList.add("hidden");
    window.dispatchEvent(new CustomEvent("post-shared"));
  } catch {
    showToast("Chia sẻ thất bại", "red");
  }
}

