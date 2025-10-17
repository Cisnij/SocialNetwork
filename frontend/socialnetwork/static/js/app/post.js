import { authFetch } from "../authenticate/auth.js";

const url = "http://localhost:8000/api/user/post/show";
const postContainer = document.getElementById("post-container");

let nextPageUrl = url;
let isLoading = false;

// ==================== Spinner ====================
function showLoading(container) {
  const wrapper = document.createElement("div");
  wrapper.className = "text-center py-4 flex flex-col items-center";

  const spinner = document.createElement("div");
  spinner.className =
    "animate-spin h-6 w-6 border-4 border-indigo-500 border-t-transparent rounded-full";

  const text = document.createElement("p");
  text.className = "text-gray-500 mt-2";
  text.textContent = "Đang tải...";

  wrapper.append(spinner, text);
  container.appendChild(wrapper);
  return wrapper;
}

// ==================== Reaction config ====================
const REACTIONS = [
  { type: "like", icon: "👍", label: "Thích" },
  { type: "love", icon: "❤️", label: "Yêu thích" },
  { type: "haha", icon: "😂", label: "Haha" },
  { type: "wow", icon: "😮", label: "Wow" },
  { type: "sad", icon: "😢", label: "Buồn" },
  { type: "angry", icon: "😡", label: "Phẫn nộ" },
];

function updateReactionButton(reactBtn, type) {
  reactBtn.replaceChildren();

  if (!type) { // nếu không có reaction thì mặc định like
    reactBtn.dataset.reaction = "";
    const icon = document.createElement("span");
    icon.textContent = "👍";
    const text = document.createElement("span");
    text.textContent = "Thích";
    reactBtn.append(icon, text);
    reactBtn.classList.remove("font-bold", "text-indigo-600");
    return;
  }

  const r = REACTIONS.find((x) => x.type === type) || REACTIONS[0]; // nếu có reaction thì tìm tương ứng và đổi tương ứng
  const icon = document.createElement("span");
  icon.textContent = r.icon;
  const text = document.createElement("span");
  text.textContent = r.label;

  reactBtn.append(icon, text);
  reactBtn.dataset.reaction = r.type;
  reactBtn.classList.add("font-bold", "text-indigo-600");
}

// ==================== Reaction Bar ====================
function createReactionBar(postId, reactBtn, wrapper, reactionCount, post) { //tạo thanh reaction khi hover vào nút like
  const bar = document.createElement("div");
  bar.className =
    "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white shadow-lg rounded-full px-2 py-1 flex gap-2 z-50 hidden";

  let hideTimeout;

  REACTIONS.forEach((r) => { //lặp để hiển thị lên thanh bar
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = r.label;
    btn.dataset.type = r.type;
    btn.className =
      "text-xl leading-none p-1 rounded-full hover:scale-125 transition-transform outline-none";
    btn.textContent = r.icon;

    btn.addEventListener("click", async (e) => { //khi click sẽ post lên server reaction tương ứng
      e.stopPropagation();
      const res = await reactToPost(postId, r.type);

    if (res) {
      // cập nhật nút
      updateReactionButton(reactBtn, res.reaction_type || "");

      // cập nhật tổng reactions
      if (Array.isArray(res.count)) {
        const newTotal = res.count.reduce((sum, x) => sum + x.total, 0);
        reactionCount.textContent =
          newTotal > 0 ? `${newTotal} lượt thích` : "";
        post.reactions = res.count;
      }

      // luôn lưu trạng thái mới
      post.user_is_reaction = res.reaction_type || "";
      reactBtn.dataset.reaction = post.user_is_reaction;
    }


      bar.classList.add("hidden");
    });

    bar.appendChild(btn);
  });

  wrapper.addEventListener("mouseenter", () => {
    clearTimeout(hideTimeout);
    bar.classList.remove("hidden");
  });

  wrapper.addEventListener("mouseleave", () => {
    hideTimeout = setTimeout(() => {
      bar.classList.add("hidden");
    }, 50);
  });

  return bar;
}

