import { authFetch } from "../authenticate/auth.js";

const openBtn = document.getElementById("openPostModal");
const closeBtn = document.getElementById("closePostModal");
const closeBtn2 = document.getElementById("closePostModal2");
const modal = document.getElementById("postModal");

openBtn.addEventListener("click", () => modal.classList.remove("hidden"));
closeBtn.addEventListener("click", () => modal.classList.add("hidden"));
closeBtn2.addEventListener("click", () => modal.classList.add("hidden"));

// Đóng modal khi click ra ngoài
modal.addEventListener("click", (e) => {
  if (e.target === modal) modal.classList.add("hidden");
});

// Preview ảnh
const imageInput = document.getElementById("imageInput");
const imagePreview = document.getElementById("imagePreview");

imageInput.addEventListener("change", (event) => {
  const files = Array.from(event.target.files);

  // Clear preview cũ
  while (imagePreview.firstChild) {
    imagePreview.removeChild(imagePreview.firstChild);
  }

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

//=================================Tạo Bài Post==================================

const submitBtn = document.getElementById("submit");

submitBtn.addEventListener("click", async () => {
  const title = document.getElementById("postTitle").value;
  const files = imageInput.files;

  if (!title) {
    alert("Vui lòng nhập tiêu đề");
    return;
  }

  // 1. Gửi post
  let resPost;
  try {
    resPost = await authFetch("http://localhost:8000/api/user/post/create/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  } catch (err) {
    console.error("Không gọi được API tạo bài viết:", err);
    alert("Không thể kết nối server khi tạo post");
    return;
  }

  if (!resPost.ok) {
    const error = await resPost.json().catch(() => ({}));
    console.error("Lỗi khi tạo bài viết:", error);
    alert("Không tạo được bài viết");
    return;
  }

  const newPost = await resPost.json();
  console.log("Đã tạo bài viết:", newPost);
  const postId = newPost.post_id;

  // 2. Upload ảnh
  if (files.length > 0) {
    const formData = new FormData();
    for (let file of files) formData.append("photo", file);

    let resImages;
    try {
      resImages = await authFetch(`http://localhost:8000/api/user/post-photo/${postId}/`, {
        method: "POST",
        body: formData,
      });
    } catch (err) {
      console.error("Không gọi được API upload ảnh:", err);
      alert("Không thể kết nối server khi upload ảnh");
      return;
    }

    if (!resImages.ok) {
      const error = await resImages.json().catch(() => ({}));
      console.error("Lỗi khi upload ảnh:", error);
      alert("Upload ảnh thất bại");
      return;
    }

    console.log("Upload ảnh thành công");
  }

  // 3. Reset form
  document.getElementById("postTitle").value = "";
  imageInput.value = "";
  while (imagePreview.firstChild) imagePreview.removeChild(imagePreview.firstChild);

  modal.classList.add("hidden");
  alert("Bài viết đã được tạo thành công");
});
