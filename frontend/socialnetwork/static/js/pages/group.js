import { API, profileUrl, DEFAULT_AVATAR } from "../shared/config.js";
import { authFetch, authFetchCache } from "../authenticate/auth.js";
import { initAdminPanel } from "./groupManage.js";

const GROUP_ID = window.CURRENT_GROUP_ID;
let groupData = null;

// ============ HELPERS ============
/**
 * GET với cache: onData(data, isFromCache) - gọi tối đa 2 lần
 */
function apiGet(url, onData) {
    return authFetchCache(url, {}, onData);
}

/**
 * POST/PUT/PATCH/DELETE: không cache, trả Promise<data>
 */
async function apiMutate(url, method, body = null) {
    const options = { method };
    if (body instanceof FormData) {
        options.body = body;
    } else if (body !== null) {
        options.headers = { 'Content-Type': 'application/json' };
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

// ============ MAIN ============
document.addEventListener("DOMContentLoaded", async () => {
    if (!GROUP_ID) return;

    await loadGroupInfo();

    // Tab navigation
    const navButtons = document.querySelectorAll("#groupNav button[data-tab]");
    navButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
            navButtons.forEach(b => {
                b.className = "px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800";
            });
            e.target.className = "px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all bg-fb-primary/10 text-fb-primary shadow-sm";

            document.querySelectorAll(".group-tab-content").forEach(tab => tab.classList.add("hidden"));

            const tabName = e.target.getAttribute("data-tab");
            const tabId = `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`;
            const targetTab = document.getElementById(tabId);
            if (targetTab) {
                targetTab.classList.remove("hidden");
                targetTab.classList.remove("animate-fade-in");
                void targetTab.offsetWidth;
                targetTab.classList.add("animate-fade-in");
            }

            // Load dữ liệu tab với cache
            if (tabName === "rules") renderRules();
            else if (tabName === "members") loadMembers();
            else if (tabName === "events") loadEvents();
            else if (tabName === "votes") loadVotesTab();
        });
    });

    // Suggestion box
    document.getElementById("btnOpenSuggestionModal")?.addEventListener("click", async () => {
        const content = prompt("Nhập nội dung góp ý của bạn (ẩn danh):");
        if (content?.trim()) {
            try {
                await apiMutate(API.groupCreateSuggestion(GROUP_ID), 'POST', { content: content.trim() });
                showToast("Đã gửi góp ý thành công!");
            } catch (err) { showToast("Lỗi: " + err.message, "error"); }
        }
    });

    // Sidebar votes (dùng cache)
    loadActiveVotesSidebar();
});

// ============ LOAD GROUP INFO (cache) ============
async function loadGroupInfo() {
    return new Promise((resolve) => {
        apiGet(API.groupDetail(GROUP_ID), (data, isFromCache) => {
            groupData = data;
            renderHero(data);
            if (!isFromCache) {
                // Khi có data fresh từ server, setup permissions và load posts
                setupPermissions(data);
                if (!isFromCache || !document.getElementById("groupPostList").innerHTML) {
                    loadPosts();
                }
            } else {
                // Cache: render hero trước, posts sau khi fetch thực
                setupPermissions(data);
                loadPosts();
            }
            resolve(data);
        });
    });
}

