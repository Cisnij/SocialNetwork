import { API, DEFAULT_AVATAR } from "../shared/config.js";
import { authFetch, authFetchCache } from "../authenticate/auth.js";

// ============ HELPERS ============
function apiGet(url, onData) {
    return authFetchCache(url, {}, onData);
}

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

// ============ INIT ADMIN PANEL ============
export function initAdminPanel(groupId, isCompany) {
    const adminTabBtn = document.getElementById("navAdmin");
    if (adminTabBtn) adminTabBtn.classList.remove("hidden");

    if (isCompany) {
        document.querySelectorAll(".company-only").forEach(el => el.classList.remove("hidden"));
    }

    // Admin sub-tab switching
    document.querySelectorAll(".admin-tab").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".admin-tab").forEach(t => {
                t.classList.remove("bg-fb-primary", "text-white", "shadow-md");
                t.classList.add("text-gray-600", "dark:text-gray-300");
            });
            e.target.classList.add("bg-fb-primary", "text-white", "shadow-md");
            e.target.classList.remove("text-gray-600", "dark:text-gray-300");

            document.querySelectorAll(".admin-tab-content").forEach(c => c.classList.add("hidden"));
            const targetId = e.target.getAttribute("data-target");
            const el = document.getElementById(targetId);
            if (el) {
                el.classList.remove("hidden");
                el.classList.remove("animate-fade-in");
                void el.offsetWidth;
                el.classList.add("animate-fade-in");
            }

            if (targetId === "adminPendingPosts") loadPendingPosts(groupId);
            if (targetId === "adminJoinRequests") loadJoinRequests(groupId, isCompany);
            if (targetId === "adminDepartments" && isCompany) loadDepartments(groupId);
            if (targetId === "adminSuggestions" && isCompany) loadSuggestions(groupId);
        });
    });

    // Add department button
    document.getElementById("btnAddDepartment")?.addEventListener("click", () => {
        const name = prompt("Nhập tên phòng ban mới:");
        if (name?.trim()) addDepartment(groupId, name.trim());
    });

    // Default: load pending posts + badge
    loadPendingPosts(groupId);
    loadJoinRequests(groupId, isCompany, true); // silent for badge only
}

// ============ PENDING POSTS (cache) ============
function loadPendingPosts(groupId) {
    const container = document.getElementById("pendingPostsList");
    if (!container) return;
    container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;

    apiGet(API.groupReviewList(groupId), (data, isFromCache) => {
        if (isFromCache && container.dataset.loaded) return;
        container.dataset.loaded = "1";

        if (data.results && data.results.length > 0) {
            container.innerHTML = "";
            data.results.forEach(post => {
                const user = post.user || {};
                const avatar = user.picture || DEFAULT_AVATAR;
                const name = user.full_name || "Unknown";

                container.insertAdjacentHTML('beforeend', `
                    <div class="glass-card p-5 rounded-2xl shadow-sm border border-orange-200 dark:border-orange-900/50 hover:shadow-md transition">
                        <div class="flex items-center justify-between mb-4 pb-3 border-b border-orange-100 dark:border-orange-900/30">
                            <div class="flex items-center gap-3">
                                <img src="${avatar}" class="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-gray-800 shadow-sm" onerror="this.src='${DEFAULT_AVATAR}'">
                                <div>
                                    <h4 class="font-bold text-gray-900 dark:text-white">${name}</h4>
                                    <span class="text-xs text-gray-500"><i class="far fa-clock"></i> ${new Date(post.created_at).toLocaleString('vi-VN')}</span>
                                </div>
                            </div>
                            <div class="flex gap-2">
                                <button class="btn-review-post px-4 py-2 bg-green-500 text-white font-bold rounded-xl hover:bg-green-600 transition" data-id="${post.post_id}" data-action="approved">
                                    <i class="fas fa-check mr-1"></i> Duyệt
                                </button>
                                <button class="btn-review-post px-3 py-2 bg-red-100 text-red-600 font-bold rounded-xl hover:bg-red-200 transition" data-id="${post.post_id}" data-action="rejected">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                        <p class="text-gray-800 dark:text-gray-200">${post.title || ""}</p>
                        ${post.photos?.length ? `<div class="rounded-xl overflow-hidden mt-3 max-w-sm"><img src="${post.photos[0].image}" class="w-full h-auto object-cover"></div>` : ''}
                    </div>`);
            });

            container.querySelectorAll('.btn-review-post').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const postId = e.currentTarget.dataset.id;
                    const action = e.currentTarget.dataset.action;
                    try {
                        await apiMutate(API.groupReviewPost(groupId, postId), 'POST', { action });
                        delete container.dataset.loaded;
                        loadPendingPosts(groupId);
                    } catch (err) { alert("Lỗi: " + err.message); }
                });
            });
        } else {
            container.innerHTML = `
                <div class="text-center text-gray-500 py-10 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <i class="fas fa-check-circle text-4xl mb-3 text-green-500 opacity-50"></i>
                    <p class="font-bold">Không có bài viết nào chờ duyệt.</p>
                </div>`;
        }
    });
}

