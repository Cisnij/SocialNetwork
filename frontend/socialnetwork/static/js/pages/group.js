import { API, profileUrl } from "../shared/config.js";
import { authFetch, authFetchCache } from "../authenticate/auth.js";
import { initAdminPanel } from "./groupManage.js";
import { initCommentsPanel } from "../shared/comments-panel.js";
import { fetchUserProfileShared } from "../app/profile.js";
import { renderPostCard } from "../shared/posts/render.js";
import { openReactionsModal, openPhotoModal } from "../shared/posts/modals.js";

// ============ STATE ============
const GROUP_ID = window.CURRENT_GROUP_ID;
let groupData = null;
let isMember = false;
let myRole = null;
let myUserId = null;

// Sidebar loaded flags to prevent duplicate API calls
let sidebarVotesLoaded = false;
let sidebarAdminLoaded = false;

// Pagination states
let nextPostsUrl = null;
let isLoadingPosts = false;

let nextMembersUrl = null;
let isLoadingMembers = false;

let nextEventsUrl = null;
let isLoadingEvents = false;

let nextVotesUrl = null;
let isLoadingVotes = false;

let nextPhotosUrl = null;
let isLoadingPhotos = false;
let allPhotos = [];

let searchNextUrl = null;
let isLoadingSearch = false;

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

// Modal nhập 1 trường (thay thế prompt) -> Promise<string|null>
function openInputModal({ title = "Nhập", label = "", value = "", placeholder = "", required = true } = {}) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
        overlay.innerHTML = `
            <div class="glass-card rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-scale-in">
                <h3 class="font-bold text-lg text-gray-900 dark:text-white mb-4">${escapeHtml(title)}</h3>
                ${label ? `<label class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">${escapeHtml(label)}</label>` : ""}
                <input type="text" class="vote-input-modal w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-fb-primary text-gray-800 dark:text-white" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}">
                <div class="flex gap-2 justify-end mt-5">
                    <button type="button" class="vote-input-cancel px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition">Hủy</button>
                    <button type="button" class="vote-input-ok px-6 py-2 rounded-lg bg-fb-primary text-white font-semibold hover:bg-blue-600 transition shadow-md">Lưu</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const input = overlay.querySelector(".vote-input-modal");
        const close = (val) => { overlay.remove(); resolve(val); };

        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(null); });
        overlay.querySelector(".vote-input-cancel").addEventListener("click", () => close(null));
        overlay.querySelector(".vote-input-ok").addEventListener("click", () => {
            const v = input.value.trim();
            if (required && !v) { input.focus(); return; }
            close(v || null);
        });
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") overlay.querySelector(".vote-input-ok").click();
            if (e.key === "Escape") close(null);
        });
        setTimeout(() => input.focus(), 50);
    });
}

