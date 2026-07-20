import { authFetch } from "../authenticate/auth.js";
import { API } from "../shared/config.js";
import { showToast } from "../shared/toast.js";

document.addEventListener("DOMContentLoaded", () => {
  const contentTextarea = document.getElementById("supportContent");
  const submitBtn = document.getElementById("submitSupportBtn");

  if (submitBtn && contentTextarea) {
    submitBtn.addEventListener("click", async () => {
      const content = contentTextarea.value.trim();
      
      if (!content) {
        showToast("Vui lòng nhập nội dung yêu cầu hỗ trợ", "red");
        return;
      }

      if (content.length < 10) {
        showToast("Nội dung quá ngắn, vui lòng mô tả chi tiết hơn", "red");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Đang gửi...";

      try {
        const res = await authFetch(API.supportTicket(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        });

        if (res.ok) {
          showToast("Đã gửi yêu cầu hỗ trợ thành công", "green");
          contentTextarea.value = "";
        } else {
          const error = await res.json().catch(() => ({}));
          showToast(error.detail || "Không thể gửi yêu cầu hỗ trợ", "red");
        }
      } catch (err) {
        console.error("Support ticket error:", err);
        showToast("Lỗi mạng, vui lòng thử lại", "red");
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Gửi yêu cầu";
      }
    });
  }
});

