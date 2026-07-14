import { API, DEFAULT_AVATAR, profileUrl } from "../shared/config.js";
import { authFetch, authFetchCache } from "../authenticate/auth.js";
import { initAdminPanel } from "./groupManage.js";
import { initCommentsPanel } from "../shared/comments-panel.js";

// ============ STATE ============
const GROUP_ID = window.CURRENT_GROUP_ID;
let groupData = null;
let isMember = false;
let myRole = null;
let myUserId = null;

// Pagination states
let nextPostsUrl = null;
let isLoadingPosts = false;

let nextMembersUrl = null;
let isLoadingMembers = false;

let nextEventsUrl = null;
let isLoadingEvents = false;

let nextVotesUrl = null;
let isLoadingVotes = false;

// Cache keys
const CACHE_KEYS = {
    group: `group:${GROUP_ID}`,
    posts: `group:${GROUP_ID}:posts`,
    members: `group:${GROUP_ID}:members`,
    votes: `group:${GROUP_ID}:votes`,
    events: `group:${GROUP_ID}:events`,
};

// ============ HELPERS ============
function apiGet(url, onData) {
    return authFetchCache(url, {}, onData);
}

async function apiMutate(url, method, body = null) {
    const options = { method };
    if (body instanceof FormData) {
        options.body = body;
    } else if (body !== null) {
        options.headers = { "Content-Type": "application/json" };
        options.body = JSON.stringify(body);
    }
    const res = await authFetch(url, options);
    if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || `HTTP ${res.status}`);
    }
    if (res.status === 204) return {};
    return res.json();
}

function showToast(msg, type = "info") {
    const toast = document.getElementById("toast");
    if (!toast) { console.log(msg); return; }
    toast.textContent = msg;
    toast.className = `fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg z-[80] max-w-sm toast toast-${type}`;
    toast.classList.remove("hidden");
    toast.classList.remove("animate-slide-up");
    void toast.offsetWidth;
    toast.classList.add("animate-slide-up");
    setTimeout(() => toast.classList.add("hidden"), 4000);
}

function confirmAction(msg) {
    return new Promise((resolve) => {
        const modal = document.getElementById("confirmModal");
        if (!modal) {
            resolve(confirm(msg));
            return;
        }
        document.getElementById("confirmModalMessage").textContent = msg;
        modal.classList.remove("hidden");
        document.getElementById("confirmModalOk").onclick = () => {
            modal.classList.add("hidden");
            resolve(true);
        };
        document.getElementById("confirmModalCancel").onclick = () => {
            modal.classList.add("hidden");
            resolve(false);
        };
    });
}

// ============ MAIN INIT ============
document.addEventListener("DOMContentLoaded", async () => {
    if (!GROUP_ID) return;

    initCommentsPanel();

    await loadGroupInfo();

    // Tab navigation
    const navButtons = document.querySelectorAll("#groupNav button[data-tab]");
    navButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
            navButtons.forEach((b) => {
                b.className =
                    "px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800";
            });
            e.target.className =
                "px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all bg-fb-primary/10 text-fb-primary shadow-sm";

            document.querySelectorAll(".group-tab-content").forEach((tab) => tab.classList.add("hidden"));

            const tabName = e.target.getAttribute("data-tab");
            const tabId = `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`;
            const targetTab = document.getElementById(tabId);
            if (targetTab) {
                targetTab.classList.remove("hidden");
                targetTab.classList.remove("animate-fade-in");
                void targetTab.offsetWidth;
                targetTab.classList.add("animate-fade-in");
            }

            // Load data on tab switch
            if (tabName === "rules") renderRules();
            else if (tabName === "members") loadMembers(true);
            else if (tabName === "events") loadEvents(true);
            else if (tabName === "votes") loadVotesTab(true);
            else if (tabName === "photos") loadPhotos(true);
            else if (tabName === "search") loadSearch();
        });
    });

    // Suggestion box
    document.getElementById("btnOpenSuggestionModal")?.addEventListener("click", openSuggestionModal);

    // Cover image upload
    document.getElementById("btnEditGroupCover")?.addEventListener("click", () => {
        document.getElementById("groupCoverInput")?.click();
    });
    document.getElementById("groupCoverInput")?.addEventListener("change", handleCoverUpload);

    // Scroll-based infinite load
    setupInfiniteScroll();
});

// ============ LOAD GROUP INFO ============
async function loadGroupInfo() {
    return new Promise((resolve) => {
        apiGet(API.groupDetail(GROUP_ID), (data, isFromCache) => {
            groupData = data;
            myRole = data.role || null;
            myUserId = data.user_id || null;

            renderHero(data);

            if (!isFromCache) {
                setupPermissions(data);
                loadPosts();
                loadActiveVotesSidebar();
            } else {
                setupPermissions(data);
                if (!document.getElementById("groupPostList").innerHTML) {
                    loadPosts();
                }
            }
            resolve(data);
        });
    });
}

