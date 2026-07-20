import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";
import { showToast } from "../shared/toast.js";

document.addEventListener("DOMContentLoaded", () => {
  const articleTitle = document.getElementById("articleTitle");
  const articleContent = document.getElementById("articleContent");
  const publishBtn = document.getElementById("publishBtn");
  const saveDraftBtn = document.getElementById("saveDraftBtn");
  const coverImage = document.getElementById("coverImage");
  const coverPreview = document.getElementById("coverPreview");
  const coverImg = document.getElementById("coverImg");
  const titleCount = document.getElementById("titleCount");
  const articlePrivacy = document.getElementById("articlePrivacy");

  let coverFile = null;

  // Title character count
  if (articleTitle && titleCount) {
    articleTitle.addEventListener("input", () => {
      const count = articleTitle.value.length;
      titleCount.textContent = count;
      titleCount.className = count > 180 ? "text-red-500" : "";
    });
  }

  // Cover image preview
  if (coverImage) {
    coverImage.addEventListener("change", (event) => {
      const file = event.target.files[0];
      if (file) {
        coverFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
          coverImg.src = e.target.result;
          coverPreview.classList.remove("hidden");
        };
        reader.readAsDataURL(file);
      }
    });
  }

  // Validate article
  function validateArticle() {
    const title = articleTitle?.value.trim();
    const content = articleContent?.value.trim();
    
    if (!title) {
      showToast("⚠️ Vui lòng nhập tiêu đề", "red");
      return false;
    }
    
    if (title.length < 5) {
      showToast("⚠️ Tiêu đề quá ngắn (tối thiểu 5 ký tự)", "red");
      return false;
    }
    
    if (!content) {
      showToast("⚠️ Vui lòng nhập nội dung bài viết", "red");
      return false;
    }
    
    if (content.length < 50) {
      showToast("⚠️ Nội dung quá ngắn (tối thiểu 50 ký tự)", "red");
      return false;
    }
    
    return true;
  }

  // Create article
  async function createArticle(isDraft = false) {
    if (!validateArticle()) return;

    const formData = new FormData();
    formData.append("title", articleTitle.value.trim());
    formData.append("content", articleContent.value.trim());
    
    if (coverFile) {
      formData.append("cover_image", coverFile);
    }

    const btn = isDraft ? saveDraftBtn : publishBtn;
    const prevLabel = btn.textContent;
    
    btn.disabled = true;
    btn.textContent = isDraft ? "Đang lưu..." : "Đang xuất bản...";

    try {
      const res = await authFetch("/api/user/post-article/", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        showToast(errorData.error || "⚠️ Không thể tạo bài viết", "red");
        return;
      }

      const newArticle = await res.json();

      showToast(isDraft ? "✅ Đã lưu nháp" : "✅ Bài viết đã được xuất bản!");
      
      // Redirect to article detail or home
      setTimeout(() => {
        window.location.href = "/";
      }, 1000);
      
    } catch (err) {
      console.error("Create article error:", err);
      showToast("⚠️ Không thể kết nối server", "red");
    } finally {
      btn.disabled = false;
      btn.textContent = prevLabel;
    }
  }

  // Event listeners
  if (publishBtn) {
    publishBtn.addEventListener("click", () => createArticle(false));
  }

  if (saveDraftBtn) {
    saveDraftBtn.addEventListener("click", () => {
      // For now, draft functionality can be the same as publish
      // In a real app, you'd have a draft status field
      showToast("ℹ️ Tính năng lưu nháp sẽ được cập nhật sau", "amber");
    });
  }

  // Auto-save functionality (optional enhancement)
  let autoSaveTimeout;
  if (articleTitle || articleContent) {
    const autoSave = () => {
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => {
        const title = articleTitle?.value.trim();
        const content = articleContent?.value.trim();
        if (title || content) {
          // Save to localStorage as auto-save
          localStorage.setItem("article_draft", JSON.stringify({
            title: title || "",
            content: content || "",
            timestamp: new Date().toISOString()
          }));
        }
      }, 2000);
    };

    articleTitle?.addEventListener("input", autoSave);
    articleContent?.addEventListener("input", autoSave);

    // Load from localStorage if exists
    const savedDraft = localStorage.getItem("article_draft");
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        const timeDiff = Date.now() - new Date(draft.timestamp).getTime();
        // Only restore if less than 24 hours old
        if (timeDiff < 24 * 60 * 60 * 1000) {
          if (articleTitle && draft.title) articleTitle.value = draft.title;
          if (articleContent && draft.content) articleContent.value = draft.content;
          if (titleCount) titleCount.textContent = draft.title.length;
          showToast("📝 Đã khôi phục bản nháp tự động", "blue");
        }
      } catch (e) {
        console.error("Failed to restore draft:", e);
      }
    }
  }
});

