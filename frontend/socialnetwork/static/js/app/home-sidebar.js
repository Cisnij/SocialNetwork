import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl } from "../shared/config.js";
import { profileUrl } from "../shared/config.js";
import { createUserRow, btn } from "../shared/ui.js";
import { showToast } from "../shared/toast.js";

async function init() {
  try {
    const res = await authFetch(API.user());
    const u = await res.json();
    const av = document.getElementById("sidebarAvatar");
    const composerAv = document.getElementById("composerAvatar");
    const name = document.getElementById("sidebarName");
    const link = document.getElementById("sidebarProfile");
    if (av) av.src = u.picture;
    if (composerAv) composerAv.src = u.picture;
    if (name) name.textContent = `${u.first_name || ""} ${u.last_name || ""}`.trim();
    if (link) link.href = profileUrl(u.id);
  } catch (_) {}

  document.getElementById("openPostComposer")?.addEventListener("click", () => {
    document.getElementById("openPostModal")?.click();
  });

  loadIncomingSidebar();
  loadSuggest();
}

async function loadIncomingSidebar() {
  const el = document.getElementById("homeFriendRequests");
  if (!el) return;
  try {
    const res = await authFetch(API.incomingRequests());
    const data = await res.json();
    const items = (data.results || []).slice(0, 5);
    el.replaceChildren();
    if (!items.length) {
      el.innerHTML = '<p class="text-xs text-gray-500">Không có lời mời</p>';
      return;
    }
    items.forEach((req) => {
      const p = req.sender;
      const actions = document.createElement("div");
      actions.className = "flex gap-1";
      const ok = btn("✓", "px-2 py-1 text-xs rounded-lg bg-fb-primary text-white");
      ok.onclick = async () => {
        await authFetch(API.acceptRequest(req.id), { method: "PUT" });
        showToast("Đã chấp nhận");
        loadIncomingSidebar();
      };
      const no = btn("✕", "px-2 py-1 text-xs rounded-lg bg-fb-secondary");
      no.onclick = async () => {
        await authFetch(API.rejectRequest(req.id), { method: "PUT" });
        loadIncomingSidebar();
      };
      actions.append(ok, no);
      el.appendChild(createUserRow(p, { actions }));
    });
  } catch (_) {}
}

async function loadSuggest() {
  const el = document.getElementById("homeFriendSuggest");
  if (!el) return;
  try {
    const res = await authFetch(buildListUrl(API.friendSuggest(), 5));
    const data = await res.json();
    el.replaceChildren();
    (data.results || []).slice(0, 5).forEach((s) => {
      const profile = { id: s.id, first_name: s.full_name, picture: s.picture };
      const add = btn("Thêm", "px-2 py-1 text-xs rounded-lg bg-fb-secondary");
      add.onclick = async () => {
        await authFetch(API.friendRequest(profile.id), { method: "POST" });
        showToast("Đã gửi lời mời");
      };
      el.appendChild(createUserRow(profile, { actions: add }));
    });
  } catch (_) {}
}

init();