// ============ RENDER HERO ============
function renderHero(group) {
    const nameEl = document.getElementById("groupName");
    const countEl = document.getElementById("groupMemberCount");
    const privacyEl = document.getElementById("groupPrivacyText");
    const descEl = document.getElementById("groupDescriptionSidebar");

    if (nameEl) nameEl.textContent = group.name || "Nhóm không tên";
    if (countEl)
        countEl.innerHTML = `<i class="fas fa-users mr-1"></i> ${group.member_count || 0} thành viên`;
    if (privacyEl) privacyEl.textContent = group.is_company ? "Công ty" : "Riêng tư";
    if (descEl) descEl.textContent = group.description || "Nhóm chưa có mô tả.";

    // Avatar
    const avatarUrl = group.avatar || DEFAULT_AVATAR;
    const heroAvatar = document.getElementById("groupAvatarImageHero");
    if (heroAvatar) {
        heroAvatar.src = avatarUrl;
        heroAvatar.onerror = () => { heroAvatar.src = DEFAULT_AVATAR; };
    }

    // Cover
    if (group.cover_image) {
        const coverImg = document.getElementById("groupCoverImage");
        if (coverImg) {
            coverImg.src = group.cover_image;
            coverImg.classList.remove("hidden");
        }
        document.getElementById("groupComposerContainer").classList.add("hidden");

        const tabPosts = document.getElementById("tabPosts");
        if (tabPosts) {
            // Add 'My Posts' filter button if not exists
            if (!document.getElementById("btnMyGroupPosts")) {
                const myPostsBtn = document.createElement("div");
                myPostsBtn.className = "flex justify-end mb-4";
                myPostsBtn.innerHTML = `<button id="btnMyGroupPosts" class="bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-xl text-sm font-bold transition flex items-center gap-2"><i class="fas fa-user-edit"></i> Bài viết của tôi</button>`;
                document.getElementById("groupComposerContainer").parentElement.insertBefore(myPostsBtn, document.getElementById("groupPostList"));

                let showingMyPosts = false;
                document.getElementById("btnMyGroupPosts").addEventListener("click", (e) => {
                    showingMyPosts = !showingMyPosts;
                    if (showingMyPosts) {
                        e.currentTarget.classList.replace("bg-gray-100", "bg-blue-100");
                        e.currentTarget.classList.replace("text-gray-700", "text-blue-700");
                        e.currentTarget.innerHTML = `<i class="fas fa-list"></i> Xem tất cả bài viết`;
                        // Override nextPostsUrl to my posts
                        nextPostsUrl = API.groupPostUser(GROUP_ID);
                        loadPosts(true);
                    } else {
                        e.currentTarget.classList.replace("bg-blue-100", "bg-gray-100");
                        e.currentTarget.classList.replace("text-blue-700", "text-gray-700");
                        e.currentTarget.innerHTML = `<i class="fas fa-user-edit"></i> Bài viết của tôi`;
                        nextPostsUrl = API.groupPostList(GROUP_ID);
                        loadPosts(true);
                    }
                });
            }
        }
        document.getElementById("groupCoverPlaceholder")?.classList.add("hidden");
    }

    // Company badges
    if (group.is_company) {
        document.getElementById("companyBadgeSidebar")?.classList.remove("hidden");
        document.querySelectorAll(".company-only").forEach((el) => el.classList.remove("hidden"));
        // Show suggestion box only for members
        apiGet(API.groupDetail(GROUP_ID), (data) => {
            if (data.join_status === "member") {
                document.getElementById("companySuggestionBox")?.classList.remove("hidden");
            }
        });
    }

    // History
    const historyEl = document.querySelector(".fa-history")?.closest(".flex");
    if (historyEl) {
        const textEl = historyEl.querySelector(".text-xs");
        if (textEl && group.created_at) {
            const days = Math.floor((Date.now() - new Date(group.created_at).getTime()) / 86400000);
            textEl.textContent =
                days < 1
                    ? "Nhóm được tạo hôm nay."
                    : days < 30
                        ? `Nhóm được tạo ${days} ngày trước.`
                        : days < 365
                            ? `Nhóm được tạo ${Math.floor(days / 30)} tháng trước.`
                            : `Nhóm được tạo ${Math.floor(days / 365)} năm trước.`;
        }
    }

    // Action buttons
    renderActionButtons(group);
}

// ============ ACTION BUTTONS ============
function renderActionButtons(group) {
    const container = document.getElementById("groupActionButtons");
    if (!container) return;

    isMember = group.join_status === "member";

    let btnHtml = "";
    if (group.join_status === "member") {
        btnHtml = `
      <button id="btnLeaveGroup" class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-gray-300 dark:hover:bg-gray-600 transition shadow-sm">
        <i class="fas fa-check-circle text-green-500"></i> Đã tham gia
      </button>
      <button class="bg-fb-primary text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-600 transition shadow-md" onclick="navigator.clipboard.writeText(window.location.href);showToast('Đã sao chép link nhóm!')">
        <i class="fas fa-share-nodes"></i>
      </button>`;
    } else if (group.join_status === "pending") {
        btnHtml = `
      <button id="btnCancelRequest" class="bg-yellow-100 text-yellow-700 border border-yellow-300 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-yellow-200 transition shadow-sm">
        <i class="fas fa-clock"></i> Đang chờ duyệt — Hủy?
      </button>`;
    } else {
        btnHtml = `
      <button id="btnJoinGroup" class="bg-fb-primary text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-600 transition shadow-lg shadow-blue-500/30 active:scale-95">
        <i class="fas fa-user-plus"></i> Tham gia nhóm
      </button>`;
    }
    container.innerHTML = btnHtml;

    document.getElementById("btnJoinGroup")?.addEventListener("click", joinGroup);
    document.getElementById("btnCancelRequest")?.addEventListener("click", cancelJoinRequest);
    document.getElementById("btnLeaveGroup")?.addEventListener("click", () => {
        if (confirm("Bạn có chắc muốn rời khỏi nhóm?")) leaveGroup();
    });
}

// ============ PERMISSIONS ============
function setupPermissions(group) {
    const isAdmin = group.role === "owner" || group.role === "admin";

    if (isAdmin) {
        initAdminPanel(GROUP_ID, group.is_company);
        document.getElementById("btnEditGroupCover")?.classList.remove("hidden");
        document.getElementById("navAdmin")?.classList.remove("hidden");
    }

    isMember = group.join_status === "member";

    if (isMember) {
        const composer = document.getElementById("groupComposerContainer");
        if (composer) {
            composer.classList.remove("hidden");
            composer.addEventListener("click", () => {
                window.GROUP_POSTING_MODE = GROUP_ID;
                const openBtn = document.getElementById("openPostModal");
                if (openBtn) openBtn.click();
            });
        }
    }
}

// ============ JOIN / LEAVE ============
async function joinGroup() {
    try {
        await apiMutate(API.groupSendRequest(GROUP_ID), "POST");
        showToast("Đã gửi yêu cầu tham gia nhóm!");
        loadGroupInfo();
    } catch (err) {
        showToast("Lỗi: " + err.message, "error");
    }
}

async function cancelJoinRequest() {
    try {
        await apiMutate(API.groupCancelRequest(GROUP_ID), "POST");
        showToast("Đã hủy yêu cầu.");
        loadGroupInfo();
    } catch (err) {
        showToast("Lỗi: " + err.message, "error");
    }
}

async function leaveGroup() {
    try {
        await apiMutate(API.groupLeave(GROUP_ID), "POST");
        showToast("Đã rời khỏi nhóm.");
        loadGroupInfo();
    } catch (err) {
        showToast("Lỗi: " + err.message, "error");
    }
}

// ============ COVER UPLOAD ============
async function handleCoverUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("cover_image", file);
    try {
        await apiMutate(API.groupUpdate(GROUP_ID), "PATCH", formData);
        showToast("Đã cập nhật ảnh bìa!");
        loadGroupInfo();
    } catch (err) {
        showToast("Lỗi: " + err.message, "error");
    }
    e.target.value = "";
}

