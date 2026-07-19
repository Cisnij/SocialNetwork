import { authFetch } from "../authenticate/auth.js";
import { API, withPageSize } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { createUserRow, showEmpty, btn } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";

const list = document.getElementById("blockedUsersList");

async function load() {
  if (!list) return;
  list.replaceChildren();
  try {
    const res = await authFetch(withPageSize(API.blockedByMe(), 50));
    if (!res.ok) throw new Error("blocked");
    const data = await res.json();
    const items = data.results || [];
    if (!items.length) return showEmpty(list, "Chưa chặn ai.");
    items.forEach((profile) => {
      const un = btn("Bỏ chặn", "text-xs text-fb-primary font-semibold");
      un.onclick = async () => {
        const res = await authFetch(API.unblock(profile.id), { method: "DELETE" });
        showToast(res.ok ? "Đã bỏ chặn" : "Lỗi", res.ok ? "green" : "red");
        if (res.ok) load();
      };
      list.appendChild(createUserRow(profile, { actions: un }));
    });
  } catch {
    showEmpty(list, "Không tải được danh sách.");
  }
}

load();
