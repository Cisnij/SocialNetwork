import { authFetch } from '../authenticate/auth.js'; 

async function getCurrentUserId() {
  const res = await authFetch("http://localhost:8000/api/user/", { method: "GET" });
  if (!res.ok) throw new Error("Cannot fetch user info");

  const data = await res.json();
  return data[0].id;  // user id

}

async function loadAvatar(userId) {
  const res = await authFetch(`http://localhost:8000/api/auth/profile/userpage/${userId}`, { method: "GET" });
  if (!res.ok) throw new Error("Cannot fetch profile");

  const profile = await res.json();

  // gán avatar và tên
  document.getElementById("dropdownAvatar").src = profile.picture
  document.getElementById("dropdownName").textContent = `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
  const avatar = document.getElementById("avatarBtn"); 
  avatar.src = profile.picture 

  // gán link "Xem trang cá nhân"
  document.getElementById("profileLink").href = `/profile/${userId}`;
}

// Hàm init
async function init() {
  try {
    const userId = await getCurrentUserId();
    await loadAvatar(userId);
  } catch (err) {
    console.error("Error:", err);
  }
}
export {getCurrentUserId}
init();
