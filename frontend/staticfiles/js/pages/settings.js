import { authFetch } from "../authenticate/auth.js";
import { API, buildListUrl, withPageSize } from "../shared/config.js";
import { showToast } from "../shared/toast.js";
import { confirmDialog, passwordPrompt } from "../shared/confirm.js";
import { saveDarkMode, isDarkMode, bootstrapTheme, parseDarkmode, updateCurrentSetting } from "../shared/theme.js";
import { createUserRow, showEmpty, btn } from "../shared/ui.js";
import {
  invalidateUserProfileCache,
  applyProfileToNavbar,
} from "../app/profile.js";
import { fetchPage } from "../shared/paginated-list.js";

let profileId = null;
let darkToggleBusy = false;
let setting = null;
let hasPassword = true;

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
  setting = await bootstrapTheme();
  await loadHasPassword();
  const uRes = await authFetch(API.user());
  if (!uRes.ok) {
    showToast("Không tải hồ sơ", "red");
    return;
  }
  profileId = (await uRes.json()).id;

  await loadProfileForm();
  await loadEmails();
  await loadBlocked();
  await loadFollowLists();
  setupProfileSave();
  setupDarkToggle();
  setupEmailAdd();
  setupDeleteAccount();
  loadActivity(true);
  setupDefaultPostPrivacy();

  // Inject private profile UI
  setupPrivateProfileUI();
}

function setupDefaultPostPrivacy() {
  const selectEl = document.getElementById("defaultPostPrivacySelect");
  if (!selectEl || !setting) return;

  // Load initial value
  if (setting.default_post_privacy) {
    selectEl.value = setting.default_post_privacy;
  }

  // Setup change listener
  selectEl.addEventListener("change", async (e) => {
    const oldValue = setting.default_post_privacy;
    try {
      const patchRes = await authFetch(API.setting(setting.id), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_post_privacy: e.target.value }),
      });

      if (!patchRes.ok) throw new Error("Failed to save setting");
      
      // Update local setting variable and global state
      setting = await patchRes.json();
      updateCurrentSetting(setting);
      showToast("Đã lưu cài đặt riêng tư mặc định", "green");
    } catch (err) {
      console.error("Save default post privacy error:", err);
      // Revert to old value if failed
      if (oldValue) {
        selectEl.value = oldValue;
      }
      showToast("Không thể lưu cài đặt", "red");
    }
  });
}

async function loadProfileForm() {
  const res = await authFetch(API.user());
  const p = await res.json();
  document.getElementById("setFirstName").value = p.first_name || "";
  document.getElementById("setLastName").value = p.last_name || "";
  document.getElementById("setBio").value = p.bio || "";
  const preview = document.getElementById("setAvatarPreview");
  if (preview && p.picture) preview.src = p.picture;
}

async function loadHasPassword() {
  hasPassword = true;
  try {
    const res = await authFetch(API.hasPassword());
    if (!res.ok) return;
    const data = await res.json();
    hasPassword = !!data.has_password;
  } catch (_) {
    hasPassword = true;
  } finally {
    const passwordLink = document.getElementById("settingsChangePasswordLink");
    if (passwordLink) passwordLink.classList.toggle("hidden", !hasPassword);
  }
}