// ============ JOIN REQUESTS (cache) ============
function loadJoinRequests(groupId, isCompany, silent = false) {
    const container = document.getElementById("joinRequestsList");
    const badge = document.getElementById("pendingBadge");

    if (!silent && container) {
        container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
    }

    apiGet(API.groupAllRequests(groupId), (data) => {
        const pending = (data.results || []).filter(r => r.status === 'pending');

        // Badge
        if (badge) {
            badge.textContent = pending.length;
            pending.length > 0 ? badge.classList.remove("hidden") : badge.classList.add("hidden");
        }

        if (silent || !container) return;

        if (pending.length > 0) {
            container.innerHTML = "";
            pending.forEach(req => {
                const user = req.user || {};
                const avatar = user.picture || DEFAULT_AVATAR;
                const name = user.full_name || "Unknown";

                const acceptBtn = isCompany
                    ? `<button class="btn-company-accept px-4 py-2 bg-fb-primary text-white font-bold rounded-xl hover:bg-blue-600 transition" data-id="${req.id}"><i class="fas fa-check mr-1"></i> Duyệt</button>`
                    : `<button class="btn-accept-req px-4 py-2 bg-fb-primary text-white font-bold rounded-xl hover:bg-blue-600 transition" data-id="${req.id}"><i class="fas fa-check mr-1"></i> Duyệt</button>`;

                container.insertAdjacentHTML('beforeend', `
                    <div class="flex items-center justify-between py-4 border-b dark:border-gray-700 last:border-0">
                        <div class="flex items-center gap-4">
                            <img src="${avatar}" class="w-12 h-12 rounded-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
                            <div>
                                <h4 class="font-bold text-gray-900 dark:text-white">${name}</h4>
                                <span class="text-xs text-gray-500">${new Date(req.created_at).toLocaleDateString('vi-VN')}</span>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            ${acceptBtn}
                            <button class="btn-reject-req px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition" data-id="${req.id}">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>`);
            });

            container.querySelectorAll('.btn-accept-req, .btn-company-accept').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const reqId = e.currentTarget.dataset.id;
                    try {
                        await apiMutate(API.groupAcceptRequest(groupId, reqId), 'POST');
                        loadJoinRequests(groupId, isCompany);
                    } catch (err) { alert("Lỗi: " + err.message); }
                });
            });

            container.querySelectorAll('.btn-reject-req').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const reqId = e.currentTarget.dataset.id;
                    try {
                        await apiMutate(API.groupRejectRequest(groupId, reqId), 'POST');
                        loadJoinRequests(groupId, isCompany);
                    } catch (err) { alert("Lỗi: " + err.message); }
                });
            });
        } else {
            container.innerHTML = `
                <div class="text-center text-gray-500 py-10 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <i class="fas fa-inbox text-4xl mb-3 opacity-50"></i>
                    <p class="font-bold">Không có yêu cầu tham gia nào.</p>
                </div>`;
        }
    });
}