// ==================== Render Post ====================
function renderPost(post) {
  const article = document.createElement("article");
  article.className = "bg-white shadow rounded-xl p-5 mb-4";
  article.dataset.postId = post.post_id;

// Header
const header = document.createElement("div");
header.className = "flex items-center justify-between mb-3";

// --- Left side: avatar + tên + thời gian
const left = document.createElement("div");
left.className = "flex items-center gap-3";

const userId = post.user?.id;
const profileLink = document.createElement("a");
profileLink.href = `http://localhost:3000/profile/${userId}`;
profileLink.className = "flex items-center gap-3";

const avatar = document.createElement("img");
avatar.className = "w-10 h-10 rounded-full";
avatar.src = post.user?.picture || "/default-avatar.png";

const info = document.createElement("div");
const name = document.createElement("h2");
name.className = "font-semibold text-gray-800";
name.textContent =
  `${post?.user?.first_name || ""} ${post?.user?.last_name || ""}`.trim() ||
  "Người dùng";

const time = document.createElement("p");
time.className = "text-sm text-gray-500";
time.textContent = new Date(post.created_at).toLocaleString("vi-VN");

info.append(name, time);
profileLink.append(avatar, info);
left.appendChild(profileLink);

// --- Right side: menu ba chấm
const menuWrapper = document.createElement("div");
menuWrapper.className = "relative";

const menuBtn = document.createElement("button");
menuBtn.className = "text-gray-500 hover:text-gray-800 text-2xl font-bold px-2";
menuBtn.textContent = "⋯";

const menuDropdown = document.createElement("div");
menuDropdown.className =
  "absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg hidden z-50";

const editBtn = document.createElement("button");
editBtn.className =
  "block w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100";
editBtn.textContent = "✏️ Chỉnh sửa bài viết";

const deleteBtn = document.createElement("button");
deleteBtn.className =
  "block w-full text-left px-4 py-2 text-red-600 hover:bg-red-100";
deleteBtn.textContent = "🗑️ Xóa bài viết";

// Gắn sự kiện cho nút
menuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menuDropdown.classList.toggle("hidden");
});

document.addEventListener("click", () => {
  menuDropdown.classList.add("hidden");
});

editBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  menuDropdown.classList.add("hidden");
  alert(`Chỉnh sửa bài viết: ${post.post_id}`);
});

deleteBtn.addEventListener("click",async  (e) => {
  e.stopPropagation();
  menuDropdown.classList.add("hidden");
  await deletePost(post.post_id);
});

menuDropdown.append(editBtn, deleteBtn);
menuWrapper.append(menuBtn, menuDropdown);

// --- Gắn cả 2 bên vào header
header.append(left, menuWrapper);


  // Title
  const title = document.createElement("p");
  title.className = "text-gray-700 mb-3";
  title.textContent = post.title || "";

  // Photos
const photoWrapper = document.createElement("div");
photoWrapper.className = "mb-3";

