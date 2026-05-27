import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";
import { createUserRow, btn, showEmpty } from "../shared/ui.js";
import { showToast } from "../shared/toast.js";

const tabs = document.querySelectorAll("[data-home-tab]");
const panels = {
  feed: document.getElementById("homeTabFeed"),
  incoming: document.getElementById("homeTabIncoming"),
  outgoing: document.getElementById("homeTabOutgoing"),
};

tabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    tabs.forEach((t) => {
      t.classList.remove("border-fb-primary", "text-fb-primary", "border-b-2");
      t.classList.add("text-gray-500");
    });
    tab.classList.add("border-fb-primary", "text-fb-primary", "border-b-2");
    tab.classList.remove("text-gray-500");
    Object.values(panels).forEach((p) => p?.classList.add("hidden"));
    const key = tab.dataset.homeTab;
    if (key === "feed") panels.feed?.classList.remove("hidden");
    else panels[key]?.classList.remove("hidden");
    if (key === "incoming") loadIncoming();
    if (key === "outgoing") loadOutgoing();
  });
});

async function loadIncoming() {
  const el = panels.incoming;
  el.replaceChildren();
  try {
    const res = await authFetch(API.incomingRequests());
    const data = await res.json();
    const items = data.results || [];
    if (!items.length) return showEmpty(el, "Không có lời mời.");
    items.forEach((req) => {
      const actions = document.createElement("div");
      actions.className = "flex gap-2 flex-wrap";
      const accept = btn("Chấp nhận", "px-3 py-1.5 text-sm rounded-lg bg-fb-primary dark:bg-[#1877f2] text-white");
      accept.onclick = async () => {
        await authFetch(API.acceptRequest(req.id), { method: "PUT" });
        showToast("Đã chấp nhận");
        loadIncoming();
      };
      const reject = btn("Từ chối", "px-3 py-1.5 text-sm rounded-lg bg-fb-secondary dark:bg-[#4e4f50] dark:text-[#e4e6eb]");
      reject.onclick = async () => {
        await authFetch(API.rejectRequest(req.id), { method: "PUT" });
        loadIncoming();
      };
      actions.append(accept, reject);
      el.appendChild(createUserRow(req.sender, { actions }));
    });
  } catch {
    showEmpty(el, "Lỗi tải dữ liệu.");
  }
}

async function loadOutgoing() {
  const el = panels.outgoing;
  el.replaceChildren();
  try {
    const res = await authFetch(API.outgoingRequests());
    const data = await res.json();
    const items = data.results || [];
    if (!items.length) return showEmpty(el, "Chưa gửi lời mời.");
    items.forEach((req) => {
      const cancel = btn("Hủy lời mời", "px-3 py-1.5 text-sm rounded-lg bg-fb-secondary dark:bg-[#4e4f50] dark:text-[#e4e6eb]");
      cancel.onclick = async () => {
        await authFetch(API.cancelRequest(req.id), { method: "DELETE" });
        showToast("Đã hủy");
        loadOutgoing();
      };
      el.appendChild(createUserRow(req.receiver, { actions: cancel }));
    });
  } catch {
    showEmpty(el, "Lỗi tải dữ liệu.");
  }
}
