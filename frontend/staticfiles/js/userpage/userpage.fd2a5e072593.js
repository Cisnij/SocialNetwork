import { authFetch } from "../authenticate/auth.js";
import {
  API,
  API_BASE_URL,
  DEFAULT_AVATAR,
  buildListUrl,
  POST_ENDPOINTS,
  POST_PAGE_SIZE,
  profileUrl,
} from "../shared/config.js";
import { PostInfiniteLoader } from "../shared/posts/infinite-loader.js";
import { getCurrentUserId } from "../app/profile.js";
import { mountRelationshipBar } from "../shared/relationship-bar.js";
import { renderShareCard } from "../shared/share-post-render.js";
import {
  createUserRow,
  wrapAvatarWithOnlineStatus,
  isProfileOnline,
  onlineStatusText,
} from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";
import { initCommentsPanel } from "../shared/comments-panel.js";

initCommentsPanel();

const cache = {};
const user_id = window.user_id;

let postLoader = null;

let nextFriendsPage = null;
let isLoadingFriends = false;

let nextPhotosPage = null;
let isLoadingPhotos = false;
let allPhotoUrlsGlobal = [];

let currentPhotoIndex = 0;
let photosList = [];

let isOwnProfile = false;
let myProfileId = null;
let nextSharesPage = null;
let isLoadingShares = false;

// ======================== LOADING ========================
function showLoading(container) {
  const wrapper = document.createElement("div");
  wrapper.className =
    "text-center py-4 flex flex-col items-center loading-spinner";
  const spinner = document.createElement("div");
  spinner.className =
    "animate-spin h-6 w-6 border-4 border-indigo-500 border-t-transparent rounded-full";
  const text = document.createElement("p");
  text.className = "text-gray-500 mt-2 text-sm";
  text.textContent = "Đang tải...";
  wrapper.append(spinner, text);
  container.appendChild(wrapper);
  return wrapper;
}

// ======================== PROFILE ========================
function fetchUserPageShared() {
  if (cache.userInfo) return Promise.resolve(cache.userInfo);

  if (window.currentUserPromise) {
    return window.currentUserPromise.then((user) => {
      if (Number(user.id) === Number(user_id)) {
        cache.userInfo = user;
        return user;
      }
      return fetchTargetUserPage();
    });
  }
  return fetchTargetUserPage();
}

function fetchTargetUserPage() {
  if (!window.userPagePromise) {
    window.userPagePromise = authFetch(
      `${API_BASE_URL}/api/auth/profile/userpage/${user_id}`,
      { method: "GET" }
    )
      .then((res) => {
        if (!res.ok) throw new Error("Cannot fetch user profile");
        return res.json();
      })
      .then((data) => {
        const user = data.results ? data.results[0] : data;
        cache.userInfo = user;
        return user;
      })
      .catch((err) => {
        window.userPagePromise = null;
        throw err;
      });
  }
  return window.userPagePromise;
}

