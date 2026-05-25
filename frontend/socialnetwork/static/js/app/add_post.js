import { authFetch } from "../authenticate/auth.js";

const openBtn = document.getElementById("openPostModal");
const closeBtn = document.getElementById("closePostModal");
const closeBtn2 = document.getElementById("closePostModal2");
const modal = document.getElementById("postModal");
const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
const submitBtn = document.getElementById("submit");

// =================================TOAST=========================================
function showToast(message, color = "green") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `fixed bottom-5 right-5 bg-${color}-500 text-white px-4 py-3 rounded shadow-lg toast-slide z-[60]`;
    toast.classList.remove("hidden");

    setTimeout(() => {
        toast.classList.add("toast-hide");
    }, 3000);

    setTimeout(() => {
        toast.classList.add("hidden");
        toast.classList.remove("toast-slide", "toast-hide");
    }, 3500);
}

// CHỐT CHẶN BẢO VỆ: Chỉ gán sự kiện nếu trang HTML hiện tại có chứa các phần tử này
if (openBtn && modal && submitBtn) {

    // =================================ĐÓNG MỞ MODAL==================================
    openBtn.addEventListener("click", () => modal.classList.remove("hidden"));
    if (closeBtn) closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
    if (closeBtn2) closeBtn2.addEventListener("click", () => modal.classList.add("hidden"));

    modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.classList.add("hidden");
    });

    // =================================PREVIEW ẢNH==================================
    imageInput.addEventListener("change", (event) => {
        const files = Array.from(event.target.files);

        // Clear preview cũ (Dùng replaceChildren an toàn và nhanh hơn vòng lặp while)
        imagePreview.replaceChildren();

        files.forEach((file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = document.createElement("img");
                img.src = e.target.result;
                img.alt = "Preview";
                img.className = "h-24 w-24 object-cover rounded-lg border";
                imagePreview.appendChild(img);
            };
            reader.readAsDataURL(file);
        });
    });

    // =================================TẠO BÀI POST V2 (ALL IN ONE)==================================
    submitBtn.addEventListener("click", async () => {
        const title = document.getElementById("postTitle").value.trim();
        const files = imageInput.files;

        if (!title) {
            showToast("⚠️ Vui lòng nhập tiêu đề", "red");
            return;
        }

        // 1. Đóng gói TOÀN BỘ dữ liệu (Text + File) vào FormData
        const formData = new FormData();
        formData.append("title", title);

        if (files.length > 0) {
            for (let file of files) {
                formData.append("photos", file); // Đảm bảo key "photo" khớp với tên biến Backend mong đợi
            }
        }

        // Tạm thời vô hiệu hóa nút đăng để tránh spam click
        submitBtn.disabled = true;
        submitBtn.textContent = "Đang đăng...";

        try {
            // 2. Gửi duy nhất 1 request. KHÔNG set header Content-Type ở đây.
            const resPost = await authFetch("http://localhost:8000/api/user/post/create/v2/", {
                method: "POST",
                body: formData,
            });

            if (!resPost.ok) {
                const error = await resPost.json().catch(() => ({}));
                console.error("Lỗi khi tạo bài viết:", error);
                showToast("⚠️ Không tạo được bài viết", "red");
                return;
            }

            const newPost = await resPost.json();
            console.log("Đã tạo bài viết:", newPost);

            // 3. Reset form
            document.getElementById("postTitle").value = "";
            imageInput.value = "";
            imagePreview.replaceChildren();
            modal.classList.add("hidden");

            showToast("✅ Bài viết đã được đăng thành công!");

            // 4. Phát đi sự kiện custom event chứa bài viết mới
            const event = new CustomEvent('newPostCreated', { detail: newPost });
            document.dispatchEvent(event);

        } catch (err) {
            console.error("Không gọi được API tạo bài viết:", err);
            showToast("⚠️ Không thể kết nối server khi tạo post", "red");
        } finally {
            // Trả lại trạng thái ban đầu cho nút bấm
            submitBtn.disabled = false;
            submitBtn.textContent = "Đang";
        }
    });
}