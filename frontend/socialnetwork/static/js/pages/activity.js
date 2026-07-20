import { API, buildListUrl } from "../shared/config.js";
import { showEmpty } from "../shared/ui.js";
import { fetchPage } from "../shared/paginated-list.js";
import { authFetch } from "../authenticate/auth.js";

const list = document.getElementById("activityList");
let nextUrl = buildListUrl(API.activity(), 25);
let loading = false;
let currentFilter = "all";

// Filter buttons
document.querySelectorAll(".activity-filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".activity-filter").forEach((b) => {
      b.classList.remove("bg-fb-primary", "text-white");
      b.classList.add("text-gray-600", "dark:text-fb-muted", "hover:bg-fb-secondary", "dark:hover:bg-[#3a3b3c]");
    });
    btn.classList.add("bg-fb-primary", "text-white");
    btn.classList.remove("text-gray-600", "dark:text-fb-muted", "hover:bg-fb-secondary", "dark:hover:bg-[#3a3b3c]");
    currentFilter = btn.dataset.activityFilter;
    load(true);
  });
});

async function load(reset = false) {
  if (!list || loading) return;
  if (reset) {
    nextUrl = buildListUrl(API.activity(), 25);
    list.replaceChildren();
  }
  if (!nextUrl) return;

  loading = true;
  const moreBtn = document.getElementById("loadMoreActivityBtn");
  if (moreBtn) moreBtn.disabled = true;

  try {
    const data = await fetchPage(nextUrl);
    let activities = data.results || [];
    
    // Filter activities based on selected filter
    if (currentFilter !== "all") {
      activities = filterActivities(activities, currentFilter);
    }
    
    if (reset && !activities.length) {
      showEmpty(list, "Không có hoạt động nào trong danh mục này.");
    }
    
    activities.forEach((a) => {
      list.appendChild(renderActivity(a));
    });
    
    nextUrl = data.next;
    if (moreBtn) moreBtn.classList.toggle("hidden", !nextUrl);
    if (!list.childElementCount && !nextUrl && reset) {
      showEmpty(list, "Chưa có hoạt động.");
    }
  } catch {
    if (reset) showEmpty(list, "Không tải hoạt động.");
  } finally {
    loading = false;
    if (moreBtn) moreBtn.disabled = false;
  }
}

function filterActivities(activities, filter) {
  const filterMap = {
    posts: ["created", "posted", "đăng bài"],
    comments: ["commented", "bình luận", "comment"],
    likes: ["liked", "thích", "like", "reaction"],
    friends: ["followed", "kết bạn", "friend", "unfollow"]
  };
  
  const keywords = filterMap[filter] || [];
  return activities.filter(a => {
    const verb = (a.verb || "").toLowerCase();
    return keywords.some(keyword => verb.includes(keyword));
  });
}

function renderActivity(activity) {
  const row = document.createElement("div");
  row.className = "p-4 hover:bg-fb-bg dark:hover:bg-[#3a3b3c] transition cursor-pointer";

  const flex = document.createElement("div");
  flex.className = "flex gap-3";

  const iconWrap = document.createElement("div");
  iconWrap.className =
    "w-10 h-10 rounded-full bg-fb-secondary dark:bg-[#4e4f50] flex items-center justify-center text-xl shrink-0";
  iconWrap.textContent = getActivityIcon(activity.verb);

  const body = document.createElement("div");
  body.className = "flex-1 min-w-0";

  const textLine = document.createElement("p");
  textLine.className = "text-sm text-gray-800 dark:text-[#e4e6eb]";
  const actor = "Bạn";
  const verb = activity.verb || "đã thực hiện hành động";
  const target = activity.target || "";
  const strongActor = document.createElement("span");
  strongActor.className = "font-semibold";
  strongActor.textContent = actor;
  textLine.appendChild(strongActor);
  textLine.append(` ${verb} `);
  if (target) {
    const strongTarget = document.createElement("span");
    strongTarget.className = "font-medium text-fb-primary";
    strongTarget.textContent = target;
    textLine.appendChild(strongTarget);
  }

  const timeLine = document.createElement("p");
  timeLine.className = "text-xs text-gray-500 dark:text-fb-muted mt-1";
  timeLine.textContent = formatTime(activity.timestamp);

  body.append(textLine, timeLine);
  flex.append(iconWrap, body);
  row.appendChild(flex);

  if (activity.target_url) {
    row.addEventListener("click", () => {
      window.location.href = activity.target_url;
    });
  }

  return row;
}

function getActivityIcon(verb) {
  const lowerVerb = (verb || "").toLowerCase();
  if (lowerVerb.includes("đăng") || lowerVerb.includes("posted") || lowerVerb.includes("created")) {
    return "📝";
  } else if (lowerVerb.includes("bình luận") || lowerVerb.includes("comment")) {
    return "💬";
  } else if (lowerVerb.includes("thích") || lowerVerb.includes("like") || lowerVerb.includes("reaction")) {
    return "❤️";
  } else if (lowerVerb.includes("kết bạn") || lowerVerb.includes("friend") || lowerVerb.includes("follow")) {
    return "👥";
  } else if (lowerVerb.includes("chia sẻ") || lowerVerb.includes("share")) {
    return "🔄";
  } else if (lowerVerb.includes("chặn") || lowerVerb.includes("block")) {
    return "🚫";
  } else {
    return "📌";
  }
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return "Vừa xong";
  if (diffMins < 60) return `${diffMins} phút trước`;
  if (diffHours < 24) return `${diffHours} giờ trước`;
  if (diffDays < 7) return `${diffDays} ngày trước`;
  
  return date.toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

// Fallback for basic functionality if filter buttons don't exist
if (!document.querySelector(".activity-filter")) {
  document.getElementById("loadMoreActivityBtn")?.addEventListener("click", () =>
    load(false)
  );
} else {
  document.getElementById("loadMoreActivityBtn")?.addEventListener("click", () =>
    load(false)
  );
}

load(true);