function setupProfileSave() {
  document.getElementById("setAvatar")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    const preview = document.getElementById("setAvatarPreview");
    if (file && preview) preview.src = URL.createObjectURL(file);
  });

  document.getElementById("saveProfileBtn")?.addEventListener("click", async () => {
    if (!profileId) {
      showToast("Chưa tải được ID hồ sơ", "red");
      return;
    }
    const btn = document.getElementById("saveProfileBtn");
    btn.disabled = true;

    const form = new FormData();
    form.append("first_name", document.getElementById("setFirstName").value);
    form.append("last_name", document.getElementById("setLastName").value);
    form.append("bio", document.getElementById("setBio").value);
    const pic = document.getElementById("setAvatar")?.files?.[0];
    if (pic) form.append("picture", pic);

    try {
      const res = await authFetch(API.profile(profileId), {
        method: "PATCH",
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg =
          err.picture?.[0] ||
          err.phone_number?.[0] ||
          err.detail ||
          (typeof err === "object" ? JSON.stringify(err) : String(err));
        showToast(msg || `Lỗi lưu (${res.status})`, "red");
        return;
      }

      const updated = await res.json();
      invalidateUserProfileCache();
      applyProfileToNavbar(updated);

      const fresh = await authFetch(API.user());
      if (fresh.ok) {
        const user = await fresh.json();
        applyProfileToNavbar(user);
        const preview = document.getElementById("setAvatarPreview");
        if (preview && user.picture) preview.src = user.picture;
      } else if (updated.picture) {
        const preview = document.getElementById("setAvatarPreview");
        if (preview) preview.src = updated.picture;
      }

      document.getElementById("setAvatar").value = "";
      showToast("Đã lưu hồ sơ", "green");
    } catch (e) {
      console.error("save profile", e);
      showToast("Lỗi mạng khi lưu hồ sơ", "red");
    } finally {
      btn.disabled = false;
    }
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
        const primary = btn("Đặt làm chính", "text-xs px-2 py-1 rounded bg-fb-primary dark:bg-[#1877f2] text-white");
        primary.onclick = async () => {
          // Task 4: Trigger OTP immediately, then show modal to enter it
          const triggerRes = await authFetch(API.setPrimaryEmail(e.id), { method: "POST" });
          if (!triggerRes.ok) {
            const err = await triggerRes.json().catch(() => ({}));
            showToast(err.error || err.detail || "Không thể gửi OTP", "red");
            return;
          }
          showToast("Mã OTP đã gửi về email hiện tại", "green");
          showOtpModal(e.id, e.email);
        };
        actions.appendChild(primary);
      }
      if (!e.primary) {
        const del = btn("Xóa", "text-xs px-2 py-1 rounded bg-red-100 text-red-600");
        del.onclick = async () => {
          const pw = await promptPasswordWithForgot("Nhập mật khẩu để xóa email");
          if (hasPassword && !pw) return;
          // Task 6: verify password before proceeding
          if (hasPassword && pw) {
            const checkRes = await authFetch(API.checkPassword(), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: pw }),
            });
            if (!checkRes.ok) {
              showToast("Mật khẩu không đúng", "red");
              return;
            }
          }
          if (!(await confirmDialog("Xóa email này?"))) return;
          const r = await authFetch(API.deleteEmail(e.id), {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(hasPassword ? { password: pw } : {}),
          });
          if (r.ok) {
            showToast("Đã xóa email", "green");
            loadEmails();
          } else {
            const err = await r.json().catch(() => ({}));
            showToast(err.error || err.detail || "Xóa thất bại", "red");
          }
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

    let password = null;
    if (hasPassword) {
      password = await promptPasswordWithForgot(
        "Nhập mật khẩu để xác nhận thêm email"
      );
      if (!password) return;
      const checkRes = await authFetch(API.checkPassword(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!checkRes.ok) {
        // Show forgot password CTA like login
        await promptPasswordWithForgot("Mật khẩu không đúng");
        return;
      }
    }

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
      p.textContent = `Bạn ${a.verb}${a.target ? ` ${a.target}` : ""} · ${new Date(a.timestamp).toLocaleString("vi-VN")}`;
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
        "mt-3 w-full py-2 text-sm font-semibold text-fb-primary dark:text-[#1877f2] hover:bg-fb-secondary dark:hover:bg-[#3a3b3c] rounded-lg";
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


function setupDeleteAccount() {
  document.getElementById("deleteAccountBtn")?.addEventListener("click", async () => {
    // Bước 1: Gửi OTP xóa tài khoản
    const res = await authFetch(API.deleteAccount(), { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.detail || "Không thể gửi OTP", "red");
      return;
    }
    showToast("Mã OTP đã gửi về email của bạn", "green");

    // Bước 2: Hiển thị modal OTP + mật khẩu
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4";
    modal.id = "deleteAccountOtpModal";
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-bold dark:text-white">Xóa tài khoản</h2>
          <button type="button" class="text-2xl text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white" onclick="document.getElementById('deleteAccountOtpModal')?.remove()">&times;</button>
        </div>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Nhập mã OTP đã gửi về email để xác nhận xóa tài khoản của bạn.</p>
        <input type="text" id="deleteOtpInput" placeholder="Mã OTP 6 số" maxlength="6" class="w-full p-3 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white mb-3">
        <input type="password" id="deletePasswordInput" placeholder="${hasPassword ? 'Mật khẩu' : 'Không cần mật khẩu'}" class="w-full p-3 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white mb-4" ${hasPassword ? '' : 'disabled'}>
        <button id="confirmDeleteBtn" type="button" class="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold">
          Xác nhận xóa tài khoản
        </button>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("confirmDeleteBtn")?.addEventListener("click", async () => {
      const otp = document.getElementById("deleteOtpInput")?.value.trim();
      if (!otp || otp.length !== 6) {
        showToast("Vui lòng nhập mã OTP 6 số", "red");
        return;
      }
      const body = { otp };
      if (hasPassword) {
        const password = document.getElementById("deletePasswordInput")?.value;
        if (!password) { showToast("Vui lòng nhập mật khẩu", "red"); return; }
        body.password = password;
      }
      if (!(await confirmDialog("Bạn có CHẮC CHẮN muốn xóa tài khoản? Hành động này KHÔNG THỂ hoàn tác!"))) return;

      const confirmRes = await authFetch(API.confirmDeleteAccount(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (confirmRes.ok) {
        showToast("Đã xóa tài khoản!", "green");
        setTimeout(() => {
          localStorage.removeItem("accessToken");
          window.location.href = "/login/";
        }, 2000);
      } else {
        const err = await confirmRes.json().catch(() => ({}));
        showToast(err.error || "OTP sai hoặc mật khẩu không đúng", "red");
      }
    });
  });
}

// OTP Modal cho set primary email
function showOtpModal(emailId, email) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4";
  modal.id = "otpModal";

  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-bold dark:text-white">Xác nhận đổi email chính</h2>
        <button type="button" class="text-2xl text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white" onclick="document.getElementById('otpModal')?.remove()">&times;</button>
      </div>
      <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Mã OTP đã được gửi đến email hiện tại: <strong>${email}</strong>
      </p>
      <input type="text" id="otpInput" placeholder="Nhập mã OTP 6 số" maxlength="6" class="w-full p-3 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-700 dark:text-white mb-4">
      <div class="flex justify-between items-center mb-4">
        <button type="button" id="resendOtpBtn" class="text-fb-primary dark:text-[#1877f2] text-sm font-medium" disabled>Gửi lại mã (1:30)</button>
        <button type="button" id="confirmOtpBtn" class="px-4 py-2 bg-fb-primary dark:bg-[#1877f2] text-white rounded-lg font-medium">Xác nhận</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let countdown = 90; // 1:30 = 90 giây
  const resendBtn = modal.querySelector("#resendOtpBtn");
  const confirmBtn = modal.querySelector("#confirmOtpBtn");
  const otpInput = modal.querySelector("#otpInput");

  const countdownInterval = setInterval(() => {
    countdown--;
    const minutes = Math.floor(countdown / 60);
    const seconds = countdown % 60;
    resendBtn.textContent = `Gửi lại mã (${minutes}:${seconds.toString().padStart(2, '0')})`;
    if (countdown <= 0) {
      clearInterval(countdownInterval);
      resendBtn.textContent = "Gửi lại mã";
      resendBtn.disabled = false;
    }
  }, 1000);

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true;
    countdown = 90;
    clearInterval(countdownInterval);
    const newInterval = setInterval(() => {
      countdown--;
      const minutes = Math.floor(countdown / 60);
      const seconds = countdown % 60;
      resendBtn.textContent = `Gửi lại mã (${minutes}:${seconds.toString().padStart(2, '0')})`;
      if (countdown <= 0) {
        clearInterval(newInterval);
        resendBtn.textContent = "Gửi lại mã";
        resendBtn.disabled = false;
      }
    }, 1000);

    // Task 4: resend = trigger OTP again
    try {
      const res = await authFetch(API.setPrimaryEmail(emailId), { method: "POST" });
      if (res.ok) {
        showToast("Đã gửi lại mã OTP", "green");
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || err.detail || "Không thể gửi lại mã", "red");
        resendBtn.disabled = false;
      }
    } catch (err) {
      showToast("Lỗi mạng", "red");
      resendBtn.disabled = false;
    }
  });

  confirmBtn.addEventListener("click", async () => {
    const otp = otpInput.value.trim();
    if (!otp || otp.length !== 6) {
      showToast("Vui lòng nhập mã OTP 6 số", "red");
      return;
    }

    try {
      const res = await authFetch(API.confirmPrimaryEmailOtp(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ otp: otp }),
      });

      if (res.ok) {
        showToast("Đã đổi email chính thành công", "green");
        modal.remove();
        loadEmails();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.error || "OTP không hợp lệ hoặc đã hết hạn", "red");
      }
    } catch (err) {
      showToast("Lỗi mạng", "red");
    }
  });
}