// ============ DEPARTMENTS (cache) ============
function loadDepartments(groupId) {
    const container = document.getElementById("departmentList");
    if (!container) return;
    container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;

    apiGet(API.groupDepartmentList(groupId), async (data, isFromCache) => {
        if (data.results && data.results.length > 0) {
            container.innerHTML = "";
            for (const dept of data.results) {
                // Load roles cho mỗi dept (cũng dùng cache)
                apiGet(API.groupRoleList(groupId, dept.id), (roleData) => {
                    const roles = roleData.results || [];
                    const rolesHtml = roles.map(r => `
                        <div class="flex justify-between items-center bg-white dark:bg-gray-800 border dark:border-gray-700 p-3 rounded-xl mt-3 shadow-sm">
                            <span class="font-bold text-gray-800 dark:text-gray-200">
                                ${r.name} <span class="text-xs text-gray-400 ml-1">${r.member_count || 0} người</span>
                            </span>
                        </div>`).join('');

                    // Render hoặc update dept block
                    const existingBlock = container.querySelector(`[data-dept-id="${dept.id}"]`);
                    const deptHtml = `
                        <div class="border border-gray-200 dark:border-gray-700 rounded-2xl p-5 bg-gray-50/50 dark:bg-gray-800/20 relative overflow-hidden" data-dept-id="${dept.id}">
                            <div class="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                            <div class="flex justify-between items-start gap-3 mb-4">
                                <div>
                                    <h4 class="font-black text-xl text-gray-900 dark:text-white">${dept.name}</h4>
                                    <span class="text-gray-500 text-sm">${dept.member_count || 0} nhân sự</span>
                                </div>
                                <button class="btn-add-role text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1" data-did="${dept.id}">
                                    <i class="fas fa-plus"></i> Thêm chức vụ
                                </button>
                            </div>
                            <div class="pl-0 sm:pl-4">
                                ${rolesHtml || `<div class="text-center py-4 text-sm text-gray-500 bg-white dark:bg-gray-800 rounded-xl border border-dashed dark:border-gray-700">Chưa có chức vụ nào.</div>`}
                            </div>
                        </div>`;

                    if (existingBlock) {
                        existingBlock.outerHTML = deptHtml;
                    } else {
                        container.insertAdjacentHTML('beforeend', deptHtml);
                    }

                    // Bind add role button
                    container.querySelector(`[data-dept-id="${dept.id}"] .btn-add-role`)?.addEventListener('click', async (e) => {
                        const did = e.currentTarget.dataset.did;
                        const name = prompt("Tên chức vụ mới:");
                        if (name?.trim()) {
                            try {
                                await apiMutate(API.groupAddRole(groupId, did), 'POST', { name: name.trim(), department_id: parseInt(did) });
                                loadDepartments(groupId);
                            } catch (err) { alert("Lỗi: " + err.message); }
                        }
                    });
                });
            }
        } else {
            container.innerHTML = `
                <div class="text-center text-gray-500 py-12 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <i class="fas fa-building text-4xl mb-4 text-gray-300"></i>
                    <p class="font-bold text-lg">Chưa có phòng ban nào</p>
                    <p class="text-sm mt-1">Nhấn "Thêm phòng ban" để bắt đầu thiết lập cơ cấu tổ chức.</p>
                </div>`;
        }
    });
}

async function addDepartment(groupId, name) {
    try {
        await apiMutate(API.groupAddDepartment(groupId), 'POST', { name });
        loadDepartments(groupId);
    } catch (err) { alert("Lỗi: " + err.message); }
}

// ============ SUGGESTIONS (cache) ============
function loadSuggestions(groupId) {
    const container = document.getElementById("suggestionsList");
    if (!container) return;
    container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;

    apiGet(API.groupListSuggestion(groupId), (data) => {
        if (data.results && data.results.length > 0) {
            container.innerHTML = "";
            data.results.forEach(s => {
                container.insertAdjacentHTML('beforeend', `
                    <div class="p-5 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-2xl shadow-sm">
                        <div class="flex justify-between items-start mb-3">
                            <span class="font-black text-yellow-800 dark:text-yellow-500 bg-yellow-100 dark:bg-yellow-900/50 px-3 py-1 rounded-full text-xs uppercase tracking-wider">
                                <i class="fas fa-comment-dots"></i> Góp ý ẩn danh
                            </span>
                            <span class="text-xs text-gray-500">${new Date(s.created_at).toLocaleString('vi-VN')}</span>
                        </div>
                        <p class="text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed bg-white/50 dark:bg-black/20 p-4 rounded-xl">${s.content}</p>
                    </div>`);
            });
        } else {
            container.innerHTML = `
                <div class="text-center text-gray-500 py-12 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <i class="fas fa-envelope-open-text text-4xl mb-4 text-gray-300"></i>
                    <p class="font-bold text-lg">Hòm thư trống</p>
                    <p class="text-sm mt-1">Chưa có góp ý nào từ thành viên.</p>
                </div>`;
        }
    });
}