// ============ POSTS ============
function loadPosts(append = false) {
    const container = document.getElementById("groupPostList");
    const loading = document.getElementById("loadingGroupPosts");
    if (!container) return;

    if (!isMember) {
        container.innerHTML = `
      <div class="glass-card p-8 rounded-2xl text-center border border-white/40 dark:border-white/5">
        <i class="fas fa-lock text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
        <h3 class="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">Nhóm Riêng Tư</h3>
        <p class="text-gray-500">Hãy tham gia nhóm để xem bài viết và tương tác cùng thành viên.</p>
      </div>`;
        return;
    }

    const url = append && nextPostsUrl ? nextPostsUrl : API.groupPostList(GROUP_ID);

    if (loading && !append) loading.classList.remove("hidden");

    apiGet(url, (data, isFromCache) => {
        if (loading) loading.classList.add("hidden");

        if (!append) container.innerHTML = "";

        const posts = data.results || (Array.isArray(data) ? data : []);
        if (posts.length > 0) {
            // Pinned post first
            const pinned = posts.find((p) => p.is_pinned);
            if (pinned && !append) {
                const pinnedContainer = document.getElementById("pinnedPostContainer");
                const pinnedContent = document.getElementById("pinnedPostContent");
                if (pinnedContainer && pinnedContent) {
                    pinnedContainer.classList.remove("hidden");
                    pinnedContent.innerHTML = renderPost(pinned);
                }
            }

            posts
                .filter((p) => !p.is_pinned)
                .forEach((post) => {
                    container.insertAdjacentHTML("beforeend", renderPost(post));
                });

            nextPostsUrl = data.next || null;
        } else if (!append) {
            container.innerHTML = `
        <div class="glass-card p-8 rounded-2xl text-center border border-white/40 dark:border-white/5">
          <i class="fas fa-newspaper text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
          <h3 class="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">Chưa có bài viết nào</h3>
          <p class="text-gray-500">Hãy là người đầu tiên chia sẻ nội dung với nhóm!</p>
        </div>`;
        }

        // Bind post action buttons
        bindPostActions();
    });
}

function renderPost(post) {
    const user = post.user || {};
    const avatar = user.picture || DEFAULT_AVATAR;
    const name = user.full_name || "Unknown";
    const time = new Date(post.created_at).toLocaleString("vi-VN");
    const photos = post.photos || [];
    const postId = post.post_id;

    const photosHtml =
        photos.length > 0
            ? `<div class="mt-3 rounded-xl overflow-hidden ${photos.length === 1 ? "max-h-96" : "grid grid-cols-2 gap-1"
            }">${photos
                .slice(0, 4)
                .map(
                    (ph, i) =>
                        `<img src="${ph.photo}" class="w-full object-cover ${photos.length > 1 ? "h-48" : "max-h-96"} cursor-pointer hover:opacity-95 transition" onclick="window.location.href='/post/${postId}/'" loading="lazy" onerror="this.src='${DEFAULT_AVATAR}'">`
                )
                .join("")}</div>`
            : "";

    const pendingBadge =
        post.post_status === "pending"
            ? `<span class="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full font-bold ml-2">Chờ duyệt</span>`
            : "";
    const pinnedBadge = post.is_pinned
        ? `<span class="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full font-bold ml-2"><i class="fas fa-thumbtack"></i> Đã ghim</span>`
        : "";

    const isAdmin = myRole === "owner" || myRole === "admin";

    const adminActions = isAdmin
        ? `
    <div class="flex gap-1 mt-3 pt-3 border-t dark:border-gray-700">
      ${post.is_pinned
            ? `<button class="btn-unpin-post px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-bold rounded-lg hover:bg-blue-100 transition" data-id="${postId}"><i class="fas fa-thumbtack"></i> Bỏ ghim</button>`
            : `<button class="btn-pin-post px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-bold rounded-lg hover:bg-blue-100 transition" data-id="${postId}"><i class="fas fa-thumbtack"></i> Ghim</button>`
        }
      ${post.post_status === "pending"
            ? `<button class="btn-approve-post px-3 py-1.5 bg-green-50 text-green-600 text-xs font-bold rounded-lg hover:bg-green-100 transition" data-id="${postId}"><i class="fas fa-check"></i> Duyệt</button>
             <button class="btn-reject-post px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition" data-id="${postId}"><i class="fas fa-times"></i> Từ chối</button>`
            : ""
        }
      <button class="btn-edit-post px-3 py-1.5 bg-yellow-50 text-yellow-600 text-xs font-bold rounded-lg hover:bg-yellow-100 transition" data-id="${postId}" data-content="${encodeURIComponent(post.content || '')}"><i class="fas fa-edit"></i> Sửa</button>
      <button class="btn-delete-post px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition" data-id="${postId}"><i class="fas fa-trash"></i> Xóa</button>
      <button class="btn-notify-post px-3 py-1.5 bg-purple-50 text-purple-600 text-xs font-bold rounded-lg hover:bg-purple-100 transition" data-id="${postId}"><i class="fas fa-bell"></i> Thông báo</button>
    </div>`
        : "";

    const commentsCount = post.comment_count || post.comments_count || 0;

    return `
    <div class="glass-card rounded-2xl shadow-sm border border-white/40 dark:border-white/5 overflow-hidden post-card" data-post-id="${postId}">
      <div class="p-4 cursor-pointer btn-detail-post" data-id="${postId}" title="Xem chi tiết bài viết">
        <div class="flex items-center gap-3 mb-3">
          <a href="${profileUrl(user.id || user.user)}" class="shrink-0">
            <img src="${avatar}" class="w-11 h-11 rounded-full object-cover shadow-sm border border-gray-100 dark:border-gray-700" onerror="this.src='${DEFAULT_AVATAR}'">
          </a>
          <div class="min-w-0 flex-1">
            <h5 class="font-bold text-gray-900 dark:text-white flex items-center flex-wrap">
              <a href="${profileUrl(user.id || user.user)}" class="hover:underline">${name}</a>
              ${pendingBadge}${pinnedBadge}
            </h5>
            <p class="text-xs text-gray-500 flex items-center gap-2">
              <span>${time}</span>
              <span class="cursor-pointer hover:text-fb-primary transition" onclick="window.location.href='/post/${postId}/'"><i class="fas fa-external-link-alt"></i></span>
            </p>
          </div>
        </div>
        <a href="/post/${postId}/" class="block text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed hover:text-gray-900 dark:hover:text-white transition">
          ${post.title || ""}
        </a>
        ${photosHtml}
        ${adminActions}
      </div>
    </div>`;
}