// Task 3: Show password prompt with inline "Quên mật khẩu?" link
async function promptPasswordWithForgot(title = "Xác nhận mật khẩu") {
  if (!hasPassword) return "";
  // Use the enhanced passwordPrompt with forgotPasswordUrl option
  const pw = await passwordPrompt(title, "Xác nhận mật khẩu", {
    forgotPasswordUrl: "/forgot-password/",
  });
  return pw || null;
}

// Inject private profile UI
function setupPrivateProfileUI() {
  const panelProfile = document.getElementById("panel-profile");
  if (!panelProfile || document.getElementById("privateProfileSection")) return;

  const privateSection = document.createElement("div");
  privateSection.id = "privateProfileSection";
  privateSection.className = "border-t dark:border-fb-divider mt-6 pt-6 space-y-4";

  privateSection.innerHTML = `
    <h3 class="font-bold text-lg dark:text-[#e4e6eb]">Thông tin riêng tư</h3>
    <div>
      <label class="block text-sm font-medium text-gray-600 dark:text-fb-muted mb-1">Số điện thoại</label>
      <input id="privatePhone" type="tel" class="w-full p-3 rounded-lg bg-fb-secondary dark:bg-[#3a3b3c] dark:text-[#e4e6eb]" placeholder="+8490xxxxxxxxx">
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-600 dark:text-fb-muted mb-1">Ngày sinh</label>
      <input id="privateBirthday" type="date" class="w-full p-3 rounded-lg bg-fb-secondary dark:bg-[#3a3b3c] dark:text-[#e4e6eb]">
    </div>
    <div class="flex items-center gap-2">
      <input id="phonePublic" type="checkbox" class="w-4 h-4 rounded border-gray-300">
      <label for="phonePublic" class="text-sm text-gray-600 dark:text-fb-muted">Cho người khác thấy số điện thoại</label>
    </div>
    <div class="flex items-center gap-2">
      <input id="birthdayPublic" type="checkbox" class="w-4 h-4 rounded border-gray-300">
      <label for="birthdayPublic" class="text-sm text-gray-600 dark:text-fb-muted">Cho người khác thấy ngày sinh</label>
    </div>
    <button id="savePrivateBtn" type="button" class="px-4 py-2.5 bg-fb-primary dark:bg-[#1877f2] text-white rounded-lg font-semibold hover:bg-fb-primary-hover dark:hover:bg-[#166fe5]">Lưu thông tin riêng tư</button>
  `;

  panelProfile.appendChild(privateSection);
  loadPrivateProfile();
  document.getElementById("savePrivateBtn")?.addEventListener("click", savePrivateProfile);
}

