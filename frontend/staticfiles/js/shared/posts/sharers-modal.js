import { authFetch } from "../../authenticate/auth.js";
import { API, buildListUrl } from "../config.js";
import { createUserRow } from "../ui.js";
import { fetchPage } from "../paginated-list.js";

export async function openSharersModal(postId) {
  const modal = document.getElementById("sharersModal");
  const list = document.getElementById("sharersList");
  if (!modal || !list) return;
  list.replaceChildren();
  modal.classList.remove("hidden");

  document.getElementById("closeSharersModal")?.addEventListener("click", () => {
    modal.classList.add("hidden");
  }, { once: true });

  let url = buildListUrl(API.postShares(postId), 20);
  while (url) {
    const data = await fetchPage(url);
    (data.results || []).forEach((s) => {
      list.appendChild(
        createUserRow(s.user, { subtitle: s.content || "Đã chia sẻ" })
      );
    });
    url = data.next;
  }
}
