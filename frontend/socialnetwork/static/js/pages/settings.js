import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl, withPageSize } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { confirmDialog } from "../shared/confirm.js";
import { saveDarkMode, isDarkMode, bootstrapTheme, parseDarkmode } from "../shared/theme.js";
import { createUserRow, showEmpty, btn } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";

let profileId = null;
let darkToggleBusy = false;

document.querySelectorAll("[data-settings-tab]").forEach((tab) => {
  tab.addEventListener("click", (e) => {
    e.preventDefault();
    document.querySelectorAll("[data-settings-tab]").forEach((t) =>
      t.classList.remove("border-fb-primary", "text-fb-primary", "border-b-2")
    );
    tab.classList.add("border-fb-primary", "text-fb-primary", "border-b-2");
    document.querySelectorAll("[data-settings-panel]").forEach((p) =>
      p.classList.add("hidden")
    );
    document
      .getElementById(`panel-${tab.dataset.settingsTab}`)
      ?.classList.remove("hidden");
  });
});

async function init() {
  const setting = await bootstrapTheme();
  const u = await authFetch(API.user());
  profileId = (await u.json()).id;

  await loadProfileForm();
  await loadEmails();
  await loadBlocked();
  await loadFollowLists();
  setupProfileSave();
  setupDarkToggle();
  setupEmailAdd();
  loadActivity(true);
}

async function loadProfileForm() {
  const res = await authFetch(API.user());
  const p = await res.json();
  document.getElementById("setFirstName").value = p.first_name || "";
  document.getElementById("setLastName").value = p.last_name || "";
  document.getElementById("setBio").value = p.bio || "";
  document.getElementById("setPhone").value = p.phone_number || "";
}

function setupProfileSave() {
  document.getElementById("saveProfileBtn")?.addEventListener("click", async () => {
    const form = new FormData();
    form.append("first_name", document.getElementById("setFirstName").value);
    form.append("last_name", document.getElementById("setLastName").value);
    form.append("bio", document.getElementById("setBio").value);
    form.append("phone_number", document.getElementById("setPhone").value);
    const pic = document.getElementById("setAvatar")?.files?.[0];
    if (pic) form.append("picture", pic);
    const res = await authFetch(API.profile(profileId), { method: "PATCH", body: form });
    showToast(res.ok ? "Đã lưu hồ sơ" : "Lỗi lưu", res.ok ? "green" : "red");
  });
}

function setupDarkToggle() {
  const toggle = document.getElementById("darkModeToggle");
  if (!toggle) return;
  toggle.checked = setting
    ? parseDarkmode(setting.darkmode)
    : isDarkMode();
  const iconWrap = document.getElementById("themeIconWrap");
  const syncIcon = () => {
    if (iconWrap) iconWrap.textContent = toggle.checked ? "🌙" : "☀️";
  };
  syncIcon();
  toggle.addEventListener("change", async () => {
    if (darkToggleBusy) return;
    darkToggleBusy = true;
    toggle.disabled = true;
    syncIcon();
    try {
      await saveDarkMode(toggle.checked);
      syncIcon();
      showToast(toggle.checked ? "Chế độ tối đã lưu" : "Chế độ sáng đã lưu");
    } catch (err) {
      console.error("saveDarkMode", err);
      toggle.checked = !toggle.checked;
      syncIcon();
      showToast("Không lưu được cài đặt", "red");
    } finally {
      toggle.disabled = false;
      darkToggleBusy = false;
    }
  });
}

async function loadEmails() {
  const el = document.getElementById("emailList");
  el.replaceChildren();
  try {
    const res = await authFetch(API.emails());
    const data = await res.json();
    const items = data.results || data || [];
    if (!items.length) return showEmpty(el, "Chưa có email.");
    items.forEach((e) => {
      const row = document.createElement("div");
      row.className =
        "flex flex-wrap items-center justify-between gap-2 py-3 border-b dark:border-fb-divider";
      const info = document.createElement("div");
      info.innerHTML = `<p class="font-medium">${e.email}</p><p class="text-xs text-gray-500">${e.primary ? "Email chính · " : ""}${e.verified ? "✓ Đã xác minh" : "⏳ Chưa xác minh — kiểm tra hộp thư"}</p>`;
      const actions = document.createElement("div");
      actions.className = "flex gap-2";
      if (!e.primary && e.verified) {
        const primary = btn("Đặt làm chính", "text-xs px-2 py-1 rounded bg-fb-primary text-white");
        primary.onclick = async () => {
          if (!(await confirmDialog(`Đặt ${e.email} làm email chính?`))) return;
          await authFetch(API.setPrimaryEmail(e.id), { method: "POST" });
          loadEmails();
        };
        actions.appendChild(primary);
      }
      if (!e.primary) {
        const del = btn("Xóa", "text-xs px-2 py-1 rounded bg-red-100 text-red-600");
        del.onclick = async () => {
          const pw = prompt("Nhập mật khẩu để xóa email:");
          if (!pw) return;
          if (!(await confirmDialog("Xóa email này?"))) return;
          const r = await authFetch(API.deleteEmail(e.id), {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw }),
          });
          showToast(r.ok ? "Đã xóa" : "Lỗi", r.ok ? "green" : "red");
          loadEmails();
        };
        actions.appendChild(del);
      }
      row.append(info, actions);
      el.appendChild(row);
    });
  } catch {
    showEmpty(el, "Không tải email.");
  }
}