function bindPostActions() {
    // Pin/Unpin
    document.querySelectorAll(".btn-pin-post").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const postId = e.currentTarget.dataset.id;
            try {
                await apiMutate(API.groupPinPost(GROUP_ID, postId), "POST");
                showToast("Đã ghim bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    document.querySelectorAll(".btn-unpin-post").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const postId = e.currentTarget.dataset.id;
            try {
                await apiMutate(API.groupPinPost(GROUP_ID, postId), "POST", { is_pinned: false });
                showToast("Đã bỏ ghim bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Approve/Reject
    document.querySelectorAll(".btn-approve-post").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const postId = e.currentTarget.dataset.id;
            try {
                await apiMutate(API.groupReviewPost(GROUP_ID, postId), "POST", { action: "approved" });
                showToast("Đã duyệt bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    document.querySelectorAll(".btn-reject-post").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const postId = e.currentTarget.dataset.id;
            try {
                await apiMutate(API.groupReviewPost(GROUP_ID, postId), "POST", { action: "rejected" });
                showToast("Đã từ chối bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Delete
    document.querySelectorAll(".btn-delete-post").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const postId = e.currentTarget.dataset.id;
            if (!(await confirmAction("Xóa bài viết này?"))) return;
            try {
                await apiMutate(API.groupDeletePost(GROUP_ID, postId), "DELETE");
                showToast("Đã xóa bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Edit
    document.querySelectorAll(".btn-edit-post").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const postId = e.currentTarget.dataset.id;
            const currentContent = decodeURIComponent(e.currentTarget.dataset.content || "");
            const newContent = prompt("Sửa nội dung bài viết:", currentContent);
            if (!newContent || newContent === currentContent) return;
            try {
                await apiMutate(API.groupUpdatePost(GROUP_ID, postId), "PUT", { content: newContent });
                showToast("Đã cập nhật bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Detail
    document.querySelectorAll(".btn-detail-post").forEach((div) => {
        div.addEventListener("click", (e) => {
            if (e.target.closest("button") || e.target.closest("a") || e.target.closest("img")) return; // Don't trigger if clicked on child interactive elements
            const postId = e.currentTarget.dataset.id;
            apiGet(API.groupPostDetail(GROUP_ID, postId), (data) => {
                const post = data.results?.[0] || data;
                alert("Chi tiết bài viết: " + (post.content || "Không có nội dung") + "\\nĐăng lúc: " + new Date(post.created_at).toLocaleString("vi-VN"));
            }).catch(err => {
                showToast("Không thể tải chi tiết bài viết.", "error");
            });
        });
    });

    // Make notification (highlight post)
    document.querySelectorAll(".btn-notify-post").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const postId = e.currentTarget.dataset.id;
            try {
                await apiMutate(API.groupHighlightPost(GROUP_ID, postId), "POST");
                showToast("Đã gửi thông báo đến thành viên!");
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });
}

// ============ RULES ============
function renderRules() {
    const el = document.getElementById("groupRulesContent");
    if (el) {
        const rules = groupData?.rules || "Ban quản trị chưa thiết lập nội quy cho nhóm.";
        el.textContent = rules;
    }
}

// ============ MEMBERS ============
function loadMembers(initial = true) {
    const containerAll = document.getElementById("groupMembersList");
    const containerAdmins = document.getElementById("groupAdminsList");
    if (!containerAll || !containerAdmins) return;

    if (!isMember) {
        containerAll.innerHTML =
            "<p class='text-gray-500 text-sm col-span-full text-center py-8'>Chỉ thành viên mới xem được danh sách.</p>";
        return;
    }

    if (initial) {
        containerAll.innerHTML = `<div class="col-span-full py-8 flex justify-center"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
        containerAdmins.innerHTML = "";
        nextMembersUrl = API.groupMembers(GROUP_ID);
        isLoadingMembers = false;
    }

    if (!nextMembersUrl || isLoadingMembers) return;
    isLoadingMembers = true;

    if (!initial) {
        const loadMore = document.getElementById("loadMoreMembers");
        if (loadMore) loadMore.innerHTML = `<i class="fas fa-spinner fa-spin text-fb-primary"></i>`;
    }

    apiGet(nextMembersUrl, (data) => {
        isLoadingMembers = false;

        if (initial) {
            containerAll.innerHTML = "";
            containerAdmins.innerHTML = "";
        }

        const members = data.results || (Array.isArray(data) ? data : []);

        members.forEach((member) => {
            const user = member.user || {};
            const name = user.full_name || "Unknown";
            const avatar = user.picture || DEFAULT_AVATAR;
            const memberId = user.id || user.user;

            let roleBadge = "";
            if (member.role === "owner")
                roleBadge =
                    '<span class="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold ml-1"><i class="fas fa-crown"></i> Owner</span>';
            else if (member.role === "admin")
                roleBadge =
                    '<span class="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full font-bold ml-1"><i class="fas fa-shield-alt"></i> Admin</span>';

            const badge = member.department
                ? `<span class="text-xs text-gray-500 block mt-1">${member.department}${member.job_role ? " — " + member.job_role : ""}</span>`
                : "";

            const html = `
        <div class="flex items-center gap-4 p-4 border border-gray-100 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition">
          <a href="${profileUrl(memberId)}" class="shrink-0">
            <img src="${avatar}" class="w-14 h-14 rounded-full object-cover shadow-sm border border-gray-200 dark:border-gray-700" onerror="this.src='${DEFAULT_AVATAR}'">
          </a>
          <div class="flex-1 min-w-0">
            <h4 class="font-bold flex items-center flex-wrap text-gray-900 dark:text-white">
              <a href="${profileUrl(memberId)}" class="hover:underline truncate">${name}</a>
              ${roleBadge}
            </h4>
            ${badge}
          </div>
          ${myRole === "owner" && member.role === "member"
                    ? `<button class="btn-promote-admin text-sm bg-blue-50 hover:bg-blue-100 text-blue-600 px-3 py-1.5 rounded-lg font-bold transition" data-id="${memberId}" title="Thêm quyền Admin"><i class="fas fa-user-shield"></i></button>
                 <button class="btn-kick-member text-sm bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold transition" data-id="${memberId}" title="Xóa khỏi nhóm"><i class="fas fa-user-minus"></i></button>`
                    : myRole === "admin" && (member.role === "member")
                        ? `<button class="btn-kick-member text-sm bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold transition" data-id="${memberId}" title="Xóa khỏi nhóm"><i class="fas fa-user-minus"></i></button>`
                        : ""
                }
        </div>`;

            if (member.role === "owner" || member.role === "admin")
                containerAdmins.insertAdjacentHTML("beforeend", html);
            else containerAll.insertAdjacentHTML("beforeend", html);
        });

        // Load more button
        const loadMoreBtn = document.getElementById("loadMoreMembers");
        if (loadMoreBtn) loadMoreBtn.remove();

        if (data.next) {
            nextMembersUrl = data.next;
            const btnDiv = document.createElement("div");
            btnDiv.id = "loadMoreMembers";
            btnDiv.className = "col-span-full text-center";
            btnDiv.innerHTML = `<button class="px-6 py-2 bg-gray-100 dark:bg-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition">Xem thêm thành viên</button>`;
            btnDiv.querySelector("button").onclick = () => loadMembers(false);
            containerAll.parentElement.appendChild(btnDiv);
        } else {
            nextMembersUrl = null;
        }

        if (!containerAdmins.children.length)
            containerAdmins.innerHTML =
                "<p class='text-gray-500 text-sm col-span-full text-center py-4'>Chưa có thông tin.</p>";
        if (!containerAll.children.length)
            containerAll.innerHTML =
                "<p class='text-gray-500 text-sm col-span-full text-center py-4'>Chưa có thành viên nào khác.</p>";

        // Bind admin actions
        bindMemberActions();
    });
}

function bindMemberActions() {
    document.querySelectorAll(".btn-kick-member").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const uid = e.currentTarget.dataset.id;
            if (!(await confirmAction("Xóa thành viên này khỏi nhóm?"))) return;
            try {
                await apiMutate(API.groupKickMember(GROUP_ID, uid), "POST");
                showToast("Đã xóa thành viên!");
                loadMembers(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    document.querySelectorAll(".btn-promote-admin").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const uid = e.currentTarget.dataset.id;
            if (!(await confirmAction("Thêm quyền Admin cho thành viên này?"))) return;
            try {
                await apiMutate(API.groupAddAdmin(GROUP_ID, uid), "POST");
                showToast("Đã thêm quyền Admin!");
                loadMembers(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });
}

// ============ EVENTS ============
function loadEvents(initial = true) {
    const container = document.getElementById("groupEventsList");
    if (!container) return;

    if (!isMember) {
        container.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-calendar-times text-4xl mb-3 opacity-50"></i><p class="font-semibold">Hãy tham gia nhóm để xem sự kiện.</p></div>`;
        return;
    }

    if (initial) {
        container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
        nextEventsUrl = API.groupEventList(GROUP_ID);
        isLoadingEvents = false;
    }

    if (!nextEventsUrl || isLoadingEvents) return;
    isLoadingEvents = true;

    apiGet(nextEventsUrl, (data) => {
        isLoadingEvents = false;

        if (initial) container.innerHTML = "";
        const events = data.results || (Array.isArray(data) ? data : []);

        if (myRole === "owner" || myRole === "admin") {
            document.getElementById("btnCreateEvent")?.classList.remove("hidden");
        }

        if (events.length === 0 && initial) {
            container.innerHTML = `
        <div class="text-center py-10 text-gray-500">
          <i class="fas fa-calendar-times text-4xl mb-3 opacity-50"></i>
          <p class="font-semibold">Chưa có sự kiện nào.</p>
        </div>`;
            return;
        }

        events.forEach((event) => {
            const startDate = event.start_time
                ? new Date(event.start_time).toLocaleDateString("vi-VN", {
                    weekday: "long",
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                })
                : "Chưa có ngày";

            const isExpired = event.is_expired;
            const userStatus = event.is_accepted || null;

            let statusBadge = "";
            if (userStatus === "accept")
                statusBadge =
                    '<span class="bg-green-100 text-green-600 text-xs px-2 py-0.5 rounded-full font-bold ml-2"><i class="fas fa-check"></i> Đã tham gia</span>';
            else if (userStatus === "decline")
                statusBadge =
                    '<span class="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold ml-2"><i class="fas fa-times"></i> Đã từ chối</span>';
            else if (userStatus === "pending")
                statusBadge =
                    '<span class="bg-yellow-100 text-yellow-600 text-xs px-2 py-0.5 rounded-full font-bold ml-2"><i class="fas fa-clock"></i> Chưa phản hồi</span>';

            container.insertAdjacentHTML(
                "beforeend",
                `
        <div class="glass-card p-5 rounded-2xl shadow-sm border border-white/40 dark:border-white/5 hover:shadow-md transition" data-event-id="${event.id}">
          <div class="flex items-start gap-4">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-fb-primary to-purple-600 flex flex-col items-center justify-center text-white shrink-0 shadow-md">
              <span class="text-2xl font-black">${startDate.split(" ")[0]?.slice(0, 2) || "?"}</span>
              <span class="text-xs font-bold uppercase -mt-1">${new Date(event.start_time).toLocaleString("vi-VN", { month: "short" }) || ""}</span>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-bold text-lg text-gray-900 dark:text-white flex items-center">${event.title} ${statusBadge}</h4>
              <p class="text-sm text-gray-500 mt-1"><i class="far fa-clock mr-1"></i> ${startDate}</p>
              ${event.description
                    ? `<p class="text-sm text-gray-600 dark:text-gray-400 mt-2 line-clamp-2">${event.description}</p>`
                    : ""
                }
              ${isExpired
                    ? `<span class="inline-block mt-2 text-xs text-gray-400"><i class="fas fa-hourglass-end"></i> Đã kết thúc</span>`
                    : userStatus !== "accept"
                        ? `<div class="flex gap-2 mt-3">
                        <button class="btn-event-response px-4 py-1.5 bg-fb-primary text-white text-sm font-bold rounded-xl hover:bg-blue-600 transition" data-eid="${event.id}" data-response="accept"><i class="fas fa-check mr-1"></i> Tham gia</button>
                        <button class="btn-event-response px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition" data-eid="${event.id}" data-response="decline"><i class="fas fa-times mr-1"></i> Từ chối</button>
                      </div>`
                        : ""
                }
            </div>
            <div class="flex flex-col items-end gap-2 shrink-0">
                <button class="btn-event-participants px-3 py-1 bg-purple-50 text-purple-600 hover:bg-purple-100 rounded-lg text-xs font-bold transition" data-eid="${event.id}"><i class="fas fa-users"></i> Xem người tham gia</button>
                ${(myRole === "owner" || myRole === "admin") ? `
                    <button class="btn-event-edit px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg text-xs font-bold transition" data-eid="${event.id}" data-title="${event.title || ''}" data-desc="${event.description || ''}" data-start="${event.start_time || ''}" data-end="${event.end_time || ''}"><i class="fas fa-edit"></i> Sửa</button>
                    <button class="btn-event-delete px-3 py-1 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg text-xs font-bold transition" data-eid="${event.id}"><i class="fas fa-trash"></i> Xóa</button>
                ` : ''}
            </div>
          </div>
        </div>`
            );
        });

        // Bind event response buttons
        document.querySelectorAll(".btn-event-response").forEach((btn) => {
            btn.addEventListener("click", async (e) => {
                const eid = e.currentTarget.dataset.eid;
                const response = e.currentTarget.dataset.response;
                try {
                    await apiMutate(API.groupEventResponse(GROUP_ID, eid), "POST", { status: response });
                    showToast("Đã cập nhật trạng thái!");
                    loadEvents(true);
                } catch (err) {
                    showToast("Lỗi: " + err.message, "error");
                }
            });
        });

        // Event participants
        document.querySelectorAll(".btn-event-participants").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const eid = e.currentTarget.dataset.eid;
                apiGet(API.groupEventParticipants(GROUP_ID, eid), (data) => {
                    const participants = data.results || (Array.isArray(data) ? data : []);
                    if (participants.length === 0) {
                        alert("Chưa có người tham gia.");
                        return;
                    }
                    const names = participants.map(u => u.user?.full_name || u.user?.name || "Unknown").join("\\n");
                    alert("Người tham gia:\\n" + names);
                });
            });
        });

        // Edit event
        document.querySelectorAll(".btn-event-edit").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const dataset = e.currentTarget.dataset;
                const title = prompt("Sửa tiêu đề sự kiện:", dataset.title);
                if (!title?.trim()) return;

                const description = prompt("Sửa mô tả:", dataset.desc);
                const startTime = prompt("Thời gian bắt đầu (YYYY-MM-DD HH:MM):", dataset.start ? dataset.start.substring(0, 16).replace('T', ' ') : "");
                if (!startTime?.trim()) return;

                const data = {
                    title: title.trim(),
                    description: description?.trim() || "",
                    start_time: new Date(startTime.trim()).toISOString(),
                };
                try {
                    await apiMutate(API.groupEventDetail(GROUP_ID, dataset.eid), "PUT", data);
                    showToast("Đã cập nhật sự kiện!");
                    loadEvents(true);
                } catch (err) {
                    showToast("Lỗi: " + err.message, "error");
                }
            });
        });

        // Delete event
        document.querySelectorAll(".btn-event-delete").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const eid = e.currentTarget.dataset.eid;
                if (!(await confirmAction("Xóa sự kiện này?"))) return;
                try {
                    await apiMutate(API.groupEventDetail(GROUP_ID, eid), "DELETE");
                    showToast("Đã xóa sự kiện!");
                    loadEvents(true);
                } catch (err) {
                    showToast("Lỗi: " + err.message, "error");
                }
            });
        });
    });
}

