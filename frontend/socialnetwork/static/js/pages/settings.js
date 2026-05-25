import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { confirmDialog } from "../shared/confirm.js";
import { saveDarkMode, getSettingId, bootstrapTheme, isDarkMode } from "../shared/theme.js";
import { createUserRow, showEmpty, btn } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";
import { profileUrl } from "../shared/config.js";

let profileId = null;

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
  await bootstrapTheme();
  const u = await authFetch(API.user());
  profileId = (await u.json()).id;

  await loadProfileForm();
  await loadEmails();
  await loadBlocked();
  await loadFollowLists();
  await loadActivity();
  setupProfileSave();
  setupDarkToggle();
  setupEmailAdd();
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
  toggle.checked = isDarkMode();
  toggle.addEventListener("change", async () => {
    await saveDarkMode(toggle.checked);
    showToast(toggle.checked ? "Chế độ tối bật" : "Chế độ sáng bật");
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
        "flex flex-wrap items-center justify-between gap-2 py-3 border-b dark:border-gray-700";
      const info = document.createElement("div");
      info.innerHTML = `<p class="font-medium">${e.email}</p><p class="text-xs text-gray-500">${e.primary ? "Email chính" : ""} ${e.verified ? "✓ Đã xác minh" : "⏳ Chưa xác minh"}</p>`;
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
    } else showToast(data.error || "Thêm thất bại", "red");
  });
}

async function loadBlocked() {
  const el = document.getElementById("blockedList");
  el.replaceChildren();
  const stored = JSON.parse(localStorage.getItem("blockedProfileIds") || "[]");
  if (stored.length) {
    for (const pid of stored) {
      try {
        const pr = await authFetch(API.profileUserpage(pid));
        const user = await pr.json();
        const un = btn("Bỏ chặn", "text-xs text-fb-primary");
        un.onclick = async () => {
          await authFetch(API.unblock(pid), { method: "DELETE" });
          const arr = stored.filter((x) => x !== pid);
          localStorage.setItem("blockedProfileIds", JSON.stringify(arr));
          loadBlocked();
        };
        el.appendChild(createUserRow(user, { actions: un }));
      } catch (_) {}
    }
    return;
  }
  showEmpty(el, "Chưa chặn ai (hoặc chặn từ trang cá nhân).");
}

async function loadFollowLists() {
  const [f1, f2] = await Promise.all([
    authFetch(API.followers()),
    authFetch(API.following()),
  ]);
  renderUsers(document.getElementById("followersList"), (await f1.json()).results);
  renderUsers(document.getElementById("followingList"), (await f2.json()).results);
}

function renderUsers(container, users) {
  container.replaceChildren();
  if (!users?.length) return showEmpty(container, "Trống.");
  users.forEach((u) => {
    const p = document.createElement("p");
    p.className = "text-sm py-1.5 border-b dark:border-gray-700";
    p.textContent = `${u.first_name || ""} ${u.last_name || ""}`.trim() || u.username;
    container.appendChild(p);
  });
}

async function loadActivity() {
  const el = document.getElementById("activityList");
  el.replaceChildren();
  let url = `${API.activity()}?page_size=25`;
  try {
    while (url) {
      const data = await fetchPage(url);
      (data.results || []).forEach((a) => {
        const p = document.createElement("p");
        p.className = "text-sm py-2 border-b dark:border-gray-700 text-gray-600 dark:text-gray-400";
        p.textContent = `${a.actor} ${a.verb} · ${new Date(a.timestamp).toLocaleString("vi-VN")}`;
        el.appendChild(p);
      });
      url = data.next;
    }
  } catch {
    showEmpty(el, "Không tải hoạt động.");
  }
}

init();