// ============ RENDER HERO ============
function renderHero(group) {
    const nameEl = document.getElementById("groupName");
    const countEl = document.getElementById("groupMemberCount");
    const descEl = document.getElementById("groupDescriptionSidebar");

    if (nameEl) nameEl.textContent = group.name;
    if (countEl) countEl.innerHTML = `<i class="fas fa-users mr-1"></i> ${group.member_count || 0} thành viên`;
    if (descEl) descEl.textContent = group.description || "Nhóm chưa có mô tả.";

    if (group.avatar) {
        const img = document.getElementById("groupCoverImage");
        if (img) { img.src = group.avatar; img.classList.remove("hidden"); }
        document.getElementById("groupCoverPlaceholder")?.classList.add("hidden");
        const heroAvatar = document.getElementById("groupAvatarImageHero");
        if (heroAvatar) heroAvatar.src = group.avatar;
    }

    if (group.is_company) {
        document.getElementById("companyBadgeSidebar")?.classList.remove("hidden");
        document.querySelectorAll(".company-only").forEach(el => el.classList.remove("hidden"));
        if (group.join_status === 'member') {
            document.getElementById("companySuggestionBox")?.classList.remove("hidden");
        }
    }

    // Action buttons
    const actionContainer = document.getElementById("groupActionButtons");
    if (!actionContainer) return;

    let btnHtml = '';
    if (group.join_status === 'member') {
        btnHtml = `
            <button id="btnLeaveGroup" class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-gray-300 dark:hover:bg-gray-600 transition shadow-sm">
                <i class="fas fa-check-circle text-green-500"></i> Đã tham gia
            </button>
            <button class="bg-fb-primary text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-600 transition shadow-md">
                <i class="fas fa-user-plus"></i> Mời
            </button>`;
    } else if (group.join_status === 'pending') {
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
    actionContainer.innerHTML = btnHtml;

    document.getElementById("btnJoinGroup")?.addEventListener("click", joinGroup);
    document.getElementById("btnCancelRequest")?.addEventListener("click", cancelJoinRequest);
    document.getElementById("btnLeaveGroup")?.addEventListener("click", () => {
        if (confirm("Bạn có chắc muốn rời khỏi nhóm?")) leaveGroup();
    });
}

// ============ PERMISSIONS ============
function setupPermissions(group) {
    if (group.role === 'owner' || group.role === 'admin') {
        initAdminPanel(GROUP_ID, group.is_company);
        document.getElementById("btnEditGroupCover")?.classList.remove("hidden");
    }
    if (group.join_status === 'member') {
        const composer = document.getElementById("groupComposerContainer");
        if (composer) {
            composer.classList.remove("hidden");
            composer.addEventListener("click", () => {
                window.GROUP_POSTING_MODE = GROUP_ID;
                document.getElementById("openPostModal")?.click();
            });
        }
    }
}

// ============ JOIN / LEAVE ============
async function joinGroup() {
    try {
        await apiMutate(API.groupSendRequest(GROUP_ID), 'POST');
        showToast("Đã gửi yêu cầu tham gia nhóm!");
        loadGroupInfo();
    } catch (err) { showToast("Lỗi: " + err.message, "error"); }
}

async function cancelJoinRequest() {
    try {
        await apiMutate(API.groupCancelRequest(GROUP_ID), 'POST');
        showToast("Đã hủy yêu cầu.");
        loadGroupInfo();
    } catch (err) { showToast("Lỗi: " + err.message, "error"); }
}

async function leaveGroup() {
    try {
        await apiMutate(API.groupLeave(GROUP_ID), 'POST');
        showToast("Đã rời khỏi nhóm.");
        loadGroupInfo();
    } catch (err) { showToast("Lỗi: " + err.message, "error"); }
}

// ============ POSTS (cache) ============
let postsRendered = false;

function loadPosts() {
    const loading = document.getElementById("loadingGroupPosts");
    const container = document.getElementById("groupPostList");
    if (!loading || !container) return;

    if (groupData?.join_status !== 'member') {
        container.innerHTML = `
            <div class="glass-card p-8 rounded-2xl text-center border border-white/40 dark:border-white/5">
                <i class="fas fa-lock text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">Nhóm Riêng Tư</h3>
                <p class="text-gray-500">Hãy tham gia nhóm để xem bài viết và tương tác cùng thành viên.</p>
            </div>`;
        return;
    }

    loading.classList.remove("hidden");
    postsRendered = false;

    apiGet(API.groupPostList(GROUP_ID), (data, isFromCache) => {
        loading.classList.add("hidden");

        // Chỉ re-render nếu là fresh data hoặc lần đầu
        if (isFromCache && postsRendered) return;
        postsRendered = true;
        container.innerHTML = "";

        if (data.results && data.results.length > 0) {
            const pinned = data.results.find(p => p.is_pinned);
            if (pinned) {
                const pinnedContainer = document.getElementById("pinnedPostContainer");
                const pinnedContent = document.getElementById("pinnedPostContent");
                if (pinnedContainer && pinnedContent) {
                    pinnedContainer.classList.remove("hidden");
                    pinnedContent.innerHTML = renderGroupPost(pinned);
                }
                document.getElementById("newPostsLabel")?.classList.remove("hidden");
            }
            data.results.filter(p => !p.is_pinned).forEach(post => {
                container.insertAdjacentHTML('beforeend', renderGroupPost(post));
            });
        } else {
            container.innerHTML = `
                <div class="glass-card p-8 rounded-2xl text-center border border-white/40 dark:border-white/5">
                    <i class="fas fa-newspaper text-5xl text-gray-300 dark:text-gray-600 mb-4"></i>
                    <h3 class="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">Chưa có bài viết nào</h3>
                    <p class="text-gray-500">Hãy là người đầu tiên chia sẻ nội dung với nhóm!</p>
                </div>`;
        }
    });
}

function renderGroupPost(post) {
    const user = post.user || {};
    const avatar = user.picture || DEFAULT_AVATAR;
    const name = user.full_name || "Unknown";
    const time = new Date(post.created_at).toLocaleString('vi-VN');
    const photos = post.photos || [];
    const photosHtml = photos.length > 0
        ? `<div class="mt-3 rounded-xl overflow-hidden max-h-96"><img src="${photos[0].image}" class="w-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'"></div>`
        : '';
    const pendingBadge = post.status === 'pending'
        ? `<span class="bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full font-bold ml-2">Chờ duyệt</span>`
        : '';

    return `
        <div class="glass-card rounded-2xl shadow-sm border border-white/40 dark:border-white/5 overflow-hidden">
            <div class="p-4">
                <div class="flex items-center gap-3 mb-3">
                    <img src="${avatar}" class="w-11 h-11 rounded-full object-cover shadow-sm" onerror="this.src='${DEFAULT_AVATAR}'">
                    <div>
                        <h5 class="font-bold text-gray-900 dark:text-white flex items-center">${name} ${pendingBadge}</h5>
                        <p class="text-xs text-gray-500">${time}</p>
                    </div>
                </div>
                <p class="text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">${post.title || ""}</p>
                ${photosHtml}
            </div>
        </div>`;
}

// ============ RULES ============
function renderRules() {
    const el = document.getElementById("groupRulesContent");
    if (el) el.textContent = groupData?.rules || "Ban quản trị chưa thiết lập nội quy cho nhóm.";
}

// ============ MEMBERS (cache) ============
function loadMembers() {
    const containerAll = document.getElementById("groupMembersList");
    const containerAdmins = document.getElementById("groupAdminsList");
    if (!containerAll || !containerAdmins) return;

    if (groupData?.join_status !== 'member') {
        containerAll.innerHTML = "<p class='text-gray-500 text-sm col-span-full'>Chỉ thành viên mới xem được danh sách.</p>";
        return;
    }

    containerAll.innerHTML = `<div class="col-span-full py-8 flex justify-center"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
    containerAdmins.innerHTML = '';

    apiGet(API.groupMembers(GROUP_ID), (data, isFromCache) => {
        containerAll.innerHTML = "";
        containerAdmins.innerHTML = "";

        if (data.results && data.results.length > 0) {
            data.results.forEach(member => {
                const user = member.user || {};
                const name = user.full_name || "Unknown";
                const avatar = user.picture || DEFAULT_AVATAR;

                let roleBadge = '';
                if (member.role === 'owner') roleBadge = '<span class="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold ml-1">Owner</span>';
                else if (member.role === 'admin') roleBadge = '<span class="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full font-bold ml-1">Admin</span>';

                const html = `
                    <div class="flex items-center gap-4 p-4 border border-gray-100 dark:border-gray-800 rounded-2xl bg-white dark:bg-gray-800 shadow-sm hover:shadow-md transition">
                        <img src="${avatar}" class="w-14 h-14 rounded-full object-cover shadow-sm" onerror="this.src='${DEFAULT_AVATAR}'">
                        <div class="flex-1 min-w-0">
                            <h4 class="font-bold flex items-center text-gray-900 dark:text-white truncate">${name} ${roleBadge}</h4>
                        </div>
                    </div>`;

                if (member.role === 'owner' || member.role === 'admin') containerAdmins.insertAdjacentHTML('beforeend', html);
                else containerAll.insertAdjacentHTML('beforeend', html);
            });

            if (!containerAdmins.children.length) containerAdmins.innerHTML = "<p class='text-gray-500 text-sm'>Chưa có thông tin.</p>";
            if (!containerAll.children.length) containerAll.innerHTML = "<p class='text-gray-500 text-sm col-span-full'>Chưa có thành viên nào khác.</p>";
        }
    });
}

// ============ VOTES SIDEBAR (cache) ============
function loadActiveVotesSidebar() {
    if (!groupData || groupData.join_status !== 'member') return;

    apiGet(API.groupVoteList(GROUP_ID), (data) => {
        const votes = (data.results || []).filter(v => v.is_active);
        if (votes.length === 0) return;
        const sidebar = document.getElementById("sidebarActiveVotes");
        const list = document.getElementById("sidebarVoteList");
        if (!sidebar || !list) return;
        sidebar.classList.remove("hidden");
        list.innerHTML = "";
        votes.slice(0, 3).forEach(v => {
            list.insertAdjacentHTML('beforeend', `
                <div class="bg-fb-primary/5 border border-fb-primary/20 rounded-xl p-3">
                    <p class="font-bold text-sm text-gray-900 dark:text-white">${v.question || v.title || "Bình chọn"}</p>
                    <p class="text-xs text-gray-500 mt-1">${(v.options || []).length} lựa chọn</p>
                </div>`);
        });
    });
}

// ============ STUBS ============
async function loadEvents() { /* TODO */ }
async function loadVotesTab() { /* TODO */ }

// ============ TOAST ============
function showToast(msg, type = "info") {
    const toast = document.getElementById("toast");
    if (!toast) { console.warn(msg); return; }
    toast.textContent = msg;
    toast.className = `fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg z-[80] max-w-sm toast toast-${type}`;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 4000);
}
