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

// ============ INIT ADMIN PANEL ============
export function initAdminPanel(groupId, isCompany) {
    const adminTabBtn = document.getElementById("navAdmin");
    if (adminTabBtn) adminTabBtn.classList.remove("hidden");

    if (isCompany) {
        document.querySelectorAll(".company-only").forEach((el) => el.classList.remove("hidden"));
    }

    // Admin sub-tab switching
    document.querySelectorAll(".admin-tab").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".admin-tab").forEach((t) => {
                t.classList.remove("bg-fb-primary", "text-white", "shadow-md");
                t.classList.add("text-gray-600", "dark:text-gray-300");
            });
            e.target.classList.add("bg-fb-primary", "text-white", "shadow-md");
            e.target.classList.remove("text-gray-600", "dark:text-gray-300");

            document.querySelectorAll(".admin-tab-content").forEach((c) => c.classList.add("hidden"));
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

    // Create event button
    document.getElementById("btnCreateEvent")?.addEventListener("click", () => {
        createEventModal(groupId);
    });

    // Create vote button
    document.getElementById("btnCreateVoteTab")?.addEventListener("click", () => {
        createVoteModal(groupId);
    });

    // Default: load pending posts + badge
    loadPendingPosts(groupId);
    loadJoinRequests(groupId, isCompany, true); // silent for badge only
}

