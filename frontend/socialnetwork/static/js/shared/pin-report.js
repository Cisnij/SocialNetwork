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

// ========= REPORT MODAL — FB-style beautiful (Task 8) =========
export function showReportModal(id, type = "post") {
  // Remove existing if any
  document.getElementById("reportModal")?.remove();

  // Inject animation style once
  if (!document.getElementById("reportModalStyle")) {
    const s = document.createElement("style");
    s.id = "reportModalStyle";
    s.textContent = `
      @keyframes reportFadeIn {
        from { opacity: 0; transform: scale(.95) translateY(8px); }
        to   { opacity: 1; transform: scale(1)  translateY(0); }
      }
      .report-animate { animation: reportFadeIn .18s ease-out; }
      .report-option input:checked ~ .report-check-ring { border-color: #1877f2; }
      .report-option input:checked ~ .report-check-ring::after {
        content: ''; display: block; width: 10px; height: 10px;
        border-radius: 50%; background: #1877f2; margin: 3px;
      }
      .report-option:has(input:checked) {
        border-color: #1877f2;
        background: rgba(24,119,242,0.06);
      }
    `;
    document.head.appendChild(s);
  }

  const REASONS = [
    { icon: "🔞", label: "Nội dung người lớn / nhạy cảm" },
    { icon: "😤", label: "Quấy rối / bắt nạt" },
    { icon: "💬", label: "Spam hoặc lừa đảo" },
    { icon: "🤥", label: "Thông tin sai lệch" },
    { icon: "⚔️", label: "Bạo lực / gây thù hận" },
    { icon: "🏷️", label: "Vi phạm bản quyền" },
    { icon: "🤬", label: "Ngôn từ thù ghét / phân biệt" },
    { icon: "✏️", label: "Khác (tự điền)" },
  ];

  const overlay = document.createElement("div");
  overlay.id = "reportModal";
  overlay.className = "fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4";

  const card = document.createElement("div");
  card.className = "report-animate bg-white dark:bg-[#242526] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden";

  // ---- Header ----
  const header = document.createElement("div");
  header.className = "flex items-center justify-between px-5 py-4 border-b dark:border-[#3e4042]";
  const modalTitle = type === "post" ? "🚩 Báo cáo bài viết" : "🚩 Báo cáo bình luận";
  header.innerHTML = `
    <div>
      <h2 class="text-base font-bold dark:text-white flex items-center gap-2">${modalTitle}</h2>
      <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Giúp chúng tôi hiểu vấn đề bạn gặp phải</p>
    </div>
    <button type="button" id="closeReportModal"
      class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 dark:bg-[#3a3b3c]
             text-gray-700 dark:text-[#e4e6eb] hover:bg-gray-200 dark:hover:bg-[#4e4f50] text-xl font-bold transition">
      ×
    </button>
  `;

  // ---- Reasons list ----
  const reasonsWrap = document.createElement("div");
  reasonsWrap.className = "px-5 py-3 space-y-2 max-h-[50vh] overflow-y-auto";

  let selectedLabel = "";
  let isCustom = false;

  REASONS.forEach(({ icon, label }) => {
    const opt = document.createElement("label");
    opt.className =
      "report-option flex items-center gap-3 p-3 rounded-xl border-2 border-transparent " +
      "dark:border-transparent cursor-pointer transition-all " +
      "hover:bg-gray-50 dark:hover:bg-[#3a3b3c]";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "reportReason";
    radio.value = label;
    radio.className = "sr-only";

    const checkRing = document.createElement("span");
    checkRing.className =
      "report-check-ring w-5 h-5 rounded-full border-2 border-gray-300 dark:border-[#4e4f50] flex-shrink-0 transition-colors";

    const iconEl = document.createElement("span");
    iconEl.className = "text-xl flex-shrink-0";
    iconEl.textContent = icon;

    const labelText = document.createElement("span");
    labelText.className = "text-sm font-medium text-gray-800 dark:text-[#e4e6eb] flex-1";
    labelText.textContent = label;

    opt.append(radio, checkRing, iconEl, labelText);
    reasonsWrap.appendChild(opt);

    radio.addEventListener("change", () => {
      selectedLabel = label;
      isCustom = label.startsWith("Khác");
      customWrap.classList.toggle("hidden", !isCustom);
      submitBtn.disabled = isCustom ? !customInput.value.trim() : false;
      // Visual border update
      reasonsWrap.querySelectorAll(".report-option").forEach((o) => {
        o.style.borderColor = "";
        o.style.background = "";
      });
      opt.style.borderColor = "#1877f2";
      opt.style.background = "rgba(24,119,242,0.06)";
      checkRing.style.borderColor = "#1877f2";
      // Filled dot
      checkRing.innerHTML = '<span style="display:block;width:10px;height:10px;border-radius:50%;background:#1877f2;margin:3px auto"></span>';
    });
  });

  // ---- Custom textarea (only for "Khác") ----
  const customWrap = document.createElement("div");
  customWrap.className = "hidden px-5 pb-2";

  const customInput = document.createElement("textarea");
  customInput.rows = 3;
  customInput.maxLength = 500;
  customInput.placeholder = "Mô tả chi tiết lý do báo cáo của bạn...";
  customInput.className =
    "w-full p-3 rounded-xl bg-gray-50 dark:bg-[#3a3b3c] border border-gray-200 " +
    "dark:border-[#4e4f50] dark:text-[#e4e6eb] text-sm resize-none " +
    "focus:outline-none focus:ring-2 focus:ring-[#1877f2]";

  const charCount = document.createElement("p");
  charCount.className = "text-right text-xs text-gray-400 mt-1";
  charCount.textContent = "0/500";

  customInput.addEventListener("input", () => {
    const len = customInput.value.length;
    charCount.textContent = `${len}/500`;
    submitBtn.disabled = !customInput.value.trim();
  });

  customWrap.append(customInput, charCount);

  // ---- Footer ----
  const footer = document.createElement("div");
  footer.className = "px-5 py-4 border-t dark:border-[#3e4042] flex justify-end gap-3";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className =
    "px-5 py-2 rounded-lg bg-gray-100 dark:bg-[#3a3b3c] text-gray-700 dark:text-[#e4e6eb] " +
    "font-semibold text-sm hover:bg-gray-200 dark:hover:bg-[#4e4f50] transition";
  cancelBtn.textContent = "Hủy";

  const submitBtn = document.createElement("button");
  submitBtn.type = "button";
  submitBtn.className =
    "px-5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-sm " +
    "transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2";
  submitBtn.textContent = "Gửi báo cáo";
  submitBtn.disabled = true;

  footer.append(cancelBtn, submitBtn);

  // ---- Assemble ----
  card.append(header, reasonsWrap, customWrap, footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // ---- Close logic ----
  const closeModal = () => overlay.remove();
  overlay.querySelector("#closeReportModal")?.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  // ---- Submit logic ----
  submitBtn.addEventListener("click", async () => {
    if (!selectedLabel) return;

    const finalReason = isCustom
      ? (customInput.value.trim() || selectedLabel)
      : selectedLabel;

    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <svg class="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" opacity=".25"/>
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
      </svg>
      Đang gửi...
    `;

    try {
      const endpoint = type === "post" ? API.reportPost(id) : API.reportComment(id);
      const res = await authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: finalReason }),
      });

      if (res.ok) {
        showToast("✅ Đã gửi báo cáo. Cảm ơn bạn!", "green");
        closeModal();
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || "Không thể gửi báo cáo", "red");
        submitBtn.disabled = false;
        submitBtn.textContent = "Gửi báo cáo";
      }
    } catch (err) {
      console.error("Report post error:", err);
      showToast("Lỗi mạng", "red");
      submitBtn.disabled = false;
      submitBtn.textContent = "Gửi báo cáo";
    }
  });
}