// Modal thông báo (thay thế alert) -> Promise<void>
function openAlertModal(title, messageHtml) {
    return new Promise((resolve) => {
        const overlay = document.createElement("div");
        overlay.className = "fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
        overlay.innerHTML = `
            <div class="glass-card rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-scale-in">
                <h3 class="font-bold text-lg text-gray-900 dark:text-white mb-3">${escapeHtml(title)}</h3>
                <div class="text-gray-700 dark:text-gray-300 text-sm whitespace-pre-wrap leading-relaxed mb-5">${messageHtml || ""}</div>
                <div class="flex justify-end">
                    <button type="button" class="vote-alert-ok px-6 py-2 rounded-lg bg-fb-primary text-white font-semibold hover:bg-blue-600 transition shadow-md">Đóng</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);
        const close = () => { overlay.remove(); resolve(); };
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
        overlay.querySelector(".vote-alert-ok").addEventListener("click", close);
    });
}

// Modal danh sách user (thay thế alert danh sách)
function openUserListModal(title, users) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
    const body = users.length
        ? `<div class="space-y-2 max-h-[60vh] overflow-y-auto">${users
            .map((u) => {
                const first = u.first_name || "";
                const last = u.last_name || "";
                const name = `${first} ${last}`.trim() || u.name || "Unknown";
                const avatar = u.picture || "";
                const uid = u.user || u.id;
                return `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                    <a href="${profileUrl(uid)}"><img src="${avatar}" class="w-10 h-10 rounded-full object-cover border" onerror="this.src=''"></a>
                    <a href="${profileUrl(uid)}" class="font-semibold text-gray-800 dark:text-gray-200 hover:underline">${escapeHtml(name)}</a>
                </div>`;
            })
            .join("")}</div>`
        : `<p class="text-center text-gray-500 py-8">Chưa có ai.</p>`;
    overlay.innerHTML = `
        <div class="glass-card rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-scale-in">
            <div class="flex items-center justify-between mb-4">
                <h3 class="font-bold text-lg text-gray-900 dark:text-white">${escapeHtml(title)}</h3>
                <button type="button" class="userlist-close text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl font-bold leading-none">&times;</button>
            </div>
            ${body}
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".userlist-close").addEventListener("click", close);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function normalizeListResponse(data) {
    return data?.results || (Array.isArray(data) ? data : []);
}

function clearGroupCaches() {
    [API.groupExplore(), API.groupUserGroups(), API.groupMyRequests()].forEach((url) => {
        if (typeof url === 'string') {
            sessionStorage.removeItem(`authCache_${url}`);
        }
    });
}

function openInlineFormModal({ title, bodyHtml, okText = "Lưu", getValues, validate }) {
    return new Promise((resolve) => {
        const modal = document.getElementById("formModal");
        const backdrop = document.getElementById("formModalBackdrop");
        const titleEl = document.getElementById("formModalTitle");
        const bodyEl = document.getElementById("formModalBody");
        const errorEl = document.getElementById("formModalError");
        const cancelBtn = document.getElementById("formModalCancel");
        const okBtn = document.getElementById("formModalOk");

        if (!modal || !titleEl || !bodyEl || !errorEl || !cancelBtn || !okBtn) {
            resolve(null);
            return;
        }

        titleEl.textContent = title;
        bodyEl.innerHTML = bodyHtml;
        okBtn.textContent = okText;
        errorEl.textContent = "";
        errorEl.classList.add("hidden");
        modal.classList.remove("hidden");

        const close = (value = null) => {
            modal.classList.add("hidden");
            if (backdrop) backdrop.onclick = null;
            cancelBtn.onclick = null;
            okBtn.onclick = null;
            resolve(value);
        };

        if (backdrop) backdrop.onclick = () => close(null);
        cancelBtn.onclick = () => close(null);
        okBtn.onclick = () => {
            const values = getValues ? getValues(bodyEl) : {};
            const error = validate ? validate(values) : "";
            if (error) {
                errorEl.textContent = error;
                errorEl.classList.remove("hidden");
                return;
            }
            close(values);
        };

        setTimeout(() => {
            bodyEl.querySelector("input, textarea, select")?.focus();
        }, 0);
    });
}

function setCompanyUIState(isCompany) {
    const wasViewingEvents = !document.getElementById("tabEvents")?.classList.contains("hidden");
    const wasViewingAdminDepartments = !document.getElementById("adminDepartments")?.classList.contains("hidden");
    const wasViewingAdminSuggestions = !document.getElementById("adminSuggestions")?.classList.contains("hidden");

    document.querySelectorAll(".company-only").forEach((el) => {
        el.classList.toggle("hidden", !isCompany);
    });
    document.getElementById("companyBadgeSidebar")?.classList.toggle("hidden", !isCompany);
    document.getElementById("companySuggestionBox")?.classList.toggle("hidden", !(isCompany && isMember));

    if (!isCompany) {
        document.getElementById("tabEvents")?.classList.add("hidden");
        document.getElementById("adminDepartments")?.classList.add("hidden");
        document.getElementById("adminSuggestions")?.classList.add("hidden");

        if (wasViewingEvents) {
            document.querySelector('#groupNav button[data-tab="posts"]')?.click();
        }

        if (wasViewingAdminDepartments || wasViewingAdminSuggestions) {
            document.querySelector('.admin-tab[data-target="adminPendingPosts"]')?.click();
        }
    }
}

function updateUIVisibilityForMembership() {
    const groupNav = document.getElementById("groupNav");
    const groupSidebar = document.getElementById("groupSidebar");
    const sidebarActiveVotes = document.getElementById("sidebarActiveVotes");
    const sidebarAdminCard = document.getElementById("sidebarAdminCard");
    const companySuggestionBox = document.getElementById("companySuggestionBox");
    const navAdmin = document.getElementById("navAdmin");
    const isAdmin = myRole === "owner" || myRole === "admin";

    if (!isMember) {
        if (groupNav) groupNav.classList.add("hidden");
        if (groupSidebar) groupSidebar.classList.add("hidden");

        document.querySelectorAll(".group-tab-content").forEach((tab) => tab.classList.add("hidden"));
        const rulesTab = document.getElementById("tabRules");
        if (rulesTab) rulesTab.classList.remove("hidden");

        if (sidebarActiveVotes) sidebarActiveVotes.classList.add("hidden");
        if (sidebarAdminCard) sidebarAdminCard.classList.add("hidden");
        if (companySuggestionBox) companySuggestionBox.classList.add("hidden");
        if (navAdmin) navAdmin.classList.add("hidden");
    } else {
        if (groupNav) groupNav.classList.remove("hidden");
        if (groupSidebar) groupSidebar.classList.remove("hidden");

        document.querySelectorAll("#groupNav button[data-tab]").forEach((btn) => {
            btn.classList.remove("hidden");
        });

        if (!isAdmin && navAdmin) {
            navAdmin.classList.add("hidden");
        } else if (isAdmin && navAdmin) {
            navAdmin.classList.remove("hidden");
        }

        const activeBtn = document.querySelector("#groupNav button.bg-fb-primary\\/10");
        if (activeBtn) {
            const tabName = activeBtn.getAttribute("data-tab");
            const tabId = `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`;
            const targetTab = document.getElementById(tabId);
            if (targetTab) targetTab.classList.remove("hidden");
        }

        if (sidebarActiveVotes && !sidebarVotesLoaded) {
            loadActiveVotesSidebar();
            sidebarVotesLoaded = true;
        }
        if (sidebarAdminCard && !sidebarAdminLoaded) {
            loadAdminSidebar();
            sidebarAdminLoaded = true;
        }
        if (companySuggestionBox) {
            companySuggestionBox.classList.toggle("hidden", !(groupData?.is_company && isMember));
        }
    }
}

// ============ MAIN INIT ============
document.addEventListener("DOMContentLoaded", async () => {
    console.log("[GROUP] DOMContentLoaded, GROUP_ID:", GROUP_ID);
    if (!GROUP_ID) {
        console.error("[GROUP] No GROUP_ID found");
        return;
    }

    initCommentsPanel();
    const { initShareModal } = await import("../shared/share-modal.js");
    initShareModal();

    try {
        await fetchUserProfileShared();
        console.log("[GROUP] fetchUserProfileShared done");
    } catch (err) {
        console.error("[GROUP] fetchUserProfileShared failed:", err);
    }

    try {
        await loadGroupInfo();
        console.log("[GROUP] loadGroupInfo done");
    } catch (err) {
        console.error("[GROUP] loadGroupInfo failed:", err);
    }

    setupGroupSettings();
    setupGroupDelete();

    // Tab navigation
    const navButtons = document.querySelectorAll("#groupNav button[data-tab]");
    navButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
            const clickedBtn = e.currentTarget;
            navButtons.forEach((b) => {
                b.className =
                    "px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800";
            });
            clickedBtn.className =
                "px-5 py-2.5 rounded-xl font-bold whitespace-nowrap transition-all bg-fb-primary/10 text-fb-primary shadow-sm";

            document.querySelectorAll(".group-tab-content").forEach((tab) => tab.classList.add("hidden"));

            const tabName = clickedBtn.getAttribute("data-tab");
            const tabId = `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`;
            const targetTab = document.getElementById(tabId);
            if (targetTab) {
                targetTab.classList.remove("hidden");
                targetTab.classList.remove("animate-fade-in");
                void targetTab.offsetWidth;
                targetTab.classList.add("animate-fade-in");
            }

            updateUIVisibilityForMembership();

            // Load data on tab switch
            if (tabName === "rules") renderRules();
            else if (tabName === "members") loadMembers(true);
            else if (tabName === "events") loadEvents(true);
            else if (tabName === "votes") loadVotesTab(true);
            else if (tabName === "photos") loadPhotos(true);
            else if (tabName === "search") loadSearch();
            else if (tabName === "myposts") loadMyGroupPosts("approved");
        });
    });

    // My-group-posts filter switch
    document.querySelectorAll(".my-post-filter").forEach((btn) => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".my-post-filter").forEach((b) => {
                b.className =
                    "my-post-filter py-2.5 px-5 rounded-t-lg font-bold transition-all text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 border-b-2 border-transparent";
            });
            btn.className =
                "my-post-filter active py-2.5 px-5 rounded-t-lg font-bold transition-all bg-fb-primary/10 text-fb-primary border-b-2 border-fb-primary";
            loadMyGroupPosts(btn.getAttribute("data-filter") || "approved");
        });
    });

    // Member search (filter list by first_name / last_name)
    const memberSearchInput = document.getElementById("searchMemberInput");
    if (memberSearchInput && !memberSearchInput.dataset.bound) {
        memberSearchInput.dataset.bound = "1";
        let memberSearchTimer = null;
        memberSearchInput.addEventListener("input", (e) => {
            clearTimeout(memberSearchTimer);
            const val = e.target.value.trim();
            memberSearchTimer = setTimeout(() => {
                memberSearchKeyword = val;
                loadMembers(true);
            }, 400);
        });
    }

    // Suggestion box
    document.getElementById("btnOpenSuggestionModal")?.addEventListener("click", openSuggestionModal);

    // Close any open vote kebab menu on outside click
    document.addEventListener("click", () => {
        document.querySelectorAll(".vote-kebab-menu:not(.hidden)").forEach((m) => m.classList.add("hidden"));
    });

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
    sidebarVotesLoaded = false;
    sidebarAdminLoaded = false;
    try {
        // Fetch group data
        const data = await new Promise((resolve, reject) => {
            apiGet(API.groupDetail(GROUP_ID), (result, isCache) => {
                // authFetchCache calls onData(data, isCache)
                // Resolve on both cache and network response.
                // If cache matches network, onData may not be called again,
                // so we must resolve on the first call.
                resolve(result);
            });
            // Timeout safeguard
            setTimeout(() => reject(new Error("Timeout")), 15000);
        });
        groupData = data;
        myRole = data.role || null;
        
        // Get current user ID from currentUserProfile as source of truth
        try {
            await fetchUserProfileShared(); // Ensure profile is loaded
            myUserId = Number(window.currentUserProfile?.id) || null;
        } catch (profileErr) {
            console.error("[GROUP] Failed to get user profile for ID:", profileErr);
            // Fallback to data.user_id if profile not available
            myUserId = data.user_id ? Number(data.user_id) : null;
        }
        
        isMember = data.join_status === "member";

        renderHero(data);
        setupPermissions(data);

        if (isMember) {
            loadPosts();
        } else {
            renderRules();
        }
        return data;
    } catch (err) {
        console.error("[GROUP] loadGroupInfo failed:", err);
        const nameEl = document.getElementById("groupName");
        if (nameEl) nameEl.textContent = "Lỗi tải nhóm";
        showToast("Không thể tải thông tin nhóm: " + (err.message || "Unknown error"), "error");
        return null;
    }
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
    const avatarUrl = group.avatar || "";
    const heroAvatar = document.getElementById("groupAvatarImageHero");
    if (heroAvatar) {
        heroAvatar.src = avatarUrl;
        heroAvatar.onerror = null;
    }

    // Cover image
    if (group.cover_image) {
        const coverImg = document.getElementById("groupCoverImage");
        if (coverImg) {
            coverImg.src = group.cover_image;
            coverImg.classList.remove("hidden");
        }
        document.getElementById("groupCoverPlaceholder")?.classList.add("hidden");
    } else {
        const coverImg = document.getElementById("groupCoverImage");
        if (coverImg) coverImg.classList.add("hidden");
        document.getElementById("groupCoverPlaceholder")?.classList.remove("hidden");
    }

    // Company badges and company-only UI
    setCompanyUIState(Boolean(group.is_company));

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
    updateUIVisibilityForMembership();

    let btnHtml = "";
    if (group.join_status === "member") {
        btnHtml = `
      <button id="btnLeaveGroup" class="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/50 transition shadow-sm">
        <i class="fas fa-sign-out-alt"></i> Rời nhóm
      </button>
      <button class="bg-fb-primary text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-600 transition shadow-md" onclick="navigator.clipboard.writeText(window.location.href);showToast('Đã sao chép link nhóm!')">
        <i class="fas fa-share-nodes"></i> Sao chép link
      </button>`;
    } else if (group.join_status === "pending") {
        btnHtml = `
      <button id="btnCancelRequest" class="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-yellow-200 dark:hover:bg-yellow-900/60 transition shadow-sm">
        <i class="fas fa-clock"></i> Hủy yêu cầu
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
    document.getElementById("btnLeaveGroup")?.addEventListener("click", async () => {
        if (group.role === "owner") {
            const newOwnerId = await showTransferOwnershipModal();
            if (newOwnerId === null) return;
            const confirmed = await showFormModal("Xác nhận rời nhóm", `
                <div class="text-center py-4">
                    <img src="${groupData?.avatar || ""}" class="w-16 h-16 rounded-full object-cover mx-auto mb-4 border-2 border-red-200 dark:border-red-800 shadow-sm">
                    <p class="text-gray-800 dark:text-white font-bold text-lg mb-2">Bạn có chắc muốn rời nhóm?</p>
                    <p class="text-sm text-gray-500">Quyền sở hữu sẽ được chuyển cho admin đã chọn. Hành động này không thể hoàn tác.</p>
                </div>
            `);
            const okBtn = document.getElementById("formModalOk");
            if (okBtn) {
                okBtn.textContent = "Rời nhóm";
                okBtn.classList.remove("bg-fb-primary", "hover:bg-blue-600");
                okBtn.classList.add("bg-red-500", "hover:bg-red-600");
            }
            if (!confirmed) return;
            await leaveGroup(newOwnerId);
        } else {
            const confirmed = await showFormModal("Rời nhóm", `
                <div class="text-center py-4">
                    <img src="${groupData?.avatar || ""}" class="w-16 h-16 rounded-full object-cover mx-auto mb-4 border-2 border-red-200 dark:border-red-800 shadow-sm">
                    <p class="text-gray-800 dark:text-white font-bold text-lg mb-2">Bạn có chắc muốn rời khỏi nhóm?</p>
                    <p class="text-sm text-gray-500">Sau khi rời nhóm, bạn sẽ không xem được nội dung và phải gửi yêu cầu tham gia lại nếu muốn quay lại.</p>
                </div>
            `);
            const okBtn = document.getElementById("formModalOk");
            if (okBtn) {
                okBtn.textContent = "Rời nhóm";
                okBtn.classList.remove("bg-fb-primary", "hover:bg-blue-600");
                okBtn.classList.add("bg-red-500", "hover:bg-red-600");
            }
            if (!confirmed) return;
            await leaveGroup(null);
        }
    });
}

async function showTransferOwnershipModal() {
    const container = document.getElementById("groupActionButtons");
    try {
        const data = await new Promise((resolve, reject) => {
            apiGet(API.groupAdminList(GROUP_ID), (result, isCache) => {
                resolve(result);
            });
        });
        const admins = data.results || (Array.isArray(data) ? data : []);
        const adminMembers = admins.filter(a => a.role === "admin");

        if (adminMembers.length === 0) {
            showToast("Không thể rời nhóm vì bạn là owner duy nhất. Hãy thêm admin trước!", "error");
            return null;
        }

        const result = await showFormModal("Chuyển quyền Owner", `
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">Chọn admin để chuyển quyền sở hữu trước khi rời nhóm:</p>
            <div class="space-y-2 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
                ${adminMembers.map((a) => {
            const user = a.user || {};
            const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || "Admin";
            const avatar = user.picture || "";
            const uid = user.user || user.id || a.user_id;
            return `
                        <label class="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
                            <input type="radio" name="ownerOption" value="${uid}" class="accent-fb-primary w-4 h-4">
                            <img src="${avatar}" class="w-8 h-8 rounded-full object-cover">
                            <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">${name}</span>
                        </label>
                    `;
        }).join("")}
            </div>
        `, async (body) => {
            const selected = body.querySelector('input[name="ownerOption"]:checked');
            if (!selected) throw new Error("Vui lòng chọn admin để chuyển quyền");
            return parseInt(selected.value);
        });

        return result;
    } catch (err) {
        showToast("Lỗi tải danh sách admin: " + err.message, "error");
        return null;
    }
}

// ============ GROUP COMPOSER MODAL ============
let groupComposerFiles = [];

function openGroupComposer() {
    const modal = document.getElementById("groupComposerModal");
    const content = document.getElementById("groupPostContent");
    const preview = document.getElementById("groupPhotoPreview");
    const photoInput = document.getElementById("groupPhotoInput");
    
    if (!modal) return;
    
    content.value = "";
    groupComposerFiles = [];
    preview.innerHTML = "";
    photoInput.value = "";
    
    modal.classList.remove("hidden");
    content.focus();
}

function closeGroupComposer() {
    const modal = document.getElementById("groupComposerModal");
    const preview = document.getElementById("groupPhotoPreview");
    const photoInput = document.getElementById("groupPhotoInput");
    
    if (modal) modal.classList.add("hidden");
    groupComposerFiles = [];
    preview.innerHTML = "";
    photoInput.value = "";
}

function updateComposerAvatar() {
    const composerAvatar = document.getElementById("myAvatarComposer");
    if (!composerAvatar) return;

    const picture = window.currentUserProfile?.picture || "";
    if (picture) {
        composerAvatar.src = picture;
    }
}

function updateGroupPhotoPreview() {
    const preview = document.getElementById("groupPhotoPreview");
    if (!preview) return;
    preview.replaceChildren();
    
    groupComposerFiles.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const div = document.createElement("div");
            div.className = "relative";
            const img = document.createElement("img");
            img.src = e.target.result;
            img.alt = "Preview";
            img.className = "w-full h-32 object-cover rounded-lg";
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600";
            removeBtn.textContent = "×";
            removeBtn.onclick = () => {
                groupComposerFiles = groupComposerFiles.filter((_, i) => i !== index);
                updateGroupPhotoPreview();
            };
            div.appendChild(img);
            div.appendChild(removeBtn);
            preview.appendChild(div);
        };
        reader.readAsDataURL(file);
    });
}

async function submitGroupPost() {
    const content = document.getElementById("groupPostContent")?.value.trim();
    const photoInput = document.getElementById("groupPhotoInput");
    
    if (!content && groupComposerFiles.length === 0) {
        showToast("⚠️ Vui lòng nhập nội dung hoặc thêm ảnh", "red");
        return;
    }
    
    const formData = new FormData();
    formData.append("title", content || "Bài viết mới");
    groupComposerFiles.forEach((file) => {
        formData.append("photos", file);
    });
    
    const submitBtn = document.getElementById("groupComposerSubmit");
    submitBtn.disabled = true;
    submitBtn.textContent = "Đang đăng...";
    
    try {
        const resPost = await authFetch(API.groupCreatePost(GROUP_ID), {
            method: "POST",
            body: formData,
        });
        
        if (!resPost.ok) {
            const errorData = await resPost.json().catch(() => ({}));
            showToast(errorData.error || "⚠️ Không tạo được bài viết", "red");
            return;
        }
        
        const newPost = await resPost.json();
        closeGroupComposer();
        showToast("✅ Bài viết đã được đăng!");
        
        document.dispatchEvent(new CustomEvent("newPostCreated", { detail: newPost }));
        
        if (isMember) {
            loadPosts();
        }
    } catch (err) {
        console.error("Create group post error:", err);
        showToast("⚠️ Không thể kết nối server", "red");
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Đăng";
    }
}

// ============ PERMISSIONS ============
function setupPermissions(group) {
    const isAdmin = group.role === "owner" || group.role === "admin";

    if (isAdmin) {
        initAdminPanel(GROUP_ID, group.is_company);
        document.getElementById("btnEditGroupCover")?.classList.remove("hidden");
        document.getElementById("navAdmin")?.classList.remove("hidden");
        document.getElementById("groupAdminActions")?.classList.remove("hidden");
    } else {
        document.getElementById("navAdmin")?.classList.add("hidden");
        document.getElementById("groupAdminActions")?.classList.add("hidden");
    }

    if (isMember) {
        const composer = document.getElementById("groupComposerContainer");
        if (composer) {
            composer.classList.remove("hidden");
            composer.addEventListener("click", () => {
                openGroupComposer();
            });
        }
        updateComposerAvatar();
    }
    
    // Group composer modal events
    document.getElementById("groupComposerBackdrop")?.addEventListener("click", closeGroupComposer);
    document.getElementById("groupComposerCancel")?.addEventListener("click", closeGroupComposer);
    document.getElementById("groupComposerSubmit")?.addEventListener("click", submitGroupPost);
    document.getElementById("groupPhotoInput")?.addEventListener("change", (event) => {
        const files = Array.from(event.target.files);
        groupComposerFiles = [...groupComposerFiles, ...files];
        updateGroupPhotoPreview();
    });
}

// ============ JOIN / LEAVE ============
async function joinGroup() {
    try {
        const result = await apiMutate(API.groupSendRequest(GROUP_ID), "POST");
        const detail = result?.detail || "";
        const container = document.getElementById("groupActionButtons");
        if (container) {
            container.innerHTML = `
                <button id="btnCancelRequest" class="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-yellow-200 dark:hover:bg-yellow-900/60 transition shadow-sm">
                    <i class="fas fa-clock"></i> Đang chờ duyệt — Hủy
                </button>`;
            document.getElementById("btnCancelRequest")?.addEventListener("click", cancelJoinRequest);
        }
        if (groupData) groupData.join_status = "pending";
        isMember = false;
        updateUIVisibilityForMembership();
        clearGroupCaches();
        showToast("Đã gửi yêu cầu tham gia nhóm!");
    } catch (err) {
        const msg = err.message || "";
        if (msg.includes("đã là thành viên") || msg.includes("đã tham gia")) {
            showToast("Bạn đã là thành viên nhóm!");
            const container = document.getElementById("groupActionButtons");
            if (container) {
                container.innerHTML = `
                    <button id="btnLeaveGroup" class="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-red-100 dark:hover:bg-red-900/50 transition shadow-sm">
                        <i class="fas fa-sign-out-alt"></i> Rời nhóm
                    </button>
                    <button class="bg-fb-primary text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-600 transition shadow-md" onclick="navigator.clipboard.writeText(window.location.href);showToast('Đã sao chép link nhóm!')">
        <i class="fas fa-share-nodes"></i> Sao chép link
      </button>`;
                document.getElementById("btnLeaveGroup")?.addEventListener("click", async () => {
                    if (groupData?.role === "owner") {
                        const newOwnerId = await showTransferOwnershipModal();
                        if (newOwnerId === null) return;
                        const confirmed = await showFormModal("Xác nhận rời nhóm", `
                            <div class="text-center py-4">
                                <img src="${groupData?.avatar || ""}" class="w-16 h-16 rounded-full object-cover mx-auto mb-4 border-2 border-red-200 dark:border-red-800 shadow-sm">
                                <p class="text-gray-800 dark:text-white font-bold text-lg mb-2">Bạn có chắc muốn rời nhóm?</p>
                                <p class="text-sm text-gray-500">Quyền sở hữu sẽ được chuyển cho admin đã chọn. Hành động này không thể hoàn tác.</p>
                            </div>
                        `);
                        const okBtn = document.getElementById("formModalOk");
                        if (okBtn) {
                            okBtn.textContent = "Rời nhóm";
                            okBtn.classList.remove("bg-fb-primary", "hover:bg-blue-600");
                            okBtn.classList.add("bg-red-500", "hover:bg-red-600");
                        }
                        if (!confirmed) return;
                        await leaveGroup(newOwnerId);
                    } else {
                        const confirmed = await showFormModal("Rời nhóm", `
                            <div class="text-center py-4">
                                <img src="${groupData?.avatar || ""}" class="w-16 h-16 rounded-full object-cover mx-auto mb-4 border-2 border-red-200 dark:border-red-800 shadow-sm">
                                <p class="text-gray-800 dark:text-white font-bold text-lg mb-2">Bạn có chắc muốn rời khỏi nhóm?</p>
                                <p class="text-sm text-gray-500">Sau khi rời nhóm, bạn sẽ không xem được nội dung và phải gửi yêu cầu tham gia lại nếu muốn quay lại.</p>
                            </div>
                        `);
                        const okBtn = document.getElementById("formModalOk");
                        if (okBtn) {
                            okBtn.textContent = "Rời nhóm";
                            okBtn.classList.remove("bg-fb-primary", "hover:bg-blue-600");
                            okBtn.classList.add("bg-red-500", "hover:bg-red-600");
                        }
                        if (!confirmed) return;
                        await leaveGroup(null);
                    }
                });
            }
            if (groupData) groupData.join_status = "member";
            isMember = true;
            updateUIVisibilityForMembership();
            clearGroupCaches();
        } else if (msg.includes("đã gửi yêu cầu") || msg.includes("đã gửi")) {
            showToast("Bạn đã gửi yêu cầu tham gia rồi!");
            const container = document.getElementById("groupActionButtons");
            if (container) {
                container.innerHTML = `
                    <button id="btnCancelRequest" class="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 border border-yellow-300 dark:border-yellow-700 px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-yellow-200 dark:hover:bg-yellow-900/60 transition shadow-sm">
                        <i class="fas fa-clock"></i> Đang chờ duyệt — Hủy?
                    </button>`;
                document.getElementById("btnCancelRequest")?.addEventListener("click", cancelJoinRequest);
            }
            if (groupData) groupData.join_status = "pending";
            isMember = false;
            updateUIVisibilityForMembership();
            clearGroupCaches();
        } else {
            showToast("Lỗi: " + msg, "error");
        }
    }
}

async function cancelJoinRequest() {
    try {
        await apiMutate(API.groupCancelRequest(GROUP_ID), "POST");
        showToast("Đã hủy yêu cầu.");
        const container = document.getElementById("groupActionButtons");
        if (container) {
            container.innerHTML = `
                <button id="btnJoinGroup" class="bg-fb-primary text-white px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-600 transition shadow-lg shadow-blue-500/30 active:scale-95">
                    <i class="fas fa-user-plus"></i> Tham gia nhóm
                </button>`;
            document.getElementById("btnJoinGroup")?.addEventListener("click", joinGroup);
        }
        if (groupData) groupData.join_status = "none";
        isMember = false;
        updateUIVisibilityForMembership();
        clearGroupCaches();
    } catch (err) {
        showToast("Lỗi: " + err.message, "error");
    }
}

async function leaveGroup(nextOwnerId = null) {
    try {
        const body = nextOwnerId ? { next_owner_id: nextOwnerId } : {};
        await apiMutate(API.groupLeave(GROUP_ID), "POST", body);
        showToast("Đã rời khỏi nhóm.");
        clearGroupCaches();

        if (groupData) {
            groupData.join_status = "none";
            groupData.role = null;
        }
        isMember = false;
        updateUIVisibilityForMembership();
        renderActionButtons(groupData || { join_status: "none", role: null });
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
            const pinnedContainer = document.getElementById("pinnedPostContainer");
            const pinnedContent = document.getElementById("pinnedPostContent");
            if (pinned && !append) {
                if (pinnedContainer && pinnedContent) {
                    pinnedContainer.classList.remove("hidden");
                    pinnedContent.innerHTML = "";
                    const card = buildGroupPostCard(pinned);
                    if (card) pinnedContent.appendChild(card);
                }
            } else if (pinnedContainer) {
                pinnedContainer.classList.add("hidden");
                if (pinnedContent) pinnedContent.innerHTML = "";
            }

            posts
                .filter((p) => !p.is_pinned)
                .forEach((post) => {
                    const card = buildGroupPostCard(post);
                    if (card) container.appendChild(card);
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

        // Post action buttons are bound inline by renderPostCard / buildGroupPostCard
    });
}

// ============ MY GROUP POSTS (approved / pending / rejected) ============
function loadMyGroupPosts(filter = "approved") {
    const container = document.getElementById("myGroupPostsList");
    if (!container) return;

    if (!isMember) {
        container.innerHTML = `
      <div class="text-center py-10 text-gray-500">
        <i class="fas fa-lock text-4xl mb-3 opacity-50"></i>
        <p class="font-semibold">Chỉ thành viên mới xem được mục này.</p>
      </div>`;
        return;
    }

    container.innerHTML = `
      <div class="text-center py-10 text-gray-400">
        <i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i>
      </div>`;

    apiGet(API.groupPostUser(GROUP_ID, filter), (data) => {
        const posts = data.results || (Array.isArray(data) ? data : []);
        container.innerHTML = "";

        if (posts.length === 0) {
            const labels = {
                approved: "Bạn chưa có bài viết nào được duyệt.",
                pending: "Không có bài viết nào đang chờ duyệt.",
                rejected: "Không có bài viết nào bị từ chối.",
            };
            container.innerHTML = `
        <div class="text-center py-10 text-gray-500">
          <i class="fas fa-inbox text-4xl mb-3 opacity-50"></i>
          <p class="font-semibold">${labels[filter] || "Không có bài viết nào."}</p>
        </div>`;
            return;
        }

        posts.forEach((post) => {
            const card = buildGroupPostCard(post, { myPostsView: true });
            if (card) container.appendChild(card);
        });
    });
}


function buildGroupPostCard(post, opts = {}) {
    const user = post.user || {};
    const isAdmin = myRole === "owner" || myRole === "admin";
    const isPostOwner = Number(user.user) === myUserId || Number(user.id) === myUserId;
    const canEdit = isPostOwner;
    const canDelete = isAdmin || isPostOwner;
    const postId = post.post_id;

    const card = renderPostCard(post, {
        currentUserId: myUserId,
        isGroupPost: true,
        navigateOnClick: false,
        showShare: false,
        showCopyLink: false,
        showPrivacy: false,
        disableInteractions:
            opts.myPostsView ||
            post.post_status === "pending" ||
            post.post_status === "rejected",
        onPinGroupPost: isAdmin
            ? async (p) => {
                  try {
                      await apiMutate(API.groupPinPost(GROUP_ID, p.post_id), "POST");
                      showToast(p.is_pinned ? "Đã bỏ ghim bài viết!" : "Đã ghim bài viết!");
                      loadPosts();
                  } catch (err) {
                      showToast("Lỗi: " + err.message, "error");
                  }
              }
            : null,
        onEditGroupPost: canEdit
            ? (p) => editGroupPost(p)
            : null,
        onNotifyGroupPost: isAdmin
            ? async (p) => {
                  try {
                      await apiMutate(API.groupHighlightPost(GROUP_ID, p.post_id), "POST");
                      showToast("Đã gửi thông báo đến thành viên!");
                  } catch (err) {
                      showToast("Lỗi: " + err.message, "error");
                  }
              }
            : null,
        onDeleteGroupPost: canDelete
            ? async (pid) => {
                  if (!(await confirmAction("Xóa bài viết này?"))) return;
                  try {
                      await apiMutate(API.groupDeletePost(GROUP_ID, pid), "DELETE");
                      showToast("Đã xóa bài viết!");
                      loadPosts();
                  } catch (err) {
                      showToast("Lỗi: " + err.message, "error");
                  }
              }
            : null,
        onOpenReactions: openReactionsModal,
        onOpenPhotos: openPhotoModal,
    });

    if (!card) return null;

    card.classList.add("glass-card", "rounded-2xl", "shadow-sm",
        "border", "border-white/40", "dark:border-white/5", "overflow-hidden", "mb-4");

    // Pending / rejected badges
    if (post.post_status === "pending" || post.post_status === "rejected") {
        const badge = document.createElement("span");
        if (post.post_status === "pending") {
            badge.className = "bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full font-bold ml-2";
            badge.textContent = "Chờ duyệt";
        } else {
            badge.className = "bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-bold ml-2";
            badge.textContent = "Đã từ chối";
        }
        const nameLink = card.querySelector("a.font-semibold") || card.querySelector("h5 a");
        if (nameLink && nameLink.parentElement) nameLink.parentElement.appendChild(badge);
    }

    // Admin approve/reject bar for pending posts (kept separate from 3-dot menu)
    if (isAdmin && post.post_status === "pending") {
        const bar = document.createElement("div");
        bar.className = "flex gap-1 mt-3 pt-3 border-t dark:border-gray-700 flex-wrap";
        const approveBtn = document.createElement("button");
        approveBtn.className = "px-3 py-1.5 bg-green-50 text-green-600 text-xs font-bold rounded-lg hover:bg-green-100 transition";
        approveBtn.innerHTML = `<i class="fas fa-check"></i> Duyệt`;
        approveBtn.addEventListener("click", async () => {
            try {
                await apiMutate(API.groupReviewPost(GROUP_ID, postId), "POST", { action: "approved" });
                showToast("Đã duyệt bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
        const rejectBtn = document.createElement("button");
        rejectBtn.className = "px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded-lg hover:bg-red-100 transition";
        rejectBtn.innerHTML = `<i class="fas fa-times"></i> Từ chối`;
        rejectBtn.addEventListener("click", async () => {
            try {
                await apiMutate(API.groupReviewPost(GROUP_ID, postId), "POST", { action: "rejected" });
                showToast("Đã từ chối bài viết!");
                loadPosts();
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
        bar.append(approveBtn, rejectBtn);
        card.appendChild(bar);
    }

    return card;
}

function buildGroupPhotoUrl(photoObj) {
    if (!photoObj) return null;
    const candidate =
        photoObj.photo ||
        photoObj.image ||
        photoObj.url ||
        photoObj.photo_url ||
        photoObj.file ||
        "";
    if (!candidate || candidate === "null" || candidate === "undefined") return null;
    if (candidate.startsWith("/")) return new URL(candidate, window.location.origin).href;
    return candidate;
}

async function editGroupPost(post) {
    const modal = document.getElementById("editPostModal");
    if (!modal) {
        showToast("Không tìm thấy modal chỉnh sửa", "error");
        return;
    }
    const titleInput = document.getElementById("editPostTitle");
    const saveBtn = document.getElementById("savePostChanges");
    const cancelBtn = document.getElementById("cancelEditPost");
    const imageContainer = document.getElementById("editImageContainer");
    const newImagesInput = document.getElementById("editNewImages");
    const newImagesPreview = document.getElementById("editNewImagesPreview");

    const markedForDeletion = new Set();
    if (imageContainer) imageContainer.replaceChildren();
    if (newImagesPreview) newImagesPreview.replaceChildren();
    if (newImagesInput) newImagesInput.value = "";
    titleInput.value = post.title || "";

    if (imageContainer && Array.isArray(post.photos)) {
        post.photos.forEach((photo) => {
            const url = buildGroupPhotoUrl(photo);
            if (!url) return;

            const wrapper = document.createElement("div");
            wrapper.className = "relative inline-block mr-2 mb-2";
            wrapper.style.width = "96px";
            wrapper.style.height = "96px";

            const img = document.createElement("img");
            img.src = url;
            img.className = "w-24 h-24 object-cover rounded-md border";
            img.dataset.photoId = photo.id || "";

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.textContent = "✕";
            delBtn.className =
                "absolute top-0 right-0 bg-red-500 text-white rounded-full px-1 text-xs";
            delBtn.dataset.id = photo.id || "";

            delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (photo.id) markedForDeletion.add(photo.id);
                wrapper.remove();
            });

            wrapper.append(img, delBtn);
            imageContainer.appendChild(wrapper);
        });
    }

    if (newImagesInput && newImagesPreview) {
        newImagesInput.onchange = () => {
            newImagesPreview.replaceChildren();
            [...newImagesInput.files].forEach((file) => {
                const url = URL.createObjectURL(file);
                const wrapper = document.createElement("div");
                wrapper.className = "relative inline-block mr-2 mb-2";
                wrapper.style.width = "96px";
                wrapper.style.height = "96px";

                const img = document.createElement("img");
                img.src = url;
                img.className = "w-24 h-24 object-cover rounded-md border";

                wrapper.appendChild(img);
                newImagesPreview.appendChild(wrapper);
            });
        };
    }

    modal.classList.remove("hidden");

    const onSave = async () => {
        const newTitle = titleInput.value;
        saveBtn.disabled = true;
        try {
            if (markedForDeletion.size > 0) {
                await Promise.all(
                    [...markedForDeletion].map((photoId) =>
                        authFetch(API.groupDeletePhoto(photoId), { method: "DELETE" }).catch(() => {})
                    )
                );
            }

            const form = new FormData();
            form.append("title", newTitle);
            await apiMutate(API.groupUpdatePost(GROUP_ID, post.post_id), "PUT", form);

            const files = newImagesInput ? [...newImagesInput.files] : [];
            if (files.length > 0) {
                const photoForm = new FormData();
                files.forEach((file) => photoForm.append("photo", file));
                await authFetch(API.groupAddPhoto(post.post_id), {
                    method: "POST",
                    body: photoForm,
                }).catch(() => {});
            }

            showToast("Đã cập nhật bài viết!");
            modal.classList.add("hidden");
            loadPosts();
        } catch (err) {
            showToast("Lỗi: " + err.message, "error");
        } finally {
            saveBtn.disabled = false;
        }
    };

    saveBtn.onclick = onSave;
    cancelBtn.onclick = () => modal.classList.add("hidden");
}

function bindPostActions() {
    // Post action buttons (reaction, comment, share, 3-dot menu) are now
    // bound inline by renderPostCard / buildGroupPostCard.
}

// ============ RULES ============
function renderRules() {
    const el = document.getElementById("groupRulesContent");
    if (!el) return;

    const rules = groupData?.rules || "Ban quản trị chưa thiết lập nội quy cho nhóm.";
    const lines = rules.split('\n').filter(line => line.trim() !== '');

    if (lines.length === 0) {
        el.innerHTML = `<p class="text-gray-500 italic">Chưa có nội quy nào được thiết lập.</p>`;
        return;
    }

    const html = lines.map(line => {
        const trimmed = line.trim();
        if (/^[-*]\s/.test(trimmed)) {
            const content = trimmed.replace(/^[-*]\s+/, '');
            return `<li class="flex items-start gap-3 mb-3">
                <span class="w-2 h-2 rounded-full bg-fb-primary mt-2 shrink-0"></span>
                <span class="text-gray-800 dark:text-gray-200 font-semibold leading-relaxed">${escapeHtml(content)}</span>
            </li>`;
        } else if (/^\d+\.\s/.test(trimmed)) {
            const content = trimmed.replace(/^\d+\.\s+/, '');
            return `<li class="flex items-start gap-3 mb-3">
                <span class="w-6 h-6 rounded-full bg-fb-primary/10 text-fb-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">${trimmed.match(/^\d+/)[0]}</span>
                <span class="text-gray-800 dark:text-gray-200 font-semibold leading-relaxed">${escapeHtml(content)}</span>
            </li>`;
        } else {
            return `<p class="text-gray-800 dark:text-gray-200 font-bold text-lg mb-4 leading-snug">${escapeHtml(trimmed)}</p>`;
        }
    }).join('');

    el.innerHTML = `<ul class="space-y-1">${html}</ul>`;
}

// ============ MEMBERS ============
let memberSearchKeyword = "";

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
        nextMembersUrl = API.groupMembers(GROUP_ID, null, memberSearchKeyword);
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
            const name = (user.first_name && user.last_name)
                ? `${user.last_name} ${user.first_name}`
                : user.first_name || user.last_name || "Unknown";
            const avatar = user.picture || "";
            const memberId = user.user || user.id;

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
            <img src="${avatar}" class="w-14 h-14 rounded-full object-cover shadow-sm border border-gray-200 dark:border-gray-700">
          </a>
          <div class="flex-1 min-w-0">
            <h4 class="font-bold flex items-center flex-wrap text-gray-900 dark:text-white">
              <a href="${profileUrl(memberId)}" class="hover:underline truncate">${name}</a>
              ${roleBadge}
            </h4>
            ${badge}
          </div>
          ${myRole === "owner" && member.role === "member"
                    ? `<button class="btn-promote-admin text-xs bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 px-3 py-2 rounded-lg font-bold transition flex items-center gap-1.5" data-id="${memberId}" title="Thêm quyền Admin"><i class="fas fa-user-shield"></i> <span class="hidden sm:inline">Làm Admin</span></button>
                         <button class="btn-kick-member text-xs bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 px-3 py-2 rounded-lg font-bold transition flex items-center gap-1.5" data-id="${memberId}" title="Xóa khỏi nhóm"><i class="fas fa-user-minus"></i> <span class="hidden sm:inline">Kick</span></button>`
                    : myRole === "owner" && member.role === "admin"
                        ? `<button class="btn-demote-admin text-xs bg-yellow-50 dark:bg-yellow-900/30 hover:bg-yellow-100 dark:hover:bg-yellow-900/50 text-yellow-600 dark:text-yellow-400 border border-yellow-200 dark:border-yellow-800/50 px-3 py-2 rounded-lg font-bold transition flex items-center gap-1.5" data-id="${memberId}" title="Hạ quyền Admin"><i class="fas fa-user-shield"></i> <span class="hidden sm:inline">Hạ Admin</span></button>
                                 <button class="btn-kick-member text-xs bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 px-3 py-2 rounded-lg font-bold transition flex items-center gap-1.5" data-id="${memberId}" title="Xóa khỏi nhóm"><i class="fas fa-user-minus"></i> <span class="hidden sm:inline">Kick</span></button>`
                        : myRole === "admin" && (member.role === "member")
                            ? `<button class="btn-kick-member text-xs bg-red-50 dark:bg-red-900/30 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 px-3 py-2 rounded-lg font-bold transition flex items-center gap-1.5" data-id="${memberId}" title="Xóa khỏi nhóm"><i class="fas fa-user-minus"></i> <span class="hidden sm:inline">Kick</span></button>`
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
            
            openInlineFormModal({
                title: "Xóa thành viên",
                bodyHtml: `
                    <div class="space-y-4">
                        <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Bạn có chắc muốn xóa thành viên này khỏi nhóm?</p>
                        <label class="flex items-start gap-2 cursor-pointer mt-4 bg-red-50 dark:bg-red-900/10 p-3 rounded-lg border border-red-100 dark:border-red-800/30">
                            <input type="checkbox" name="deleteAllPosts" class="w-4 h-4 text-red-600 rounded mt-0.5">
                            <span class="text-sm font-semibold text-red-600 dark:text-red-400">Xóa tất cả bài viết và bình luận của người này trong nhóm</span>
                        </label>
                    </div>
                `,
                okText: "Xóa",
                getValues: (body) => ({
                    deleteAllPosts: body.querySelector("[name='deleteAllPosts']").checked
                }),
                validate: () => ""
            }).then(async val => {
                if (val) {
                    try {
                        if (val.deleteAllPosts) {
                            await apiMutate(API.groupDeleteMemberPosts(GROUP_ID, uid), "POST");
                        }
                        await apiMutate(API.groupKickMember(GROUP_ID, uid), "POST");
                        showToast("Đã xóa thành viên khỏi nhóm!");
                        clearGroupCaches();
                        loadMembers(true);
                    } catch (err) {
                        showToast("Lỗi: " + err.message, "error");
                    }
                }
            });
        });
    });

    document.querySelectorAll(".btn-promote-admin").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const uid = e.currentTarget.dataset.id;
            if (!(await confirmAction("Thêm quyền Admin cho thành viên này?"))) return;
            try {
                await apiMutate(API.groupAddAdmin(GROUP_ID, uid), "POST");
                showToast("Đã thêm quyền Admin!");
                clearGroupCaches();
                loadMembers(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    document.querySelectorAll(".btn-demote-admin").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const uid = e.currentTarget.dataset.id;
            if (!(await confirmAction("Hạ quyền Admin cho thành viên này? Họ sẽ trở thành thành viên thường."))) return;
            try {
                await apiMutate(API.groupRemoveAdmin(GROUP_ID, uid), "POST");
                showToast("Đã hạ quyền Admin!");
                clearGroupCaches();
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
        nextEventsUrl = data.next || null;

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
              <span class="text-2xl font-black">${new Date(event.start_time).getDate()}</span>
              <span class="text-xs font-bold uppercase -mt-1">${new Date(event.start_time).toLocaleString("vi-VN", { month: "short" })}</span>
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
                    await apiMutate(API.groupEventResponse(GROUP_ID, eid), "PATCH", { status: response });
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
                    openUserListModal("Người tham gia sự kiện", participants);
                });
            });
        });

        // Edit event
        document.querySelectorAll(".btn-event-edit").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const dataset = e.currentTarget.dataset;
                openEventEditModal(dataset);
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
        nextVotesUrl = data.next || null;

        if (initial) container.innerHTML = "";
        const votes = data.results || (Array.isArray(data) ? data : []);

        if (votes.length === 0 && initial) {
            container.innerHTML = `
        <div class="text-center py-10 text-gray-500">
          <i class="fas fa-poll-h text-4xl mb-3 opacity-50"></i>
          <p class="font-semibold">Chưa có cuộc bình chọn nào.</p>
        </div>`;
            const createVoteBtn = document.getElementById("btnCreateVoteTab");
            if (createVoteBtn) {
                const isAdmin = myRole === "owner" || myRole === "admin";
                createVoteBtn.classList.toggle("hidden", !isAdmin);
            }
            return;
        }

        votes.forEach((vote) => {
            const options = vote.options || [];
            const totalVotes = options.reduce((sum, o) => sum + (o.count || 0), 0);
            const isClosed = vote.is_closed;

            const isAdmin = myRole === "owner" || myRole === "admin";
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
            ${isAdmin ? `
            <div class="relative">
              <button type="button" class="vote-kebab text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xl font-bold px-2 rounded-full" data-vid="${vote.id}">⋯</button>
              <div class="vote-kebab-menu absolute right-0 mt-2 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-lg hidden z-50 border border-gray-200 dark:border-gray-700">
                ${!isClosed ? `<button class="block w-full text-left px-4 py-2 text-sm text-blue-600 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="edit" data-vid="${vote.id}" data-text="${vote.title || vote.question || ""}"><i class="fas fa-edit mr-2"></i> Sửa bình chọn</button>` : ""}
                ${!isClosed ? `<button class="block w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="close" data-vid="${vote.id}"><i class="fas fa-ban mr-2"></i> Đóng bình chọn</button>` : ""}
                ${isClosed ? `<button class="block w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="reopen" data-vid="${vote.id}"><i class="fas fa-redo mr-2"></i> Mở lại bình chọn</button>` : ""}
                <button class="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-700" data-action="delete" data-vid="${vote.id}"><i class="fas fa-trash mr-2"></i> Xóa bình chọn</button>
              </div>
            </div>` : ""}
          </div>
          <div class="space-y-2">
            ${options
                    .map(
                        (opt) => `
              <div class="relative">
                <button class="btn-vote-option w-full text-left p-3 rounded-xl border ${opt.is_voted
                                ? "bg-fb-primary/10 border-fb-primary/40 font-bold"
                                : isClosed
                                    ? "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 opacity-70 cursor-default"
                                    : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-fb-primary/5 hover:border-fb-primary/30 transition"
                            }" data-vote-id="${vote.id}" data-opt-id="${opt.id}" ${isClosed ? "disabled" : ""}>
                  <div class="flex justify-between items-center mb-1">
                    <span class="text-sm font-medium text-gray-800 dark:text-gray-200">${opt.text}</span>
                    <span class="text-xs text-gray-500 font-bold btn-view-voters hover:text-fb-primary transition" data-vid="${vote.id}" data-oid="${opt.id}" title="Xem người bình chọn">${totalVotes > 0 ? Math.round((opt.count / totalVotes) * 100) : 0}% (${opt.count})</span>
                  </div>
                  ${totalVotes > 0
                                ? `<div class="absolute bottom-0 left-0 h-full rounded-xl bg-fb-primary/10 pointer-events-none" style="width: ${(opt.count / totalVotes) * 100}%"></div>`
                                : ""
                            }
                </button>
                ${!isClosed && isAdmin ? `
                <div class="flex justify-end gap-2 mt-1">
                    <button type="button" class="btn-edit-option text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 font-bold hover:bg-blue-100 transition" data-vid="${vote.id}" data-oid="${opt.id}" data-text="${opt.text}" title="Sửa lựa chọn"><i class="fas fa-edit mr-1"></i> Sửa</button>
                    <button type="button" class="btn-delete-option text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 font-bold hover:bg-red-100 transition" data-vid="${vote.id}" data-oid="${opt.id}" title="Xóa lựa chọn"><i class="fas fa-trash mr-1"></i> Xóa</button>
                </div>` : ''}
              </div>`
                    )
                    .join("")}
            ${!isClosed ? `<button class="btn-add-option-vote w-full mt-1 py-2 rounded-xl border border-dashed border-fb-primary/40 text-fb-primary font-semibold hover:bg-fb-primary/5 transition text-sm" data-vid="${vote.id}"><i class="fas fa-plus mr-1"></i> Thêm lựa chọn</button>` : ""}
          </div>
        </div>`
            );
        });

        // Show create vote button (admins/owner only)
        const createVoteBtn = document.getElementById("btnCreateVoteTab");
        if (createVoteBtn) {
            const isAdmin = myRole === "owner" || myRole === "admin";
            createVoteBtn.classList.toggle("hidden", !isAdmin);
        }

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

    // Kebab menu (admin/owner) -> close / delete vote
    document.querySelectorAll(".vote-kebab").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const menu = btn.parentElement.querySelector(".vote-kebab-menu");
            if (menu) menu.classList.toggle("hidden");
        });
    });

    document.querySelectorAll(".vote-kebab-menu button").forEach((item) => {
        item.addEventListener("click", async (e) => {
            e.stopPropagation();
            const action = e.currentTarget.dataset.action;
            const vid = e.currentTarget.dataset.vid;
            const menu = e.currentTarget.closest(".vote-kebab-menu");
            if (menu) menu.classList.add("hidden");
            try {
                if (action === "edit") {
                    const oldText = e.currentTarget.dataset.text || "";
                    const text = await openInputModal({ title: "Sửa tiêu đề bình chọn", label: "Tiêu đề", value: oldText, placeholder: "Nhập tiêu đề" });
                    if (!text || text === oldText) return;
                    await apiMutate(API.groupUpdateVote(GROUP_ID, vid), "PATCH", { title: text.trim() });
                    showToast("Đã cập nhật bình chọn!");
                } else if (action === "close") {
                    await apiMutate(API.groupUpdateVote(GROUP_ID, vid), "PATCH", { is_closed: true });
                    showToast("Đã đóng bình chọn!");
                } else if (action === "reopen") {
                    await apiMutate(API.groupUpdateVote(GROUP_ID, vid), "PATCH", { is_closed: false });
                    showToast("Đã mở lại bình chọn!");
                } else if (action === "delete") {
                    if (!(await confirmAction("Xóa bình chọn này?"))) return;
                    await apiMutate(API.groupDeleteVote(GROUP_ID, vid), "DELETE");
                    showToast("Đã xóa bình chọn!");
                }
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Add option (member + admin)
    document.querySelectorAll(".btn-add-option-vote").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const vid = e.currentTarget.dataset.vid;
            const text = await openInputModal({ title: "Thêm lựa chọn", label: "Nội dung lựa chọn", placeholder: "Nhập lựa chọn mới" });
            if (!text) return;
            try {
                await apiMutate(API.groupAddVoteOption(GROUP_ID, vid), "POST", { options: [text.trim()] });
                showToast("Đã thêm lựa chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Edit option (admin/owner only - rendered conditionally)
    document.querySelectorAll(".btn-edit-option").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const vid = e.currentTarget.dataset.vid;
            const oid = e.currentTarget.dataset.oid;
            const oldText = e.currentTarget.dataset.text;
            const text = await openInputModal({ title: "Sửa lựa chọn", label: "Nội dung lựa chọn", value: oldText, placeholder: "Nhập nội dung" });
            if (!text || text === oldText) return;
            try {
                await apiMutate(API.groupUpdateVoteOption(GROUP_ID, vid, oid), "PUT", { text: text.trim() });
                showToast("Đã cập nhật lựa chọn!");
                loadVotesTab(true);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Delete option (admin/owner only - rendered conditionally)
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

    // View voters -> modal user-list
    document.querySelectorAll(".btn-view-voters").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vid = e.currentTarget.dataset.vid;
            const oid = e.currentTarget.dataset.oid;
            openVoteVotersModal(vid, oid);
        });
    });

    // Vote Detail
    document.querySelectorAll(".btn-vote-detail").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const vid = e.currentTarget.dataset.vid;
            apiGet(API.groupVoteDetail(GROUP_ID, vid), (data) => {
                const v = data.results?.[0] || data;
                const total = (v.options || []).reduce((s, o) => s + (o.count || 0), 0);
                openAlertModal(
                    "Chi tiết bình chọn",
                    `<p><b>${escapeHtml(v.title || v.question || "Bình chọn")}</b></p>
                     <p class="mt-2">Ngày tạo: ${new Date(v.created_at).toLocaleString("vi-VN")}</p>
                     <p>Tổng phiếu: ${total}</p>
                     <p>Số lựa chọn: ${(v.options || []).length}</p>`
                );
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

// ============ VOTE VOTERS MODAL ============
function openVoteVotersModal(voteId, optionId) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
    overlay.innerHTML = `
        <div class="glass-card rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-scale-in max-h-[85vh] flex flex-col">
            <div class="flex items-center justify-between mb-4">
                <h3 class="font-bold text-lg text-gray-900 dark:text-white">Những người đã bình chọn</h3>
                <button type="button" class="voters-close text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl font-bold leading-none">&times;</button>
            </div>
            <div class="voters-body text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>
        </div>`;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector(".voters-close").addEventListener("click", close);

    const body = overlay.querySelector(".voters-body");

    apiGet(API.groupListUserVote(GROUP_ID, voteId, optionId), (data) => {
        const users = data.results || (Array.isArray(data) ? data : []);
        if (users.length === 0) {
            body.innerHTML = `<p class="text-center text-gray-500 py-8">Chưa có ai chọn mục này.</p>`;
            return;
        }
        body.className = "voters-body overflow-y-auto";
        body.innerHTML = `<div class="space-y-2 max-h-[60vh]">${users
            .map((u) => {
                const first = u.created_by?.first_name || u.first_name || "";
                const last = u.created_by?.last_name || u.last_name || "";
                const name = `${first} ${last}`.trim() || u.name || "Unknown";
                const avatar = u.created_by?.picture || u.picture || "";
                const uid = u.created_by?.user || u.user || u.id;
                return `
                <div class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700">
                    <a href="${profileUrl(uid)}"><img src="${avatar}" class="w-10 h-10 rounded-full object-cover border" onerror="this.src=''"></a>
                    <a href="${profileUrl(uid)}" class="font-semibold text-gray-800 dark:text-gray-200 hover:underline">${name}</a>
                </div>`;
            })
            .join("")}</div>`;
    });
}

// ============ SUGGESTION MODAL ============
function openSuggestionModal() {
    openInputModal({ title: "Góp ý (ẩn danh)", label: "Nội dung góp ý", placeholder: "Nhập nội dung góp ý của bạn", required: true })
        .then((content) => {
            if (!content) return;
            return apiMutate(API.groupCreateSuggestion(GROUP_ID), "POST", { content })
                .then(() => showToast("Đã gửi góp ý thành công!"))
                .catch((err) => showToast("Lỗi: " + err.message, "error"));
        });
}

// ============ EVENT EDIT MODAL ============
function openEventEditModal(dataset) {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
    const startVal = dataset.start ? dataset.start.substring(0, 16).replace('T', ' ') : "";
    overlay.innerHTML = `
        <div class="glass-card rounded-2xl p-6 max-w-md w-full shadow-2xl relative animate-scale-in">
            <h3 class="font-bold text-lg text-gray-900 dark:text-white mb-4">Sửa sự kiện</h3>
            <div class="space-y-3">
                <div>
                    <label class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Tiêu đề</label>
                    <input type="text" class="ev-title w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-fb-primary text-gray-800 dark:text-white" value="${escapeHtml(dataset.title || '')}">
                </div>
                <div>
                    <label class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Mô tả</label>
                    <textarea class="ev-desc w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-fb-primary text-gray-800 dark:text-white" rows="3">${escapeHtml(dataset.desc || '')}</textarea>
                </div>
                <div>
                    <label class="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Thời gian bắt đầu (YYYY-MM-DD HH:MM)</label>
                    <input type="text" class="ev-start w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-fb-primary text-gray-800 dark:text-white" value="${escapeHtml(startVal)}">
                </div>
            </div>
            <div class="flex gap-2 justify-end mt-5">
                <button type="button" class="ev-cancel px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold hover:bg-gray-200 dark:hover:bg-gray-600 transition">Hủy</button>
                <button type="button" class="ev-ok px-6 py-2 rounded-lg bg-fb-primary text-white font-semibold hover:bg-blue-600 transition shadow-md">Lưu</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);

    const titleEl = overlay.querySelector(".ev-title");
    const descEl = overlay.querySelector(".ev-desc");
    const startEl = overlay.querySelector(".ev-start");
    const close = () => overlay.remove();

    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    overlay.querySelector(".ev-cancel").addEventListener("click", close);
    overlay.querySelector(".ev-ok").addEventListener("click", async () => {
        const title = titleEl.value.trim();
        const startTime = startEl.value.trim();
        if (!title || !startTime) { (title ? startEl : titleEl).focus(); return; }
        const data = {
            title,
            description: descEl.value.trim() || "",
            start_time: new Date(startTime).toISOString(),
        };
        try {
            await apiMutate(API.groupEventDetail(GROUP_ID, dataset.eid), "PUT", data);
            showToast("Đã cập nhật sự kiện!");
            close();
            loadEvents(true);
        } catch (err) {
            showToast("Lỗi: " + err.message, "error");
        }
    });
}

// ============ SETTINGS ============
async function purgeCompanyStructure() {
    const departmentsRes = await authFetch(API.groupDepartmentList(GROUP_ID));
    const departmentsData = await departmentsRes.json();
    const departments = normalizeListResponse(departmentsData);

    for (const department of departments) {
        const roles = normalizeListResponse(department.roles || []);
        for (const role of roles) {
            await apiMutate(API.groupUpdateRole(GROUP_ID, role.id), "DELETE");
        }
    }

    for (const department of departments) {
        await apiMutate(API.groupUpdateDepartment(GROUP_ID, department.id), "DELETE");
    }
}

function setupGroupSettings() {
    const btnSettings = document.getElementById("btnEditGroupSettings");
    if (!btnSettings) return;
    btnSettings.addEventListener("click", async () => {
        const group = groupData;
        const isAdmin = group?.role === "owner" || group?.role === "admin";
        if (!group || !isAdmin) return;

        const values = await openInlineFormModal({
            title: "Chỉnh sửa thông tin nhóm",
            okText: "Cập nhật",
            bodyHtml: `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Tên nhóm</label>
                        <input id="editGroupName" type="text" value="${escapeHtml(group.name)}"
                            class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 focus:ring-2 focus:ring-fb-primary focus:outline-none transition-all dark:text-white">
                    </div>
                    <div>
                        <label class="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Mô tả</label>
                        <textarea id="editGroupDescription" rows="4"
                            class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 focus:ring-2 focus:ring-fb-primary focus:outline-none transition-all resize-none dark:text-white">${escapeHtml(group.description || "")}</textarea>
                    </div>
                    <div>
                        <label class="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Nội quy</label>
                        <textarea id="editGroupRules" rows="4"
                            class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3 focus:ring-2 focus:ring-fb-primary focus:outline-none transition-all resize-none dark:text-white">${escapeHtml(group.rules || "")}</textarea>
                    </div>
                    <label class="flex items-start gap-3 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 cursor-pointer">
                        <input id="editGroupIsCompany" type="checkbox" class="mt-1" ${group.is_company ? "checked" : ""}>
                        <span>
                            <span class="block font-bold text-gray-900 dark:text-white">Nhóm công ty</span>
                            <span class="block text-sm text-gray-500">Nếu đổi trạng thái này, toàn bộ phòng ban và chức vụ hiện có sẽ bị xóa.</span>
                        </span>
                    </label>
                </div>
            `,
            getValues: (bodyEl) => ({
                name: bodyEl.querySelector("#editGroupName")?.value.trim() || "",
                description: bodyEl.querySelector("#editGroupDescription")?.value.trim() || "",
                rules: bodyEl.querySelector("#editGroupRules")?.value.trim() || "",
                is_company: Boolean(bodyEl.querySelector("#editGroupIsCompany")?.checked),
            }),
            validate: (formValues) => {
                if (!formValues.name) return "Tên nhóm không được để trống.";
                return "";
            },
        });
        if (!values) return;

        try {
            const isCompanyChanged = Boolean(group.is_company) !== values.is_company;
            if (isCompanyChanged) {
                const confirmed = await confirmAction("Đổi loại nhóm sẽ xóa toàn bộ phòng ban và chức vụ hiện có. Tiếp tục?");
                if (!confirmed) return;
                if (group.is_company) {
                    await purgeCompanyStructure();
                }
            }

            const payload = {
                name: values.name,
                description: values.description,
                rules: values.rules,
                is_company: values.is_company,
            };
            await apiMutate(API.groupUpdate(GROUP_ID), "PATCH", payload);
            showToast("Đã cập nhật thông tin nhóm!");
            await loadGroupInfo();
        } catch (err) {
            showToast("Lỗi: " + err.message, "error");
        }
    });
}

// ============ DELETE GROUP ============
function setupGroupDelete() {
    const btnDelete = document.getElementById("btnDeleteGroup");
    if (!btnDelete) return;
    btnDelete.addEventListener("click", async () => {
        if (!(await confirmAction("Bạn có chắc muốn xóa nhóm này? Hành động này không thể hoàn tác!"))) return;
        try {
            await apiMutate(API.groupDelete(GROUP_ID), "DELETE");
            showToast("Đã xóa nhóm!");
            window.location.href = "/groups/";
        } catch (err) {
            showToast("Lỗi: " + err.message, "error");
        }
    });
}

// ============ ADMIN SIDEBAR ============
function loadAdminSidebar() {
    if (!isMember) return;
    apiGet(API.groupAdminList(GROUP_ID), (data) => {
        const admins = data.results || (Array.isArray(data) ? data : []);
        if (admins.length === 0) return;
        const sidebar = document.getElementById("sidebarAdminCard");
        const list = document.getElementById("sidebarAdminList");
        if (!sidebar || !list) return;
        sidebar.classList.remove("hidden");
        list.innerHTML = "";
        admins.forEach((a) => {
            const user = a.user || {};
            const avatar = user.picture || "";
            list.insertAdjacentHTML(
                "beforeend",
                `<div class="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-2 py-1.5">
                    <img src="${avatar}" class="w-7 h-7 rounded-full object-cover">
                    <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">${`${user.first_name || ''} ${user.last_name || ''}`.trim() || "Admin"}</span>
                </div>`
            );
        });
    });
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
            div.innerHTML = `<img src="${imgUrl}" class="w-full h-full object-cover" loading="lazy">`;
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
                <button class="search-type-btn px-4 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm font-bold rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition" data-type="members">Thành viên</button>
            </div>
            <div id="searchResults" class="space-y-4">
                <p class="text-center text-gray-500 py-8 text-sm">Nhập từ khóa để tìm kiếm trong nhóm.</p>
            </div>
        </div>`;

    // Click vào kết quả bài viết -> gọi API detail và render inline
    container.addEventListener("click", (e) => {
        const postEl = e.target.closest(".btn-detail-post");
        if (postEl && postEl.dataset.id) {
            e.preventDefault();
            openGroupPostDetailInline(postEl.dataset.id, container);
        }
    });

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
        const posts = data.posts || [];
        const members = data.members || [];

        if (results.length === 0 && posts.length === 0 && members.length === 0 && !append) {
            resultsContainer.innerHTML = `<div class="text-center py-10 text-gray-500"><i class="fas fa-search text-4xl mb-3 opacity-50"></i><p class="font-semibold">Không tìm thấy kết quả.</p></div>`;
            return;
        }

        // Handle combined results
        const items = [...results, ...posts, ...members];
        items.forEach((item) => {
            if (item.image || item.photo) {
                // Photo result
                const imgUrl = item.image || item.photo || item.url || "";
                resultsContainer.insertAdjacentHTML("beforeend", `
                    <div class="rounded-xl overflow-hidden aspect-video shadow-sm">
                        <img src="${imgUrl}" class="w-full h-full object-cover" loading="lazy">
                    </div>`);
            } else {
                // Post/member result
                // NOTE: ProfileSerializer returns `user` as an integer (user_id),
                // so it must NOT be treated as a nested user object.
                const src = item.first_name || item.last_name ? item : (item.user && typeof item.user === "object" ? item.user : item);
                const avatar = item.picture || (typeof item.user === "object" ? item.user.picture : "") || "";
                const firstName = item.first_name || (typeof item.user === "object" ? item.user.first_name : "") || "";
                const lastName = item.last_name || (typeof item.user === "object" ? item.user.last_name : "") || "";
                const name =
                    `${firstName} ${lastName}`.trim() ||
                    item.full_name ||
                    item.name ||
                    "Unknown";
                const itemId = item.post_id || item.id;

                resultsContainer.insertAdjacentHTML("beforeend", `
                    <div class="glass-card p-4 rounded-2xl shadow-sm border border-white/40 dark:border-white/5 ${item.post_id ? 'cursor-pointer hover:shadow-md' : ''}">
                        <div class="flex items-center gap-3 mb-2 ${item.post_id ? 'btn-detail-post' : ''}" ${item.post_id ? `data-id="${item.post_id}"` : ''}>
                            <img src="${avatar}" class="w-10 h-10 rounded-full object-cover">
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

// Mở chi tiết bài viết trong group bằng cách gọi API detail, render inline
async function openGroupPostDetailInline(postId, searchContainer) {
    const resultsContainer = document.getElementById("searchResults");
    if (!resultsContainer) return;

    resultsContainer.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;

    let post;
    try {
        const res = await authFetch(API.groupPostDetail(GROUP_ID, postId));
        if (!res.ok) throw new Error("fetch failed");
        post = await res.json();
    } catch {
        resultsContainer.innerHTML = `<div class="text-center py-10 text-gray-500"><p class="font-semibold">Không thể tải bài viết.</p></div>`;
        return;
    }

    const back = document.createElement("button");
    back.type = "button";
    back.className = "mb-3 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition";
    back.innerHTML = `<i class="fas fa-arrow-left mr-1"></i> Quay lại kết quả`;
    back.onclick = () => {
        const q = document.getElementById("groupSearchInput")?.value.trim() || "";
        if (q.length >= 2) executeGroupSearch(q);
    };
    resultsContainer.replaceChildren(back);

    if (post && post.post_id) {
        const card = renderPostCard(post, {
            currentUserId: myUserId,
            isGroupPost: true,
            navigateOnClick: false,
            showShare: false,
            showCopyLink: false,
            showPrivacy: false,
            onOpenReactions: openReactionsModal,
            onOpenPhotos: openPhotoModal,
        });
        if (card) {
            card.classList.add("glass-card", "rounded-2xl", "shadow-sm",
                "border", "border-white/40", "dark:border-white/5", "overflow-hidden", "mb-4");
            resultsContainer.appendChild(card);
        }
    }
}

// ============ EXPOSE GLOBALLY ============
window.showToast = showToast;
window.loadPosts = loadPosts;
window.loadEvents = loadEvents;
window.loadVotesTab = loadVotesTab;


// ============ GROUP VOTES ============
let nextGroupVotesUrl = null;
let isLoadingGroupVotes = false;

window.loadVotesTab = async function(reset = false) {
    if (!GROUP_ID) return;
    const container = document.getElementById("groupVotesList");
    if (!container) return;

    if (reset) {
        nextGroupVotesUrl = API.groupListVotes(GROUP_ID);
        container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
    }

    if (!nextGroupVotesUrl || isLoadingGroupVotes) return;
    isLoadingGroupVotes = true;

    try {
        const res = await authFetch(nextGroupVotesUrl);
        if (!res.ok) throw new Error("Failed to fetch votes");
        const data = await res.json();
        
        if (reset) container.replaceChildren();

        const votes = data.results || (Array.isArray(data) ? data : []);
        if (votes.length === 0 && reset) {
            container.innerHTML = `
                <div class="text-center py-10 text-gray-500">
                    <i class="fas fa-poll-h text-4xl mb-3 opacity-50"></i>
                    <p class="font-semibold">Chưa có cuộc bình chọn nào.</p>
                </div>`;
        } else {
            for (const v of votes) {
                container.appendChild(renderGroupVoteCard(v));
            }
        }
        
        nextGroupVotesUrl = data.next || null;
        if (nextGroupVotesUrl) {
            const btn = document.createElement("button");
            btn.className = "w-full py-2 mt-2 text-sm text-fb-primary font-bold hover:underline";
            btn.textContent = "Tải thêm bình chọn...";
            btn.onclick = () => { btn.remove(); loadVotesTab(); };
            container.appendChild(btn);
        }
    } catch (err) {
        console.error(err);
        if (reset) container.innerHTML = `<p class="text-red-500">Lỗi tải bình chọn.</p>`;
    } finally {
        isLoadingGroupVotes = false;
    }
};

function renderGroupVoteCard(v) {
    const card = document.createElement("div");
    card.className = "glass-card rounded-2xl p-4 shadow-sm border border-white/40 dark:border-white/5 relative group/vote mb-4";

    const totalVotes = (v.options || []).reduce((s, o) => s + o.count, 0);
    const creatorName = v.created_by ? (v.created_by.full_name || `${v.created_by.first_name || ''} ${v.created_by.last_name || ''}`.trim()) : 'Ai đó';
    const canManageVote = v.created_by?.user === myUserId || Number(v.created_by?.id) === Number(myUserId) || myRole === 'admin' || myRole === 'owner';

    let headerHtml = `
        <div class="flex justify-between items-start mb-3">
            <div>
                <h4 class="font-bold text-gray-900 dark:text-white text-lg pr-8">${escapeHtml(v.title)}</h4>
                <p class="text-xs text-gray-500 mt-1">Tạo bởi: ${escapeHtml(creatorName)}</p>
                ${v.is_closed ? '<span class="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full mt-1 inline-block font-semibold">Đã đóng</span>' : ''}
            </div>
            ${canManageVote ? `
            <div class="relative vote-kebab-container">
                <button type="button" class="vote-kebab-btn w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center text-gray-500 transition">
                    <i class="fas fa-ellipsis-v"></i>
                </button>
                <div class="vote-kebab-menu hidden absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden">
                    <button class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition" data-action="edit-vote">Sửa tiêu đề</button>
                    <button class="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition" data-action="toggle-vote">${v.is_closed ? 'Mở lại bình chọn' : 'Đóng bình chọn'}</button>
                    <button class="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 text-red-600 transition" data-action="delete-vote">Xóa bình chọn</button>
                </div>
            </div>` : ''}
        </div>
    `;

    let optsHtml = `<div class="space-y-2 mb-3">`;
    for (const o of (v.options || [])) {
        const pct = totalVotes ? Math.round((o.count / totalVotes) * 100) : 0;
        const myVote = (v.user_votes || []).includes(o.id);
        const canManageOption = canManageVote; // Only admin/owner/creator can update/delete option
        optsHtml += `
            <div class="vote-option-item cursor-pointer p-2 rounded-lg border border-transparent hover:border-fb-primary/30 transition-colors group/opt relative" data-option-id="${o.id}" data-vote-id="${v.id}">
                <div class="flex items-center justify-between mb-1">
                    <div class="flex items-center gap-2 flex-1 min-w-0 pr-16">
                        <div class="w-4 h-4 shrink-0 rounded-full border border-gray-300 dark:border-gray-500 flex items-center justify-center ${myVote ? 'bg-fb-primary border-fb-primary' : ''}">
                            ${myVote ? `<i class="fas fa-check text-white text-[10px]"></i>` : ''}
                        </div>
                        <p class="text-sm dark:text-gray-200 truncate vote-opt-text font-medium" title="${escapeHtml(o.text)}">${escapeHtml(o.text)}</p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <button type="button" class="text-xs font-bold text-gray-500 hover:text-blue-500 px-1" data-action="view-voters" data-option-id="${o.id}">${o.count}</button>
                    </div>
                </div>
                <div class="h-1.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                    <div class="h-full bg-blue-400 dark:bg-blue-500 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
                </div>
                ${!v.is_closed && canManageOption ? `
                <div class="hidden group-hover/opt:flex absolute right-1 top-1 gap-1 bg-white dark:bg-gray-800 shadow-sm rounded-md border border-gray-200 dark:border-gray-700 p-0.5 z-10">
                    <button class="w-6 h-6 hover:bg-blue-50 text-blue-500 rounded flex items-center justify-center" data-action="edit-opt" data-option-id="${o.id}"><i class="fas fa-pen text-xs"></i></button>
                    <button class="w-6 h-6 hover:bg-red-50 text-red-500 rounded flex items-center justify-center" data-action="delete-opt" data-option-id="${o.id}"><i class="fas fa-trash text-xs"></i></button>
                </div>
                ` : ''}
            </div>
        `;
    }
    optsHtml += `</div>`;
    
    let footerHtml = `
        <div class="flex items-center justify-between mt-2 pt-2 border-t dark:border-gray-700">
            <span class="text-xs text-gray-400 font-medium">${totalVotes} lượt bình chọn</span>
            ${!v.is_closed ? `<button class="text-sm font-semibold text-fb-primary hover:underline" data-action="add-option"><i class="fas fa-plus mr-1"></i> Thêm lựa chọn</button>` : ''}
        </div>
    `;

    card.innerHTML = headerHtml + optsHtml + footerHtml;

    // Handlers
    card.querySelector(".vote-kebab-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelectorAll(".vote-kebab-menu").forEach(m => {
            if (m !== card.querySelector(".vote-kebab-menu")) m.classList.add("hidden");
        });
        card.querySelector(".vote-kebab-menu")?.classList.toggle("hidden");
    });

    card.querySelector("[data-action='edit-vote']")?.addEventListener("click", () => {
        card.querySelector(".vote-kebab-menu").classList.add("hidden");
        openInputModal({ title: "Sửa tiêu đề bình chọn", value: v.title }).then(async val => {
            if (val && val !== v.title) {
                const res = await authFetch(API.groupUpdateVote(GROUP_ID, v.id), { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ title: val }) });
                if (res.ok) loadVotesTab(true);
            }
        });
    });

    card.querySelector("[data-action='toggle-vote']")?.addEventListener("click", async () => {
        const res = await authFetch(API.groupUpdateVote(GROUP_ID, v.id), { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ is_closed: !v.is_closed }) });
        if (res.ok) loadVotesTab(true);
    });

    card.querySelector("[data-action='delete-vote']")?.addEventListener("click", async () => {
        if (await confirmAction("Bạn có chắc muốn xóa cuộc bình chọn này?")) {
            const res = await authFetch(API.groupDeleteVote(GROUP_ID, v.id), { method: "DELETE" });
            if (res.ok) loadVotesTab(true);
        }
    });

    card.querySelector("[data-action='add-option']")?.addEventListener("click", () => {
        openInputModal({ title: "Thêm lựa chọn", placeholder: "Nhập lựa chọn..." }).then(async val => {
            if (val) {
                const res = await authFetch(API.groupAddVoteOption(GROUP_ID, v.id), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ options: [val] }) });
                if (res.ok) loadVotesTab(true);
            }
        });
    });

    card.querySelectorAll("[data-action='edit-opt']").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const optId = btn.dataset.optionId;
            const currentText = card.querySelector(`[data-option-id="${optId}"] .vote-opt-text`).textContent;
            openInputModal({ title: "Sửa lựa chọn", value: currentText }).then(async val => {
                if (val && val !== currentText) {
                    const res = await authFetch(API.groupUpdateVoteOption(GROUP_ID, v.id, optId), { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ text: val }) });
                    if (res.ok) loadVotesTab(true);
                }
            });
        });
    });

    card.querySelectorAll("[data-action='delete-opt']").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const optId = btn.dataset.optionId;
            if (await confirmAction("Xóa lựa chọn này?")) {
                const res = await authFetch(API.groupDeleteVoteOption(GROUP_ID, v.id, optId), { method: "DELETE" });
                if (res.ok) loadVotesTab(true);
            }
        });
    });

    card.querySelectorAll("[data-action='view-voters']").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const optId = btn.dataset.optionId;
            const res = await authFetch(API.groupListUserVotes(GROUP_ID, v.id, optId));
            if (res.ok) {
                const data = await res.json();
                openUserListModal("Người đã bình chọn", data.results || data);
            }
        });
    });

    card.querySelectorAll(".vote-option-item").forEach(item => {
        item.addEventListener("click", async (e) => {
            if (v.is_closed) return;
            const optId = item.dataset.optionId;
            const res = await authFetch(API.groupUserVote(GROUP_ID, v.id, optId), { method: "POST" });
            if (res.ok) loadVotesTab(true);
        });
    });

    return card;
}

// ============ GROUP EVENTS ============
let nextGroupEventsUrl = null;
let isLoadingGroupEvents = false;

window.loadEvents = async function(reset = false) {
    if (!GROUP_ID) return;
    const container = document.getElementById("groupEventsList");
    if (!container) return;

    if (reset) {
        nextGroupEventsUrl = API.groupListCreateEvent(GROUP_ID);
        container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
    }

    if (!nextGroupEventsUrl || isLoadingGroupEvents) return;
    isLoadingGroupEvents = true;

    try {
        const res = await authFetch(nextGroupEventsUrl);
        if (!res.ok) throw new Error("Failed to fetch events");
        const data = await res.json();
        
        if (reset) container.replaceChildren();

        const evts = data.results || (Array.isArray(data) ? data : []);
        if (evts.length === 0 && reset) {
            container.innerHTML = `
                <div class="text-center py-10 text-gray-500">
                    <i class="fas fa-calendar-times text-4xl mb-3 opacity-50"></i>
                    <p class="font-semibold">Chưa có sự kiện nào.</p>
                </div>`;
        } else {
            for (const e of evts) {
                container.appendChild(renderGroupEventCard(e));
            }
        }
        
        nextGroupEventsUrl = data.next || null;
        if (nextGroupEventsUrl) {
            const btn = document.createElement("button");
            btn.className = "w-full py-2 mt-2 text-sm text-fb-primary font-bold hover:underline";
            btn.textContent = "Tải thêm sự kiện...";
            btn.onclick = () => { btn.remove(); loadEvents(); };
            container.appendChild(btn);
        }
    } catch (err) {
        console.error(err);
        if (reset) container.innerHTML = `<p class="text-red-500">Lỗi tải sự kiện.</p>`;
    } finally {
        isLoadingGroupEvents = false;
    }
};

function formatEventTime(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    return d.toLocaleString("vi-VN", { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderGroupEventCard(e) {
    const card = document.createElement("div");
    card.className = "glass-card rounded-2xl p-5 shadow-sm border border-white/40 dark:border-white/5 relative flex flex-col sm:flex-row gap-5 mb-4";

    const canManageEvent = myRole === 'admin' || myRole === 'owner' || e.created_by?.id == myUserId;

    const startDate = new Date(e.start_time);
    const month = startDate.toLocaleString('vi-VN', { month: 'short' });
    const day = startDate.getDate();

    card.innerHTML = `
        <div class="w-16 h-16 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex flex-col items-center justify-center border border-blue-100 dark:border-blue-800/50 shrink-0">
            <span class="text-xs font-bold text-red-500 uppercase">${month}</span>
            <span class="text-2xl font-black text-blue-700 dark:text-blue-400 leading-none">${day}</span>
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex justify-between items-start gap-2">
                <h4 class="font-bold text-lg text-gray-900 dark:text-white truncate">${escapeHtml(e.title)}</h4>
                ${canManageEvent ? `
                <div class="flex gap-1 shrink-0">
                    <button class="w-8 h-8 rounded-full hover:bg-blue-50 text-blue-500 flex items-center justify-center transition" data-action="edit-event" title="Sửa"><i class="fas fa-pen text-sm"></i></button>
                    <button class="w-8 h-8 rounded-full hover:bg-red-50 text-red-500 flex items-center justify-center transition" data-action="delete-event" title="Xóa"><i class="fas fa-trash text-sm"></i></button>
                </div>` : ''}
            </div>
            <p class="text-sm text-gray-500 mb-2 flex items-center gap-1.5 font-medium"><i class="far fa-clock"></i> ${formatEventTime(e.start_time)} ${e.end_time ? ' - ' + formatEventTime(e.end_time) : ''}</p>
            ${e.description ? `<p class="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 mb-3">${escapeHtml(e.description)}</p>` : ''}
            
            <div class="flex items-center gap-3 mt-4 border-t dark:border-gray-700 pt-3">
                <button class="flex-1 py-1.5 rounded-lg text-sm font-bold transition-all ${e.user_status === 'accept' ? 'bg-fb-primary text-white shadow-md' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'}" data-action="join-event">
                    ${e.user_status === 'accept' ? '<i class="fas fa-check-circle mr-1"></i> Đã tham gia' : 'Tham gia'}
                </button>
                <button class="flex-1 py-1.5 rounded-lg text-sm font-bold transition-all bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700" data-action="view-participants">
                    <i class="fas fa-users mr-1"></i> ${e.participant_count || 0} người tham gia
                </button>
            </div>
        </div>
    `;

    card.querySelector("[data-action='delete-event']")?.addEventListener("click", async () => {
        if (await confirmAction("Bạn có chắc muốn xóa sự kiện này?")) {
            const res = await authFetch(API.groupEventDetail(GROUP_ID, e.id), { method: "DELETE" });
            if (res.ok) loadEvents(true);
        }
    });

    card.querySelector("[data-action='edit-event']")?.addEventListener("click", () => {
        openInlineFormModal({
            title: "Sửa Sự Kiện",
            bodyHtml: `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold mb-1">Tên sự kiện</label>
                        <input type="text" name="title" value="${escapeHtml(e.title)}" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-fb-primary outline-none">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold mb-1">Mô tả</label>
                        <textarea name="description" rows="3" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-fb-primary outline-none">${escapeHtml(e.description || "")}</textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-semibold mb-1">Bắt đầu</label>
                            <input type="datetime-local" name="start_time" value="${e.start_time ? e.start_time.slice(0,16) : ''}" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold mb-1">Kết thúc (Tùy chọn)</label>
                            <input type="datetime-local" name="end_time" value="${e.end_time ? e.end_time.slice(0,16) : ''}" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        </div>
                    </div>
                </div>
            `,
            getValues: (body) => ({
                title: body.querySelector("[name='title']").value.trim(),
                description: body.querySelector("[name='description']").value.trim(),
                start_time: body.querySelector("[name='start_time']").value || null,
                end_time: body.querySelector("[name='end_time']").value || null,
            }),
            validate: (v) => {
                if (!v.title) return "Vui lòng nhập tên sự kiện.";
                if (!v.start_time) return "Vui lòng chọn thời gian bắt đầu.";
                return "";
            }
        }).then(async val => {
            if (val) {
                const res = await authFetch(API.groupEventDetail(GROUP_ID, e.id), { method: "PATCH", headers: {"Content-Type":"application/json"}, body: JSON.stringify(val) });
                if (res.ok) loadEvents(true);
            }
        });
    });

    card.querySelector("[data-action='join-event']")?.addEventListener("click", async () => {
        const newStatus = e.user_status === 'accept' ? 'decline' : 'accept'; // Hủy thì coi như decline/hoặc pending
        const res = await authFetch(API.groupEventResponse(GROUP_ID, e.id), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ status: newStatus }) });
        if (res.ok) loadEvents(true);
    });

    card.querySelector("[data-action='view-participants']")?.addEventListener("click", async () => {
        const res = await authFetch(API.groupEventParticipant(GROUP_ID, e.id));
        if (res.ok) {
            const data = await res.json();
            const users = data.results || data;
            const formattedUsers = users.map(u => u.user_details || u);
            openUserListModal("Người tham gia", formattedUsers);
        }
    });

    return card;
}

// BIND CREATE EVENT & VOTE BUTTONS
document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btnCreateVoteTab")?.addEventListener("click", () => {
        openInlineFormModal({
            title: "Tạo Bình Chọn Mới",
            bodyHtml: `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold mb-1">Tiêu đề bình chọn</label>
                        <input type="text" name="title" placeholder="VD: Cuối tuần này đi đâu?" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-fb-primary outline-none">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold mb-1">Các lựa chọn ban đầu (Cách nhau bởi dấu phẩy)</label>
                        <input type="text" name="options" placeholder="Đà Lạt, Vũng Tàu, Ở nhà" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-fb-primary outline-none">
                    </div>
                </div>
            `,
            getValues: (body) => ({
                title: body.querySelector("[name='title']").value.trim(),
                options: body.querySelector("[name='options']").value.split(",").map(s => s.trim()).filter(Boolean)
            }),
            validate: (v) => {
                if (!v.title) return "Vui lòng nhập tiêu đề bình chọn.";
                if (v.options.length === 0) return "Vui lòng nhập ít nhất 1 lựa chọn.";
                return "";
            }
        }).then(async val => {
            if (val) {
                const res = await authFetch(API.groupCreateVote(GROUP_ID), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(val) });
                if (res.ok) loadVotesTab(true);
            }
        });
    });

    document.getElementById("btnCreateEvent")?.addEventListener("click", () => {
        openInlineFormModal({
            title: "Tạo Sự Kiện Mới",
            bodyHtml: `
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm font-semibold mb-1">Tên sự kiện</label>
                        <input type="text" name="title" placeholder="VD: Họp tổng kết tháng" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-fb-primary outline-none">
                    </div>
                    <div>
                        <label class="block text-sm font-semibold mb-1">Mô tả</label>
                        <textarea name="description" rows="3" placeholder="Nội dung sự kiện..." class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-fb-primary outline-none"></textarea>
                    </div>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-semibold mb-1">Bắt đầu</label>
                            <input type="datetime-local" name="start_time" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        </div>
                        <div>
                            <label class="block text-sm font-semibold mb-1">Kết thúc (Tùy chọn)</label>
                            <input type="datetime-local" name="end_time" class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
                        </div>
                    </div>
                </div>
            `,
            getValues: (body) => ({
                title: body.querySelector("[name='title']").value.trim(),
                description: body.querySelector("[name='description']").value.trim(),
                start_time: body.querySelector("[name='start_time']").value || null,
                end_time: body.querySelector("[name='end_time']").value || null,
            }),
            validate: (v) => {
                if (!v.title) return "Vui lòng nhập tên sự kiện.";
                if (!v.start_time) return "Vui lòng chọn thời gian bắt đầu.";
                return "";
            }
        }).then(async val => {
            if (val) {
                const res = await authFetch(API.groupListCreateEvent(GROUP_ID), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(val) });
                if (res.ok) loadEvents(true);
            }
        });
    });
});

window.openSuggestionModal = function() {
    openInlineFormModal({
        title: "Gửi Góp Ý",
        bodyHtml: `
            <div class="space-y-4">
                <p class="text-sm text-gray-500">Góp ý của bạn sẽ được gửi tới Ban Quản Trị của công ty. Bạn có thể nêu ra các vấn đề, khiếu nại hoặc đóng góp ý tưởng cải thiện.</p>
                <div>
                    <label class="block text-sm font-semibold mb-1">Nội dung góp ý</label>
                    <textarea name="content" rows="5" placeholder="Nhập nội dung góp ý..." class="w-full p-2.5 rounded-lg border dark:border-gray-700 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-fb-primary outline-none"></textarea>
                </div>
            </div>
        `,
        okText: "Gửi Góp Ý",
        getValues: (body) => ({
            content: body.querySelector("[name='content']").value.trim()
        }),
        validate: (v) => {
            if (!v.content) return "Vui lòng nhập nội dung góp ý.";
            return "";
        }
    }).then(async val => {
        if (val) {
            const res = await authFetch(API.groupCreateSuggestion(GROUP_ID), { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(val) });
            if (res.ok) {
                showToast("Gửi góp ý thành công!", "green");
            } else {
                showToast("Không thể gửi góp ý.", "red");
            }
        }
    });
};

