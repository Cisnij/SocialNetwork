import { authFetch } from "../authenticate/auth.js";
import { POST_ENDPOINTS } from "./config.js";
import { showToast } from "./toast.js";
import { injectPinReportButtons } from "./pin-report.js";

function buildPhotoUrl(photoObj) {
  if (!photoObj) return null;
  const candidate =
    photoObj.photo ||
    photoObj.image ||
    photoObj.url ||
    photoObj.photo_url ||
    photoObj.file ||
    "";
  if (!candidate || candidate === "null" || candidate === "undefined")
    return null;
  if (candidate.startsWith("/"))
    return new URL(candidate, window.location.origin).href;
  return candidate;
}

function buildVideoUrl(videoObj) {
  if (!videoObj) return null;
  const candidate = videoObj.video || videoObj.url || videoObj.file || "";
  if (!candidate || candidate === "null" || candidate === "undefined")
    return null;
  if (candidate.startsWith("/"))
    return new URL(candidate, window.location.origin).href;
  return candidate;
}

export function openEditModal(post) {
  const modal = document.getElementById("editPostModal");
  if (!modal) return;

  // (Userpage only) inject pin/report actions into edit modal
  try {
    const isUserPage = window.location.pathname.startsWith("/profile/");
    injectPinReportButtons(post, { isUserPage });
  } catch (_) {}

  const titleInput = document.getElementById("editPostTitle");
  const imageContainer = document.getElementById("editImageContainer");
  const newImagesInput = document.getElementById("editNewImages");
  const saveBtn = document.getElementById("savePostChanges");
  const cancelBtn = document.getElementById("cancelEditPost");

  const markedForDeletion = new Set();
  const markedForDeletionVideos = new Set();
  titleInput.value = post.title || "";
  imageContainer.replaceChildren();

  if (Array.isArray(post.photos)) {
    post.photos.forEach((photo) => {
      const url = buildPhotoUrl(photo);
      if (!url) return;

      const wrapper = document.createElement("div");
      wrapper.className = "relative inline-block mr-2 mb-2";
      wrapper.style.width = "96px";
      wrapper.style.height = "96px";

      const img = document.createElement("img");
      img.src = url;
      img.className = "w-24 h-24 object-cover rounded-md border";
      img.dataset.photoId = photo.id || "";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "✕";
      delBtn.className =
        "absolute top-0 right-0 bg-red-500 text-white rounded-full px-1 text-xs";
      delBtn.dataset.id = photo.id || "";

      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        markedForDeletion.add(delBtn.dataset.id);
        wrapper.remove();
      });

      wrapper.append(img, delBtn);
      imageContainer.appendChild(wrapper);
    });
  }

  if (Array.isArray(post.videos)) {
    post.videos.forEach((video) => {
      const url = buildVideoUrl(video);
      if (!url) return;

      const wrapper = document.createElement("div");
      wrapper.className = "relative inline-block mr-2 mb-2";
      wrapper.style.width = "96px";
      wrapper.style.height = "96px";

      const vid = document.createElement("video");
      vid.src = url;
      vid.className = "w-24 h-24 object-cover rounded-md border bg-black";
      vid.dataset.videoId = video.id || "";

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.textContent = "✕";
      delBtn.className =
        "absolute top-0 right-0 bg-red-500 text-white rounded-full px-1 text-xs";
      delBtn.dataset.id = video.id || "";

      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        markedForDeletionVideos.add(delBtn.dataset.id);
        wrapper.remove();
      });

      wrapper.append(vid, delBtn);
      imageContainer.appendChild(wrapper);
    });
  }

  modal.classList.remove("hidden");

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try {
      const postEl = document.querySelector(`[data-post-id="${post.post_id}"]`);

      if (markedForDeletion.size > 0) {
        await Promise.all(
          [...markedForDeletion].map((photoId) =>
            authFetch(POST_ENDPOINTS.deletePhoto(photoId), {
              method: "DELETE",
            }).catch(() => {})
          )
        );
        if (postEl) {
          [...markedForDeletion].forEach((id) => {
            const img = postEl.querySelector(`[data-photo-id="${id}"]`);
            if (img?.parentNode) img.parentNode.remove();
          });
        }
      }

      if (markedForDeletionVideos.size > 0) {
        await Promise.all(
          [...markedForDeletionVideos].map((videoId) =>
            authFetch(POST_ENDPOINTS.deleteVideo(videoId), {
              method: "DELETE",
            }).catch(() => {})
          )
        );
        if (postEl) {
          [...markedForDeletionVideos].forEach((id) => {
            const vid = postEl.querySelector(`[data-video-id="${id}"]`);
            if (vid?.parentNode) vid.parentNode.remove();
          });
        }
      }

      const updated = await updatePost(post.post_id, titleInput.value);
      const newTitle =
        (updated?.title && updated.title.trim()) ||
        titleInput.value.trim();

      if (postEl) {
        const titleEl =
          postEl.querySelector(".post-title") ||
          postEl.querySelector("p.post-title, p.text-gray-700, p.mt-3");
        if (titleEl) titleEl.textContent = newTitle || "";
      }

      const photoFiles = [];
      const videoFiles = [];
      if (newImagesInput.files) {
        for (const file of newImagesInput.files) {
          if (file.type.startsWith("video/")) {
            videoFiles.push(file);
          } else {
            photoFiles.push(file);
          }
        }
      }

      const newPhotos = await addNewPhotos(post.post_id, photoFiles);
      if (newPhotos?.length && postEl) {
        let container = postEl.querySelector(".post-photos");
        if (!container) {
          container = document.createElement("div");
          container.className = "post-photos grid grid-cols-2 gap-2 mb-3";
          const titleNode = postEl.querySelector(".post-title");
          if (titleNode?.parentNode === postEl) {
            titleNode.after(container);
          } else {
            postEl.insertBefore(container, postEl.lastElementChild);
          }
        }
        newPhotos.forEach((p) => {
          const src = p.local_url || buildPhotoUrl(p);
          if (!src) return;
          const wrap = document.createElement("div");
          wrap.className = "relative aspect-square";
          const img = document.createElement("img");
          img.src = src;
          img.className =
            "w-full h-full object-cover rounded-lg cursor-pointer";
          if (p.id) img.dataset.photoId = p.id;
          wrap.appendChild(img);
          container.appendChild(wrap);
        });
      }

      const newVideos = await addNewVideos(post.post_id, videoFiles);
      if (newVideos?.length && postEl) {
        let container = postEl.querySelector(".post-videos");
        if (!container) {
          container = document.createElement("div");
          container.className = "post-videos mb-3 flex flex-col gap-2";
          let insertAfterNode = postEl.querySelector(".post-photos") || postEl.querySelector(".post-title");
          if (insertAfterNode?.parentNode === postEl) {
            insertAfterNode.after(container);
          } else {
            postEl.insertBefore(container, postEl.lastElementChild);
          }
        }
        newVideos.forEach((v) => {
          const src = v.local_url || buildVideoUrl(v);
          if (!src) return;
          const vid = document.createElement("video");
          vid.src = src;
          vid.className = "w-full max-h-[480px] rounded-lg bg-black";
          vid.controls = true;
          if (v.id) vid.dataset.videoId = v.id;
          vid.addEventListener("click", (e) => e.stopPropagation());
          container.appendChild(vid);
        });
      }

      showToast("✅ Cập nhật thành công!");
      modal.classList.add("hidden");
    } catch (err) {
      console.error("Edit post error:", err);
      showToast("⚠️ Lưu thất bại", "red");
    } finally {
      saveBtn.disabled = false;
      newImagesInput.value = "";
    }
  };

  cancelBtn.onclick = () => modal.classList.add("hidden");
}

