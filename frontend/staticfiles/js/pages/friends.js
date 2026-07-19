import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl, withPageSize } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { btn, createUserRow, showEmpty, showSpinner } from "../shared/ui.js";
import { createPaginatedLoader } from "../shared/paginated-list.js";
import { profileUrl } from "../shared/config.js";

const tabs = document.querySelectorAll("[data-friends-tab]");
const panels = {
  list: document.getElementById("friendsListPanel"),
  incoming: document.getElementById("incomingPanel"),
  outgoing: document.getElementById("outgoingPanel"),
  suggest: document.getElementById("suggestPanel"),
};

tabs.forEach((t) => {
  t.addEventListener("click", (e) => {
    e.preventDefault();
    tabs.forEach((x) =>
      x.classList.remove("border-indigo-600", "text-indigo-600", "font-medium")
    );
    t.classList.add("border-indigo-600", "text-indigo-600", "font-medium");
    Object.values(panels).forEach((p) => p?.classList.add("hidden"));
    panels[t.dataset.friendsTab]?.classList.remove("hidden");
    loadTab(t.dataset.friendsTab);
  });
});

async function loadTab(tab) {
  if (tab === "list") loadFriends();
  if (tab === "incoming") loadIncoming();
  if (tab === "outgoing") loadOutgoing();
  if (tab === "suggest") loadSuggest();
}

async function loadFriends() {
  const el = panels.list;
  el.replaceChildren();
  const spin = showSpinner(el);
  try {
    const res = await authFetch(withPageSize(API.friends(), 30));
    const data = await res.json();
    spin.remove();
    const items = data.results || [];
    if (!items.length) return showEmpty(el, "Chưa có bạn bè.");
    items.forEach((f) => {
      const profile = f.user;
      const actions = btn("Xem", "px-3 py-1 text-sm rounded-lg bg-slate-100");
      actions.onclick = () => {
        window.location.href = profileUrl(profile.id);
      };
      el.appendChild(
        createUserRow(profile, { subtitle: "Bạn bè", actions })
      );
    });
  } catch {
    spin.remove();
    showEmpty(el, "Không tải được danh sách.");
  }
}

async function loadIncoming() {
  const el = panels.incoming;
  el.replaceChildren();
  const spin = showSpinner(el);
  try {
    const res = await authFetch(API.incomingRequests());
    const data = await res.json();
    spin.remove();
    const items = data.results || [];
    if (!items.length) return showEmpty(el, "Không có lời mời mới.");
    items.forEach((req) => {
      const profile = req.sender;
      const actions = document.createElement("div");
      actions.className = "flex gap-2";
      const accept = btn("Chấp nhận");
      accept.onclick = async () => {
        await authFetch(API.acceptRequest(req.id), { method: "PUT" });
        showToast("Đã chấp nhận");
        loadIncoming();
      };
      const reject = btn("Từ chối", "px-3 py-1 text-sm rounded-lg bg-gray-200");
      reject.onclick = async () => {
        await authFetch(API.rejectRequest(req.id), { method: "PUT" });
        showToast("Đã từ chối");
        loadIncoming();
      };
      actions.append(accept, reject);
      el.appendChild(createUserRow(profile, { actions }));
    });
  } catch {
    spin.remove();
  }
}

async function loadOutgoing() {
  const el = panels.outgoing;
  el.replaceChildren();
  const spin = showSpinner(el);
  try {
    const res = await authFetch(API.outgoingRequests());
    const data = await res.json();
    spin.remove();
    const items = data.results || [];
    if (!items.length) return showEmpty(el, "Chưa gửi lời mời nào.");
    items.forEach((req) => {
      const profile = req.receiver;
      const cancel = btn("Hủy", "px-3 py-1 text-sm rounded-lg bg-gray-200");
      cancel.onclick = async () => {
        await authFetch(API.cancelRequest(req.id), { method: "DELETE" });
        showToast("Đã hủy");
        loadOutgoing();
      };
      el.appendChild(createUserRow(profile, { actions: cancel }));
    });
  } catch {
    spin.remove();
  }
}

async function loadSuggest() {
  const el = panels.suggest;
  el.replaceChildren();
  const spin = showSpinner(el);
  try {
    const res = await authFetch(buildListUrl(API.friendSuggest(), 20));
    const data = await res.json();
    spin.remove();
    const items = data.results || [];
    if (!items.length) return showEmpty(el, "Chưa có gợi ý.");
    items.forEach((s) => {
      const profile = {
        id: s.id,
        first_name: s.full_name,
        picture: s.picture,
      };
      const add = btn("Kết bạn");
      add.onclick = async () => {
        const r = await authFetch(API.friendRequest(profile.id), {
          method: "POST",
        });
        if (r.ok) showToast("Đã gửi lời mời");
        else showToast("Không gửi được", "red");
      };
      el.appendChild(
        createUserRow(profile, {
          subtitle: s.mutual_count
            ? `${s.mutual_count} bạn chung`
            : "Gợi ý kết bạn",
          actions: add,
        })
      );
    });
  } catch {
    spin.remove();
  }
}

loadTab("list");
