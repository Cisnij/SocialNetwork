import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";
import { el, textEl } from "../shared/dom.js";
import { showToast } from "../shared/toast.js";

const STATUS_VI = {
  myself: "Đây là trang cá nhân của bạn",
  blocked: "Một trong hai đã chặn nhau",
  friend: "Bạn bè",
  request_sent: "Bạn đã gửi lời mời kết bạn",
  request_received: "Người này đã gửi lời mời cho bạn",
  following: "Bạn đang theo dõi người này",
  none: "Chưa có mối quan hệ đặc biệt",
};

document.addEventListener("DOMContentLoaded", () => {
  const profileIdInput = document.getElementById("profileIdInput");
  const checkBtn = document.getElementById("checkBtn");
  const result = document.getElementById("result");
  const relationshipInfo = document.getElementById("relationshipInfo");

  const pathMatch = window.location.pathname.match(/\/relationship\/(\d+)\/?/);
  const profileIdFromPath = pathMatch ? pathMatch[1] : null;

  if (profileIdFromPath && profileIdInput) {
    profileIdInput.value = profileIdFromPath;
    checkRelationship(profileIdFromPath);
  }

  checkBtn?.addEventListener("click", () => {
    const profileId = profileIdInput?.value.trim();
    if (!profileId) {
      showToast("Vui lòng nhập ID profile", "red");
      return;
    }
    checkRelationship(profileId);
  });

  async function checkRelationship(profileId) {
    if (!checkBtn || !relationshipInfo) return;

    checkBtn.disabled = true;
    checkBtn.textContent = "Đang kiểm tra...";
    relationshipInfo.replaceChildren();

    try {
      const res = await authFetch(API.relationship(profileId));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const status = data.status || "none";
      const label = STATUS_VI[status] || status;

      result?.classList.remove("hidden");

      const box = el("div", "space-y-3");
      const row = el("div", "flex items-center gap-3 p-4 bg-fb-secondary dark:bg-[#3a3b3c] rounded-lg");
      row.appendChild(textEl("span", "text-2xl shrink-0", "👤"));
      const col = el("div", "min-w-0");
      col.appendChild(
        textEl("p", "font-medium dark:text-[#e4e6eb]", `Profile ID: ${profileId}`)
      );
      col.appendChild(
        textEl("p", "text-sm text-gray-600 dark:text-fb-muted mt-1", label)
      );
      row.append(col);
      box.append(row);

      if (status === "request_received") {
        const actions = el("div", "flex gap-2 flex-wrap");
        const accept = el("button", "px-4 py-2 bg-fb-primary text-white rounded-lg text-sm font-semibold", {
          type: "button",
          text: "Xem lời mời bạn bè",
        });
        accept.addEventListener("click", () => {
          window.location.href = "/friends/";
        });
        actions.appendChild(accept);
        box.append(actions);
      } else if (status === "friend" || status === "none" || status === "following") {
        const chatBtn = el("button", "px-4 py-2 bg-fb-primary text-white rounded-lg text-sm font-semibold", {
          type: "button",
          text: "Nhắn tin",
        });
        chatBtn.addEventListener("click", () => {
          window.location.href = `/chat/?user=${encodeURIComponent(profileId)}`;
        });
        box.appendChild(chatBtn);
      }

      relationshipInfo.appendChild(box);
    } catch (err) {
      console.error("[relationship]", err);
      showToast("Không kiểm tra được mối quan hệ", "red");
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = "Kiểm tra";
    }
  }
});
