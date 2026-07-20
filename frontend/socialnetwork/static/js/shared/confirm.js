/** Simple confirm modal — returns Promise<boolean> */
export function confirmDialog(message, title = "Xác nhận") {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const msg = document.getElementById("confirmModalMessage");
    const titleEl = document.getElementById("confirmModalTitle");
    const ok = document.getElementById("confirmModalOk");
    const cancel = document.getElementById("confirmModalCancel");
    if (!modal) {
      resolve(window.confirm(message));
      return;
    }
    titleEl.textContent = title;
    msg.textContent = message;
    modal.classList.remove("hidden");

    const cleanup = (v) => {
      modal.classList.add("hidden");
      ok.onclick = null;
      cancel.onclick = null;
      resolve(v);
    };
    ok.onclick = () => cleanup(true);
    cancel.onclick = () => cleanup(false);
  });
}

/**
 * Password prompt modal — returns Promise<string | null>
 * @param {string} message
 * @param {string} title
 * @param {object} [options]
 * @param {string} [options.forgotPasswordUrl] — if provided, shows "Quên mật khẩu?" link below input
 */
export function passwordPrompt(message, title = "Xác nhận mật khẩu", options = {}) {
  const { forgotPasswordUrl } = options;
  return new Promise((resolve) => {
    // Remove existing modal if any
    const existing = document.getElementById("passwordModal");
    if (existing) existing.remove();

    // Create modal container
    const modal = document.createElement("div");
    modal.id = "passwordModal";
    modal.className = "fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4";

    // Create modal content
    const modalContent = document.createElement("div");
    modalContent.className = "bg-white dark:bg-[#242526] rounded-xl w-full max-w-md shadow-xl";

    const modalBody = document.createElement("div");
    modalBody.className = "p-6";

    // Title
    const titleEl = document.createElement("h3");
    titleEl.className = "text-xl font-bold dark:text-[#e4e6eb] mb-2";
    titleEl.textContent = title;

    // Message
    const msgEl = document.createElement("p");
    msgEl.className = "text-sm text-gray-600 dark:text-gray-400 mb-4";
    msgEl.textContent = message;

    // Input container
    const inputContainer = document.createElement("div");
    inputContainer.className = "relative mb-1";

    // Password input
    const input = document.createElement("input");
    input.id = "passwordModalInput";
    input.type = "password";
    input.placeholder = "Nhập mật khẩu";
    input.className = "w-full p-3 pr-10 rounded-lg bg-fb-secondary dark:bg-[#3a3b3c] dark:text-[#e4e6eb] border border-gray-300 dark:border-[#3e4042] focus:outline-none focus:ring-2 focus:ring-fb-primary focus:border-transparent";
    input.autocomplete = "current-password";

    // Toggle password button
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "passwordModalToggle";
    toggleBtn.type = "button";
    toggleBtn.className = "absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200";
    toggleBtn.textContent = "👁️";

    inputContainer.appendChild(input);
    inputContainer.appendChild(toggleBtn);

    // Forgot password link (Task 3) — shown inline below input
    const forgotRow = document.createElement("div");
    forgotRow.className = "flex justify-end mb-3";
    if (forgotPasswordUrl) {
      const forgotLink = document.createElement("a");
      forgotLink.href = forgotPasswordUrl;
      forgotLink.className = "text-xs text-fb-primary dark:text-[#1877f2] hover:underline font-medium";
      forgotLink.textContent = "Quên mật khẩu?";
      forgotRow.appendChild(forgotLink);
    }

    // Error message
    const errorEl = document.createElement("div");
    errorEl.id = "passwordModalError";
    errorEl.className = "text-sm text-red-500 mb-4 hidden";

    // Button container
    const btnContainer = document.createElement("div");
    btnContainer.className = "flex gap-3 justify-end";

    // Cancel button
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "px-4 py-2 rounded-lg bg-gray-200 dark:bg-[#3a3b3c] text-gray-900 dark:text-[#e4e6eb] font-semibold hover:opacity-90";
    cancelBtn.textContent = "Hủy";

    // OK button
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "px-4 py-2 rounded-lg bg-fb-primary dark:bg-[#1877f2] text-white font-semibold hover:bg-fb-primary-hover dark:hover:bg-[#166fe5]";
    okBtn.textContent = "Xác nhận";

    // Assemble elements
    modalBody.appendChild(titleEl);
    modalBody.appendChild(msgEl);
    modalBody.appendChild(inputContainer);
    modalBody.appendChild(forgotRow);
    modalBody.appendChild(errorEl);
    btnContainer.appendChild(cancelBtn);
    btnContainer.appendChild(okBtn);
    modalBody.appendChild(btnContainer);
    modalContent.appendChild(modalBody);
    modal.appendChild(modalContent);
    document.body.appendChild(modal);

    // Toggle password visibility
    toggleBtn.onclick = () => {
      const type = input.type === "password" ? "text" : "password";
      input.type = type;
      toggleBtn.textContent = type === "password" ? "👁️" : "🙈";
    };

    // Handle submit
    const cleanup = (result) => {
      modal.remove();
      resolve(result);
    };

    const handleSubmit = () => {
      const password = input.value.trim();
      if (!password) {
        errorEl.textContent = "Vui lòng nhập mật khẩu";
        errorEl.classList.remove("hidden");
        input.focus();
        return;
      }
      cleanup(password);
    };

    okBtn.onclick = handleSubmit;
    cancelBtn.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter") handleSubmit();
      if (e.key === "Escape") cleanup(null);
    };

    // Focus input after modal is shown
    setTimeout(() => input.focus(), 100);
  });
}
