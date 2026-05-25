import { authFetch } from "../authenticate/auth.js";
import { POST_ENDPOINTS } from "../shared/config.js";
import { showToast } from "../shared/toast.js";

const openBtn = document.getElementById("openPostModal");
const closeBtn = document.getElementById("closePostModal");
const closeBtn2 = document.getElementById("closePostModal2");
const modal = document.getElementById("postModal");
const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");
const submitBtn = document.getElementById("submit");

if (openBtn && modal && submitBtn) {
  openBtn.addEventListener("click", () => modal.classList.remove("hidden"));
  closeBtn?.addEventListener("click", () => modal.classList.add("hidden"));
  closeBtn2?.addEventListener("click", () => modal.classList.add("hidden"));

  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.add("hidden");
  });

  imageInput?.addEventListener("change", (event) => {
    const files = Array.from(event.target.files);
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

  submitBtn.addEventListener("click", async () => {
    const title = document.getElementById("postTitle")?.value.trim();
    const files = imageInput?.files || [];

    if (!title) {
      showToast("⚠️ Vui lòng nhập tiêu đề", "red");
      return;
    }

    const formData = new FormData();
    formData.append("title", title);
    for (const file of files) {
      formData.append("photos", file);
    }

    submitBtn.disabled = true;
    const prevLabel = submitBtn.textContent;
    submitBtn.textContent = "Đang đăng...";

    try {
      const resPost = await authFetch(POST_ENDPOINTS.create(), {
        method: "POST",
        body: formData,
      });

      if (!resPost.ok) {
        showToast("⚠️ Không tạo được bài viết", "red");
        return;
      }

      const newPost = await resPost.json();

      document.getElementById("postTitle").value = "";
      if (imageInput) imageInput.value = "";
      imagePreview.replaceChildren();
      modal.classList.add("hidden");

      showToast("✅ Bài viết đã được đăng!");
      document.dispatchEvent(
        new CustomEvent("newPostCreated", { detail: newPost })
      );
    } catch (err) {
      console.error("Create post error:", err);
      showToast("⚠️ Không thể kết nối server", "red");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevLabel || "Đăng";
    }
  });
}
