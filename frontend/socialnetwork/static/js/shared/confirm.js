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
