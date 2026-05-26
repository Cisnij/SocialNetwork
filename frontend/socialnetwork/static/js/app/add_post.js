import { authFetch } from "../authenticate/auth.js";
import { POST_ENDPOINTS, API } from "../shared/config.js";
import { showToast } from "../shared/toast.js";

let selectedFiles = [];

document.addEventListener("DOMContentLoaded", () => {
  const photoInput = document.getElementById("photoInput");
  const photoPreview = document.getElementById("photoPreview");
  const postSubmitBtn = document.getElementById("postSubmitBtn");
  const postContent = document.getElementById("postContent");
  const composerAvatar = document.getElementById("composerAvatar");

  // Load user avatar
  async function loadUserInfo() {
    try {
      const res = await authFetch(API.user());
      const user = await res.json();
      if (user?.profile?.picture && composerAvatar) {
        composerAvatar.src = user.profile.picture;
      }
    } catch (err) {
      console.error("Failed to load user info:", err);
    }
  }
  loadUserInfo();

  // Handle photo selection
  if (photoInput) {
    photoInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files);
      selectedFiles = [...selectedFiles, ...files];
      updatePhotoPreview();
    });
  }

  function updatePhotoPreview() {
    if (!photoPreview) return;
    photoPreview.replaceChildren();
    
    selectedFiles.forEach((file, index) => {
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
          selectedFiles = selectedFiles.filter((_, i) => i !== index);
          updatePhotoPreview();
        };
        
        div.appendChild(img);
        div.appendChild(removeBtn);
        photoPreview.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  }

  // Handle post submission
  if (postSubmitBtn) {
    postSubmitBtn.addEventListener("click", async () => {
      const content = postContent?.value.trim();
      const privacy = document.getElementById("postPrivacy")?.value || "public";

      if (!content && selectedFiles.length === 0) {
        showToast("⚠️ Vui lòng nhập nội dung hoặc thêm ảnh", "red");
        return;
      }

      const formData = new FormData();
      formData.append("title", content || "Bài viết mới");
      formData.append("privacy", privacy);
      
      selectedFiles.forEach((file) => {
        formData.append("photos", file);
      });

      postSubmitBtn.disabled = true;
      const prevLabel = postSubmitBtn.textContent;
      postSubmitBtn.textContent = "Đang đăng...";

      try {
        const resPost = await authFetch(POST_ENDPOINTS.create(), {
          method: "POST",
          body: formData,
        });

        if (!resPost.ok) {
          const errorData = await resPost.json().catch(() => ({}));
          showToast(errorData.error || "⚠️ Không tạo được bài viết", "red");
          return;
        }

        const newPost = await resPost.json();

        // Reset form
        if (postContent) postContent.value = "";
        if (photoInput) photoInput.value = "";
        selectedFiles = [];
        updatePhotoPreview();

        showToast("✅ Bài viết đã được đăng!");
        
        // Redirect to home or reload
        setTimeout(() => {
          window.location.href = "/";
        }, 1000);
        
      } catch (err) {
        console.error("Create post error:", err);
        showToast("⚠️ Không thể kết nối server", "red");
      } finally {
        postSubmitBtn.disabled = false;
        postSubmitBtn.textContent = prevLabel || "Đăng";
      }
    });
  }

  // Enable/disable submit button based on content
  const updateSubmitButton = () => {
    const content = postContent?.value.trim();
    if (postSubmitBtn) {
      postSubmitBtn.disabled = !content && selectedFiles.length === 0;
    }
  };

  if (postContent) {
    postContent.addEventListener("input", updateSubmitButton);
  }
  
  // Initial state
  updateSubmitButton();
});
