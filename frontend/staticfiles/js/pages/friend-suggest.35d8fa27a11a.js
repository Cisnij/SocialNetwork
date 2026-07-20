import { authFetch } from "../authenticate/auth.js";
import { API, withPageSize, DEFAULT_AVATAR } from "../shared/config.js";
import { el, img, textEl } from "../shared/dom.js";
import { showToast } from "../shared/toast.js";
import { showEmpty } from "../shared/ui.js";

document.addEventListener("DOMContentLoaded", async () => {
  const list = document.getElementById("friendSuggestList");
  const emptyState = document.getElementById("emptyState");
  if (!list) return;

  list.replaceChildren();
  const loading = textEl("p", "text-center text-gray-500 py-8", "Đang tải gợi ý...");
  list.appendChild(loading);

  try {
    const res = await authFetch(withPageSize(API.friendSuggest(), 20));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const suggestions = data.results || [];

    list.replaceChildren();
    if (!suggestions.length) {
      emptyState?.classList.remove("hidden");
      return;
    }
    emptyState?.classList.add("hidden");

    suggestions.forEach((profile) => {
      list.appendChild(renderSuggestCard(profile));
    });
  } catch (err) {
    console.error("[friend-suggest]", err);
    list.replaceChildren();
    showEmpty(list, "Không tải được gợi ý kết bạn.");
  }
});

function renderSuggestCard(profile) {
  const card = el("div", "flex items-center gap-4 p-4 bg-white dark:bg-[#242526] rounded-xl shadow-sm");

  card.append(
    img(profile.picture || DEFAULT_AVATAR, "w-12 h-12 rounded-full object-cover shrink-0", "")
  );

  const info = el("div", "flex-1 min-w-0");
  info.appendChild(
    textEl("p", "font-semibold dark:text-[#e4e6eb] truncate", profile.full_name || "Người dùng")
  );
  const mutual = profile.mutual_count ?? 0;
  info.appendChild(
    textEl(
      "p",
      "text-sm text-gray-500 dark:text-fb-muted",
      `${mutual} bạn chung`
    )
  );
  card.append(info);

  const addBtn = el("button", "px-4 py-2 bg-fb-primary dark:bg-[#1877f2] text-white rounded-lg font-semibold hover:bg-fb-primary-hover dark:hover:bg-[#166fe5] text-sm shrink-0", {
    type: "button",
    text: "Thêm bạn",
  });

  addBtn.addEventListener("click", async () => {
    addBtn.disabled = true;
    addBtn.textContent = "Đang gửi...";
    try {
      const res = await authFetch(API.friendRequest(profile.id), { method: "POST" });
      if (!res.ok) throw new Error("request failed");
      addBtn.textContent = "Đã gửi";
      addBtn.className =
        "px-4 py-2 bg-fb-secondary dark:bg-[#4e4f50] text-gray-700 dark:text-[#e4e6eb] rounded-lg text-sm shrink-0 cursor-default";
      showToast("Đã gửi lời mời kết bạn");
    } catch {
      addBtn.disabled = false;
      addBtn.textContent = "Thêm bạn";
      showToast("Không gửi được lời mời", "red");
    }
  });

  card.appendChild(addBtn);
  return card;
}

