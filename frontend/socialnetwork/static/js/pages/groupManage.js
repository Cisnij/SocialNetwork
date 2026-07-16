import { API, DEFAULT_AVATAR } from "../shared/config.js";
import { authFetch, authFetchCache } from "../authenticate/auth.js";

// ============ HELPERS ============
function apiGet(url, onData) {
    return authFetchCache(url, {}, onData);
}

function clearGroupCaches() {
    [API.groupExplore(), API.groupUserGroups(), API.groupMyRequests()].forEach((url) => {
        if (typeof url === 'string') {
            sessionStorage.removeItem(`authCache_${url}`);
        }
    });
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

function openFormModal({ title, bodyHtml, validate, onGetValues, okText = "Lưu" }) {
    return new Promise((resolve) => {
        const modal = document.getElementById("formModal");
        if (!modal) {
            resolve(null);
            return;
        }
        document.getElementById("formModalTitle").textContent = title;
        document.getElementById("formModalOk").textContent = okText;
        const body = document.getElementById("formModalBody");
        const errorEl = document.getElementById("formModalError");
        body.innerHTML = bodyHtml || "";
        errorEl.classList.add("hidden");

        modal.classList.remove("hidden");

        const cleanup = (value) => {
            modal.classList.add("hidden");
            document.getElementById("formModalOk").onclick = null;
            document.getElementById("formModalCancel").onclick = null;
            resolve(value);
        };

            document.getElementById("formModalOk").onclick = () => {
                const values = onGetValues ? onGetValues() : {};
                if (validate) {
                    const err = validate(values);
                    if (err) {
                        errorEl.textContent = err;
                        errorEl.classList.remove("hidden");
                        return;
                    }
                }
                cleanup(values);
            };

        document.getElementById("formModalCancel").onclick = () => cleanup(null);

        setTimeout(() => {
            const first = body.querySelector("input, textarea, select");
            if (first) first.focus();
        }, 100);
    });
}

function showFormModal(arg1, arg2, arg3) {
    // Backward compatible: check if first arg is an object (new signature)
    if (typeof arg1 === "object" && arg1 !== null && !Array.isArray(arg1)) {
        const { title, fields, validate, okText = "Lưu" } = arg1;
        const fieldIds = fields.map(f => f.id);
        const bodyHtml = fields.map(field => {
            const required = field.required ? " *" : "";
            let inputHtml = "";
            if (field.type === "textarea") {
                inputHtml = `<textarea id="formField_${field.id}" rows="${field.rows || 3}" placeholder="${field.placeholder || ""}" class="w-full p-3 rounded-lg bg-fb-secondary dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-fb-primary dark:text-[#e4e6eb]">${field.value || ""}</textarea>`;
            } else {
                inputHtml = `<input type="${field.type || "text"}" id="formField_${field.id}" value="${field.value || ""}" placeholder="${field.placeholder || ""}" class="w-full p-3 rounded-lg bg-fb-secondary dark:bg-gray-700 border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-fb-primary dark:text-[#e4e6eb]">`;
            }
            return `<div class="mb-3"><label class="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">${field.label}${required}</label>${inputHtml}</div>`;
        }).join("");

        return openFormModal({
            title,
            okText,
            validate,
            bodyHtml,
            onGetValues: () => {
                const values = {};
                fieldIds.forEach(id => {
                    const el = document.getElementById("formField_" + id);
                    values[id] = el ? el.value.trim() : "";
                });
                return values;
            },
        });
    } else {
        // Old signature: showFormModal(title, bodyHtml, onSubmit)
        const title = arg1;
        const bodyHtml = arg2;
        const onSubmit = arg3;
        return new Promise(async (resolve) => {
            const modal = document.getElementById("formModal");
            const titleEl = document.getElementById("formModalTitle");
            const bodyEl = document.getElementById("formModalBody");
            const okBtn = document.getElementById("formModalOk");
            const cancelBtn = document.getElementById("formModalCancel");
            const errorEl = document.getElementById("formModalError");

            if (!modal || !titleEl || !bodyEl || !okBtn || !cancelBtn) {
                resolve(null);
                return;
            }

            titleEl.textContent = title;
            bodyEl.innerHTML = bodyHtml || "";
            errorEl.textContent = "";
            errorEl.classList.add("hidden");

            modal.classList.remove("hidden");

            const cleanup = (value = null) => {
                modal.classList.add("hidden");
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                resolve(value);
            };

            cancelBtn.onclick = () => cleanup(null);

            okBtn.onclick = async () => {
                try {
                    const result = onSubmit ? await onSubmit(bodyEl) : true;
                    cleanup(result);
                } catch (err) {
                    errorEl.textContent = err.message || "Đã xảy ra lỗi";
                    errorEl.classList.remove("hidden");
                }
            };

            setTimeout(() => {
                const first = bodyEl.querySelector("input, textarea, select");
                if (first) first.focus();
            }, 100);
        });
    }
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
            if (targetId === "adminDepartments" && isCompany) {
                loadDepartments(groupId);
                setupDepartmentDelegation(groupId);
            }
            if (targetId === "adminSuggestions" && isCompany) loadSuggestions(groupId);
        });
    });

    // Add department button
    document.getElementById("btnAddDepartment")?.addEventListener("click", async () => {
        const values = await showFormModal({
            title: "Thêm phòng ban",
            fields: [
                { id: "name", label: "Tên phòng ban", placeholder: "Nhập tên phòng ban...", required: true }
            ],
            validate: (values) => {
                if (!values.name) return "Vui lòng nhập tên phòng ban!";
                return null;
            }
        });
        if (values) {
            try {
                await apiMutate(API.groupAddDepartment(groupId), "POST", { name: values.name });
                showToast("Đã thêm phòng ban!");
                loadDepartments(groupId);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
        }
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
                const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || "Unknown";
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
                const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || "Unknown";

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
                            <button class="btn-reject-req px-4 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 font-bold rounded-xl hover:bg-red-100 dark:hover:bg-red-900/50 border border-red-200 dark:border-red-800/50 transition" data-id="${req.id}">
                                <i class="fas fa-times mr-1"></i> Từ chối
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
                        clearGroupCaches();
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
                    const req = pending.find((r) => r.id == reqId);
                    if (!req) return;
                    
                    const roleId = await showRoleAssignmentModal(groupId);
                    if (roleId === null) return; // cancelled
                    
                    try {
                        await apiMutate(API.groupAcceptRequest(groupId, reqId), "POST");
                        const userId = req.user?.id;
                        if (userId && roleId) {
                            await apiMutate(API.groupAddMemberJobRole(groupId, userId), "POST", { role_id: roleId });
                        }
                        showToast("Đã chấp nhận và gán chức vụ!");
                        clearGroupCaches();
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
                        clearGroupCaches();
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
    try {
        const res = await authFetch(API.groupDepartmentList(groupId));
        const data = await res.json();
        const departments = data.results || (Array.isArray(data) ? data : []);
        if (departments.length === 0) {
            showToast("Chưa có phòng ban nào. Vui lòng tạo phòng ban trước.", "error");
            return null;
        }

        const result = await showFormModal("Gán chức vụ", `
            <p class="text-sm text-red-500 dark:text-red-400 mb-3 font-semibold">Bắt buộc chọn chức vụ cho thành viên mới:</p>
            <div class="space-y-3 max-h-[60vh] overflow-y-auto custom-scrollbar pr-1">
                ${departments.map((dept) => {
                    const roles = dept.roles || [];
                    const rolesHtml = roles.length > 0
                        ? roles.map((r) => `
                            <label class="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition border border-transparent hover:border-gray-200 dark:hover:border-gray-700">
                                <input type="radio" name="roleOption" value="${r.id}" class="accent-fb-primary w-4 h-4" required>
                                <div class="flex-1">
                                    <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">${r.name}</span>
                                    <span class="text-xs text-gray-500 ml-2">${r.member_count || 0} người</span>
                                </div>
                            </label>
                        `).join("")
                        : `<p class="text-xs text-gray-500 italic px-2">Chưa có chức vụ</p>`;
                    return `
                        <div class="border dark:border-gray-700 rounded-xl p-3">
                            <h4 class="font-bold text-gray-900 dark:text-white mb-2 text-xs uppercase tracking-wider">${dept.name}</h4>
                            <div class="space-y-1">
                                ${rolesHtml}
                            </div>
                        </div>
                    `;
                }).join("")}
            </div>
        `, async (body) => {
            const selected = body.querySelector('input[name="roleOption"]:checked');
            if (!selected) throw new Error("Vui lòng chọn chức vụ trước khi duyệt");
            return parseInt(selected.value);
        });

        return result;
    } catch (err) {
        showToast("Lỗi: " + err.message, "error");
        return null;
    }
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

            departments.forEach((dept) => {
                const roles = dept.roles || [];
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
                            <button class="btn-edit-role text-xs bg-yellow-50 hover:bg-yellow-100 text-yellow-600 px-2 py-1 rounded-lg transition" data-rid="${r.id}" data-name="${r.name}" title="Sửa chức vụ">
                                <i class="fas fa-edit"></i>
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
                                <button class="btn-edit-dept text-sm bg-yellow-100 hover:bg-yellow-200 text-yellow-600 px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1" data-did="${dept.id}" data-name="${dept.name}">
                                    <i class="fas fa-edit"></i>
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

                const existingBlock = container.querySelector(`[data-dept-id="${dept.id}"]`);
                if (existingBlock) {
                    existingBlock.outerHTML = deptHtml;
                } else {
                    container.insertAdjacentHTML("beforeend", deptHtml);
                }
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

function setupDepartmentDelegation(groupId) {
    const container = document.getElementById("departmentList");
    if (!container) return;

    // Remove existing listeners first (if any)
    const newContainer = container.cloneNode(true);
    container.parentNode.replaceChild(newContainer, container);
    const containerRef = document.getElementById("departmentList");

    containerRef.addEventListener("click", async (e) => {
        // Add role
        const addRoleBtn = e.target.closest(".btn-add-role");
        if (addRoleBtn) {
            const did = addRoleBtn.dataset.did;
            const values = await showFormModal({
                title: "Thêm chức vụ",
                fields: [
                    { id: "name", label: "Tên chức vụ", placeholder: "Nhập tên chức vụ...", required: true }
                ],
                validate: (values) => {
                    if (!values.name) return "Vui lòng nhập tên chức vụ!";
                    return null;
                }
            });
            if (values) {
                try {
                    await apiMutate(API.groupAddRole(groupId, did), "POST", {
                        name: values.name,
                        department_id: parseInt(did),
                    });
                    showToast("Đã thêm chức vụ!");
                    loadDepartments(groupId);
                } catch (err) {
                    showToast("Lỗi: " + err.message, "error");
                }
            }
            return;
        }

        // Edit department
        const editDeptBtn = e.target.closest(".btn-edit-dept");
        if (editDeptBtn) {
            const did = editDeptBtn.dataset.did;
            const oldName = editDeptBtn.dataset.name;
            const values = await showFormModal({
                title: "Sửa phòng ban",
                fields: [
                    { id: "name", label: "Tên phòng ban", value: oldName, placeholder: "Nhập tên phòng ban...", required: true }
                ],
                validate: (values) => {
                    if (!values.name) return "Vui lòng nhập tên phòng ban!";
                    return null;
                }
            });
            if (values) {
                try {
                    await apiMutate(API.groupUpdateDepartment(groupId, did), "PATCH", { name: values.name });
                    showToast("Đã cập nhật phòng ban!");
                    loadDepartments(groupId);
                } catch (err) {
                    showToast("Lỗi: " + err.message, "error");
                }
            }
            return;
        }

        // Delete department
        const deleteDeptBtn = e.target.closest(".btn-delete-dept");
        if (deleteDeptBtn) {
            const did = deleteDeptBtn.dataset.did;
            if (!(await confirmAction("Xóa phòng ban này? Các chức vụ liên quan cũng sẽ bị xóa."))) return;
            try {
                await apiMutate(API.groupUpdateDepartment(groupId, did), "DELETE");
                showToast("Đã xóa phòng ban!");
                loadDepartments(groupId);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
            return;
        }

        // Edit role
        const editRoleBtn = e.target.closest(".btn-edit-role");
        if (editRoleBtn) {
            const rid = editRoleBtn.dataset.rid;
            const oldName = editRoleBtn.dataset.name;
            const values = await showFormModal({
                title: "Sửa chức vụ",
                fields: [
                    { id: "name", label: "Tên chức vụ", value: oldName, placeholder: "Nhập tên chức vụ...", required: true }
                ],
                validate: (values) => {
                    if (!values.name) return "Vui lòng nhập tên chức vụ!";
                    return null;
                }
            });
            if (values) {
                try {
                    await apiMutate(API.groupUpdateRole(groupId, rid), "PATCH", { name: values.name });
                    showToast("Đã cập nhật chức vụ!");
                    loadDepartments(groupId);
                } catch (err) {
                    showToast("Lỗi: " + err.message, "error");
                }
            }
            return;
        }

        // Delete role
        const deleteRoleBtn = e.target.closest(".btn-delete-role");
        if (deleteRoleBtn) {
            const rid = deleteRoleBtn.dataset.rid;
            if (!(await confirmAction("Xóa chức vụ này?"))) return;
            try {
                await apiMutate(API.groupUpdateRole(groupId, rid), "DELETE");
                showToast("Đã xóa chức vụ!");
                loadDepartments(groupId);
            } catch (err) {
                showToast("Lỗi: " + err.message, "error");
            }
            return;
        }

        // View department members
        const viewDeptBtn = e.target.closest(".btn-view-dept-members");
        if (viewDeptBtn) {
            const did = viewDeptBtn.dataset.did;
            const modalPromise = showFormModal("Thành viên phòng ban", `
                <div id="deptMembersList" class="space-y-2 max-h-96 overflow-y-auto">
                    <div class="text-center py-4"><i class="fas fa-spinner fa-spin text-fb-primary"></i></div>
                </div>
            `, async (body) => true);

            const listContainer = document.getElementById("deptMembersList");
            if (listContainer) {
                try {
                    const res = await authFetch(API.groupDeptMembers(groupId, did));
                    const data = await res.json();
                    const members = data.results || (Array.isArray(data) ? data : []);
                    if (members.length === 0) {
                        listContainer.innerHTML = `<p class="text-center text-gray-500 py-4">Chưa có thành viên</p>`;
                        return;
                    }
                    listContainer.innerHTML = members.map(m => `
                        <div class="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-800 border dark:border-gray-700">
                            <img src="${m.picture || DEFAULT_AVATAR}" class="w-10 h-10 rounded-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
                            <span class="font-semibold text-gray-900 dark:text-white">${(() => {
                            const name = (m.first_name && m.last_name)
                                ? `${m.last_name} ${m.first_name}`
                                : m.first_name || m.last_name || "Unknown";
                            return name;
                        })()}</span>
                        </div>
                    `).join("");
                } catch (err) {
                    listContainer.innerHTML = `<p class="text-center text-red-500 py-4">Lỗi: ${err.message}</p>`;
                }
            }

            const result = await modalPromise;
            return;
        }

        // View role members
        const viewRoleBtn = e.target.closest(".btn-view-role-members");
        if (viewRoleBtn) {
            const did = viewRoleBtn.dataset.did;
            const rid = viewRoleBtn.dataset.rid;
            const modalPromise = showFormModal("Thành viên chức vụ", `
                <div id="roleMembersList" class="space-y-2 max-h-96 overflow-y-auto">
                    <div class="text-center py-4"><i class="fas fa-spinner fa-spin text-fb-primary"></i></div>
                </div>
            `, async (body) => true);

            const listContainer = document.getElementById("roleMembersList");
            if (listContainer) {
                try {
                    const res = await authFetch(API.groupRoleMembers(groupId, did, rid));
                    const data = await res.json();
                    const members = data.results || (Array.isArray(data) ? data : []);
                    if (members.length === 0) {
                        listContainer.innerHTML = `<p class="text-center text-gray-500 py-4">Chưa có thành viên</p>`;
                        return;
                    }
                    listContainer.innerHTML = members.map(m => `
                        <div class="flex items-center gap-3 p-3 rounded-xl bg-white dark:bg-gray-800 border dark:border-gray-700">
                            <img src="${m.picture || DEFAULT_AVATAR}" class="w-10 h-10 rounded-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
                            <span class="font-semibold text-gray-900 dark:text-white">${(() => {
                            const name = (m.first_name && m.last_name)
                                ? `${m.last_name} ${m.first_name}`
                                : m.first_name || m.last_name || "Unknown";
                            return name;
                        })()}</span>
                        </div>
                    `).join("");
                } catch (err) {
                    listContainer.innerHTML = `<p class="text-center text-red-500 py-4">Lỗi: ${err.message}</p>`;
                }
            }

            const result = await modalPromise;
            return;
        }

        // Add member to role
        const addMemberBtn = e.target.closest(".btn-add-member-role");
        if (addMemberBtn) {
            const did = addMemberBtn.dataset.did;
            const rid = addMemberBtn.dataset.rid;

            let members = [];
            try {
                const res = await authFetch(API.groupMembers(groupId, rid));
                const data = await res.json();
                members = data.results || (Array.isArray(data) ? data : []);
            } catch (err) {
                showToast("Lỗi tải danh sách thành viên: " + err.message, "error");
                return;
            }

            if (members.length === 0) {
                showToast("Không có thành viên nào để thêm (tất cả đã có chức vụ này hoặc nhóm trống).", "info");
                return;
            }

            const memberOptions = members.map((m, idx) => {
                const user = m.user || {};
                const name = `${user.first_name || ''} ${user.last_name || ''}`.trim() || "Unknown";
                const avatar = user.picture || DEFAULT_AVATAR;
                const uid = user.user || user.id || m.user_id;
                const currentRole = m.job_role || "";
                const roleBadge = currentRole ? `<span class="text-xs text-gray-500 ml-1">(Đang giữ: ${currentRole})</span>` : `<span class="text-xs text-green-500 ml-1">(Chưa có chức vụ)</span>`;
                return `
                    <label class="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition" for="member_${uid}">
                        <input type="radio" name="selectedMember" id="member_${uid}" value="${uid}" class="accent-fb-primary" ${idx === 0 ? "checked" : ""}>
                        <img src="${avatar}" class="w-10 h-10 rounded-full object-cover" onerror="this.src='${DEFAULT_AVATAR}'">
                        <div>
                            <span class="font-semibold text-gray-900 dark:text-white block">${name}</span>
                            ${roleBadge}
                        </div>
                    </label>`;
            }).join("");

            const result = await showFormModal("Thêm thành viên vào chức vụ", `
                <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">Chọn thành viên để thêm vào chức vụ này:</p>
                <div class="space-y-2 max-h-80 overflow-y-auto">
                    ${memberOptions}
                </div>
            `, async (body) => {
                const selectedRadio = body.querySelector("input[name='selectedMember']:checked");
                if (!selectedRadio) throw new Error("Vui lòng chọn thành viên");
                const userId = selectedRadio.value;
                if (!userId) throw new Error("Không có ID thành viên");
                await apiMutate(API.groupAddMemberJobRole(groupId, userId), "POST", { role_id: parseInt(rid) });
                return true;
            });
            if (result) {
                showToast("Đã thêm/cập nhật chức vụ cho thành viên!");
                loadDepartments(groupId);
            }
            return;
        }
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
    showFormModal("Tạo sự kiện", `
        <div class="space-y-3">
            <input type="text" id="eventTitle" placeholder="Tiêu đề sự kiện" class="w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none">
            <textarea id="eventDesc" placeholder="Mô tả (không bắt buộc)" class="w-full h-24 p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none resize-none"></textarea>
            <input type="text" id="eventStart" placeholder="YYYY-MM-DD HH:MM" class="w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none">
            <input type="text" id="eventEnd" placeholder="YYYY-MM-DD HH:MM (không bắt buộc)" class="w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none">
        </div>
    `, async (body) => {
        const title = body.querySelector("#eventTitle")?.value.trim();
        if (!title) throw new Error("Vui lòng nhập tiêu đề sự kiện");
        const description = body.querySelector("#eventDesc")?.value.trim() || "";
        const startTime = body.querySelector("#eventStart")?.value.trim();
        if (!startTime) throw new Error("Vui lòng nhập thời gian bắt đầu");
        const endTime = body.querySelector("#eventEnd")?.value.trim();

        const data = {
            title,
            description,
            start_time: new Date(startTime).toISOString(),
        };
        if (endTime) {
            data.end_time = new Date(endTime).toISOString();
        }

        await apiMutate(API.groupEventList(groupId), "POST", data);
        return true;
    }).then((result) => {
        if (result) {
            showToast("Đã tạo sự kiện!");
            const eventsTab = document.getElementById("tabEvents");
            if (eventsTab && !eventsTab.classList.contains("hidden")) {
                const loadEvents = window.loadEvents;
                if (typeof loadEvents === "function") loadEvents(true);
            }
        }
    });
}

// ============ CREATE VOTE MODAL ============
function createVoteModal(groupId) {
    showFormModal("Tạo bình chọn", `
        <div class="space-y-3">
            <input type="text" id="voteTitle" placeholder="Câu hỏi bình chọn" class="w-full p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none">
            <div id="voteOptionsList" class="space-y-2">
                <div class="flex gap-2">
                    <input type="text" placeholder="Lựa chọn 1" class="vote-option-input flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none">
                    <input type="text" placeholder="Lựa chọn 2" class="vote-option-input flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none">
                </div>
            </div>
            <button type="button" id="addVoteOption" class="text-sm text-fb-primary font-semibold hover:underline">+ Thêm lựa chọn</button>
        </div>
    `, async (body) => {
        const title = body.querySelector("#voteTitle")?.value.trim();
        if (!title) throw new Error("Vui lòng nhập tiêu đề bình chọn");

        const optionInputs = body.querySelectorAll(".vote-option-input");
        const options = Array.from(optionInputs).map(i => i.value.trim()).filter(v => v);
        if (options.length < 2) throw new Error("Vui lòng nhập ít nhất 2 lựa chọn");

        await apiMutate(API.groupCreateVote(groupId), "POST", { title, options });
        return true;
    }).then((result) => {
        if (result) {
            showToast("Đã tạo bình chọn!");
            const votesTab = document.getElementById("tabVotes");
            if (votesTab && !votesTab.classList.contains("hidden")) {
                const loadVotesTab = window.loadVotesTab;
                if (typeof loadVotesTab === "function") loadVotesTab(true);
            }
        }
    });

    // Add option functionality
    setTimeout(() => {
        const addBtn = document.getElementById("addVoteOption");
        const optionsList = document.getElementById("voteOptionsList");
        if (addBtn && optionsList) {
            addBtn.onclick = () => {
                const count = optionsList.querySelectorAll(".vote-option-input").length + 1;
                const div = document.createElement("div");
                div.className = "flex gap-2";
                div.innerHTML = `<input type="text" placeholder="Lựa chọn ${count}" class="vote-option-input flex-1 p-3 rounded-lg bg-gray-100 dark:bg-gray-800 dark:text-white border dark:border-gray-700 focus:ring-2 focus:ring-fb-primary outline-none">`;
                optionsList.appendChild(div);
            };
        }
    }, 0);
}