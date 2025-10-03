import { authFetch } from "../authenticate/auth.js";

const cache = {};
let nextPostPage = null;
let isLoadingPosts = false;

// quản lý modal ảnh
let currentPhotoIndex = 0;
let photosList = [];
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
    if(!type) {
        reactBtn.dataset.reaction = "";
        const icon = document.createElement("span"); icon.textContent = "👍";
        const text = document.createElement("span"); text.textContent = "Thích";
        reactBtn.append(icon, text);
        reactBtn.classList.remove("font-bold","text-indigo-600");
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
    bar.className = "absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white shadow-lg rounded-full px-2 py-1 flex gap-2 z-50 hidden";
    let hideTimeout;

    REACTIONS.forEach(r=>{
        const btn = document.createElement("button");
        btn.type="button";
        btn.title = r.label;
        btn.dataset.type = r.type;
        btn.className = "text-xl leading-none p-1 rounded-full hover:scale-125 transition-transform outline-none";
        btn.textContent = r.icon;

        btn.addEventListener("click", async e=>{
            e.stopPropagation();
            const res = await reactToPost(postId, r.type);
            if(res){
                updateReactionButton(reactBtn, res.status==="added"?res.reaction_type:"");
                if(Array.isArray(res.count)){
                    const newTotal = res.count.reduce((sum,x)=>sum+x.total,0);
                    reactionCount.textContent = newTotal>0?`${newTotal} lượt thích`:"";
                    post.reactions = res.count;
                }
                post.user_is_reaction = res.status==="added"?res.reaction_type:"";
                reactBtn.dataset.reaction = post.user_is_reaction;
            }
            bar.classList.add("hidden");
        });

        bar.appendChild(btn);
    });

    wrapper.addEventListener("mouseenter", ()=>{ clearTimeout(hideTimeout); bar.classList.remove("hidden"); });
    wrapper.addEventListener("mouseleave", ()=>{ hideTimeout = setTimeout(()=>bar.classList.add("hidden"),100); });

    return bar;
}

// ======================== POSTS ========================
function renderPostCard(post){
    const card = document.createElement("div");
    card.className = "bg-white rounded-lg shadow p-4 mb-6";

    // Header
    const header = document.createElement("div");
    header.className = "flex items-center gap-3";

    const avatar = document.createElement("img");
    avatar.src = post.user.picture;
    avatar.alt = "avatar";
    avatar.className = "w-10 h-10 rounded-full";

    const info = document.createElement("div");
    const name = document.createElement("p");
    name.textContent = `${post.user.first_name||""} ${post.user.last_name||""}`.trim();
    name.className = "font-semibold";

    const time = document.createElement("p");
    time.textContent = new Date(post.created_at).toLocaleString("vi-VN");
    time.className = "text-sm text-gray-500";

    info.append(name,time);
    header.append(avatar,info);

    const content = document.createElement("p");
    content.textContent = post.title;
    content.className = "mt-3";

    card.append(header, content);

    // Photos
    if(post.photos && post.photos.length>0){
        const grid = document.createElement("div");
        grid.className="grid grid-cols-2 gap-2 mt-3";
        post.photos.forEach((p,index)=>{
            const img = document.createElement("img");
            img.src=p.photo; img.alt="post image";
            img.className="rounded-lg cursor-pointer hover:opacity-90 transition";
            img.addEventListener("click", ()=>{
                const urls = post.photos.map(x=>x.photo);
                openPhotoModal(urls,index,post.title||"");
            });
            grid.appendChild(img);
        });
        card.appendChild(grid);
    }

    // Reaction count & actions
    const totalReactions = post.reactions?.reduce((sum,r)=>sum+r.total,0) || 0;
    const reactionCount = document.createElement("button");
    reactionCount.type="button";
    reactionCount.className="text-sm text-gray-600 mb-2 hover:underline";
    reactionCount.textContent = totalReactions>0?`${totalReactions} lượt thích`:"";
    reactionCount.addEventListener("click",()=>openReactionsModal(post.post_id));

    const actions = document.createElement("div");
    actions.className="flex justify-between text-gray-600 mt-1";

    const reactionWrapper = document.createElement("div");
    reactionWrapper.className="relative inline-block group";

    const reactBtn = document.createElement("button");
    reactBtn.type="button";
    reactBtn.className="flex items-center gap-2 hover:text-indigo-600";
    updateReactionButton(reactBtn, post.user_is_reaction||"");

    const reactionBar = createReactionBar(post.post_id, reactBtn, reactionWrapper, reactionCount, post);
    reactBtn.addEventListener("click", async e=>{
        e.stopPropagation();
        const current = reactBtn.dataset.reaction;
        const res = await reactToPost(post.post_id, current||"like");
        if(res){
            updateReactionButton(reactBtn,res.status==="added"?res.reaction_type:"");
            if(Array.isArray(res.count)){
                const newTotal = res.count.reduce((sum,x)=>sum+x.total,0);
                reactionCount.textContent=newTotal>0?`${newTotal} lượt thích`:"";
                post.reactions=res.count;
            }
            post.user_is_reaction=res.status==="added"?res.reaction_type:"";
            reactBtn.dataset.reaction=post.user_is_reaction;
        }
    });

    reactionWrapper.append(reactBtn,reactionBar);

    const commentBtn = document.createElement("button");
    commentBtn.className="flex items-center gap-2 hover:text-indigo-600";
    commentBtn.textContent="🗨️ Comment";

    const shareBtn = document.createElement("button");
    shareBtn.className="flex items-center gap-2 hover:text-indigo-600";
    shareBtn.textContent="🔂 Share";

    actions.append(reactionWrapper,commentBtn,shareBtn);

    card.append(reactionCount,actions);

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
if (document.body.id === "profilePage") {
    window.addEventListener("scroll", ()=>{
        if(window.innerHeight + window.scrollY >= document.body.offsetHeight - 200){
            loadPosts(false);
        }
    });
}

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
    const spinner=showLoading(container);
    if(!cache.userInfo){
        const res=await authFetch(`http://localhost:8000/api/auth/profile/userpage/${user_id}`,{method:"GET"});
        if(!res.ok){ spinner.remove(); throw new Error("Cannot fetch introduce"); }
        const data=await res.json();
        cache.userInfo=data.results?data.results[0]:data;
    }
    const user=cache.userInfo;
    container.replaceChildren(); spinner.remove();
    const card=document.createElement("div"); card.className="bg-white p-4 rounded-lg shadow";
    const title=document.createElement("h2"); title.textContent="Giới thiệu"; title.className="text-lg font-bold mb-2";
    const bio=document.createElement("p"); bio.textContent=user.bio||"Chưa có giới thiệu.";
    card.append(title,bio); container.appendChild(card);
}