if (post.photos && post.photos.length > 0) {
  if (post.photos.length === 1) {
    // 1 ảnh → hiển thị to
    const img = document.createElement("img");
    img.className =
      "w-full max-h-[600px] object-contain rounded-lg cursor-pointer hover:opacity-90 transition";
    img.src = post.photos[0].photo;

    img.addEventListener("click", () => {
      const photoUrls = post.photos.map((photo) => photo.photo);
      openPhotoModal(photoUrls, 0, post.title || "");
    });

    photoWrapper.appendChild(img);
  } else {
    // nhiều ảnh → grid
    photoWrapper.className = "grid grid-cols-2 gap-2 mb-3";
    const maxVisible = 5;

    post.photos.slice(0, maxVisible).forEach((p, index) => {
      const imgWrapper = document.createElement("div");
      imgWrapper.className = "relative";

      const img = document.createElement("img");
      img.className =
        "w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition";
      img.src = p.photo;

      img.addEventListener("click", () => {
        const photoUrls = post.photos.map((photo) => photo.photo);
        openPhotoModal(photoUrls, index, post.title || "");
      });

      imgWrapper.appendChild(img);

      // Nếu là ảnh thứ 5 và vẫn còn ảnh phía sau
      if (index === maxVisible - 1 && post.photos.length > maxVisible) {
        const overlay = document.createElement("div");
        overlay.className =
          "absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center rounded-lg text-white text-3xl font-bold";
        overlay.textContent = `+${post.photos.length - maxVisible}`;
        imgWrapper.appendChild(overlay);
      }

      photoWrapper.appendChild(imgWrapper);
    });

  }
}
  // Reaction count
  const totalReactions = post.reactions.reduce((sum, r) => sum + r.total, 0);
  const reactionCount = document.createElement("button");
  reactionCount.type = "button";
  reactionCount.className = "text-sm text-gray-600 mb-2 hover:underline";
  reactionCount.textContent =
    totalReactions > 0 ? `${totalReactions} lượt thích` : "";

  reactionCount.addEventListener("click", () => {
    openReactionsModal(post.post_id);
  });

  // Actions
  const actions = document.createElement("div");
  actions.className = "flex justify-between text-gray-600";

  const reactionWrapper = document.createElement("div");
  reactionWrapper.className = "relative inline-block group";

  const reactBtn = document.createElement("button");
  reactBtn.type = "button";
  reactBtn.className = "flex items-center gap-2 hover:text-indigo-600";
  updateReactionButton(reactBtn, post.user_is_reaction || "");

  const reactionBar = createReactionBar(
    post.post_id,
    reactBtn,
    reactionWrapper,
    reactionCount,
    post
  );

  reactBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const current = reactBtn.dataset.reaction;
    const res = await reactToPost(post.post_id, current || "like");

    if (res) {
      updateReactionButton(
        reactBtn,
        res.status === "added" ? res.reaction_type : ""
      );

      if (Array.isArray(res.count)) {
        const newTotal = res.count.reduce((sum, x) => sum + x.total, 0);
        reactionCount.textContent =
          newTotal > 0 ? `${newTotal} lượt thích` : "";
        post.reactions = res.count;
      }

      post.user_is_reaction =
        res.status === "added" ? res.reaction_type : "";
      reactBtn.dataset.reaction = post.user_is_reaction;
    }
  });

  reactionWrapper.append(reactBtn, reactionBar);

  const commentBtn = document.createElement("button");
  commentBtn.className = "flex items-center gap-2 hover:text-indigo-600";
  commentBtn.textContent = "🗨️ Comment";

  const shareBtn = document.createElement("button");
  shareBtn.className = "flex items-center gap-2 hover:text-indigo-600";
  shareBtn.textContent = "🔂 Share";

  actions.append(reactionWrapper, commentBtn, shareBtn);

  // Append
  article.append(header, title);
  if (post.photos && post.photos.length > 0) article.appendChild(photoWrapper);
  article.appendChild(reactionCount);
  article.appendChild(actions);

  return article;
}
// ==================== Load Posts ====================
async function loadPosts(initial = true) {
  if (!nextPageUrl || isLoading) return;

  if (initial) {
    nextPageUrl = url;
    postContainer.replaceChildren();
  }

  isLoading = true;
  const spinner = showLoading(postContainer);

  try {
    const res = await authFetch(nextPageUrl, { method: "GET" });
    if (!res.ok) throw new Error("Cannot fetch posts");

    const data = await res.json();
    spinner.remove();

    const posts = data.results || data;
    posts.forEach((post) => {
      const article = renderPost(post); // load lần đầu lấy ra các post và truyền vào render tạo header title 
      postContainer.appendChild(article); // sau đó append vào container để hiển thị
    });
    nextPageUrl = data.next;
  } catch (err) {
    console.error("Error loading posts:", err);
    spinner.remove();
  }

  isLoading = false;
}

// ==================== Photo Modal ====================
let currentPhotoIndex = 0;
let photosList = [];

function openPhotoModal(photos, index = 0, caption = "") {
  photosList = photos;
  currentPhotoIndex = index;

  const modal = document.getElementById("photoModal");
  const img = document.getElementById("photoModalImg");
  const captionEl = document.getElementById("photoModalCaption");

  if (!modal || !img || !captionEl) return;

  img.src = photosList[currentPhotoIndex];
  captionEl.textContent = caption;
  modal.classList.remove("hidden");
}

document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("photoModal").classList.add("hidden");
});

document.getElementById("nextPhoto").addEventListener("click", () => {
  if (photosList.length === 0) return;
  currentPhotoIndex = (currentPhotoIndex + 1) % photosList.length;
  document.getElementById("photoModalImg").src = photosList[currentPhotoIndex];
});

