import { authFetch } from "../authenticate/auth.js";
import { openEditModal } from "./post_edit.js";

// ======================== CONFIGURATION ========================
const API_BASE_URL = "http://localhost:8000";
const DEFAULT_AVATAR = "https://res.cloudinary.com/dec8t19tm/image/upload/v1779183832/default.jpg";

const cache = {};
const user_id = window.user_id;

// Global State cho phân trang
let nextPostPage = null;
let isLoadingPosts = false;

let nextFriendsPage = null;
let isLoadingFriends = false;

// State phân trang mới cho Tab Ảnh
let nextPhotosPage = null;
let isLoadingPhotos = false;
let allPhotoUrlsGlobal = []; // Lưu danh sách URL toàn cục để khi click xem ảnh ở chế độ Modal có thể Next/Prev toàn bộ ảnh đã load

let nextReactionsUrl = null;
let currentPostId = null;
let loadingReactions = false;

// Quản lý trạng thái xem ảnh (Modal Viewer)
let currentPhotoIndex = 0;
let photosList = [];

// ======================== LOADING SPINNER ========================
function showLoading(container) {
    const wrapper = document.createElement("div");
    wrapper.className = "text-center py-4 flex flex-col items-center loading-spinner";

    const spinner = document.createElement("div");
    spinner.className = "animate-spin h-6 w-6 border-4 border-indigo-500 border-t-transparent rounded-full";

    const text = document.createElement("p");
    text.className = "text-gray-500 mt-2 text-sm";
    text.textContent = "Đang tải...";

    wrapper.append(spinner, text);
    container.appendChild(wrapper);
    return wrapper;
}

