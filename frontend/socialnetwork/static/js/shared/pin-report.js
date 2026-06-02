import { authFetch } from "../authenticate/auth.js";
import { API } from "./config.js";
import { showToast } from "./toast.js";

export function injectPinReportButtons(post, { isUserPage = false } = {}) {
  const modal = document.getElementById("editPostModal");
  if (!modal || document.getElementById("pinReportButtons")) return;

  const buttonsDiv = document.createElement("div");
  buttonsDiv.id = "pinReportButtons";
  buttonsDiv.className = "flex gap-2 mb-4";

  // Pin: only available on userpage
  if (isUserPage) {
    const pinBtn = document.createElement("button");
    pinBtn.type = "button";
    pinBtn.className =
      "px-3 py-1.5 rounded-lg bg-yellow-100 text-yellow-700 text-xs font-medium hover:bg-yellow-200";
    pinBtn.textContent = post.is_pinned ? "📌 Bỏ ghim" : "📌 Ghim bài";
    pinBtn.onclick = async () => {
      try {
        const res = await authFetch(API.pinPost(post.post_id), { method: "PUT" });
        if (res.ok) {
          post.is_pinned = !post.is_pinned;
          pinBtn.textContent = post.is_pinned ? "📌 Bỏ ghim" : "📌 Ghim bài";
          showToast("📌 Đã cập nhật ghim bài viết", "green");
        } else showToast("Không thể ghim", "red");
      } catch (err) {
        console.error("Pin post error:", err);
        showToast("Lỗi mạng", "red");
      }
    };
    buttonsDiv.appendChild(pinBtn);
  }

  // Report: always available
  const reportBtn = document.createElement("button");
  reportBtn.type = "button";
  reportBtn.className =
    "px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200";
  reportBtn.textContent = "🚩 Báo cáo";
  reportBtn.onclick = () => showReportModal(post.post_id);
  buttonsDiv.appendChild(reportBtn);

  const modalContent = modal.querySelector('.bg-white.dark\\:bg-gray-800');
  if (modalContent) modalContent.insertBefore(buttonsDiv, modalContent.firstChild);
}

function showReportModal(postId) {
  const modal = document.createElement("div");
  modal.className = "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4";
  modal.id = "reportModal";

  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-bold dark:text-white">Báo cáo bài viết</h2>
        <button type="button" class="text-2xl text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white" onclick="document.getElementById('reportModal')?.remove()">&times;</button>
      </div>
      <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">Chọn lý do báo cáo:</p>
      <div id="reportReasons" class="space-y-2 mb-4">
        ${[
          "Spam",
          "Nội dung giả mạo",
          "Quấy rối / bắt nạt",
          "Nội dung nhạy cảm",
          "Bạo lực",
          "Ngôn từ thù ghét",
          "Thông tin sai lệch",
          "Khác",
        ]
          .map(
            (r, idx) => `
          <label class="flex items-start gap-2 p-3 rounded-lg border dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer">
            <input type="radio" name="reportReason" value="${r}" class="mt-1">
            <span class="text-sm text-gray-700 dark:text-gray-200">${r}</span>
          </label>`
          )
          .join("")}
      </div>
      <textarea id="reportDescription" rows="3" placeholder="Mô tả chi tiết (nếu chọn Khác)" class="w-full p-3 rounded-lg bg-white dark:bg-gray-700 border dark:border-gray-600 dark:text-white mb-4 resize-none"></textarea>
      <button id="submitReportBtn" type="button" class="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold">Gửi báo cáo</button>
    </div>
  `;

  document.body.appendChild(modal);

  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  document.getElementById("submitReportBtn")?.addEventListener("click", async () => {
    const reason = document.querySelector('input[name="reportReason"]:checked')?.value || "";
    const description = document.getElementById("reportDescription")?.value.trim();
    
    if (!reason) {
      showToast("Vui lòng chọn lý do báo cáo", "red");
      return;
    }

    const finalReason =
      reason === "Khác"
        ? description
        : `${reason}${description ? ": " + description : ""}`;
    if (reason === "Khác" && !finalReason) {
      showToast("Vui lòng nhập mô tả", "red");
      return;
    }

    try {
      const res = await authFetch(API.reportPost(postId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: finalReason }),
      });

      if (res.ok) {
        showToast("Đã gửi báo cáo", "green");
        modal.remove();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Không thể gửi báo cáo", "red");
      }
    } catch (err) {
      console.error("Report post error:", err);
      showToast("Lỗi mạng", "red");
    }
  });
}