document.getElementById("prevPhoto").addEventListener("click", () => {
  if (photosList.length === 0) return;
  currentPhotoIndex =
    (currentPhotoIndex - 1 + photosList.length) % photosList.length;
  document.getElementById("photoModalImg").src = photosList[currentPhotoIndex];
});

// ==================== API: React ====================
async function reactToPost(postId, reactionType) {
  try {
    const res = await authFetch(`http://localhost:8000/posts/${postId}/react/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction_type: reactionType }),
    });

    if (!res.ok) throw new Error("React failed");
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Error reacting:", err);
  }
}

// ==================== Reactions Modal (infinite scroll) ====================
let nextReactionsUrl = null;
let currentPostId = null;
let loadingReactions = false;

async function loadReactions(postId, initial = true) {
  if (initial) {
    nextReactionsUrl = `http://localhost:8000/api/user/reaction/${postId}`;
    document.getElementById("reactionsList").replaceChildren();
    currentPostId = postId;
  }
  if (!nextReactionsUrl || loadingReactions) return;

  loadingReactions = true;

  try {
    const res = await authFetch(nextReactionsUrl, { method: "GET" });
    if (!res.ok) throw new Error("Cannot fetch reactions");
    const data = await res.json();

    const list = document.getElementById("reactionsList");

    data.results.forEach((r) => {
      const item = document.createElement("div");
      item.className = "flex items-center gap-3";

      const img = document.createElement("img");
      img.src = r.user.picture || "/default-avatar.png";
      img.className = "w-8 h-8 rounded-full";

      const name = document.createElement("span");
      name.textContent = `${r.user.first_name} ${r.user.last_name}`;

      const emoji = document.createElement("span");
      const found = REACTIONS.find((x) => x.type === r.slug);
      emoji.textContent = found ? found.icon : "👍";

      item.append(img, name, emoji);
      list.appendChild(item);
    });

    nextReactionsUrl = data.next; // cập nhật url trang sau
  } catch (err) {
    console.error("Error loading reactions:", err);
  }

  loadingReactions = false;
}

function openReactionsModal(postId) {
  const modal = document.getElementById("reactionsModal");
  loadReactions(postId, true);
  modal.classList.remove("hidden");
}

document.getElementById("closeReactionsModal").addEventListener("click", () => {
  document.getElementById("reactionsModal").classList.add("hidden");
});

// Infinite scroll trong modal
document.getElementById("reactionsModal").addEventListener("scroll", (e) => {
  const el = e.target.querySelector("div.overflow-y-auto") || e.target;
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    loadReactions(currentPostId, false);
  }
});

// ==================== Infinite Scroll (posts) ====================
window.addEventListener("scroll", () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) {
    loadPosts(false);
  }
});
//===================== Delete Post ===================
let postToDeleteId = null;

async function deletePost(postId) {
  if (!postId) return;

  // Mở modal
  postToDeleteId = postId;
  document.getElementById("deleteModal").classList.remove("hidden");
}

// Nút hủy
document.getElementById("cancelDelete").addEventListener("click", () => {
  postToDeleteId = null;
  document.getElementById("deleteModal").classList.add("hidden");
});

// Nút xác nhận xóa
document.getElementById("confirmDelete").addEventListener("click", async () => {
  if (!postToDeleteId) return;

  try {
    const res = await authFetch(`http://localhost:8000/api/user/post/${postToDeleteId}/`, {
      method: "DELETE",
    });

    if (res.ok) {
      const article = document.querySelector(`[data-post-id="${postToDeleteId}"]`);
      if (article) article.remove();

      showToast("✅ Bạn đã xóa bài viết thành công!");
    } else {
      showToast("⚠️ Không thể xóa bài viết. Vui lòng thử lại.", "red");
    }
  } catch (err) {
    console.error(err);
    showToast("⚠️ Lỗi khi xóa bài viết.", "red");
  } finally {
    postToDeleteId = null;
    document.getElementById("deleteModal").classList.add("hidden");
  }
});

// Hàm hiển thị toast
function showToast(message, color = "green") {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.className = `fixed bottom-5 right-5 bg-${color}-500 text-white px-4 py-3 rounded shadow-lg`;
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000); // 3 giây
}


// ==================== INIT ====================
loadPosts(true);
export { renderPost};