// ============ VOTES TAB ============
function loadVotesTab(initial = true) {
    const container = document.getElementById("groupVotesList");
    if (!container) return;

    if (!isMember) {
        container.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-poll-h text-4xl mb-3 opacity-50"></i><p class="font-semibold">Hãy tham gia nhóm để xem bình chọn.</p></div>`;
        return;
    }

    if (initial) {
        container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
        nextVotesUrl = API.groupVoteList(GROUP_ID);
        isLoadingVotes = false;
    }

    if (!nextVotesUrl || isLoadingVotes) return;
    isLoadingVotes = true;

    apiGet(nextVotesUrl, (data) => {
        isLoadingVotes = false;

        if (initial) container.innerHTML = "";
        const votes = data.results || (Array.isArray(data) ? data : []);

        if (votes.length === 0 && initial) {
            container.innerHTML = `
        <div class="text-center py-10 text-gray-500">
          <i class="fas fa-poll-h text-4xl mb-3 opacity-50"></i>
          <p class="font-semibold">Chưa có cuộc bình chọn nào.</p>
        </div>`;
            document.getElementById("btnCreateVoteTab")?.classList.remove("hidden");
            return;
        }

        votes.forEach((vote) => {
            const options = vote.options || [];
            const totalVotes = options.reduce((sum, o) => sum + (o.count || 0), 0);
            const isClosed = vote.is_closed;

            container.insertAdjacentHTML(
                "beforeend",
                `
        <div class="glass-card p-5 rounded-2xl shadow-sm border border-white/40 dark:border-white/5 hover:shadow-md transition" data-vote-id="${vote.id}">
          <div class="flex items-start gap-3 mb-4">
            <div class="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 text-purple-600 flex items-center justify-center shrink-0">
              <i class="fas fa-poll"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="font-bold text-gray-900 dark:text-white">${vote.title || vote.question || "Bình chọn"}</h4>
              <p class="text-xs text-gray-500">
                <span>${totalVotes} phiếu</span>
                <span class="mx-1">•</span>
                <span>${new Date(vote.created_at).toLocaleDateString("vi-VN")}</span>
                ${isClosed
                    ? `<span class="ml-2 text-red-500 font-bold">• Đã đóng</span>`
                    : `<span class="ml-2 text-green-500">• Đang mở</span>`
                }
                <button class="btn-vote-detail text-blue-500 hover:underline ml-2" data-vid="${vote.id}">Chi tiết</button>
              </p>
            </div>
          </div>
          <div class="space-y-2">
            ${options
                    .map(
                        (opt) => `
              <div class="relative">
                <div class="flex items-center gap-2 mb-3 mt-4">
                    ${isClosed
                                ? `<span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-bold"><i class="fas fa-lock"></i> Đã đóng</span>`
                                : `<span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-600 font-bold"><i class="fas fa-check-circle"></i> Đang mở</span>`
                            }
                    ${!isClosed && (myRole === "owner" || myRole === "admin")
                                ? `<button class="btn-close-vote text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-bold hover:bg-red-100 transition" data-vid="${vote.id}"><i class="fas fa-ban"></i> Đóng bình chọn</button>
                             <button class="btn-delete-vote text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-bold hover:bg-gray-200 transition" data-vid="${vote.id}"><i class="fas fa-trash"></i> Xóa bình chọn</button>
                             <button class="btn-add-option-vote text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold hover:bg-blue-100 transition" data-vid="${vote.id}"><i class="fas fa-plus"></i> Thêm lựa chọn</button>`
                                : ""
                            }
                </div>
                <button class="btn-vote-option w-full text-left p-3 rounded-xl border ${opt.is_voted
                                ? "bg-fb-primary/10 border-fb-primary/40 font-bold"
                                : isClosed
                                    ? "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-70 cursor-default"
                                    : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-fb-primary/5 hover:border-fb-primary/30 transition"
                            }" data-vote-id="${vote.id}" data-opt-id="${opt.id}" ${isClosed ? "disabled" : ""}>
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200">${opt.text}</span>
                    <div class="flex items-center gap-2">
                        <span class="text-xs text-gray-500 font-bold btn-view-voters hover:text-fb-primary transition" data-vid="${vote.id}" data-oid="${opt.id}" title="Xem người bình chọn">${totalVotes > 0 ? Math.round((opt.count / totalVotes) * 100) : 0}% (${opt.count})</span>
                        ${!isClosed && (myRole === "owner" || myRole === "admin") ? `
                            <span class="text-gray-400 hover:text-blue-500 transition px-1 btn-edit-option" data-vid="${vote.id}" data-oid="${opt.id}" data-text="${opt.text}" title="Sửa lựa chọn"><i class="fas fa-edit"></i></span>
                            <span class="text-gray-400 hover:text-red-500 transition px-1 btn-delete-option" data-vid="${vote.id}" data-oid="${opt.id}" title="Xóa lựa chọn"><i class="fas fa-trash"></i></span>
                        ` : ''}
                    </div>
                  </div>
                  ${totalVotes > 0
                                ? `<div class="absolute bottom-0 left-0 h-full rounded-xl bg-fb-primary/10 pointer-events-none" style="width: ${(opt.count / totalVotes) * 100}%"></div>`
                                : ""
                            }
                </button>
              </div>`
                    )
                    .join("")}
          </div>
        </div>`
            );
        });

        // Show create vote button
        document.getElementById("btnCreateVoteTab")?.classList.remove("hidden");

        // Bind vote option clicks
        bindVoteActions();
    });
}