async function loadFriends(){
    const container=document.getElementById("content");
    const spinner=showLoading(container);
    if(!cache.friends){
        const res=await authFetch(`http://localhost:8000/api/user/friends/${user_id}`,{method:"GET"});
        if(!res.ok){ spinner.remove(); throw new Error("Cannot fetch friends"); }
        cache.friends=await res.json();
    }
    const data=cache.friends; container.replaceChildren(); spinner.remove();
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

async function loadPhotos(){
    const container=document.getElementById("content");
    const spinner=showLoading(container);
    if(!cache.posts){
        const res=await authFetch(`http://localhost:8000/api/user/post/userpage/${user_id}`,{method:"GET"});
        if(!res.ok){ spinner.remove(); throw new Error("Cannot fetch posts"); }
        cache.posts=await res.json();
    }
    const data=cache.posts.results||cache.posts;
    container.replaceChildren(); spinner.remove();
    const card=document.createElement("div"); card.className="bg-white p-4 rounded-lg shadow";
    const title=document.createElement("h2"); title.textContent="Ảnh"; title.className="text-lg font-bold mb-4";

    const photos=data.filter(post=>post.photos && post.photos.length>0).flatMap(post=>post.photos.map(p=>({...p,title:post.title})));
    if(photos.length===0){ const empty=document.createElement("p"); empty.textContent="Chưa có ảnh để hiển thị."; empty.className="text-gray-600 text-center"; card.append(title,empty); }
    else{
        const grid=document.createElement("div"); grid.className="grid grid-cols-3 gap-2";
        photos.forEach((p,index)=>{
            const img=document.createElement("img"); img.src=p.photo; img.alt="photo"; img.className="w-full h-32 object-cover rounded-lg cursor-pointer hover:opacity-90 transition";
            img.addEventListener("click",()=>{ const urls=photos.map(x=>x.photo); openPhotoModal(urls,index,p.title||""); });
            grid.appendChild(img);
        });
        card.append(title,grid);
    }
    container.appendChild(card);
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

// ======================== INIT ========================
loadUserInfo();
loadPosts(true);
setupTabs();
