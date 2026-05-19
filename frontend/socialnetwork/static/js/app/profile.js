import { authFetch } from '../authenticate/auth.js';

const DEFAULT_AVATAR = "https://res.cloudinary.com/dec8t19tm/image/upload/v1779183832/default.jpg";

async function getCurrentUserId() {
  const res = await authFetch("http://localhost:8000/api/user/", { method: "GET" });
  if (!res.ok) throw new Error("Cannot fetch user info");
  const data = await res.json();
  return data.id;
}

async function loadAvatar(userId) {
  try {
    const res = await authFetch(`http://localhost:8000/api/auth/profile/userpage/${userId}`, { method: "GET" });
    if (!res.ok) throw new Error("Cannot fetch profile");

    const profile = await res.json();
    console.log("Profile data:", profile);

    // Xác định ảnh: lấy từ API nếu có, không thì dùng mặc định
    const picture = (profile.picture && profile.picture.trim() !== "") ? profile.picture : DEFAULT_AVATAR;

    // Cập nhật DOM an toàn (kiểm tra phần tử tồn tại trước khi gán)
    const dropdownAvatar = document.getElementById("dropdownAvatar");
    const avatarBtn = document.getElementById("avatarBtn");
    const dropdownName = document.getElementById("dropdownName");
    const profileLink = document.getElementById("profileLink");

    if (dropdownAvatar) dropdownAvatar.src = picture;
    if (avatarBtn) avatarBtn.src = picture;

    if (dropdownName) {
      dropdownName.textContent = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
    }

    if (profileLink) {
      profileLink.href = `/profile/${userId}`;
    }

  } catch (err) {
    console.error("Lỗi khi load profile:", err);
  }
}

async function init() {
  try {
    const userId = await getCurrentUserId();
    await loadAvatar(userId);
  } catch (err) {
    console.error("Error init:", err);
  }
}

// Gọi init nhưng bao bọc để tránh lỗi nếu DOM chưa sẵn sàng
document.addEventListener('DOMContentLoaded', init);

export { getCurrentUserId };