async function loadUserInfo() {
  const container = document.getElementById("profile");
  if (!container) return;

  try {
    const user = await fetchUserPageShared();
    container.replaceChildren();

    const avatarUrl =
      user.picture && user.picture.trim() !== ""
        ? user.picture
        : DEFAULT_AVATAR;

    const online = isProfileOnline(user);

    const avatar = document.createElement("img");
    avatar.src = avatarUrl;
    avatar.alt = "avatar";
    avatar.className =
      "w-32 h-32 rounded-full border shadow-lg cursor-pointer object-cover hover:opacity-90 transition";

    avatar.addEventListener("click", () => {
      const modal = document.getElementById("avatarModal");
      const modalImg = document.getElementById("avatarModalImg");
      if (modal && modalImg) {
        modalImg.src = avatarUrl;
        modal.classList.remove("hidden");
      }
    });

    const avatarWrap = wrapAvatarWithOnlineStatus(avatar, online);
    avatarWrap.classList.add("mx-auto");

    const statusRow = document.createElement("p");
    statusRow.className =
      "flex items-center justify-center gap-2 mt-3 text-sm font-medium";
    const statusDot = document.createElement("span");
    statusDot.className = `inline-block w-2.5 h-2.5 rounded-full shrink-0 ${online ? "bg-green-500" : "bg-gray-400 dark:bg-gray-500"
      }`;
    const statusLabel = document.createElement("span");
    statusLabel.className = online
      ? "text-green-600 dark:text-green-400"
      : "text-gray-500 dark:text-[#b0b3b8]";
    statusLabel.textContent = onlineStatusText(online);
    statusRow.append(statusDot, statusLabel);

    const name = document.createElement("h1");
    name.textContent =
      `${user.first_name || ""} ${user.last_name || ""}`.trim() ||
      "Người dùng";
    name.className = "text-2xl font-bold text-center mt-3 dark:text-[#e4e6eb]";

    const bio = document.createElement("p");
    bio.textContent = user.bio || "Chưa có giới thiệu.";
    bio.className =
      "text-sm text-gray-500 dark:text-[#b0b3b8] text-center mt-1 max-w-md";
    const privateMeta = document.createElement("div");
    privateMeta.className = "mt-3 text-sm text-gray-600 dark:text-[#b0b3b8] space-y-1 text-center";
    if (user.date_of_birth) {
      const birthday = document.createElement("p");
      birthday.textContent = `🎂 ${new Date(user.date_of_birth).toLocaleDateString("vi-VN")}`;
      privateMeta.appendChild(birthday);
    }
    if (user.phone_number) {
      const phone = document.createElement("p");
      phone.textContent = `📱 ${user.phone_number}`;
      privateMeta.appendChild(phone);
    }
    const completeHint = document.createElement("div");
    completeHint.className =
      "mt-3 rounded-lg bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-4 py-3 text-sm text-amber-700 dark:text-amber-200 flex items-start gap-2";
    completeHint.innerHTML = `
      <span class="text-xl flex-shrink-0">📸</span>
      <div>
        <p class="font-semibold mb-0.5">Hồ sơ chưa hoàn chỉnh</p>
        <p>Thêm ảnh đại diện để mọi người dễ nhận ra bạn hơn. 
          <a href="/settings/" class="underline font-semibold">Cập nhật ngay →</a>
        </p>
      </div>
    `;
    // will be conditionally appended after isOwnProfile is resolved

    container.append(avatarWrap, statusRow, name, bio);
    if (privateMeta.childElementCount) container.appendChild(privateMeta);

    const me = await getCurrentUserId().catch(() => null);
    myProfileId = me;
    isOwnProfile = Number(me) === Number(user_id);
    if (isOwnProfile) {
      document.getElementById("tabFollowing")?.classList.remove("hidden");
      document.getElementById("tabFollowers")?.classList.remove("hidden");
      // Task 10: only show hint for own profile when not completed
      if (!user.is_completed) {
        container.appendChild(completeHint);
      }
    }

    const relBar = document.createElement("div");
    relBar.id = "relationshipBar";
    relBar.className = "w-full max-w-md mt-4";
    container.appendChild(relBar);
    mountRelationshipBar(relBar, Number(user_id));

    document.getElementById("avatarModal")?.addEventListener("click", (e) => {
      if (e.target.id === "avatarModal")
        e.target.classList.add("hidden");
    });
  } catch (err) {
    console.error("Profile load error:", err);
  }
}

// ======================== POSTS TAB (shared loader) ========================
const POSTS_CACHE_KEY = `userpage:${user_id}`;
const postsListUrl = buildListUrl(
  POST_ENDPOINTS.userpage(user_id),
  POST_PAGE_SIZE.userpage
);

async function initPostsTab() {
  const container = document.getElementById("content");
  if (!container) return;

  if (!postLoader) {
    postLoader = new PostInfiniteLoader({
      container,
      cacheKey: POSTS_CACHE_KEY,
      initialUrl: postsListUrl,
      getCurrentUserId,
    });
    await postLoader.init();
  } else {
    await postLoader.refresh();
  }
}