async function updatePost(postId, title) {
  const form = new FormData();
  form.append("title", title);
  const res = await authFetch(POST_ENDPOINTS.post(postId), {
    method: "PUT",
    body: form,
  });
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

async function addNewPhotos(postId, files) {
  if (!files || files.length === 0) return [];
  const localUrls = [...files].map((file) => URL.createObjectURL(file));
  const formData = new FormData();
  for (const file of files) {
    formData.append("photo", file);
  }
  try {
    const res = await authFetch(POST_ENDPOINTS.addPhoto(postId), {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const uploaded = Array.isArray(data) ? data : data.results || data.photos || [];
    if (uploaded.length) {
      return uploaded.map((p, i) => ({ ...p, local_url: localUrls[i] }));
    }
    return localUrls.map((url) => ({ local_url: url }));
  } catch {
    return [];
  }
}

async function addNewVideos(postId, files) {
  if (!files || files.length === 0) return [];
  const localUrls = [...files].map((file) => URL.createObjectURL(file));
  const formData = new FormData();
  for (const file of files) {
    formData.append("video", file);
  }
  try {
    const res = await authFetch(POST_ENDPOINTS.addVideo(postId), {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const uploaded = Array.isArray(data) ? data : data.results || data.videos || [];
    if (uploaded.length) {
      return uploaded.map((v, i) => ({ ...v, local_url: localUrls[i] }));
    }
    return localUrls.map((url) => ({ local_url: url }));
  } catch {
    return [];
  }
}