function setupEmailAdd() {
  document.getElementById("addEmailBtn")?.addEventListener("click", async () => {
    const email = document.getElementById("newEmail").value.trim();
    if (!email) return;
    const res = await authFetch(API.addEmail(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ new_email: email }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      showToast("Đã gửi email xác minh — kiểm tra hộp thư");
      document.getElementById("newEmail").value = "";
      loadEmails();
    } else showToast(data.error || "Thêm thất bại", "red");
  });
}

async function loadBlocked() {
  const el = document.getElementById("blockedList");
  el.replaceChildren();
  try {
    const res = await authFetch(withPageSize(API.blockedByMe(), 50));
    const data = await res.json();
    const items = data.results || [];
    if (!items.length) {
      showEmpty(el, "Chưa chặn ai.");
      return;
    }
    items.forEach((profile) => {
      const un = btn("Bỏ chặn", "text-xs text-fb-primary font-semibold");
      un.onclick = async () => {
        await authFetch(API.unblock(profile.id), { method: "DELETE" });
        showToast("Đã bỏ chặn");
        loadBlocked();
      };
      el.appendChild(createUserRow(profile, { actions: un }));
    });
  } catch {
    showEmpty(el, "Không tải danh sách chặn.");
  }
}

async function loadFollowLists() {
  const [f1, f2] = await Promise.all([
    authFetch(withPageSize(API.followers(), 30)),
    authFetch(withPageSize(API.following(), 30)),
  ]);
  renderUsers(document.getElementById("followersList"), (await f1.json()).results);
  renderUsers(document.getElementById("followingList"), (await f2.json()).results);
}

function renderUsers(container, profiles) {
  container.replaceChildren();
  if (!profiles?.length) return showEmpty(container, "Trống.");
  profiles.forEach((profile) => {
    if (profile?.id) container.appendChild(createUserRow(profile));
  });
}

let activityNext = null;
let activityLoading = false;

async function loadActivity(reset = false) {
  const el = document.getElementById("activityList");
  if (!el || activityLoading) return;
  if (reset) {
    activityNext = buildListUrl(API.activity(), 25);
    el.replaceChildren();
  }
  if (!activityNext) return;

  activityLoading = true;
  const moreBtn = document.getElementById("loadMoreActivity");
  if (moreBtn) moreBtn.disabled = true;

  try {
    const data = await fetchPage(activityNext);
    (data.results || []).forEach((a) => {
      const p = document.createElement("p");
      p.className =
        "text-sm py-2 border-b dark:border-fb-divider text-gray-600 dark:text-fb-muted";
      p.textContent = `${a.actor} ${a.verb} · ${new Date(a.timestamp).toLocaleString("vi-VN")}`;
      el.appendChild(p);
    });
    activityNext = data.next;
    if (moreBtn) {
      moreBtn.classList.toggle("hidden", !activityNext);
    } else if (activityNext) {
      const btn = document.createElement("button");
      btn.id = "loadMoreActivity";
      btn.type = "button";
      btn.className =
        "mt-3 w-full py-2 text-sm font-semibold text-fb-primary hover:bg-fb-secondary dark:hover:bg-fb-hover rounded-lg";
      btn.textContent = "Xem thêm";
      btn.onclick = () => loadActivity(false);
      el.parentElement?.appendChild(btn);
    }
    if (!el.childElementCount && !activityNext) showEmpty(el, "Chưa có hoạt động.");
  } catch {
    if (reset) showEmpty(el, "Không tải hoạt động.");
  } finally {
    activityLoading = false;
    if (moreBtn) moreBtn.disabled = false;
  }
}

init();
