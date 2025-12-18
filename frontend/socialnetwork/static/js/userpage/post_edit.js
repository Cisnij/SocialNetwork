import { authFetch } from "../authenticate/auth.js";
import { showToast } from "./userpage.js";

// ----------------------------
// Helper: chuẩn hoá đường dẫn ảnh
// ----------------------------
function buildPhotoUrl(photoObj) {
  if (!photoObj) return null;
  const candidate =
    photoObj.photo ||
    photoObj.image ||
    photoObj.url ||
    photoObj.photo_url ||
    photoObj.file ||
    "";
  if (!candidate) return null;
  if (candidate === "null" || candidate === "undefined") return null;
  if (candidate.startsWith("/"))
    return new URL(candidate, window.location.origin).href;
  return candidate;
}

// ----------------------------
// Mở modal chỉnh sửa bài viết
// ----------------------------
function openEditModal(post) {
  const modal = document.getElementById("editPostModal");
  if (!modal) return;

  const titleInput = document.getElementById("editPostTitle");
  const imageContainer = document.getElementById("editImageContainer");
  const newImagesInput = document.getElementById("editNewImages");
  const saveBtn = document.getElementById("savePostChanges");
  const cancelBtn = document.getElementById("cancelEditPost");

  // ảnh cần xoá thực tế
  const markedForDeletion = new Set();
  titleInput.value = post.title || "";
  imageContainer.replaceChildren();

  // --- render ảnh cũ trong modal
  if (Array.isArray(post.photos)) {
    post.photos.forEach((photo) => {
      const url = buildPhotoUrl(photo);
      if (!url) return;

      const wrapper = document.createElement("div");
      wrapper.className = "relative inline-block mr-2 mb-2";
      wrapper.style.width = "96px";
      wrapper.style.height = "96px";
      wrapper.dataset.photoId = photo.id || "";

      const img = document.createElement("img");
      img.src = url;
      img.className = "w-24 h-24 object-cover rounded-md border";
      img.dataset.photoId = photo.id || "";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "✕";
      delBtn.className =
        "absolute top-0 right-0 bg-red-500 text-white rounded-full px-1 text-xs delete-photo";
      delBtn.dataset.id = photo.id || "";

      // ✅ Khi nhấn xóa: xóa ảnh ngay trên giao diện, và đánh dấu để backend xóa khi lưu
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = delBtn.dataset.id;
        markedForDeletion.add(id);
        wrapper.remove(); // ẩn ngay lập tức
      });

      wrapper.append(img, delBtn);
      imageContainer.appendChild(wrapper);
    });
  }

  modal.classList.remove("hidden");

  // ----------------------------
  // Nút Lưu thay đổi
  // ----------------------------
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const postArticle = document.querySelector(
        `[data-post-id="${post.post_id}"]`
      );

      // 1️⃣ Xóa ảnh backend nếu có
      if (markedForDeletion.size > 0) {
        await Promise.all(
          [...markedForDeletion].map(async (photoId) => {
            try {
              await authFetch(
                `http://localhost:8000/api/user/delete-photo/${photoId}/`,
                { method: "DELETE" }
              );
            } catch {
              /* bỏ qua lỗi nhỏ */
            }
          })
        );

        // ✅ Đồng bộ giao diện bài viết — xoá ảnh tương ứng nếu có
        if (postArticle) {
          [...markedForDeletion].forEach((id) => {
            const img = postArticle.querySelector(`[data-photo-id="${id}"]`);
            if (img) img.closest("div").remove();
          });
        }
      }

      // 2️⃣ Cập nhật tiêu đề
      const updated = await updatePost(post.post_id, titleInput.value);
      const newTitle =
        (updated && updated.title && updated.title.trim()) ||
        titleInput.value.trim();

      if (postArticle) {
        // tìm phần tử <p> chứa title (theo class chính xác trong renderPostCard)
        let titleEl = postArticle.querySelector("p.mt-3, p.text-gray-700");
        if (!titleEl) {
          titleEl = document.createElement("p");
          titleEl.className = "mt-3 text-gray-700";
          postArticle.insertBefore(titleEl, postArticle.firstChild);
        }
        titleEl.textContent = newTitle || "(Không có tiêu đề)";
      }

      // 3️⃣ Thêm ảnh mới
      const newPhotos = await addNewPhotos(post.post_id, newImagesInput.files);

      if (newPhotos && newPhotos.length > 0 && postArticle) {
        let container =
          postArticle.querySelector(".grid, .photos-container") ||
          (() => {
            const div = document.createElement("div");
            div.className = "photos-container grid grid-cols-2 gap-2 mb-3";
            postArticle.insertBefore(
              div,
              postArticle.querySelector(".text-sm") ||
                postArticle.lastElementChild
            );
            return div;
          })();

        newPhotos.forEach((p) => {
          const src = p.local_url || `${buildPhotoUrl(p)}?t=${Date.now()}`;
          if (!src) return;
          const wrap = document.createElement("div");
          wrap.className = "relative";
          const img = document.createElement("img");
          img.src = src;
          img.className =
            "w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition";
          if (p.id) img.dataset.photoId = p.id;
          wrap.appendChild(img);
          container.appendChild(wrap);
        });
      }

      showToast("✅ Cập nhật thành công!", "green");
      modal.classList.add("hidden");
    } catch (err) {
      console.error("Lỗi khi lưu:", err);
      showToast("⚠️ Lưu thất bại", "red");
    } finally {
      saveBtn.disabled = false;
      newImagesInput.value = "";
    }
  };

  cancelBtn.onclick = () => modal.classList.add("hidden");
}

// ----------------------------
// PUT cập nhật tiêu đề bài viết
// ----------------------------
async function updatePost(postId, title) {
  const form = new FormData();
  form.append("title", title);
  const res = await authFetch(
    `http://localhost:8000/api/user/post/${postId}/`,
    { method: "PUT", body: form }
  );
  if (!res.ok) {
    showToast("⚠️ Lỗi cập nhật tiêu đề", "red");
    return null;
  }
  try {
    return await res.json();
  } catch {
    return { title };
  }
}

// ----------------------------
// POST thêm ảnh mới (render preview local ngay)
// ----------------------------
async function addNewPhotos(postId, files) {
  const result = [];
  for (let file of files) {
    const localUrl = URL.createObjectURL(file); // ✅ preview local ngay
    const formData = new FormData();
    formData.append("photo", file);

    try {
      const res = await authFetch(
        `http://localhost:8000/api/user/post-photo/${postId}/`,
        { method: "POST", body: formData }
      );

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        result.push({ ...data, local_url: localUrl });
      } else {
        result.push({ id: Date.now(), local_url: localUrl });
      }
    } catch {
      result.push({ id: Date.now(), local_url: localUrl });
    }
  }
  return result;
}

export { openEditModal, updatePost, addNewPhotos };