// ======================== CHẶN TRÙNG API (PROMISE SHARING) ========================
function fetchUserPageShared() {
    if (cache.userInfo) return Promise.resolve(cache.userInfo);

    if (window.currentUserPromise) {
        return window.currentUserPromise.then(user => {
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
        window.userPagePromise = authFetch(`${API_BASE_URL}/api/auth/profile/userpage/${user_id}`, { method: "GET" })
            .then(res => {
                if (!res.ok) throw new Error("Cannot fetch user profile");
                return res.json();
            })
            .then(data => {
                const user = data.results ? data.results[0] : data;
                cache.userInfo = user;
                return user;
            })
            .catch(err => {
                window.userPagePromise = null;
                throw err;
            });
    }
    return window.userPagePromise;
}

// ======================== USER PROFILE ========================
async function loadUserInfo() {
    const container = document.getElementById("profile");
    if (!container) return;

    try {
        const user = await fetchUserPageShared();
        container.replaceChildren();

        const avatarUrl = (user.picture && user.picture.trim() !== "") ? user.picture : DEFAULT_AVATAR;

        const avatar = document.createElement("img");
        avatar.src = avatarUrl;
        avatar.alt = "avatar";
        avatar.className = "w-32 h-32 rounded-full border shadow-lg mx-auto cursor-pointer object-cover hover:opacity-90 transition";

        avatar.addEventListener("click", () => {
            const modal = document.getElementById("avatarModal");
            const modalImg = document.getElementById("avatarModalImg");
            if (modal && modalImg) {
                modalImg.src = avatarUrl;
                modal.classList.remove("hidden");
            }
        });

        const name = document.createElement("h1");
        name.textContent = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Người dùng hệ thống";
        name.className = "text-2xl font-bold text-center mt-4";

        const bio = document.createElement("p");
        bio.textContent = user.bio || "Chưa có giới thiệu.";
        bio.className = "text-sm text-gray-500 text-center mt-1";

        container.append(avatar, name, bio);

        const avatarModal = document.getElementById("avatarModal");
        if (avatarModal) {
            avatarModal.addEventListener("click", (e) => {
                if(e.target === avatarModal) avatarModal.classList.add("hidden");
            });
        }
    } catch (err) {
        console.error("Lỗi khi dựng thông tin User Profile:", err);
    }
}

// ======================== REACTIONS MANAGEMENT ========================
const REACTIONS = [
    { type: "like", icon: "👍", label: "Thích" },
    { type: "love", icon: "❤️", label: "Yêu thích" },
    { type: "haha", icon: "😂", label: "Haha" },
    { type: "wow", icon: "😮", label: "Wow" },
    { type: "sad", icon: "😢", label: "Buồn" },
    { type: "angry", icon: "😡", label: "Phẫn nộ" },
];

async function reactToPost(postId, reactionType) {
    try {
        const res = await authFetch(`${API_BASE_URL}/api/posts/${postId}/react/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reaction_type: reactionType }),
        });
        if (!res.ok) throw new Error("React failed");
        return await res.json();
    } catch (err) {
        console.error("Error reacting:", err);
        return null;
    }
}

function updateReactionButton(reactBtn, type) {
    reactBtn.replaceChildren();
    reactBtn.classList.remove("font-bold", "text-indigo-600");

    const r = REACTIONS.find(x => x.type === type) || { icon: "👍", label: "Thích", type: "" };

    const icon = document.createElement("span"); icon.textContent = r.icon;
    const text = document.createElement("span"); text.textContent = r.label;
    reactBtn.append(icon, text);

    reactBtn.dataset.reaction = r.type;
    if (type) reactBtn.classList.add("font-bold", "text-indigo-600");
}

function createReactionBar(postId, reactBtn, wrapper, reactionCount, post) {
    const bar = document.createElement("div");
    bar.className = "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white shadow-lg rounded-full px-2 py-1 flex gap-2 z-50 hidden";
    let hideTimeout;

    REACTIONS.forEach((r) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.title = r.label;
        btn.className = "text-xl leading-none p-1 rounded-full hover:scale-125 transition-transform outline-none";
        btn.textContent = r.icon;

        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            bar.classList.add("hidden");

            const res = await reactToPost(postId, r.type);
            if (res) {
                let newReaction = res.reaction_type || (res.status === "added" ? r.type : "");
                updateReactionButton(reactBtn, newReaction);

                if (Array.isArray(res.count)) {
                    const newTotal = res.count.reduce((sum, x) => sum + x.total, 0);
                    reactionCount.textContent = newTotal > 0 ? `${newTotal} lượt thích` : "";
                    post.reactions = res.count;
                }

                post.user_is_reaction = newReaction;
            }
        });

        bar.appendChild(btn);
    });

    wrapper.addEventListener("mouseenter", () => {
        clearTimeout(hideTimeout);
        bar.classList.remove("hidden");
    });
    wrapper.addEventListener("mouseleave", () => {
        hideTimeout = setTimeout(() => bar.classList.add("hidden"), 300);
    });

    return bar;
}

// ======================== POSTS RENDERING ========================
export function renderPostCard(post) {
    const card = document.createElement("div");
    card.className = "bg-white rounded-lg shadow p-4 mb-6 relative";
    card.dataset.postId = post.post_id;

    // HEADER
    const header = document.createElement("div");
    header.className = "flex items-center justify-between";

    const left = document.createElement("div");
    left.className = "flex items-center gap-3";

    const avatar = document.createElement("img");
    avatar.src = post.user?.picture || DEFAULT_AVATAR;
    avatar.alt = "avatar";
    avatar.className = "w-10 h-10 rounded-full object-cover";

    const info = document.createElement("div");
    const name = document.createElement("p");
    name.className = "font-semibold";
    name.textContent = `${post.user?.first_name || ""} ${post.user?.last_name || ""}`.trim() || "Người dùng";

    const time = document.createElement("p");
    time.className = "text-sm text-gray-500";
    time.textContent = new Date(post.created_at).toLocaleString("vi-VN");

    info.append(name, time);
    left.append(avatar, info);

    // DYNAMIC MENU DROPDOWN
    const menuWrapper = document.createElement("div");
    menuWrapper.className = "relative";

    const menuBtn = document.createElement("button");
    menuBtn.textContent = "⋯";
    menuBtn.className = "text-2xl text-gray-500 hover:text-gray-800 px-2 rounded-full font-bold";
    menuWrapper.appendChild(menuBtn);

    const menuDropdown = document.createElement("div");
    menuDropdown.className = "absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg hidden z-50";

    const editBtn = document.createElement("button");
    editBtn.className = "block w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100 transition";
    editBtn.textContent = "✏️ Chỉnh sửa";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "block w-full text-left px-4 py-2 text-red-600 hover:bg-red-100 transition";
    deleteBtn.textContent = "🗑️ Xóa bài viết";

    menuDropdown.append(editBtn, deleteBtn);
    menuWrapper.append(menuDropdown);

    deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        menuDropdown.classList.add("hidden");
        await deletePost(post.post_id);
    });

    editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        menuDropdown.classList.add("hidden");
        openEditModal(post);
    });

    menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        menuDropdown.classList.toggle("hidden");
    });
    document.addEventListener("click", () => menuDropdown.classList.add("hidden"));

    header.append(left, menuWrapper);
    card.appendChild(header);

    // CONTENT BODY
    const content = document.createElement("p");
    content.className = "mt-3 whitespace-pre-wrap text-gray-800";
    content.textContent = post.title;
    card.appendChild(content);

    // DISPLAY PHOTOS GRID
    if (post.photos && post.photos.length > 0) {
        const grid = document.createElement("div");
        grid.className = "grid grid-cols-2 gap-2 mt-3";

        const maxVisible = 4;
        post.photos.slice(0, maxVisible).forEach((p, index) => {
            const wrapper = document.createElement("div");
            wrapper.className = "relative h-48 w-full";

            const img = document.createElement("img");
            img.src = p.photo;
            img.alt = "photo";
            img.className = "rounded-lg cursor-pointer hover:opacity-90 transition w-full h-full object-cover";

            img.addEventListener("click", () => {
                const urls = post.photos.map((x) => x.photo);
                openPhotoModal(urls, index, post.title || "");
            });
            wrapper.appendChild(img);

            if (index === maxVisible - 1 && post.photos.length > maxVisible) {
                const overlay = document.createElement("div");
                overlay.className = "absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center rounded-lg text-white text-3xl font-bold cursor-pointer hover:bg-opacity-60 transition";
                overlay.textContent = `+${post.photos.length - maxVisible}`;

                overlay.addEventListener("click", () => {
                    const urls = post.photos.map((x) => x.photo);
                    openPhotoModal(urls, index, post.title || "");
                });
                wrapper.appendChild(overlay);
            }
            grid.appendChild(wrapper);
        });
        card.appendChild(grid);
    }

    // INTERACTION FOOTER
    const totalReactions = post.reactions?.reduce((sum, r) => sum + r.total, 0) || 0;
    const reactionCount = document.createElement("button");
    reactionCount.type = "button";
    reactionCount.className = "text-sm text-gray-600 mb-2 hover:underline mt-2 font-medium";
    reactionCount.textContent = totalReactions > 0 ? `${totalReactions} lượt thích` : "";
    reactionCount.addEventListener("click", () => openReactionsModal(post.post_id));
    card.appendChild(reactionCount);

    const actions = document.createElement("div");
    actions.className = "flex justify-between text-gray-600 mt-1 border-t pt-2";

    const reactionWrapper = document.createElement("div");
    reactionWrapper.className = "relative inline-block group w-1/3 flex justify-center";

    const reactBtn = document.createElement("button");
    reactBtn.type = "button";
    reactBtn.className = "flex items-center justify-center gap-2 hover:bg-gray-100 p-2 rounded-md transition w-full";
    updateReactionButton(reactBtn, post.user_is_reaction || "");

    const reactionBar = createReactionBar(post.post_id, reactBtn, reactionWrapper, reactionCount, post);

    reactBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const currentReaction = post.user_is_reaction;
        let reactionToSend = currentReaction ? currentReaction : "like";

        const res = await reactToPost(post.post_id, reactionToSend);
        if (res) {
            updateReactionButton(reactBtn, res.status === "added" ? res.reaction_type : "");
            if (Array.isArray(res.count)) {
                const newTotal = res.count.reduce((sum, x) => sum + x.total, 0);
                reactionCount.textContent = newTotal > 0 ? `${newTotal} lượt thích` : "";
                post.reactions = res.count;
            }
            post.user_is_reaction = res.status === "added" ? res.reaction_type : "";
        }
    });

    reactionWrapper.append(reactBtn, reactionBar);

    const commentBtn = document.createElement("button");
    commentBtn.className = "flex items-center justify-center gap-2 hover:bg-gray-100 p-2 rounded-md transition w-1/3";
    commentBtn.textContent = "🗨️ Bình luận";

    const shareBtn = document.createElement("button");
    shareBtn.className = "flex items-center justify-center gap-2 hover:bg-gray-100 p-2 rounded-md transition w-1/3";
    shareBtn.textContent = "🔂 Chia sẻ";

    actions.append(reactionWrapper, commentBtn, shareBtn);
    card.append(actions);

    return card;
}

async function loadPosts(initial = true) {
    const container = document.getElementById("content");
    if (!container) return;

    if (initial) {
        container.replaceChildren();
        nextPostPage = `${API_BASE_URL}/api/user/post/userpage/${user_id}`;
    }

    if (!nextPostPage || isLoadingPosts) return;

    isLoadingPosts = true;
    const spinner = showLoading(container);

    try {
        const res = await authFetch(nextPostPage, { method: "GET" });
        if (!res.ok) throw new Error("Cannot fetch posts");
        const data = await res.json();

        spinner.remove();
        const posts = data.results || data;

        const fragment = document.createDocumentFragment();
        posts.forEach(post => fragment.appendChild(renderPostCard(post)));
        container.appendChild(fragment);

        nextPostPage = data.next;
    } catch (err) {
        console.error(err);
        spinner.remove();
    } finally {
        isLoadingPosts = false;
    }
}

// ======================== TABS: INTRO / FRIENDS / PHOTOS ========================
async function loadIntroduce() {
    const container = document.getElementById("content");
    if (!container) return;
    container.replaceChildren();
    const spinner = showLoading(container);

    try {
        const user = await fetchUserPageShared();
        spinner.remove();

        const card = document.createElement("div");
        card.className = "bg-white p-4 rounded-lg shadow";

        const title = document.createElement("h2");
        title.textContent = "Giới thiệu";
        title.className = "text-lg font-bold mb-2";

        const bio = document.createElement("p");
        bio.textContent = user.bio || "Chưa có giới thiệu.";

        card.append(title, bio);
        container.appendChild(card);
    } catch (err) {
        console.error("Lỗi khi load tab giới thiệu:", err);
        spinner.remove();
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

        if (initial) {
            if (friendsData.length === 0) {
                const emptyText = document.createElement("p");
                emptyText.textContent = "Chưa có bạn bè để hiển thị.";
                emptyText.className = "text-gray-500 text-center py-8 text-sm font-medium bg-white rounded-lg shadow w-full";
                container.appendChild(emptyText);
                return;
            }

            const card = document.createElement("div");
            card.className = "bg-white p-4 rounded-lg shadow w-full";

            const title = document.createElement("h2");
            title.textContent = "Bạn bè";
            title.className = "text-lg font-bold mb-4";
            card.appendChild(title);

            const list = document.createElement("ul");
            list.id = "friendsListContainer";
            list.className = "grid grid-cols-2 gap-4";

            card.appendChild(list);
            container.appendChild(card);
        }

        const list = document.getElementById("friendsListContainer");
        if (list) {
            const fragment = document.createDocumentFragment();

            friendsData.forEach(item => {
                const friend = item.user || item;

                const li = document.createElement("li");
                const link = document.createElement("a");
                link.href = `/profile/${friend.id}`;
                link.className = "flex items-center space-x-3 hover:bg-gray-100 p-2 rounded-md transition";

                const avatar = document.createElement("img");
                avatar.src = friend.picture || DEFAULT_AVATAR;
                avatar.alt = "friend";
                avatar.className = "w-10 h-10 rounded-full object-cover shrink-0";

                const name = document.createElement("span");
                name.textContent = `${friend.first_name || ""} ${friend.last_name || ""}`.trim() || "Người dùng";
                name.className = "font-medium text-gray-800 truncate";

                link.append(avatar, name);
                li.appendChild(link);
                fragment.appendChild(li);
            });
            list.appendChild(fragment);
        }

    } catch (err) {
        console.error("Lỗi khi load danh sách bạn bè:", err);
        spinner.remove();
        if (initial) {
            const errorDiv = document.createElement("div");
            errorDiv.className = "bg-white p-4 rounded-lg shadow text-center text-red-500 text-sm";
            errorDiv.textContent = "⚠️ Lỗi tải danh sách bạn bè!";
            container.appendChild(errorDiv);
        }
    } finally {
        isLoadingFriends = false;
    }
}

// ======================== TÁI CẤU TRÚC: PHÂN TRANG THỰC SỰ CHO TAB ẢNH ========================
async function loadPhotos(initial = true) {
    const container = document.getElementById("content");
    if (!container) return;

    if (initial) {
        container.replaceChildren();
        nextPhotosPage = `${API_BASE_URL}/api/user/post/userpage/${user_id}`;
        allPhotoUrlsGlobal = []; // Reset danh sách URL khi tải mới tab

        const card = document.createElement("div");
        card.className = "bg-white p-4 rounded-lg shadow w-full";

        const title = document.createElement("h2");
        title.textContent = "Ảnh";
        title.className = "text-lg font-bold mb-4";
        card.appendChild(title);

        const grid = document.createElement("div");
        grid.id = "photosGridContainer";
        grid.className = "grid grid-cols-3 gap-2";
        card.appendChild(grid);

        container.appendChild(card);
    }

    if (!nextPhotosPage || isLoadingPhotos) return;

    isLoadingPhotos = true;
    const gridContainer = document.getElementById("photosGridContainer");
    const spinner = showLoading(gridContainer || container);

    try {
        const res = await authFetch(nextPhotosPage, { method: "GET" });
        if (!res.ok) throw new Error("Cannot fetch posts for photos");

        const data = await res.json();
        spinner.remove();

        const posts = data.results || data;
        nextPhotosPage = data.next; // Lưu con trỏ trang kế tiếp của backend

        // Lọc các bài viết có ảnh và bóc tách cấu trúc mảng thành phẳng (flat array)
        const photosFromPage = posts
            .filter(post => post.photos && post.photos.length > 0)
            .flatMap(post => post.photos.map(p => ({ photoUrl: p.photo, title: post.title })));

        if (initial && photosFromPage.length === 0 && !nextPhotosPage) {
            const empty = document.createElement("p");
            empty.textContent = "Chưa có ảnh để hiển thị.";
            empty.className = "text-gray-500 text-center py-4 text-sm font-medium w-full col-span-3";
            if (gridContainer) gridContainer.appendChild(empty);
            return;
        }

        if (gridContainer && photosFromPage.length > 0) {
            const fragment = document.createDocumentFragment();

            photosFromPage.forEach(p => {
                // Đẩy vào mảng toàn cục phục vụ cho tác vụ Xem ảnh (Next/Prev trong Modal)
                allPhotoUrlsGlobal.push(p.photoUrl);
                const currentIndex = allPhotoUrlsGlobal.length - 1;

                const wrapper = document.createElement("div");
                wrapper.className = "aspect-square w-full";

                const img = document.createElement("img");
                img.src = p.photoUrl;
                img.alt = "photo";
                img.className = "w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition";

                img.addEventListener("click", () => {
                    openPhotoModal(allPhotoUrlsGlobal, currentIndex, p.title || "");
                });

                wrapper.appendChild(img);
                fragment.appendChild(wrapper);
            });
            gridContainer.appendChild(fragment);
        }
    } catch (err) {
        console.error("Error loading photos page:", err);
        spinner.remove();
        if (initial) {
            const errorP = document.createElement("p");
            errorP.className = "text-red-500 text-sm text-center mt-2 col-span-3";
            errorP.textContent = "⚠️ Lỗi tải hình ảnh!";
            if (gridContainer) gridContainer.appendChild(errorP);
        }
    } finally {
        isLoadingPhotos = false;
    }
}

function setupTabs() {
    const tabs = document.querySelectorAll("#tabs a");
    tabs.forEach(tab => {
        tab.addEventListener("click", e => {
            e.preventDefault();
            tabs.forEach(t => t.classList.remove("border-b-2", "border-indigo-600", "text-indigo-600", "font-medium"));
            tab.classList.add("border-b-2", "border-indigo-600", "text-indigo-600", "font-medium");

            const type = tab.dataset.tab;
            if (type === "posts") loadPosts(true);
            if (type === "introduce") loadIntroduce();
            if (type === "friends") loadFriends(true);
            if (type === "photos") loadPhotos(true); // Kích hoạt nạp trang 1 của tab Ảnh
        });
    });
}

// ======================== INFINITE SCROLL (ĐÃ BỔ SUNG TAB ẢNH) ========================
window.addEventListener("scroll", () => {
    const activeTab = document.querySelector('#tabs a.border-indigo-600');
    if (!activeTab) return;

    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
        const type = activeTab.dataset.tab;
        if (type === "posts") loadPosts(false);
        if (type === "friends") loadFriends(false);
        if (type === "photos") loadPhotos(false); //
    }
});

// ======================== PHOTO & REACTIONS MODAL ========================
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

document.getElementById("closeModal")?.addEventListener("click", () => document.getElementById("photoModal").classList.add("hidden"));
document.getElementById("photoModal")?.addEventListener("click", e => { if (e.target.id === "photoModal") e.target.classList.add("hidden"); });
document.addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("photoModal")?.classList.add("hidden"); });

function openPhotoModal(photos, index = 0, caption = "") {
    photosList = photos;
    currentPhotoIndex = index;
    const modal = document.getElementById("photoModal");
    const img = document.getElementById("photoModalImg");
    const captionEl = document.getElementById("photoModalCaption");

    if (modal && img && captionEl) {
        img.src = photosList[currentPhotoIndex];
        captionEl.textContent = caption;
        modal.classList.remove("hidden");
    }
}

// --- REACTIONS MODAL ---
async function loadReactions(postId, initial = true) {
    const list = document.getElementById("reactionsList");
    if (!list) return;

    if (initial) {
        nextReactionsUrl = `${API_BASE_URL}/api/user/reaction/post/${postId}`;
        list.replaceChildren();
        currentPostId = postId;
    }
    if (!nextReactionsUrl || loadingReactions) return;

    loadingReactions = true;
    try {
        const res = await authFetch(nextReactionsUrl, { method: "GET" });
        if (!res.ok) throw new Error("Cannot fetch reactions");
        const data = await res.json();

        const fragment = document.createDocumentFragment();
        data.results.forEach(r => {
            const item = document.createElement("div");
            item.className = "flex items-center gap-3 py-2 px-1 hover:bg-gray-50 rounded";

            const img = document.createElement("img");
            img.src = r.user.picture || DEFAULT_AVATAR;
            img.className = "w-8 h-8 rounded-full object-cover";

            const name = document.createElement("span");
            name.textContent = `${r.user.first_name} ${r.user.last_name}`;
            name.className = "font-medium flex-1";

            const emoji = document.createElement("span");
            const found = REACTIONS.find(x => x.type === r.slug);
            emoji.textContent = found ? found.icon : "👍";
            emoji.className = "text-xl";

            item.append(img, name, emoji);
            fragment.appendChild(item);
        });
        list.appendChild(fragment);
        nextReactionsUrl = data.next;
    } catch (err) {
        console.error(err);
    } finally {
        loadingReactions = false;
    }
}

function openReactionsModal(postId) {
    const modal = document.getElementById("reactionsModal");
    if (modal) {
        loadReactions(postId, true);
        modal.classList.remove("hidden");
    }
}

document.getElementById("closeReactionsModal")?.addEventListener("click", () => document.getElementById("reactionsModal").classList.add("hidden"));
document.getElementById("reactionsModal")?.addEventListener("scroll", e => {
    const el = e.target.querySelector("div.overflow-y-auto") || e.target;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 50) {
        loadReactions(currentPostId, false);
    }
});


// ======================== DELETE POST ========================
let postToDeleteId = null;

async function deletePost(postId) {
    if (!postId) return;
    postToDeleteId = postId;
    document.getElementById("deleteModal")?.classList.remove("hidden");
}

document.getElementById("cancelDelete")?.addEventListener("click", () => {
    postToDeleteId = null;
    document.getElementById("deleteModal").classList.add("hidden");
});

document.getElementById("confirmDelete")?.addEventListener("click", async () => {
    if (!postToDeleteId) return;
    try {
        const res = await authFetch(`${API_BASE_URL}/api/user/post/${postToDeleteId}/`, {
            method: "DELETE",
        });

        if (res.ok) {
            const article = document.querySelector(`[data-post-id="${postToDeleteId}"]`);
            if (article) article.remove();
            showToast("✅ Bạn đã xóa bài viết thành công!");
        } else {
            showToast("⚠️ Không thể xóa bài viết. Vui lòng thử lại.", "red");
        }
    } catch (err) {
        console.error(err);
        showToast("⚠️ Lỗi khi xóa bài viết.", "red");
    } finally {
        postToDeleteId = null;
        document.getElementById("deleteModal").classList.add("hidden");
    }
});

function showToast(message, color = "green") {
    const toast = document.getElementById("toast");
    if (!toast) return;

    toast.className = `fixed bottom-5 right-5 bg-${color}-500 text-white px-4 py-3 rounded shadow-lg z-50 transition-opacity duration-300`;
    toast.textContent = message;
    toast.classList.remove("hidden", "opacity-0");

    setTimeout(() => {
        toast.classList.add("opacity-0");
        setTimeout(() => toast.classList.add("hidden"), 300);
    }, 3000);
}

// ======================== SAFE INITIALIZATION ========================
if (document.getElementById("profile")) {
    loadUserInfo();
    loadPosts(true);
    setupTabs();
}

document.addEventListener('newPostCreated', (e) => {
    const newPost = e.detail;
    const postContainer = document.getElementById("content");
    const activeTab = document.querySelector('#tabs a.border-indigo-600');
    if (activeTab && activeTab.dataset.tab === "posts" && postContainer) {
        const newArticle = renderPostCard(newPost);
        postContainer.prepend(newArticle);
    }
});

export { showToast };