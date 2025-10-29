import { authFetch } from "../authenticate/auth.js";
import { openEditModal } from "./post_edit.js";
const cache = {};
let nextPostPage = null;
let isLoadingPosts = false;

// quản lý modal ảnh
let currentPhotoIndex = 0;
let photosList = [];
// Chú ý: user_id cần được định nghĩa ở đây hoặc từ window (như trong code gốc)
const user_id = window.user_id;

// ======================== LOADING ========================
function showLoading(container) {
    const wrapper = document.createElement("div");
    wrapper.className = "text-center py-4 flex flex-col items-center";

    const spinner = document.createElement("div");
    spinner.className = "animate-spin h-6 w-6 border-4 border-indigo-500 border-t-transparent rounded-full";

    const text = document.createElement("p");
    text.className = "text-gray-500 mt-2";
    text.textContent = "Đang tải...";

    wrapper.append(spinner, text);
    container.appendChild(wrapper);
    return wrapper;
}

// ======================== USER PROFILE ========================
async function loadUserInfo() {
  if (!cache.userInfo) {
    const res = await authFetch(`http://localhost:8000/api/auth/profile/userpage/${user_id}`, { method: "GET" });
    if (!res.ok) throw new Error("Cannot fetch user profile");
    const data = await res.json();
    cache.userInfo = data.results ? data.results[0] : data;
  }

  const user = cache.userInfo;
  const container = document.getElementById("profile");
  container.replaceChildren();

  // Avatar
  const avatar = document.createElement("img");
  avatar.src = user.picture;
  avatar.alt = "avatar";
  avatar.className = "w-32 h-32 rounded-full border shadow-lg mx-auto cursor-pointer";

  // Click để phóng to
  avatar.addEventListener("click", () => {
    const modal = document.getElementById("avatarModal");
    const modalImg = document.getElementById("avatarModalImg");
    modalImg.src = user.picture;
    modal.classList.remove("hidden");
  });

  // Name
  const name = document.createElement("h1");
  name.textContent = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  name.className = "text-2xl font-bold text-center mt-4";

  // Bio
  const bio = document.createElement("p");
  bio.textContent = user.bio || "Chưa có giới thiệu.";
  bio.className = "text-sm text-gray-500 text-center mt-1"; 

  container.append(avatar, name, bio);

  // Click modal để đóng
  const avatarModal = document.getElementById("avatarModal");
  avatarModal.addEventListener("click", () => {
    avatarModal.classList.add("hidden");
  });
}

// ======================== REACTIONS ========================
const REACTIONS = [
  { type: "like", icon: "👍", label: "Thích" },
  { type: "love", icon: "❤️", label: "Yêu thích" },
  { type: "haha", icon: "😂", label: "Haha" },
  { type: "wow", icon: "😮", label: "Wow" },
  { type: "sad", icon: "😢", label: "Buồn" },
  { type: "angry", icon: "😡", label: "Phẫn nộ" },
];