// ======================== SHARES TAB ========================
async function loadShares(initial = true) {
  const container = document.getElementById("content");
  if (!container) return;
  if (initial) {
    container.replaceChildren();
    nextSharesPage = buildListUrl(API.userShares(user_id), 10);
  }
  if (!nextSharesPage || isLoadingShares) return;
  isLoadingShares = true;
  const spinner = showLoading(container);
  try {
    const data = await fetchPage(nextSharesPage);
    spinner.remove();
    const items = data.results || [];
    nextSharesPage = data.next;
    if (initial && !items.length) {
      const empty = document.createElement("p");
      empty.className = "text-center text-gray-500 py-8 text-sm";
      empty.textContent = "Chưa có bài chia sẻ.";
      container.appendChild(empty);
      return;
    }
    items.forEach((s) =>
      container.appendChild(renderShareCard(s, myProfileId))
    );
  } catch (err) {
    spinner.remove();
    console.error(err);
  } finally {
    isLoadingShares = false;
  }
}

async function loadFollowList(url, title, initial = true) {
  const container = document.getElementById("content");
  if (!container || !isOwnProfile) return;
  if (initial) {
    container.replaceChildren();
    const h = document.createElement("h2");
    h.className = "text-lg font-bold mb-4 dark:text-white";
    h.textContent = title;
    container.appendChild(h);
    const list = document.createElement("div");
    list.id = "followListInner";
    list.className = "space-y-2";
    container.appendChild(list);
  }
  const list = document.getElementById("followListInner");
  const spinner = showLoading(list || container);
  try {
    const data = await fetchPage(url);
    spinner.remove();
    (data.results || []).forEach((item) => {
      const profile =
        item?.id != null && (item.first_name != null || item.picture != null)
          ? item
          : null;
      if (profile?.id) list?.appendChild(createUserRow(profile));
    });
    if (data.next) {
      const more = document.createElement("button");
      more.type = "button";
      more.className =
        "w-full py-2 mt-2 text-sm text-fb-primary font-semibold hover:bg-fb-secondary rounded-lg";
      more.textContent = "Xem thêm";
      more.onclick = () => loadFollowList(data.next, title, false);
      list?.appendChild(more);
    }
  } catch {
    spinner.remove();
  }
}

// ======================== OTHER TABS ========================
async function loadIntroduce() {
  const container = document.getElementById("content");
  if (!container) return;
  container.replaceChildren();
  const spinner = showLoading(container);

  try {
    const user = await fetchUserPageShared();
    spinner.remove();
    const card = document.createElement("div");
    card.className = "bg-white dark:bg-[#242526] p-6 rounded-xl shadow";
    const title = document.createElement("h2");
    title.textContent = "Giới thiệu";
    title.className = "text-lg font-bold mb-2 dark:text-[#e4e6eb]";
    const bio = document.createElement("p");
    bio.className = "text-gray-700 dark:text-[#e4e6eb] whitespace-pre-wrap";
    bio.textContent = user.bio || "Chưa có giới thiệu.";
    card.append(title, bio);
    if (user.date_of_birth || user.phone_number) {
      const meta = document.createElement("div");
      meta.className = "mt-3 space-y-1 text-sm text-gray-600 dark:text-[#b0b3b8]";
      if (user.date_of_birth) {
        const dob = document.createElement("p");
        dob.textContent = `Ngày sinh: ${new Date(user.date_of_birth).toLocaleDateString("vi-VN")}`;
        meta.appendChild(dob);
      }
      if (user.phone_number) {
        const phone = document.createElement("p");
        phone.textContent = `Số điện thoại: ${user.phone_number}`;
        meta.appendChild(phone);
      }
      card.appendChild(meta);
    }
    container.appendChild(card);
  } catch (err) {
    spinner.remove();
    console.error(err);
  }
}