async function loadPrivateProfile() {
  try {
    const res = await authFetch(API.privateProfile(profileId));
    if (!res.ok) return;
    const data = await res.json();
    if (data.phone_number) document.getElementById("privatePhone").value = data.phone_number;
    if (data.date_of_birth) document.getElementById("privateBirthday").value = data.date_of_birth;
    if (data.phone_number_public) document.getElementById("phonePublic").checked = true;
    if (data.date_of_birth_public) document.getElementById("birthdayPublic").checked = true;
  } catch (err) {
    console.error("Load private profile error:", err);
  }
}

async function savePrivateProfile() {
  try {
    const phone = document.getElementById("privatePhone").value.trim();
    const birthday = document.getElementById("privateBirthday").value;
    const phonePublic = document.getElementById("phonePublic").checked;
    const birthdayPublic = document.getElementById("birthdayPublic").checked;

    const res = await authFetch(API.privateProfile(profileId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone_number: phone,
        date_of_birth: birthday,
        phone_number_public: phonePublic,
        date_of_birth_public: birthdayPublic,
      }),
    });

    if (res.ok) {
      showToast("Đã lưu thông tin riêng tư", "green");
      invalidateUserProfileCache();
      await loadProfileForm();
    } else {
      const err = await res.json().catch(() => ({}));
      showToast(err.detail || "Không thể lưu", "red");
    }
  } catch (err) {
    console.error("Save private profile error:", err);
    showToast("Lỗi mạng", "red");
  }
}
