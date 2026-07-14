import { API, groupUrl, DEFAULT_AVATAR, API_BASE_URL } from "../shared/config.js";
import { authFetch, authFetchCache } from "../authenticate/auth.js";

// ============ HELPERS ============
/**
 * GET với cache: hiển thị dữ liệu cache ngay, sau đó update nếu có thay đổi.
 * onData(data, isFromCache) được gọi tối đa 2 lần (cache + fresh).
 */
function apiGet(url, onData) {
    return authFetchCache(url, {}, onData);
}

/**
 * POST/PUT/PATCH/DELETE: không cache, trả Promise<data>.
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
document.addEventListener("DOMContentLoaded", () => {
    loadMyGroups();

    // Search với debounce
    const searchInput = document.getElementById("searchGroupInput");
    if (searchInput) {
        let debounceTimer;
        searchInput.addEventListener("input", (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                const query = e.target.value.trim();
                if (query) searchGroups(query);
                else {
                    const activeTab = document.querySelector('.nav-tab.bg-fb-primary\\/10');
                    if (activeTab && activeTab.id === 'tabExplore') {
                        loadExploreGroups();
                    } else {
                        loadMyGroups();
                    }
                }
            }, 500);
        });
    }

    // Tab Navigation
    const tabMyGroups = document.getElementById("tabMyGroups");
    const tabExplore = document.getElementById("tabExplore");
    const tabMyGroupsMobile = document.getElementById("tabMyGroupsMobile");
    const tabExploreMobile = document.getElementById("tabExploreMobile");

    function setActiveTab(isExplore) {
        // Desktop
        if (tabMyGroups) tabMyGroups.className = isExplore
            ? "nav-tab flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold transition hover-lift"
            : "nav-tab flex items-center gap-3 p-3 rounded-xl bg-fb-primary/10 text-fb-primary font-bold shadow-sm transition";
        if (tabMyGroups) tabMyGroups.querySelector('.icon-wrap').className = isExplore
            ? "w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 flex items-center justify-center icon-wrap"
            : "w-9 h-9 rounded-full bg-fb-primary text-white flex items-center justify-center shadow-md icon-wrap";

        if (tabExplore) tabExplore.className = isExplore
            ? "nav-tab flex items-center gap-3 p-3 rounded-xl bg-fb-primary/10 text-fb-primary font-bold shadow-sm transition"
            : "nav-tab flex items-center gap-3 p-3 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-semibold transition hover-lift";
        if (tabExplore) tabExplore.querySelector('.icon-wrap').className = isExplore
            ? "w-9 h-9 rounded-full bg-fb-primary text-white flex items-center justify-center shadow-md icon-wrap"
            : "w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 flex items-center justify-center icon-wrap";

        // Mobile
        if (tabMyGroupsMobile) tabMyGroupsMobile.className = isExplore
            ? "nav-tab-mobile px-5 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full font-bold whitespace-nowrap snap-start"
            : "nav-tab-mobile px-5 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-full font-bold whitespace-nowrap shadow-md snap-start";
        if (tabExploreMobile) tabExploreMobile.className = isExplore
            ? "nav-tab-mobile px-5 py-2.5 bg-gray-900 dark:bg-white text-white dark:text-gray-900 rounded-full font-bold whitespace-nowrap shadow-md snap-start"
            : "nav-tab-mobile px-5 py-2.5 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-full font-bold whitespace-nowrap snap-start";

        if (isExplore) loadExploreGroups();
        else loadMyGroups();
    }

    if (tabMyGroups) tabMyGroups.addEventListener("click", (e) => { e.preventDefault(); setActiveTab(false); });
    if (tabExplore) tabExplore.addEventListener("click", (e) => { e.preventDefault(); setActiveTab(true); });
    if (tabMyGroupsMobile) tabMyGroupsMobile.addEventListener("click", () => setActiveTab(false));
    if (tabExploreMobile) tabExploreMobile.addEventListener("click", () => setActiveTab(true));

    // Modal refs
    const btnCreateGroup = document.getElementById("btnCreateGroup");
    const btnCreateGroupMobile = document.getElementById("btnCreateGroupMobile");
    const createGroupModal = document.getElementById("createGroupModal");
    const closeBtns = document.querySelectorAll(".close-modal");
    const createGroupForm = document.getElementById("createGroupForm");
    const submitCreateGroup = document.getElementById("submitCreateGroup");
    const groupAvatarInput = document.getElementById("groupAvatarInput");
    const groupAvatarPreview = document.getElementById("groupAvatarPreview");
    const uploadCoverIcon = document.getElementById("uploadCoverIcon");
    const removeCoverBtn = document.getElementById("removeCoverBtn");

    function openModal() {
        createGroupModal.classList.remove("hidden");
        document.body.style.overflow = 'hidden';
        loadAdminAvatar();
    }

    async function loadAdminAvatar() {
        const avatarImg = document.getElementById("createGroupAdminAvatar");
        if (!avatarImg) return;
        try {
            // Dùng cache từ profile.js nếu có
            if (window.currentUserProfile && window.currentUserProfile.picture) {
                avatarImg.src = window.currentUserProfile.picture;
                return;
            }
            // Nếu chưa có, fetch từ API
            const res = await authFetch(`${API_BASE_URL}/api/user/`);
            if (res.ok) {
                const user = await res.json();
                if (user.picture) {
                    avatarImg.src = user.picture;
                }
            }
        } catch (e) {
            console.warn("loadAdminAvatar error:", e);
        }
    }

    function closeModal() {
        createGroupModal.classList.add("hidden");
        document.body.style.overflow = '';
        createGroupForm.reset();
        clearAvatarPreview();
        submitCreateGroup.disabled = false;
        submitCreateGroup.innerHTML = '<i class="fas fa-plus"></i> Tạo nhóm';
    }

    function clearAvatarPreview() {
        groupAvatarInput.value = "";
        groupAvatarPreview.src = "";
        groupAvatarPreview.classList.add("hidden");
        uploadCoverIcon.classList.remove("hidden");
        if (removeCoverBtn) removeCoverBtn.classList.add("hidden");
    }

    if (btnCreateGroup) btnCreateGroup.addEventListener("click", openModal);
    if (btnCreateGroupMobile) btnCreateGroupMobile.addEventListener("click", openModal);
    closeBtns.forEach(btn => btn.addEventListener("click", closeModal));
    createGroupModal.addEventListener("click", (e) => {
        if (e.target === createGroupModal) closeModal();
    });

    if (removeCoverBtn) {
        removeCoverBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            clearAvatarPreview();
        });
    }

    groupAvatarInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            groupAvatarPreview.src = ev.target.result;
            groupAvatarPreview.classList.remove("hidden");
            uploadCoverIcon.classList.add("hidden");
            if (removeCoverBtn) removeCoverBtn.classList.remove("hidden");
        };
        reader.readAsDataURL(file);
    });

    // Submit create group
    submitCreateGroup.addEventListener("click", async () => {
        const nameInput = createGroupForm.querySelector('[name="name"]');
        if (!nameInput || !nameInput.value.trim()) {
            nameInput.focus();
            nameInput.style.outline = '2px solid #ef4444';
            setTimeout(() => nameInput.style.outline = '', 2000);
            return;
        }

        const formData = new FormData();
        formData.append("name", nameInput.value.trim());
        formData.append("description", createGroupForm.querySelector('[name="description"]')?.value || "");
        formData.append("rules", createGroupForm.querySelector('[name="rules"]')?.value || "");
        formData.append("is_company", createGroupForm.querySelector('[name="is_company"]')?.checked ? "true" : "false");
        if (groupAvatarInput.files[0]) {
            formData.append("avatar", groupAvatarInput.files[0]);
        }

        submitCreateGroup.disabled = true;
        submitCreateGroup.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Đang tạo...';

        try {
            const data = await apiMutate(API.groupCreate(), 'POST', formData);
            window.location.href = groupUrl(data.id);
        } catch (error) {
            console.error("Create group error:", error);
            showToast("Lỗi: " + error.message, "error");
            submitCreateGroup.disabled = false;
            submitCreateGroup.innerHTML = '<i class="fas fa-plus"></i> Tạo nhóm';
        }
    });
});

// ============ LOAD MY GROUPS (với cache) ============
function loadMyGroups() {
    const container = document.getElementById("groupListContainer");
    const title = document.getElementById("groupListTitle");
    const loading = document.getElementById("loadingGroups");

    container.innerHTML = "";
    title.innerHTML = `<i class="fas fa-layer-group text-fb-primary"></i> Tất cả nhóm bạn đã tham gia`;
    container.classList.add("hidden");
    loading.classList.remove("hidden");

    let renderedFromCache = false;

    apiGet(API.groupUserGroups(), (data, isFromCache) => {
        loading.classList.add("hidden");
        container.classList.remove("hidden");

        if (isFromCache && !renderedFromCache) renderedFromCache = true;

        container.innerHTML = "";
        const groups = data.results || (Array.isArray(data) ? data : []);
        if (groups.length > 0) {
            groups.forEach(group => {
                container.insertAdjacentHTML('beforeend', createGroupCard(group));
            });
        } else {
            container.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center text-gray-500 py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <div class="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                        <i class="fas fa-users-slash text-3xl text-gray-400"></i>
                    </div>
                    <p class="font-bold text-gray-700 dark:text-gray-300">Bạn chưa tham gia nhóm nào</p>
                    <p class="text-sm mt-1 mb-4">Khám phá các nhóm để tham gia hoặc tạo nhóm của riêng bạn.</p>
                </div>`;
        }
    }).catch(error => {
        console.error(error);
        loading.classList.add("hidden");
        container.classList.remove("hidden");
        container.innerHTML = `<div class="col-span-full text-center text-red-500 py-8"><i class="fas fa-exclamation-triangle mr-2"></i> Lỗi tải danh sách: ${error.message}</div>`;
    });
}

// ============ EXPLORE GROUPS ============
function loadExploreGroups() {
    const container = document.getElementById("groupListContainer");
    const title = document.getElementById("groupListTitle");
    const loading = document.getElementById("loadingGroups");

    container.innerHTML = "";
    title.innerHTML = `<i class="fas fa-compass text-fb-primary"></i> Khám phá các nhóm dành cho bạn`;
    container.classList.add("hidden");
    loading.classList.remove("hidden");

    let renderedFromCache = false;

    apiGet(API.groupExplore(), (data, isFromCache) => {
        loading.classList.add("hidden");
        container.classList.remove("hidden");

        if (isFromCache && !renderedFromCache) renderedFromCache = true;

        container.innerHTML = "";
        const groups = data.results || (Array.isArray(data) ? data : []);
        if (groups.length > 0) {
            groups.forEach(group => {
                container.insertAdjacentHTML('beforeend', createGroupCard(group, true)); // true -> is explore
            });
        } else {
            container.innerHTML = `
                <div class="col-span-full flex flex-col items-center justify-center text-gray-500 py-16 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <div class="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                        <i class="fas fa-globe text-3xl text-gray-400"></i>
                    </div>
                    <p class="font-bold text-gray-700 dark:text-gray-300">Không có nhóm mới nào</p>
                    <p class="text-sm mt-1 mb-4">Có vẻ bạn đã tham gia hết các nhóm hiện có, hoặc chưa có nhóm nào được tạo.</p>
                </div>`;
        }
    }).catch(error => {
        console.error(error);
        loading.classList.add("hidden");
        container.classList.remove("hidden");
        container.innerHTML = `<div class="col-span-full text-center text-red-500 py-8"><i class="fas fa-exclamation-triangle mr-2"></i> Lỗi tải danh sách: ${error.message}</div>`;
    });
}

// ============ SEARCH (không cache vì query động) ============
async function searchGroups(query) {
    const container = document.getElementById("groupListContainer");
    const title = document.getElementById("groupListTitle");
    const loading = document.getElementById("loadingGroups");

    container.innerHTML = "";
    title.innerHTML = `<i class="fas fa-search text-fb-primary"></i> Kết quả cho "<b>${query}</b>"`;
    container.classList.add("hidden");
    loading.classList.remove("hidden");

    try {
        const res = await authFetch(API.search(query, 'groups'));
        const data = await res.json();
        loading.classList.add("hidden");
        container.classList.remove("hidden");

        const groups = data.groups || data.results || (Array.isArray(data) ? data : []);
        if (groups.length > 0) {
            groups.forEach(group => container.insertAdjacentHTML('beforeend', createGroupCard(group)));
        } else {
            container.innerHTML = `
                <div class="col-span-full text-center text-gray-500 py-12">
                    <i class="fas fa-search text-3xl mb-3 opacity-40"></i>
                    <p class="font-semibold">Không tìm thấy nhóm nào cho từ khóa "<b>${query}</b>".</p>
                </div>`;
        }
    } catch (error) {
        console.error(error);
        loading.classList.add("hidden");
        container.classList.remove("hidden");
    }
}

// ============ RENDER GROUP CARD ============
function createGroupCard(group, isExplore = false) {
    const avatar = group.avatar || DEFAULT_AVATAR;
    const isCompany = group.is_company
        ? `<span class="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-xs px-2.5 py-1 rounded-full font-bold ml-2 border border-blue-200 dark:border-blue-800/50 flex items-center gap-1"><i class="fas fa-building text-[10px]"></i> Công ty</span>`
        : '';
    const memberCount = group.member_count || 0;
    const actionText = isExplore ? "Xem & Tham gia" : "Truy cập nhóm";

    return `
        <a href="${groupUrl(group.id)}" class="glass-card rounded-2xl overflow-hidden card-hover block group border border-white/50 dark:border-white/5 bg-white dark:bg-gray-800">
            <div class="h-32 bg-gray-200 dark:bg-gray-700 w-full relative overflow-hidden">
                <img src="${avatar}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.src='${DEFAULT_AVATAR}'">
                <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>
            </div>
            <div class="p-5 relative -mt-6">
                <div class="w-16 h-16 rounded-xl border-4 border-white dark:border-gray-800 shadow-md bg-white overflow-hidden mb-3">
                    <img src="${avatar}" class="w-full h-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
                </div>
                <h4 class="font-black text-gray-900 dark:text-white truncate text-lg">${group.name}</h4>
                <div class="flex items-center gap-2 mt-2 flex-wrap">
                    <p class="text-sm text-gray-500 font-semibold"><i class="fas fa-users mr-1"></i> ${memberCount} thành viên</p>
                    ${isCompany}
                </div>
                <div class="mt-4 pt-4 border-t dark:border-gray-700 flex justify-between items-center text-sm font-semibold text-gray-500 group-hover:text-fb-primary transition-colors">
                    <span>${actionText}</span>
                    <i class="fas fa-arrow-right opacity-0 group-hover:opacity-100 transition-opacity group-hover:translate-x-1"></i>
                </div>
            </div>
        </a>`;
}

// ============ TOAST ============
function showToast(msg, type = "info") {
    const toast = document.getElementById("toast");
    if (!toast) { console.warn(msg); return; }
    toast.textContent = msg;
    toast.className = `fixed bottom-5 right-5 px-4 py-3 rounded-lg shadow-lg z-[80] max-w-sm toast toast-${type}`;
    toast.classList.remove("hidden");
    setTimeout(() => toast.classList.add("hidden"), 4000);
}