// ============ PENDING POSTS ============
function loadPendingPosts(groupId) {
    const container = document.getElementById("pendingPostsList");
    if (!container) return;
    container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;

    apiGet(API.groupReviewList(groupId), (data, isFromCache) => {
        if (isFromCache && container.dataset.loaded) return;
        container.dataset.loaded = "1";

        const posts = data.results || (Array.isArray(data) ? data : []);
        if (posts.length > 0) {
            container.innerHTML = "";
            posts.forEach((post) => {
                const user = post.user || {};
                const avatar = user.picture || DEFAULT_AVATAR;
                const name = user.full_name || "Unknown";
                const photos = post.photos || [];

                container.insertAdjacentHTML(
                    "beforeend",
                    `
                    <div class="glass-card p-5 rounded-2xl shadow-sm border border-orange-200 dark:border-orange-900/50 hover:shadow-md transition">
                        <div class="flex items-center justify-between mb-4 pb-3 border-b border-orange-100 dark:border-orange-900/30">
                            <div class="flex items-center gap-3">
                                <img src="${avatar}" class="w-12 h-12 rounded-full object-cover border-2 border-white dark:border-gray-800 shadow-sm" onerror="this.src='${DEFAULT_AVATAR}'">
                                <div>
                                    <h4 class="font-bold text-gray-900 dark:text-white">${name}</h4>
                                    <span class="text-xs text-gray-500"><i class="far fa-clock"></i> ${new Date(post.created_at).toLocaleString("vi-VN")}</span>
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
                        ${photos.length
                        ? `<div class="rounded-xl overflow-hidden mt-3 max-w-sm"><img src="${photos[0].photo}" class="w-full h-auto object-cover" onerror="this.src='${DEFAULT_AVATAR}'"></div>`
                        : ""
                    }
                    </div>`
                );
            });

            container.querySelectorAll(".btn-review-post").forEach((btn) => {
                btn.addEventListener("click", async (e) => {
                    const postId = e.currentTarget.dataset.id;
                    const action = e.currentTarget.dataset.action;
                    try {
                        await apiMutate(API.groupReviewPost(groupId, postId), "POST", { action });
                        delete container.dataset.loaded;
                        loadPendingPosts(groupId);
                        showToast(action === "approved" ? "Đã duyệt bài viết!" : "Đã từ chối bài viết!");
                    } catch (err) {
                        showToast("Lỗi: " + err.message, "error");
                    }
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

// ============ JOIN REQUESTS ============
function loadJoinRequests(groupId, isCompany, silent = false) {
    const container = document.getElementById("joinRequestsList");
    const badge = document.getElementById("pendingBadge");

    if (!silent && container) {
        container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;
    }

    apiGet(API.groupAllRequests(groupId), (data) => {
        const pending = (data.results || (Array.isArray(data) ? data : [])).filter((r) => r.status === "pending");

        // Badge
        if (badge) {
            badge.textContent = pending.length;
            pending.length > 0 ? badge.classList.remove("hidden") : badge.classList.add("hidden");
        }

        if (silent || !container) return;

        if (pending.length > 0) {
            container.innerHTML = "";
            pending.forEach((req) => {
                const user = req.user || {};
                const avatar = user.picture || DEFAULT_AVATAR;
                const name = user.full_name || "Unknown";

                const acceptBtn = isCompany
                    ? `<button class="btn-company-accept px-4 py-2 bg-fb-primary text-white font-bold rounded-xl hover:bg-blue-600 transition" data-id="${req.id}"><i class="fas fa-check mr-1"></i> Duyệt & Gán chức vụ</button>`
                    : `<button class="btn-accept-req px-4 py-2 bg-fb-primary text-white font-bold rounded-xl hover:bg-blue-600 transition" data-id="${req.id}"><i class="fas fa-check mr-1"></i> Duyệt</button>`;

                container.insertAdjacentHTML(
                    "beforeend",
                    `
                    <div class="flex items-center justify-between py-4 border-b dark:border-gray-700 last:border-0">
                        <div class="flex items-center gap-4">
                            <img src="${avatar}" class="w-12 h-12 rounded-full object-cover border border-gray-200 dark:border-gray-700" onerror="this.src='${DEFAULT_AVATAR}'">
                            <div>
                                <h4 class="font-bold text-gray-900 dark:text-white">${name}</h4>
                                <span class="text-xs text-gray-500">Yêu cầu từ ${new Date(req.created_at).toLocaleDateString("vi-VN")}</span>
                            </div>
                        </div>
                        <div class="flex gap-2">
                            ${acceptBtn}
                            <button class="btn-reject-req px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 font-bold rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition" data-id="${req.id}">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>`
                );
            });

            // Bind accept buttons
            container.querySelectorAll(".btn-accept-req").forEach((btn) => {
                btn.addEventListener("click", async (e) => {
                    const reqId = e.currentTarget.dataset.id;
                    try {
                        await apiMutate(API.groupAcceptRequest(groupId, reqId), "POST");
                        showToast("Đã chấp nhận yêu cầu!");
                        loadJoinRequests(groupId, isCompany);
                    } catch (err) {
                        showToast("Lỗi: " + err.message, "error");
                    }
                });
            });

            // Bind company accept buttons (with role assignment)
            container.querySelectorAll(".btn-company-accept").forEach((btn) => {
                btn.addEventListener("click", async (e) => {
                    const reqId = e.currentTarget.dataset.id;
                    // Show role assignment modal
                    const roleId = await showRoleAssignmentModal(groupId);
                    if (roleId === null) return; // cancelled
                    try {
                        await apiMutate(API.groupAcceptRequest(groupId, reqId), "POST", { role_id: roleId });
                        showToast("Đã chấp nhận và gán chức vụ!");
                        loadJoinRequests(groupId, isCompany);
                    } catch (err) {
                        showToast("Lỗi: " + err.message, "error");
                    }
                });
            });

            // Bind reject buttons
            container.querySelectorAll(".btn-reject-req").forEach((btn) => {
                btn.addEventListener("click", async (e) => {
                    const reqId = e.currentTarget.dataset.id;
                    try {
                        await apiMutate(API.groupRejectRequest(groupId, reqId), "POST");
                        showToast("Đã từ chối yêu cầu!");
                        loadJoinRequests(groupId, isCompany);
                    } catch (err) {
                        showToast("Lỗi: " + err.message, "error");
                    }
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

// ============ ROLE ASSIGNMENT MODAL ============
async function showRoleAssignmentModal(groupId) {
    return new Promise((resolve) => {
        // Fetch departments and roles
        apiGet(API.groupDepartmentList(groupId), (data) => {
            const departments = data.results || (Array.isArray(data) ? data : []);
            if (departments.length === 0) {
                resolve(null);
                return;
            }

            // Build a simple prompt-based selection
            let msg = "Chọn chức vụ cho thành viên mới:\n";
            const roleMap = {};
            let idx = 1;

            departments.forEach((dept) => {
                msg += `\n--- ${dept.name} ---\n`;
                // We need to fetch roles for each department
                // For simplicity, use a prompt approach
            });

            // Simple approach: prompt for role name
            const roleName = prompt("Nhập tên chức vụ muốn gán (để trống nếu không gán):");
            if (!roleName?.trim()) {
                resolve(null);
                return;
            }

            // Find role by name across all departments
            let foundRoleId = null;
            let checked = 0;
            departments.forEach((dept) => {
                apiGet(API.groupRoleList(groupId, dept.id), (roleData) => {
                    checked++;
                    const role = (roleData.results || []).find(
                        (r) => r.name.toLowerCase() === roleName.trim().toLowerCase()
                    );
                    if (role) foundRoleId = role.id;
                    if (checked === departments.length) {
                        resolve(foundRoleId);
                    }
                });
            });
        });
    });
}

// ============ DEPARTMENTS ============
function loadDepartments(groupId) {
    const container = document.getElementById("departmentList");
    if (!container) return;
    container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;

    apiGet(API.groupDepartmentList(groupId), (data) => {
        const departments = data.results || (Array.isArray(data) ? data : []);

        if (departments.length > 0) {
            container.innerHTML = "";
            let loadedCount = 0;

            departments.forEach((dept) => {
                apiGet(API.groupRoleList(groupId, dept.id), (roleData) => {
                    const roles = roleData.results || [];
                    const rolesHtml = roles
                        .map(
                            (r) => `
                        <div class="flex justify-between items-center bg-white dark:bg-gray-800 border dark:border-gray-700 p-3 rounded-xl mt-3 shadow-sm" data-role-id="${r.id}">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-gray-800 dark:text-gray-200">
                                    ${r.name}
                                </span>
                                <span class="text-xs text-blue-500 bg-blue-50 cursor-pointer hover:bg-blue-100 px-2 py-0.5 rounded-full btn-view-role-members transition font-bold" data-did="${dept.id}" data-rid="${r.id}" title="Xem danh sách người thuộc chức vụ này">${r.member_count || 0} người</span>
                            </div>
                            <div class="flex gap-2">
                                <button class="btn-add-member-role text-xs bg-green-50 hover:bg-green-100 text-green-600 px-2 py-1 rounded-lg transition font-bold" data-did="${dept.id}" data-rid="${r.id}" title="Thêm thành viên vào chức vụ này">
                                    <i class="fas fa-user-plus"></i> Thêm User
                                </button>
                                <button class="btn-delete-role text-xs bg-red-50 hover:bg-red-100 text-red-500 px-2 py-1 rounded-lg transition" data-rid="${r.id}" title="Xóa chức vụ">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>`
                        )
                        .join("");

                    const deptHtml = `
                        <div class="border border-gray-200 dark:border-gray-700 rounded-2xl p-5 bg-gray-50/50 dark:bg-gray-800/20 relative overflow-hidden" data-dept-id="${dept.id}">
                            <div class="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                            <div class="flex justify-between items-start gap-3 mb-4">
                                <div>
                                    <h4 class="font-black text-xl text-gray-900 dark:text-white">${dept.name}</h4>
                                    <span class="text-blue-500 bg-blue-50 cursor-pointer hover:bg-blue-100 px-2 py-0.5 rounded-full btn-view-dept-members transition font-bold text-sm" data-did="${dept.id}" title="Xem danh sách thành viên phòng ban">${dept.member_count || 0} nhân sự</span>
                                </div>
                                <div class="flex gap-2">
                                    <button class="btn-add-role text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1" data-did="${dept.id}">
                                        <i class="fas fa-plus"></i> Thêm chức vụ
                                    </button>
                                    <button class="btn-delete-dept text-sm bg-red-100 hover:bg-red-200 text-red-600 px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1" data-did="${dept.id}">
                                        <i class="fas fa-trash"></i> Xóa
                                    </button>
                                </div>
                            </div>
                            <div class="pl-0 sm:pl-4">
                                ${rolesHtml || `<div class="text-center py-4 text-sm text-gray-500 bg-white dark:bg-gray-800 rounded-xl border border-dashed dark:border-gray-700">Chưa có chức vụ nào.</div>`}
                            </div>
                        </div>`;

                    // Check if block already exists
                    const existingBlock = container.querySelector(`[data-dept-id="${dept.id}"]`);
                    if (existingBlock) {
                        existingBlock.outerHTML = deptHtml;
                    } else {
                        container.insertAdjacentHTML("beforeend", deptHtml);
                    }

                    loadedCount++;

                    // Bind actions after all departments loaded
                    if (loadedCount === departments.length) {
                        bindDepartmentActions(groupId);
                    }
                });
            });
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

function bindDepartmentActions(groupId) {
    // Add role
    document.querySelectorAll(".btn-add-role").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const did = e.currentTarget.dataset.did;
            const name = prompt("Tên chức vụ mới:");
            if (name?.trim()) {
                try {
                    await apiMutate(API.groupAddRole(groupId, did), "POST", {
                        name: name.trim(),
                        department_id: parseInt(did),
                    });
                    showToast("Đã thêm chức vụ!");
                    loadDepartments(groupId);
                } catch (err) {
                    showToast("Lỗi: " + err.message, "error");
                }
            }
        });
    });

    // Delete department
    document.querySelectorAll(".btn-delete-dept").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const did = e.currentTarget.dataset.did;
            if (!(await confirmAction("Xóa phòng ban này? Các chức vụ liên quan cũng sẽ bị xóa."))) return;
            try {
                await apiMutate(API.groupUpdateDepartment(groupId, did), "DELETE");
                showToast("Đã xóa phòng ban!");
                loadDepartments(groupId);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });

    // Delete role
    document.querySelectorAll(".btn-delete-role").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
            const rid = e.currentTarget.dataset.rid;
            if (!(await confirmAction("Xóa chức vụ này?"))) return;
            try {
                await apiMutate(API.groupUpdateRole(groupId, rid), "DELETE");
                showToast("Đã xóa chức vụ!");
                loadDepartments(groupId);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        });
    });
}

async function addDepartment(groupId, name) {
    try {
        await apiMutate(API.groupAddDepartment(groupId), "POST", { name });
        showToast("Đã thêm phòng ban!");
        loadDepartments(groupId);
    } catch (err) {
        showToast("Lỗi: " + err.message, "error");
    }
}

// ============ SUGGESTIONS ============
function loadSuggestions(groupId) {
    const container = document.getElementById("suggestionsList");
    if (!container) return;
    container.innerHTML = `<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-fb-primary text-2xl"></i></div>`;

    apiGet(API.groupListSuggestion(groupId), (data) => {
        const suggestions = data.results || (Array.isArray(data) ? data : []);
        if (suggestions.length > 0) {
            container.innerHTML = "";
            suggestions.forEach((s) => {
                container.insertAdjacentHTML(
                    "beforeend",
                    `
                    <div class="p-5 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border border-yellow-200 dark:border-yellow-700/50 rounded-2xl shadow-sm">
                        <div class="flex justify-between items-start mb-3">
                            <span class="font-black text-yellow-800 dark:text-yellow-500 bg-yellow-100 dark:bg-yellow-900/50 px-3 py-1 rounded-full text-xs uppercase tracking-wider">
                                <i class="fas fa-comment-dots"></i> Góp ý ẩn danh
                            </span>
                            <span class="text-xs text-gray-500">${new Date(s.created_at).toLocaleString("vi-VN")}</span>
                        </div>
                        <p class="text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed bg-white/50 dark:bg-black/20 p-4 rounded-xl">${s.content}</p>
                    </div>`
                );
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

// ============ CREATE EVENT MODAL ============
function createEventModal(groupId) {
    const title = prompt("Tiêu đề sự kiện:");
    if (!title?.trim()) return;

    const description = prompt("Mô tả sự kiện (không bắt buộc):");
    const startTime = prompt("Thời gian bắt đầu (YYYY-MM-DD HH:MM):");
    if (!startTime?.trim()) {
        showToast("Vui lòng nhập thời gian bắt đầu!", "error");
        return;
    }
    const endTime = prompt("Thời gian kết thúc (YYYY-MM-DD HH:MM, không bắt buộc):");

    const data = {
        title: title.trim(),
        description: description?.trim() || "",
        start_time: new Date(startTime.trim()).toISOString(),
    };
    if (endTime?.trim()) {
        data.end_time = new Date(endTime.trim()).toISOString();
    }

    apiMutate(API.groupEventList(groupId), "POST", data)
        .then(() => {
            showToast("Đã tạo sự kiện!");
            // Reload events if on events tab
            const eventsTab = document.getElementById("tabEvents");
            if (eventsTab && !eventsTab.classList.contains("hidden")) {
                // Trigger reload
                const loadEvents = window.loadEvents;
                if (typeof loadEvents === "function") loadEvents(true);
            }
        })
        .catch((err) => showToast("Lỗi: " + err.message, "error"));
}

// ============ CREATE VOTE MODAL ============
function createVoteModal(groupId) {
    const title = prompt("Câu hỏi bình chọn:");
    if (!title?.trim()) return;

    const optionsStr = prompt("Các lựa chọn (cách nhau bằng dấu phẩy):");
    if (!optionsStr?.trim()) {
        showToast("Vui lòng nhập ít nhất 2 lựa chọn!", "error");
        return;
    }

    const options = optionsStr
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o);

    if (options.length < 2) {
        showToast("Cần ít nhất 2 lựa chọn!", "error");
        return;
    }

    apiMutate(API.groupCreateVote(groupId), "POST", {
        title: title.trim(),
        options: options,
    })
        .then(() => {
            showToast("Đã tạo bình chọn!");
            const votesTab = document.getElementById("tabVotes");
            if (votesTab && !votesTab.classList.contains("hidden")) {
                const loadVotesTab = window.loadVotesTab;
                if (typeof loadVotesTab === "function") loadVotesTab(true);
            }
        })
        .catch((err) => showToast("Lỗi: " + err.message, "error"));
}