async function reactToPost(postId, reactionType) {
    try {
        const res = await authFetch(`http://localhost:8000/posts/${postId}/react/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reaction_type: reactionType }),
        });
        if(!res.ok) throw new Error("React failed");
        return await res.json();
    } catch(err) {
        console.error("Error reacting:", err);
    }
}

function updateReactionButton(reactBtn, type) {
    reactBtn.replaceChildren();
    // FIX 2: Luôn luôn xóa các class active (font-bold, text-indigo-600) trước
    // khi thêm/bỏ, để đảm bảo trạng thái UI được reset chính xác khi unlike.
    reactBtn.classList.remove("font-bold","text-indigo-600");

    if(!type) {
        reactBtn.dataset.reaction = "";
        const icon = document.createElement("span"); icon.textContent = "👍";
        const text = document.createElement("span"); text.textContent = "Thích";
        reactBtn.append(icon, text);
        return;
    }
    const r = REACTIONS.find(x=>x.type===type) || REACTIONS[0];
    const icon = document.createElement("span"); icon.textContent = r.icon;
    const text = document.createElement("span"); text.textContent = r.label;
    reactBtn.append(icon,text);
    reactBtn.dataset.reaction = r.type;
    reactBtn.classList.add("font-bold","text-indigo-600");
}

function createReactionBar(postId, reactBtn, wrapper, reactionCount, post) {
  const bar = document.createElement("div");
  bar.className =
    "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white shadow-lg rounded-full px-2 py-1 flex gap-2 z-50 hidden";
  let hideTimeout;

  REACTIONS.forEach((r) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = r.label;
    btn.dataset.type = r.type;
    btn.className =
      "text-xl leading-none p-1 rounded-full hover:scale-125 transition-transform outline-none";
    btn.textContent = r.icon;

    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      try {
        const res = await reactToPost(postId, r.type);
        if (!res) {
          bar.classList.add("hidden");
          return;
        }

        let newReaction = "";
        if (res.reaction_type) newReaction = res.reaction_type;
        else if (res.status === "added") newReaction = r.type;

        updateReactionButton(reactBtn, newReaction);

        // cập nhật tổng lượt thích
        if (Array.isArray(res.count)) {
          const newTotal = res.count.reduce((sum, x) => sum + x.total, 0);
          reactionCount.textContent =
            newTotal > 0 ? `${newTotal} lượt thích` : "";
          post.reactions = res.count;
        } else if (typeof res.total === "number") {
          reactionCount.textContent =
            res.total > 0 ? `${res.total} lượt thích` : "";
        }

        post.user_is_reaction = newReaction;
        reactBtn.dataset.reaction = newReaction;
      } catch (err) {
        console.error("Error reacting (bar):", err);
      } finally {
        bar.classList.add("hidden");
      }
    });

    bar.appendChild(btn);
  });

  wrapper.addEventListener("mouseenter", () => {
    clearTimeout(hideTimeout);
    bar.classList.remove("hidden");
  });
  wrapper.addEventListener("mouseleave", () => {
    hideTimeout = setTimeout(() => bar.classList.add("hidden"), 100);
  });

  return bar;
}


// ======================== POSTS ========================
export function renderPostCard(post) {
  const card = document.createElement("div");
  card.className = "bg-white rounded-lg shadow p-4 mb-6 relative";
  card.dataset.postId = post.post_id;

  // ===== HEADER =====
  const header = document.createElement("div");
  header.className = "flex items-center justify-between";

  // --- Left: Avatar + Info
  const left = document.createElement("div");
  left.className = "flex items-center gap-3";

  const avatar = document.createElement("img");
  avatar.src = post.user.picture;
  avatar.alt = "avatar";
  avatar.className = "w-10 h-10 rounded-full";

  const info = document.createElement("div");
  const name = document.createElement("p");
  name.className = "font-semibold";
  name.textContent = `${post.user.first_name || ""} ${post.user.last_name || ""}`.trim();

  const time = document.createElement("p");
  time.className = "text-sm text-gray-500";
  time.textContent = new Date(post.created_at).toLocaleString("vi-VN");

  info.append(name, time);
  left.append(avatar, info);

  // --- Right: Menu "⋯"
  const menuWrapper = document.createElement("div");
  menuWrapper.className = "relative";

  const menuBtn = document.createElement("button");
  menuBtn.textContent = "⋯";
  menuBtn.className = "text-2xl text-gray-500 hover:text-gray-800 px-2 rounded-full";
  menuWrapper.appendChild(menuBtn);

  const menuDropdown = document.createElement("div");
  menuDropdown.className = "absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg hidden z-50";

  const editBtn = document.createElement("button");
  editBtn.className = "block w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100";
  editBtn.textContent = "✏️ Chỉnh sửa";

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "block w-full text-left px-4 py-2 text-red-600 hover:bg-red-100";
  deleteBtn.textContent = "🗑️ Xóa bài viết";

  menuDropdown.append(editBtn, deleteBtn);
  menuWrapper.append(menuDropdown);

  //Nhấn nút xóa
  deleteBtn.addEventListener("click",async  (e) => {
    e.stopPropagation();
    menuDropdown.classList.add("hidden");
    await deletePost(post.post_id);
  });
  // Toggle menu
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.toggle("hidden");
  });
  document.addEventListener("click", () => menuDropdown.classList.add("hidden"));

  // Gắn header
  header.append(left, menuWrapper);
  card.appendChild(header);

  // ===== CONTENT =====
  const content = document.createElement("p");
  content.className = "mt-3";
  content.textContent = post.title;
  card.appendChild(content);

  // ===== PHOTOS =====
  if (post.photos && post.photos.length > 0) {
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-2 gap-2 mt-3";

    const maxVisible = 5;
    post.photos.slice(0, maxVisible).forEach((p, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "relative";

      const img = document.createElement("img");
      img.src = p.photo;
      img.alt = "photo";
      img.className = "rounded-lg cursor-pointer hover:opacity-90 transition w-full h-48 object-cover";
      img.addEventListener("click", () => {
        const urls = post.photos.map((x) => x.photo);
        openPhotoModal(urls, index, post.title || "");
      });
      wrapper.appendChild(img);

      // overlay "+x"
      if (index === maxVisible - 1 && post.photos.length > maxVisible) {
        const overlay = document.createElement("div");
        overlay.className =
          "absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center rounded-lg text-white text-3xl font-bold";
        overlay.textContent = `+${post.photos.length - maxVisible}`;
        wrapper.appendChild(overlay);
      }

      grid.appendChild(wrapper);
    });

    card.appendChild(grid);
  }

  // ===== REACTIONS =====
  const totalReactions = post.reactions?.reduce((sum, r) => sum + r.total, 0) || 0;
  const reactionCount = document.createElement("button");
  reactionCount.type = "button";
  reactionCount.className = "text-sm text-gray-600 mb-2 hover:underline";
  reactionCount.textContent = totalReactions > 0 ? `${totalReactions} lượt thích` : "";
  reactionCount.addEventListener("click", () => openReactionsModal(post.post_id));
  card.appendChild(reactionCount);

  // ===== ACTIONS =====
  const actions = document.createElement("div");
  actions.className = "flex justify-between text-gray-600 mt-1";

  const reactionWrapper = document.createElement("div");
  reactionWrapper.className = "relative inline-block group";

  const reactBtn = document.createElement("button");
  reactBtn.type = "button";
  reactBtn.className = "flex items-center gap-2 hover:text-indigo-600";
  updateReactionButton(reactBtn, post.user_is_reaction || "");

  const reactionBar = createReactionBar(post.post_id, reactBtn, reactionWrapper, reactionCount, post);

reactBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  
  // Lấy ra reaction hiện tại của bài viết
  const currentReaction = post.user_is_reaction;
  
  // FIX: Nếu đã có reaction (ví dụ: 'haha'), thì click lần này phải gửi lại 
  // chính reaction đó để backend toggle (xóa) nó.
  // Nếu chưa có reaction, thì gửi 'like' (mặc định)
  let reactionToSend = currentReaction || "like";

  const res = await reactToPost(post.post_id, reactionToSend);

  if (res) {
    // ✅ Cập nhật nút reaction: nếu thêm => dùng reaction_type, nếu bỏ => reset ""
    updateReactionButton(
      reactBtn,
      res.status === "added" ? res.reaction_type : ""
    );

    // ✅ Nếu có mảng count => cập nhật số lượt
    if (Array.isArray(res.count)) {
      const newTotal = res.count.reduce((sum, x) => sum + x.total, 0);
      reactionCount.textContent =
        newTotal > 0 ? `${newTotal} lượt thích` : "";
      post.reactions = res.count;
    }

    // ✅ Cập nhật trạng thái local
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
  card.append(actions);

  // ===== MENU EVENTS =====
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menuDropdown.classList.add("hidden");
    openEditModal(post);
  });

  return card;
}


async function loadPosts(initial=true){
    const container = document.getElementById("content");
    if(initial){ container.replaceChildren(); nextPostPage=`http://localhost:8000/api/user/post/userpage/${user_id}`; }
    if(!nextPostPage || isLoadingPosts) return;

    isLoadingPosts=true;
    const spinner=showLoading(container);
    const res=await authFetch(nextPostPage,{method:"GET"});
    if(!res.ok){ spinner.remove(); throw new Error("Cannot fetch posts"); }
    const data=await res.json();
    spinner.remove();

    const posts=data.results||data;
    posts.forEach(post=>container.appendChild(renderPostCard(post)));
    nextPostPage=data.next;
    isLoadingPosts=false;
}

// Infinite scroll chỉ kích hoạt khi là profilePage
window.addEventListener("scroll", () => {
    // Chỉ chạy khi tab "Bài viết" đang active 
    const activeTab = document.querySelector('#tabs a.border-indigo-600'); 
    if (activeTab && activeTab.dataset.tab === "posts" &&
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) { //chiều cao của màn hình đang nhìn mà không cuộn + số pixel đã cuộn mà >= tổng độ dài - 200 thì load ra thêm(tức cách đáy 200 thì load ra)
        loadPosts(false);
    }
});


// ======================== PHOTO MODAL ========================
function openPhotoModal(photos,index=0,caption=""){
    photosList=photos; currentPhotoIndex=index;
    const modal=document.getElementById("photoModal");
    const img=document.getElementById("photoModalImg");
    const captionEl=document.getElementById("photoModalCaption");
    img.src=photosList[currentPhotoIndex];
    captionEl.textContent=caption;
    modal.classList.remove("hidden");
}

document.getElementById("prevPhoto").addEventListener("click",()=>{
    if(currentPhotoIndex>0){ currentPhotoIndex--; document.getElementById("photoModalImg").src=photosList[currentPhotoIndex]; }
});
document.getElementById("nextPhoto").addEventListener("click",()=>{
    if(currentPhotoIndex<photosList.length-1){ currentPhotoIndex++; document.getElementById("photoModalImg").src=photosList[currentPhotoIndex]; }
});
document.getElementById("closeModal").addEventListener("click",()=>document.getElementById("photoModal").classList.add("hidden"));
document.getElementById("photoModal").addEventListener("click",e=>{ if(e.target.id==="photoModal") e.target.classList.add("hidden"); });
document.addEventListener("keydown",e=>{ if(e.key==="Escape") document.getElementById("photoModal").classList.add("hidden"); });

// ======================== REACTIONS MODAL ========================
let nextReactionsUrl=null;
let currentPostId=null;
let loadingReactions=false;

async function loadReactions(postId,initial=true){
    const list=document.getElementById("reactionsList");
    if(initial){ nextReactionsUrl=`http://localhost:8000/api/user/reaction/${postId}`; list.replaceChildren(); currentPostId=postId; }
    if(!nextReactionsUrl || loadingReactions) return;
    loadingReactions=true;
    try{
        const res=await authFetch(nextReactionsUrl,{method:"GET"});
        if(!res.ok) throw new Error("Cannot fetch reactions");
        const data=await res.json();
        data.results.forEach(r=>{
            const item=document.createElement("div"); item.className="flex items-center gap-3";
            const img=document.createElement("img"); img.src=r.user.picture||"/default-avatar.png"; img.className="w-8 h-8 rounded-full";
            const name=document.createElement("span"); name.textContent=`${r.user.first_name} ${r.user.last_name}`;
            const emoji=document.createElement("span"); const found=REACTIONS.find(x=>x.type===r.slug); emoji.textContent=found?found.icon:"👍";
            item.append(img,name,emoji); list.appendChild(item);
        });
        nextReactionsUrl=data.next;
    }catch(err){ console.error(err); }
    loadingReactions=false;
}

function openReactionsModal(postId){
    const modal=document.getElementById("reactionsModal");
    loadReactions(postId,true);
    modal.classList.remove("hidden");
}

document.getElementById("closeReactionsModal").addEventListener("click",()=>document.getElementById("reactionsModal").classList.add("hidden"));
document.getElementById("reactionsModal").addEventListener("scroll", e=>{
    const el=e.target.querySelector("div.overflow-y-auto")||e.target;
    if(el.scrollTop+el.clientHeight>=el.scrollHeight-100){
        loadReactions(currentPostId,false);
    }
});

// ======================== INTRODUCE / FRIENDS / PHOTOS ========================
async function loadIntroduce(){
    const container=document.getElementById("content");
    container.replaceChildren();
    const spinner=showLoading(container);
    
    if(!cache.userInfo){
        const res=await authFetch(`http://localhost:8000/api/auth/profile/userpage/${user_id}`,{method:"GET"});
        if(!res.ok){ spinner.remove(); throw new Error("Cannot fetch introduce"); }
        const data=await res.json();
        cache.userInfo=data.results?data.results[0]:data;
    }
    
    const user=cache.userInfo;
    spinner.remove();
    const card=document.createElement("div"); card.className="bg-white p-4 rounded-lg shadow";
    const title=document.createElement("h2"); title.textContent="Giới thiệu"; title.className="text-lg font-bold mb-2";
    const bio=document.createElement("p"); bio.textContent=user.bio||"Chưa có giới thiệu.";
    card.append(title,bio); container.appendChild(card);
}

async function loadFriends(){
    const container=document.getElementById("content");
    container.replaceChildren();
    const spinner=showLoading(container);

    if(!cache.friends){
        const res=await authFetch(`http://localhost:8000/api/user/friends/${user_id}`,{method:"GET"});
        if(!res.ok){ spinner.remove(); throw new Error("Cannot fetch friends"); }
        cache.friends=await res.json();
    }
    
    const data=cache.friends; 
    spinner.remove();
    const card=document.createElement("div"); card.className="bg-white p-4 rounded-lg shadow";
    const title=document.createElement("h2"); title.textContent="Bạn bè"; title.className="text-lg font-bold mb-4";
    const list=document.createElement("ul"); list.className="space-y-3";
    const friends=data[0].friends;
    friends.forEach(friend=>{
        const li=document.createElement("li");
        const link=document.createElement("a"); link.href=`/profile/${friend.id}`; link.className="flex items-center space-x-3 hover:bg-gray-100 p-2 rounded-md transition";
        const avatar=document.createElement("img"); avatar.src=friend.picture; avatar.alt=`${friend.first_name} ${friend.last_name}`; avatar.className="w-10 h-10 rounded-full object-cover";
        const name=document.createElement("span"); name.textContent=`${friend.first_name} ${friend.last_name}`; name.className="font-medium text-gray-800";
        link.append(avatar,name); li.appendChild(link); list.appendChild(li);
    });
    card.append(title,list); container.appendChild(card);
}

// FIX 1: Thêm logic phân trang để tải TẤT CẢ ảnh
async function loadPhotos(){
    const container=document.getElementById("content");
    container.replaceChildren(); // Xóa nội dung cũ

    const card=document.createElement("div"); 
    card.className="bg-white p-4 rounded-lg shadow";
    
    const title=document.createElement("h2"); 
    title.textContent="Ảnh"; 
    title.className="text-lg font-bold mb-4";
    card.appendChild(title);
    container.appendChild(card); // Thêm card vào container trước để thêm spinner

    const spinner=showLoading(card); // Hiện spinner bên trong card

    let currentUrl = `http://localhost:8000/api/user/post/userpage/${user_id}`;
    let allPhotos = [];

    try {
        // Lặp qua tất cả các trang bài viết
        while (currentUrl) {
            const res = await authFetch(currentUrl, { method: "GET" });
            if (!res.ok) throw new Error("Cannot fetch posts for photos");
            const data = await res.json();
            
            const posts = data.results || data;
            
            // Trích xuất ảnh từ trang hiện tại
            const photosFromPage = posts.filter(post => post.photos && post.photos.length > 0)
                .flatMap(post => post.photos.map(p => ({...p, title: post.title})));
            
            allPhotos.push(...photosFromPage);
            
            currentUrl = data.next; // Lấy URL trang tiếp theo
        }
        
        spinner.remove(); // Xóa spinner khi đã tải xong
        
        // Hiển thị tất cả ảnh
        if(allPhotos.length === 0){ 
            const empty=document.createElement("p"); 
            empty.textContent="Chưa có ảnh để hiển thị."; 
            empty.className="text-gray-600 text-center"; 
            card.appendChild(empty);
        } else {
            const grid=document.createElement("div"); 
            grid.className="grid grid-cols-3 gap-2";
            
            // Tạo danh sách URL ảnh để truyền cho modal
            const allPhotoUrls = allPhotos.map(x => x.photo); 
            
            allPhotos.forEach((p,index)=>{
                const img=document.createElement("img"); 
                img.src=p.photo; 
                img.alt="photo"; 
                img.className="w-full h-32 object-cover rounded-lg cursor-pointer hover:opacity-90 transition";
                
                img.addEventListener("click",()=>{ 
                    openPhotoModal(allPhotoUrls, index, p.title||""); 
                });
                grid.appendChild(img);
            });
            card.appendChild(grid);
        }

    } catch(err) { 
        console.error("Error loading all photos:", err); 
        spinner.remove();
        const errorText = document.createElement("p");
        errorText.textContent = "Lỗi khi tải ảnh.";
        errorText.className = "text-red-500 text-center";
        card.appendChild(errorText);
    }
}

// ======================== TABS ========================
function setupTabs(){
    const tabs=document.querySelectorAll("#tabs a");
    tabs.forEach(tab=>{
        tab.addEventListener("click",e=>{
            e.preventDefault();
            tabs.forEach(t=>t.classList.remove("border-b-2","border-indigo-600","text-indigo-600","font-medium"));
            tab.classList.add("border-b-2","border-indigo-600","text-indigo-600","font-medium");
            const type=tab.dataset.tab;
            if(type==="posts") loadPosts(true);
            if(type==="introduce") loadIntroduce();
            if(type==="friends") loadFriends();
            if(type==="photos") loadPhotos();
        });
    });
}
// ======================== DELETE POST ========================
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


// ======================== INIT ========================
loadUserInfo();
loadPosts(true);
setupTabs();

document.addEventListener('newPostCreated', (e) => {
    const newPost = e.detail;
    const postContainer = document.getElementById("content");
    // Chỉ thêm bài viết nếu đang ở tab "Bài viết"
    const activeTab = document.querySelector('#tabs a.border-indigo-600'); 
    if (activeTab && activeTab.dataset.tab === "posts" && postContainer) {
        // Thêm bài viết mới lên đầu danh sách
        const newArticle = renderPostCard(newPost);
        postContainer.prepend(newArticle);
    }
});
export {showToast};