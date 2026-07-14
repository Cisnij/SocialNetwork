import { authFetch } from "../authenticate/auth.js";
import { POST_ENDPOINTS, API } from "../shared/config.js";
import { showToast } from "../shared/toast.js";

let selectedFiles = [];

console.log("add_post.js loaded");

// Xử lý modal trong base.html
function setupBaseModal() {
  const openBtn = document.getElementById("openPostModal");
  const closeBtn = document.getElementById("closePostModal");
  const closeBtn2 = document.getElementById("closePostModal2");
  const modal = document.getElementById("postModal");
  const imageInput = document.getElementById("imageInput");
  const imagePreview = document.getElementById("imagePreview");
  const submitBtn = document.getElementById("submit");

  console.log("Base modal elements:", {
    openBtn: !!openBtn,
    closeBtn: !!closeBtn,
    modal: !!modal,
    submitBtn: !!submitBtn
  });

  if (openBtn && modal && submitBtn) {
    // Inject privacy selector UI if not exists
    const injectPrivacySelector = () => {
      if (!document.getElementById("postPrivacy")) {
        const imageSection = modal.querySelector('.border.dark\\:border-gray-600');
        if (imageSection) {
          const privacyDiv = document.createElement("div");
          privacyDiv.className = "border dark:border-gray-600 rounded-lg p-3";
          privacyDiv.innerHTML = `
            <label class="text-sm font-medium text-gray-600 dark:text-gray-400">Quyền riêng tư</label>
            <select id="postPrivacy" class="mt-2 w-full p-2 rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 focus:outline-none">
              <option value="public">🌍 Công khai</option>
              <option value="friends">👥 Bạn bè</option>
              <option value="private">🔒 Chỉ mình tôi</option>
            </select>
          `;
          imageSection.after(privacyDiv);
        }
      }
    };

    openBtn.addEventListener("click", () => {
      console.log("Opening post modal");
      modal.classList.remove("hidden");
      injectPrivacySelector();
    });

    closeBtn?.addEventListener("click", () => modal.classList.add("hidden"));
    closeBtn2?.addEventListener("click", () => modal.classList.add("hidden"));

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    imageInput?.addEventListener("change", (event) => {
      const files = Array.from(event.target.files);
      selectedFiles = [...selectedFiles, ...files];
      updateBasePhotoPreview();
    });

    submitBtn.addEventListener("click", async () => {
      console.log("Base modal submit clicked");
      const title = document.getElementById("postTitle")?.value.trim();
      const files = imageInput?.files || [];
      const privacy = document.getElementById("postPrivacy")?.value || "public";

      if (!title && selectedFiles.length === 0) {
        showToast("⚠️ Vui lòng nhập tiêu đề hoặc thêm ảnh", "red");
        return;
      }

      const formData = new FormData();
      formData.append("title", title || "Bài viết mới");
      formData.append("privacy", privacy);
      selectedFiles.forEach((file) => {
        formData.append("photos", file);
      });

      submitBtn.disabled = true;
      submitBtn.textContent = "Đang đăng...";

      try {
        // Check if posting in a group
        const groupId = window.GROUP_POSTING_MODE || null;
        const postUrl = groupId ? API.groupCreatePost(groupId) : POST_ENDPOINTS.create();

        const resPost = await authFetch(postUrl, {
          method: "POST",
          body: formData,
        });

        if (!resPost.ok) {
          const errorData = await resPost.json().catch(() => ({}));
          showToast(errorData.error || "⚠️ Không tạo được bài viết", "red");
          return;
        }

        const newPost = await resPost.json();
        console.log("Post created successfully:", newPost);

        // Clear form
        document.getElementById("postTitle").value = "";
        if (imageInput) imageInput.value = "";
        selectedFiles = [];
        updateBasePhotoPreview();
        modal.classList.add("hidden");

        // Dispatch event để feed loader thêm bài mới
        document.dispatchEvent(new CustomEvent("newPostCreated", { detail: newPost }));

        showToast("✅ Bài viết đã được đăng!");
      } catch (err) {
        console.error("Create post error:", err);
        showToast("⚠️ Không thể kết nối server", "red");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Đăng";
      }
    });
  }
}

