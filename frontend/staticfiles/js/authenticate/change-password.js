import { authFetch } from "./auth.js";
import { API } from "../shared/config.js";

const form = document.getElementById("change-password-form");
const message = document.getElementById("message");

async function ensureHasPasswordOrRedirect() {
    try {
        const res = await authFetch(API.hasPassword());
        if (!res.ok) return;
        const data = await res.json();
        if (data && data.has_password === false) {
            window.location.href = "/settings/";
        }
    } catch (_) {}
}

ensureHasPasswordOrRedirect();

/**
 * Xử lý thông báo lỗi từ server
 * DRF thường trả về lỗi dạng: { old_password: ["Sai mật khẩu"], new_password1: ["Quá ngắn"] }
 */
function handleApiErrors(data) {
    if (typeof data === 'string') return data;

    // Lấy thông báo lỗi đầu tiên tìm thấy
    const firstKey = Object.keys(data)[0];
    const errorDetail = data[firstKey];
    return Array.isArray(errorDetail) ? errorDetail[0] : (errorDetail || "Lỗi hệ thống");
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const oldPassword = document.getElementById("old_password").value;
    const newPassword1 = document.getElementById("new_password1").value;
    const newPassword2 = document.getElementById("new_password2").value;

    if (newPassword1 !== newPassword2) {
        showMessage("Xác nhận mật khẩu mới không khớp!", "text-red-400");
        return;
    }

    try {
        showMessage("Đang thực hiện đổi mật khẩu...", "text-yellow-400");

        // Disable nút submit để tránh double-click
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        const res = await authFetch(API.passwordChange(), {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_password: oldPassword,
                new_password1: newPassword1,
                new_password2: newPassword2,
            }),
        });

        const data = await res.json();

        if (!res.ok) {
            // Ném lỗi với nội dung cụ thể từ Server
            throw new Error(handleApiErrors(data));
        }

        showMessage("Đổi mật khẩu thành công! Chuyển hướng...", "text-green-400");
        setTimeout(() => window.location.href = '/login', 1500);

    } catch (err) {
        showMessage(err.message, "text-red-400");
        form.querySelector('button[type="submit"]').disabled = false;
    }
});

function showMessage(text, colorClass) {
    message.innerText = text;
    message.className = `mt-4 text-sm text-center ${colorClass}`;
}