async function loadFriends(initial = true) {
  const container = document.getElementById("content");
  if (!container) return;

  if (initial) {
    container.replaceChildren();
    nextFriendsPage = `${API_BASE_URL}/api/friends/${user_id}`;
  }
  if (!nextFriendsPage || isLoadingFriends) return;

  isLoadingFriends = true;
  const spinner = showLoading(container);

  try {
    const res = await authFetch(nextFriendsPage, { method: "GET" });
    if (!res.ok) throw new Error("Cannot fetch friends");
    const data = await res.json();
    spinner.remove();

    const friendsData = data.results || data;
    nextFriendsPage = data.next;

    if (initial && friendsData.length === 0) {
      const empty = document.createElement("p");
      empty.className = "text-gray-500 text-center py-8 text-sm";
      empty.textContent = "Chưa có bạn bè.";
      container.appendChild(empty);
      return;
    }

    if (initial) {
      const card = document.createElement("div");
      card.className = "bg-white dark:bg-[#242526] p-4 rounded-xl shadow w-full";
      const title = document.createElement("h2");
      title.textContent = "Bạn bè";
      title.className = "text-lg font-bold mb-4 dark:text-[#e4e6eb]";
      const list = document.createElement("ul");
      list.id = "friendsListContainer";
      list.className = "grid grid-cols-1 sm:grid-cols-2 gap-3";
      card.append(title, list);
      container.appendChild(card);
    }

    const list = document.getElementById("friendsListContainer");
    if (list) {
      const fragment = document.createDocumentFragment();
      friendsData.forEach((item) => {
        const friend = item.user || item;
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = profileUrl(friend.id);
        link.className =
          "flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-[#3a3b3c] p-2 rounded-lg transition text-gray-900 dark:text-[#e4e6eb]";
        const av = document.createElement("img");
        av.src = friend.picture || DEFAULT_AVATAR;
        av.className = "w-10 h-10 rounded-full object-cover";
        const avWrap = wrapAvatarWithOnlineStatus(av, isProfileOnline(friend));
        const textCol = document.createElement("div");
        textCol.className = "min-w-0 flex-1";
        const nm = document.createElement("span");
        nm.className = "font-medium truncate block";
        nm.textContent =
          `${friend.first_name || ""} ${friend.last_name || ""}`.trim() ||
          "Người dùng";
        const friendStatus = document.createElement("span");
        friendStatus.className = "text-xs text-gray-500 dark:text-[#b0b3b8] block";
        friendStatus.textContent = onlineStatusText(isProfileOnline(friend));
        textCol.append(nm, friendStatus);
        link.append(avWrap, textCol);
        li.appendChild(link);
        fragment.appendChild(li);
      });
      list.appendChild(fragment);
    }
  } catch (err) {
    spinner.remove();
    console.error(err);
  } finally {
    isLoadingFriends = false;
  }
}

async function loadPhotos(initial = true) {
  const container = document.getElementById("content");
  if (!container) return;

  if (initial) {
    container.replaceChildren();
    nextPhotosPage = buildListUrl(
      POST_ENDPOINTS.userpage(user_id),
      POST_PAGE_SIZE.userpage
    );
    allPhotoUrlsGlobal = [];

    const card = document.createElement("div");
    card.className = "bg-white dark:bg-[#242526] p-4 rounded-xl shadow w-full";
    const title = document.createElement("h2");
    title.textContent = "Ảnh";
    title.className = "text-lg font-bold mb-4 dark:text-[#e4e6eb]";
    const grid = document.createElement("div");
    grid.id = "photosGridContainer";
    grid.className = "grid grid-cols-3 gap-2";
    card.append(title, grid);
    container.appendChild(card);
  }

  if (!nextPhotosPage || isLoadingPhotos) return;

  isLoadingPhotos = true;
  const gridContainer = document.getElementById("photosGridContainer");
  const spinner = showLoading(gridContainer || container);

  try {
    const res = await authFetch(nextPhotosPage, { method: "GET" });
    if (!res.ok) throw new Error("Cannot fetch photos");
    const data = await res.json();
    spinner.remove();

    const posts = data.results || [];
    nextPhotosPage = data.next;

    const photosFromPage = posts
      .filter((p) => p.photos?.length)
      .flatMap((p) =>
        p.photos.map((ph) => ({ photoUrl: ph.photo, title: p.title }))
      );

    if (initial && !photosFromPage.length && !nextPhotosPage) {
      const empty = document.createElement("p");
      empty.className = "text-gray-500 text-center py-4 text-sm col-span-3";
      empty.textContent = "Chưa có ảnh.";
      gridContainer?.appendChild(empty);
      return;
    }

    if (gridContainer && photosFromPage.length) {
      const fragment = document.createDocumentFragment();
      photosFromPage.forEach((p) => {
        allPhotoUrlsGlobal.push(p.photoUrl);
        const idx = allPhotoUrlsGlobal.length - 1;
        const wrapper = document.createElement("div");
        wrapper.className = "aspect-square";
        const img = document.createElement("img");
        img.src = p.photoUrl;
        img.className =
          "w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90";
        img.addEventListener("click", () =>
          openPhotoModal(allPhotoUrlsGlobal, idx, p.title || "")
        );
        wrapper.appendChild(img);
        fragment.appendChild(wrapper);
      });
      gridContainer.appendChild(fragment);
    }
  } catch (err) {
    spinner.remove();
    console.error(err);
  } finally {
    isLoadingPhotos = false;
  }
}

