import { authFetch } from "../authenticate/auth.js";
import { API } from "./config.js";
import { showToast } from "../shared/toast.js";
import { confirmDialog } from "./confirm.js";

function rememberBlockedProfileId(profileId) {
  const ids = JSON.parse(localStorage.getItem("blockedProfileIds") || "[]");
  if (!ids.includes(Number(profileId))) ids.push(Number(profileId));
  localStorage.setItem("blockedProfileIds", JSON.stringify(ids));
}

function btnFb(label, primary = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.className = primary
    ? "px-4 py-2 rounded-lg bg-fb-primary hover:bg-fb-primary-hover text-white dark:text-[#e4e6eb] text-sm font-semibold"
    : "px-4 py-2 rounded-lg bg-fb-secondary dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-900 dark:text-[#e4e6eb] text-sm font-semibold";
  return b;
}

export async function mountRelationshipBar(container, profileId) {
  if (!container || !profileId) return;
  const { getCurrentUserId } = await import("../app/profile.js");
  const myId = await getCurrentUserId().catch(() => null);
  if (Number(myId) === Number(profileId)) return;

  container.replaceChildren();
  const bar = document.createElement("div");
  bar.className = "flex flex-wrap gap-2 justify-center mt-4";
  container.appendChild(bar);

  try {
    const res = await authFetch(API.relationship(profileId));
    const { status } = await res.json();
    renderActions(bar, profileId, status);
  } catch {
    bar.innerHTML = "";
  }
}

function renderActions(bar, profileId, status) {
  bar.replaceChildren();

  const refresh = async () => {
    const r = await authFetch(API.relationship(profileId));
    const { status: s } = await r.json();
    renderActions(bar, profileId, s);
  };

  const act = async (url, msg, method = "POST") => {
    const res = await authFetch(url, { method });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      showToast(e.error || e.detail || "Thất bại", "red");
      return false;
    }
    if (msg) showToast(msg);
    await refresh();
    return true;
  };

  const block = async () => {
    if (!(await confirmDialog("Chặn người này?"))) return;
    if (await act(API.block(profileId), "Đã chặn")) rememberBlockedProfileId(profileId);
  };

  const message = () => {
    window.location.href = `/chat/?user=${profileId}`;
  };

  switch (status) {
    case "friend": {
      const unfriend = btnFb("Hủy kết bạn");
      unfriend.onclick = async () => {
        if (await confirmDialog("Hủy kết bạn?"))
          act(API.unfriend(profileId), "Đã hủy kết bạn", "DELETE");
      };
      const msgBtn = btnFb("Nhắn tin", true);
      msgBtn.onclick = message;
      const b = btnFb("Chặn");
      b.onclick = block;
      bar.append(unfriend, msgBtn, b);
      break;
    }
    case "request_sent": {
      const cancel = btnFb("Hủy lời mời");
      cancel.onclick = () => cancelOutgoing(profileId, refresh);
      const msgBtn = btnFb("Nhắn tin", true);
      msgBtn.onclick = message;
      const follow = btnFb("Theo dõi");
      follow.onclick = () => act(API.follow(profileId), "Đã theo dõi");
      const b = btnFb("Chặn");
      b.onclick = block;
      bar.append(cancel, msgBtn, follow, b);
      break;
    }
    case "request_received": {
      const accept = btnFb("Chấp nhận", true);
      accept.onclick = () => acceptIncoming(profileId, refresh);
      const reject = btnFb("Từ chối");
      reject.onclick = () => rejectIncoming(profileId, refresh);
      const b = btnFb("Chặn");
      b.onclick = block;
      bar.append(accept, reject, b);
      break;
    }
    case "following": {
      const unfollow = btnFb("Bỏ theo dõi", true);
      unfollow.onclick = () => act(API.unfollow(profileId), "Đã bỏ theo dõi", "DELETE");
      const msgBtn = btnFb("Nhắn tin");
      msgBtn.onclick = message;
      bar.append(unfollow, msgBtn);
      break;
    }
    case "blocked": {
      const un = btnFb("Bỏ chặn", true);
      un.onclick = () => act(API.unblock(profileId), "Đã bỏ chặn", "DELETE");
      bar.append(un);
      break;
    }
    default: {
      const add = btnFb("Kết bạn", true);
      add.onclick = () => act(API.friendRequest(profileId), "Đã gửi lời mời");
      const follow = btnFb("Theo dõi");
      follow.onclick = () => act(API.follow(profileId), "Đã theo dõi");
      const msg = btnFb("Nhắn tin");
      msg.onclick = message;
      const b = btnFb("Chặn");
      b.onclick = block;
      bar.append(add, follow, msg, b);
    }
  }
}

async function acceptIncoming(profileId, refresh) {
  const res = await authFetch(API.incomingRequests());
  const req = (await res.json()).results?.find((r) => r.sender?.id === profileId);
  if (!req) return showToast("Không tìm thấy lời mời", "red");
  const r = await authFetch(API.acceptRequest(req.id), { method: "PUT" });
  if (r.ok) {
    showToast("Đã chấp nhận");
    refresh();
  }
}

async function rejectIncoming(profileId, refresh) {
  const res = await authFetch(API.incomingRequests());
  const req = (await res.json()).results?.find((r) => r.sender?.id === profileId);
  if (!req) return;
  await authFetch(API.rejectRequest(req.id), { method: "PUT" });
  refresh();
}

async function cancelOutgoing(profileId, refresh) {
  const res = await authFetch(API.outgoingRequests());
  const req = (await res.json()).results?.find((r) => r.receiver?.id === profileId);
  if (!req) return showToast("Không tìm thấy lời mời", "red");
  await authFetch(API.cancelRequest(req.id), { method: "DELETE" });
  showToast("Đã hủy lời mời");
  refresh();
}

