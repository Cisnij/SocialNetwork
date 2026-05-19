import { authFetch } from '../authenticate/auth.js';

const DEFAULT_AVATAR =
  "https://res.cloudinary.com/dec8t19tm/image/upload/v1779183832/default.jpg";

async function getCurrentUserId() {
  const res = await authFetch(
    "http://localhost:8000/api/user/",
    { method: "GET" }
  );

  if (!res.ok) throw new Error("Cannot fetch user info");

  const data = await res.json();
  return data.id;
}

async function loadAvatar(userId) {
  const res = await authFetch(
    `http://localhost:8000/api/auth/profile/userpage/${userId}`,
    { method: "GET" }
  );

  if (!res.ok) throw new Error("Cannot fetch profile");

  const profile = await res.json();

  console.log(profile);

  // fix avatar lỗi cloudinary
  const picture =
    profile.picture &&
    !profile.picture.includes("/v1/media/")
      ? profile.picture
      : DEFAULT_AVATAR;

  // avatar
  document.getElementById("dropdownAvatar").src = picture;

  const avatarBtn = document.getElementById("avatarBtn");
  avatarBtn.src = picture;

  // tên
  document.getElementById("dropdownName").textContent =
    `${profile.first_name || ""} ${profile.last_name || ""}`.trim();

  // link profile
  document.getElementById("profileLink").href =
    `/profile/${userId}`;
}

async function init() {
  try {
    const userId = await getCurrentUserId();
    await loadAvatar(userId);
  } catch (err) {
    console.error("Error:", err);
  }
}

export { getCurrentUserId };

init();