function openPhotoModal(photos, index = 0, caption = "") {
  photosList = photos;
  currentPhotoIndex = index;
  const modal = document.getElementById("photoModal");
  const img = document.getElementById("photoModalImg");
  const captionEl = document.getElementById("photoModalCaption");
  if (modal && img) {
    img.src = photosList[currentPhotoIndex];
    if (captionEl) captionEl.textContent = caption;
    modal.classList.remove("hidden");
  }
}

function setActiveTab(tab) {
  document.querySelectorAll("#tabs a").forEach((t) => {
    t.classList.remove("border-b-2", "border-fb-primary", "text-fb-primary", "tab-active");
    t.classList.add("text-gray-500");
  });
  tab.classList.add("border-b-2", "border-fb-primary", "text-fb-primary", "tab-active");
  tab.classList.remove("text-gray-500");
}

function setupTabs() {
  const tabs = document.querySelectorAll("#tabs a");
  tabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      setActiveTab(tab);
      const type = tab.dataset.tab;
      if (type === "posts") initPostsTab();
      if (type === "shares") loadShares(true);
      if (type === "introduce") loadIntroduce();
      if (type === "friends") loadFriends(true);
      if (type === "photos") loadPhotos(true);
      if (type === "following")
        loadFollowList(buildListUrl(API.following(), 20), "Đang theo dõi", true);
      if (type === "followers")
        loadFollowList(buildListUrl(API.followers(), 20), "Người theo dõi", true);
    });
  });
}

function setupTabInfiniteScroll() {
  window.addEventListener(
    "scroll",
    () => {
      const activeTab = document.querySelector("#tabs a.tab-active, #tabs a.border-fb-primary");
      if (!activeTab) return;
      if (
        window.innerHeight + window.scrollY <
        document.documentElement.scrollHeight - 250
      ) {
        return;
      }
      const type = activeTab.dataset.tab;
      if (type === "posts") postLoader?.load(false);
      if (type === "friends") loadFriends(false);
      if (type === "photos") loadPhotos(false);
      if (type === "shares") loadShares(false);
    },
    { passive: true }
  );
}

// Photo modal controls (userpage-specific viewer)
document.getElementById("prevPhoto")?.addEventListener("click", () => {
  if (currentPhotoIndex > 0) {
    currentPhotoIndex--;
    document.getElementById("photoModalImg").src = photosList[currentPhotoIndex];
  }
});
document.getElementById("nextPhoto")?.addEventListener("click", () => {
  if (currentPhotoIndex < photosList.length - 1) {
    currentPhotoIndex++;
    document.getElementById("photoModalImg").src = photosList[currentPhotoIndex];
  }
});
document
  .getElementById("closeModal")
  ?.addEventListener("click", () =>
    document.getElementById("photoModal")?.classList.add("hidden")
  );

if (document.getElementById("profile")) {
  loadUserInfo();
  initPostsTab();
  setupTabs();
  setupTabInfiniteScroll();
}

