import { authFetch } from '../authenticate/auth.js';

const API_BASE_URL = "http://localhost:8000";
const DEFAULT_AVATAR = "https://res.cloudinary.com/dec8t19tm/image/upload/v1779183832/default.jpg";

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
    const picture = (user.picture && user.picture.trim() !== "") ? user.picture : DEFAULT_AVATAR;
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

export { getCurrentUserId, fetchUserProfileShared };