function bindVoteActions() {
    document.querySelectorAll(".btn-vote-option:not([disabled])").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const voteId = e.currentTarget.dataset.voteId;
            const optId = e.currentTarget.dataset.optId;
            try {
                await apiMutate(API.groupUserVote(GROUP_ID, voteId, optId), "POST");
                showToast("Đã bình chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Close vote
    document.querySelectorAll(".btn-close-vote").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const vid = e.currentTarget.dataset.vid;
            try {
                await apiMutate(API.groupUpdateVote(GROUP_ID, vid), "PATCH", { is_closed: true });
                showToast("Đã đóng bình chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Delete vote
    document.querySelectorAll(".btn-delete-vote").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const vid = e.currentTarget.dataset.vid;
            if (!(await confirmAction("Xóa bình chọn này?"))) return;
            try {
                await apiMutate(API.groupDeleteVote(GROUP_ID, vid), "DELETE");
                showToast("Đã xóa bình chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Add option
    document.querySelectorAll(".btn-add-option-vote").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const vid = e.currentTarget.dataset.vid;
            const text = prompt("Nhập lựa chọn mới:");
            if (!text?.trim()) return;
            try {
                await apiMutate(API.groupAddVoteOption(GROUP_ID, vid), "POST", { options: [text.trim()] });
                showToast("Đã thêm lựa chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Edit option
    document.querySelectorAll(".btn-edit-option").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const vid = e.currentTarget.dataset.vid;
            const oid = e.currentTarget.dataset.oid;
            const oldText = e.currentTarget.dataset.text;
            const text = prompt("Sửa lựa chọn:", oldText);
            if (!text?.trim() || text === oldText) return;
            try {
                await apiMutate(API.groupUpdateVoteOption(GROUP_ID, vid, oid), "PUT", { text: text.trim() });
                showToast("Đã cập nhật lựa chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Delete option
    document.querySelectorAll(".btn-delete-option").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const vid = e.currentTarget.dataset.vid;
            const oid = e.currentTarget.dataset.oid;
            if (!(await confirmAction("Xóa lựa chọn này?"))) return;
            try {
                await apiMutate(API.groupDeleteVoteOption(GROUP_ID, vid, oid), "DELETE");
                showToast("Đã xóa lựa chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // View voters
    document.querySelectorAll(".btn-view-voters").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vid = e.currentTarget.dataset.vid;
            const oid = e.currentTarget.dataset.oid;
            apiGet(API.groupListUserVote(GROUP_ID, vid, oid), (data) => {
                const users = data.results || (Array.isArray(data) ? data : []);
                if (users.length === 0) {
                    alert("Chưa có ai chọn mục này.");
                    return;
                }
                const names = users.map(u => u.full_name || u.name || "Unknown").join("\\n");
                alert("Những người đã chọn:\\n" + names);
            });
        });
    });

    // Vote Detail
    document.querySelectorAll(".btn-vote-detail").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vid = e.currentTarget.dataset.vid;
            apiGet(API.groupVoteDetail(GROUP_ID, vid), (data) => {
                const v = data.results?.[0] || data;
                alert("Chi tiết bình chọn: " + (v.title || v.question || "") + "\\nNgày tạo: " + new Date(v.created_at).toLocaleString("vi-VN") + "\\nTổng vote: " + (v.options || []).reduce((s,o)=>s+(o.count||0),0));
            });
        });
    });
}

// ============ ACTIVE VOTES SIDEBAR ============
function loadActiveVotesSidebar() {
    if (!groupData || !isMember) return;

    apiGet(API.groupVoteList(GROUP_ID), (data) => {
        const votes = (data.results || (Array.isArray(data) ? data : [])).filter((v) => !v.is_closed);
        if (votes.length === 0) return;
        const sidebar = document.getElementById("sidebarActiveVotes");
        const list = document.getElementById("sidebarVoteList");
        if (!sidebar || !list) return;
        sidebar.classList.remove("hidden");
        list.innerHTML = "";
        votes.slice(0, 3).forEach((v) => {
            const optCount = (v.options || []).length;
            list.insertAdjacentHTML(
                "beforeend",
                `
        <div class="bg-fb-primary/5 border border-fb-primary/20 rounded-xl p-3 cursor-pointer hover:bg-fb-primary/10 transition" onclick="document.querySelector('[data-tab=votes]')?.click()">
          <p class="font-bold text-sm text-gray-900 dark:text-white line-clamp-2">${v.title || v.question || "Bình chọn"}</p>
          <p class="text-xs text-gray-500 mt-1">${optCount} lựa chọn</p>
        </div>`
            );
        });
    });
}

// ============ SUGGESTION MODAL ============
function openSuggestionModal() {
    const content = prompt("Nhập nội dung góp ý của bạn (ẩn danh):");
    if (content?.trim()) {
        apiMutate(API.groupCreateSuggestion(GROUP_ID), "POST", {
            content: content.trim(),
        })
            .then(() => showToast("Đã gửi góp ý thành công!"))
            .catch((err) => showToast("Lỗi: " + err.message, "error"));
    }
}

// ============ INFINITE SCROLL ============
function setupInfiniteScroll() {
    let ticking = false;
    window.addEventListener(
        "scroll",
        () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(() => {
                if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 400) {
                    const activeTab = document.querySelector(
                        "#groupNav button.bg-fb-primary\\/10, #groupNav button[style*='bg-fb-primary']"
                    );
                    const tab = activeTab?.getAttribute("data-tab");
                    if (tab === "posts" && nextPostsUrl && !isLoadingPosts) {
                        loadPosts(true);
                    }
                    if (tab === "members" && nextMembersUrl && !isLoadingMembers) {
                        loadMembers(false);
                    }
                    if (tab === "events" && nextEventsUrl && !isLoadingEvents) {
                        loadEvents(false);
                    }
                    if (tab === "votes" && nextVotesUrl && !isLoadingVotes) {
                        loadVotesTab(false);
                    }
                }
                ticking = false;
            });
        },
        { passive: true }
    );
}

// ============ PHOTOS TAB ============
let nextPhotosUrl = null;
let isLoadingPhotos = false;
let allPhotos = [];

function loadPhotos(initial = true) {
    const container = document.getElementById("groupPhotosList");
    if (!container) return;

    if (!isMember) {
        container.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-images text-4xl mb-3 opacity-50"></i><p class="font-semibold">Hãy tham gia nhóm để xem ảnh.</p></div>`;
        return;
    }

    if (initial) {
        container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
        nextPhotosUrl = API.groupPhotos(GROUP_ID);
        isLoadingPhotos = false;
        allPhotos = [];
    }

    if (!nextPhotosUrl || isLoadingPhotos) return;
    isLoadingPhotos = true;

    apiGet(nextPhotosUrl, (data) => {
        isLoadingPhotos = false;

        if (initial) container.innerHTML = "";

        const newPhotos = data.results || (Array.isArray(data) ? data : []);
        allPhotos = allPhotos.concat(newPhotos);
        nextPhotosUrl = data.next || null;

        if (newPhotos.length === 0 && initial) {
            container.innerHTML = `
                <div class="text-center py-10 text-gray-500">
                    <i class="fas fa-images text-4xl mb-3 opacity-50"></i>
                    <p class="font-semibold">Chưa có ảnh nào trong nhóm.</p>
                </div>`;
            return;
        }

        const grid = container.querySelector(".photos-grid") || document.createElement("div");
        if (initial) {
            grid.className = "photos-grid grid grid-cols-2 md:grid-cols-3 gap-3";
            container.appendChild(grid);
        }

        newPhotos.forEach((photo) => {
            const imgUrl = photo.image || photo.photo || photo.url || "";
            if (!imgUrl) return;
            const div = document.createElement("div");
            div.className = "aspect-square rounded-2xl overflow-hidden shadow-sm cursor-pointer hover:opacity-90 transition border border-gray-100 dark:border-gray-700";
            div.innerHTML = `<img src="${imgUrl}" class="w-full h-full object-cover" loading="lazy" onerror="this.src='${DEFAULT_AVATAR}'">`;
            grid.appendChild(div);
        });

        // Load more
        const loadMoreBtn = container.querySelector(".btn-load-more-photos");
        if (loadMoreBtn) loadMoreBtn.remove();
        if (data.next) {
            const btn = document.createElement("button");
            btn.className = "btn-load-more-photos col-span-full mt-4 px-6 py-2 bg-gray-100 dark:bg-gray-700 rounded-xl font-bold text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition";
            btn.textContent = "Xem thêm ảnh";
            btn.onclick = () => loadPhotos(false);
            grid.after(btn);
        }
    });
}

// ============ SEARCH TAB ============
function loadSearch() {
    const container = document.getElementById("groupSearchContent");
    if (!container) return;

    if (!isMember) {
        container.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-search text-4xl mb-3 opacity-50"></i><p class="font-semibold">Hãy tham gia nhóm để tìm kiếm.</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="glass-card rounded-2xl p-6 shadow-sm border border-white/40 dark:border-white/5">
            <div class="relative mb-4">
                <input type="text" id="groupSearchInput" placeholder="Tìm kiếm trong nhóm..." class="w-full bg-gray-100 dark:bg-gray-800 rounded-xl py-3 px-4 pl-12 text-sm focus:outline-none focus:ring-2 focus:ring-fb-primary border dark:border-gray-700">
                <i class="fas fa-search absolute left-4 top-3.5 text-gray-400"></i>
            </div>
            <div class="flex gap-2 mb-4">
                <button class="search-type-btn px-4 py-1.5 bg-fb-primary text-white text-sm font-bold rounded-full" data-type="all">Tất cả</button>
                <button class="search-type-btn px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition" data-type="post">Bài viết</button>
                <button class="search-type-btn px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition" data-type="photo">Ảnh</button>
            </div>
            <div id="searchResults" class="space-y-4">
                <p class="text-center text-gray-500 py-8 text-sm">Nhập từ khóa để tìm kiếm trong nhóm.</p>
            </div>
        </div>`;

    let searchTimer = null;
    document.getElementById("groupSearchInput").addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            const q = e.target.value.trim();
            if (q.length >= 2) executeGroupSearch(q);
            else {
                document.getElementById("searchResults").innerHTML = `<p class="text-center text-gray-500 py-8 text-sm">Nhập ít nhất 2 ký tự để tìm kiếm.</p>`;
            }
        }, 400);
    });

    document.querySelectorAll(".search-type-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".search-type-btn").forEach((b) => {
                b.className = "search-type-btn px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition";
            });
            e.target.className = "search-type-btn px-4 py-1.5 bg-fb-primary text-white text-sm font-bold rounded-full";
            const q = document.getElementById("groupSearchInput").value.trim();
            if (q.length >= 2) executeGroupSearch(q);
        });
    });
}

let searchNextUrl = null;
let isLoadingSearch = false;

function executeGroupSearch(q, append = false) {
    const resultsContainer = document.getElementById("searchResults");
    if (!resultsContainer) return;

    const activeType = document.querySelector(".search-type-btn.bg-fb-primary")?.dataset.type || "all";

    if (!append) {
        resultsContainer.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
        searchNextUrl = null;
        isLoadingSearch = false;
    }

    const url = append && searchNextUrl ? searchNextUrl : API.groupSearch(GROUP_ID, q, activeType);

    if (!url || isLoadingSearch) return;
    isLoadingSearch = true;

    apiGet(url, (data) => {
        isLoadingSearch = false;

        if (!append) resultsContainer.innerHTML = "";

        const results = data.results || (Array.isArray(data) ? data : []);

        if (results.length === 0 && !append) {
            resultsContainer.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-search text-4xl mb-3 opacity-50"></i><p class="font-semibold">Không tìm thấy kết quả.</p></div>`;
            return;
        }

        results.forEach((item) => {
            if (activeType === "photo" || (item.image || item.photo)) {
                // Photo result
                const imgUrl = item.image || item.photo || item.url || "";
                resultsContainer.insertAdjacentHTML("beforeend", `
                    <div class="rounded-xl overflow-hidden aspect-video shadow-sm">
                        <img src="${imgUrl}" class="w-full h-full object-cover" loading="lazy" onerror="this.src='${DEFAULT_AVATAR}'">
                    </div>`);
            } else {
                // Post/member result
                const user = item.user || item.created_by || {};
                const avatar = user.picture || DEFAULT_AVATAR;
                const name = user.full_name || item.name || "Unknown";

                resultsContainer.insertAdjacentHTML("beforeend", `
                    <div class="glass-card p-4 rounded-2xl shadow-sm border border-white/40 dark:border-white/5">
                        <div class="flex items-center gap-3 mb-2">
                            <img src="${avatar}" class="w-10 h-10 rounded-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
                            <div>
                                <h5 class="font-bold text-sm text-gray-900 dark:text-white">${name}</h5>
                                <span class="text-xs text-gray-500">${item.created_at ? new Date(item.created_at).toLocaleString("vi-VN") : ""}</span>
                            </div>
                        </div>
                        <p class="text-gray-700 dark:text-gray-300 text-sm line-clamp-3">${item.title || item.content || item.description || ""}</p>
                    </div>`);
            }
        });

        searchNextUrl = data.next || null;
        if (data.next) {
            const loadMoreBtn = document.createElement("button");
            loadMoreBtn.className = "w-full py-2 mt-2 text-sm text-fb-primary font-bold hover:underline";
            loadMoreBtn.textContent = "Xem thêm kết quả";
            loadMoreBtn.onclick = () => executeGroupSearch(q, true);
            resultsContainer.appendChild(loadMoreBtn);
        }
    });
}

// ============ EXPOSE GLOBALLY ============
window.showToast = showToast;
window.loadPosts = loadPosts;
window.loadEvents = loadEvents;
window.loadVotesTab = loadVotesTab;
