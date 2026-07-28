import { authFetch } from '../authenticate/auth.js';

const API_BASE_URL = "https://api.socialnetwork.dpdns.org";

/**
 * HÀM CỐT LÕI: Đảm bảo chỉ có DUY NHẤT 1 request /api/user/ được gửi lên mạng.
 * Tất cả các hàm khác gọi chung vào đây sẽ dùng chung kết quả của request đó.
 */
function fetchUserProfileShared() {
  // Nếu chưa từng có request nào được tạo, tiến hành tạo request đầu tiên và lưu vào window
  if (!window.currentUserPromise) {
    window.currentUserPromise = authFetch(`${API_BASE_URL}/api/user/`, { method: "GET" })
      .then(res => {
        if (!res.ok) throw new Error("Cannot fetch user info");
        return res.json();
      })
      .then(user => {
        window.currentUserProfile = user; // Lưu dữ liệu cứng phòng hờ
        return user;
      })
      .catch(err => {
        window.currentUserPromise = null; // Nếu lỗi mạng, xóa đi để lần sau có thể bấm tải lại
        throw err;
      });
  }
  // Trả về chung 1 tiến trình đang chạy cho mọi nơi gọi tới
  return window.currentUserPromise;
}

/**
 * Hàm dựng giao diện Navbar
 */
async function init() {
  try {
    // Đợi request chung hoàn thành
    const user = await fetchUserProfileShared();

    const userId = user.id;
    const picture = (user.picture && user.picture.trim() !== "") ? user.picture : "";
    const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();

    const els = {
      dropdownAvatar: document.getElementById("dropdownAvatar"),
      avatarBtn: document.getElementById("avatarBtn"),
      dropdownName: document.getElementById("dropdownName"),
      profileLink: document.getElementById("profileLink")
    };

    if (els.dropdownAvatar) els.dropdownAvatar.src = picture;
    if (els.avatarBtn) els.avatarBtn.src = picture;
    if (els.dropdownName) els.dropdownName.textContent = fullName;
    if (els.profileLink && userId) els.profileLink.href = `/profile/${userId}`;

    // Mobile menu avatar/name sync
    const mobileMenuAvatar = document.getElementById("mobileMenuAvatar");
    const mobileMenuName = document.getElementById("mobileMenuName");
    const mobileMenuProfileLink = document.getElementById("mobileMenuProfileLink");
    if (mobileMenuAvatar) mobileMenuAvatar.src = picture || "https://res.cloudinary.com/dec8t19tm/image/upload/v1781533632/default-avatar_qprrlr.jpg";
    if (mobileMenuName) mobileMenuName.textContent = fullName;
    if (mobileMenuProfileLink && userId) mobileMenuProfileLink.href = `/profile/${userId}`;

    const mobileProfileLink = document.getElementById("mobileProfileLink");
    if (mobileProfileLink && userId) mobileProfileLink.href = `/profile/${userId}`;

  } catch (err) {
    console.error("Lỗi khi khởi tạo thông tin Navbar:", err);
  }
}

// Kích hoạt chạy hàm dựng Navbar khi DOM sẵn sàng
if (document.readyState === "complete" || document.readyState === "interactive") {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init);
}


async function getCurrentUserId() {
  try {
    const user = await fetchUserProfileShared();
    return user.id;
  } catch (err) {
    console.error("Lỗi khi getCurrentUserId:", err);
    throw err;
  }
}

export function invalidateUserProfileCache() {
  window.currentUserPromise = null;
  window.currentUserProfile = null;
}

export function applyProfileToNavbar(user) {
  if (!user) return;
  const picture =
    user.picture && String(user.picture).trim() !== ""
      ? user.picture
      : "";
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  const els = {
    dropdownAvatar: document.getElementById("dropdownAvatar"),
    avatarBtn: document.getElementById("avatarBtn"),
    dropdownName: document.getElementById("dropdownName"),
    profileLink: document.getElementById("profileLink"),
    sidebarAvatar: document.getElementById("sidebarAvatar"),
  };
  if (els.dropdownAvatar) els.dropdownAvatar.src = picture;
  if (els.avatarBtn) els.avatarBtn.src = picture;
  if (els.dropdownName) els.dropdownName.textContent = fullName;
  if (els.profileLink && user.id) els.profileLink.href = `/profile/${user.id}`;
  if (els.sidebarAvatar) els.sidebarAvatar.src = picture;
  const mobileProfileLink = document.getElementById("mobileProfileLink");
  if (mobileProfileLink && user.id) mobileProfileLink.href = `/profile/${user.id}`;
}

export { getCurrentUserId, fetchUserProfileShared };