function updateBasePhotoPreview() {
  const preview = document.getElementById("imagePreview");
  if (!preview) return;
  preview.replaceChildren();

  selectedFiles.forEach((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.createElement("img");
      img.src = e.target.result;
      img.alt = "Preview";
      img.className = "h-24 w-24 object-cover rounded-lg border";
      preview.appendChild(img);
    };
    reader.readAsDataURL(file);
  });
}

// Xử lý trang add_post riêng
function setupAddPostPage() {
  const photoInput = document.getElementById("photoInput");
  const photoPreview = document.getElementById("photoPreview");
  const postSubmitBtn = document.getElementById("postSubmitBtn");
  const postContent = document.getElementById("postContent");
  const composerAvatar = document.getElementById("composerAvatar");

  console.log("Add post page elements:", {
    photoInput: !!photoInput,
    photoPreview: !!photoPreview,
    postSubmitBtn: !!postSubmitBtn,
    postContent: !!postContent,
    composerAvatar: !!composerAvatar
  });

  if (!postSubmitBtn) {
    console.log("Not on add post page, skipping page setup");
    return;
  }

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
      console.log("Photo input changed");
      const files = Array.from(event.target.files);
      selectedFiles = [...selectedFiles, ...files];
      updatePhotoPreview();
      updateSubmitButton();
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
          updateSubmitButton();
        };

        div.appendChild(img);
        div.appendChild(removeBtn);
        photoPreview.appendChild(div);
      };
      reader.readAsDataURL(file);
    });
  }

  // Handle post submission
  postSubmitBtn.addEventListener("click", async (e) => {
    console.log("Add post page submit clicked!", e);
    e.preventDefault();
    e.stopPropagation();

    const content = postContent?.value.trim();
    const privacy = document.getElementById("postPrivacy")?.value || "public";

    console.log("Form data:", { content, privacy, selectedFilesCount: selectedFiles.length });

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

    console.log("Submitting to API:", POST_ENDPOINTS.create());
    postSubmitBtn.disabled = true;
    const prevLabel = postSubmitBtn.textContent;
    postSubmitBtn.textContent = "Đang đăng...";

    try {
      const resPost = await authFetch(POST_ENDPOINTS.create(), {
        method: "POST",
        body: formData,
      });

      console.log("API response status:", resPost.status);

      if (!resPost.ok) {
        const errorData = await resPost.json().catch(() => ({}));
        console.error("API error:", errorData);
        showToast(errorData.error || "⚠️ Không tạo được bài viết", "red");
        return;
      }

      const newPost = await resPost.json();
      console.log("Post created:", newPost);

      // Clear form
      if (postContent) postContent.value = "";
      if (photoInput) photoInput.value = "";
      selectedFiles = [];
      updatePhotoPreview();

      // Dispatch event để feed loader thêm bài mới
      document.dispatchEvent(new CustomEvent("newPostCreated", { detail: newPost }));

      showToast("✅ Bài viết đã được đăng!");

      // Redirect về trang chủ sau 1 giây
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

  // Visual feedback for submit button
  const updateSubmitButton = () => {
    const content = postContent?.value.trim();
    if (postSubmitBtn) {
      if (!content && selectedFiles.length === 0) {
        postSubmitBtn.classList.add("opacity-50");
      } else {
        postSubmitBtn.classList.remove("opacity-50");
      }
    }
  };

  if (postContent) {
    postContent.addEventListener("input", updateSubmitButton);
  }

  // Initial state
  updateSubmitButton();
}

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM Content Loaded in add_post.js");
  setupBaseModal();
  setupAddPostPage();
});
