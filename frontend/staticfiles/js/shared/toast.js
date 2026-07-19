/** Global toast — used by posts, edit, create post, etc. */
export function showToast(message, color = "green") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `fixed bottom-5 right-5 bg-${color}-500 text-white px-4 py-3 rounded shadow-lg z-[60] transition-opacity duration-300`;
  toast.classList.remove("hidden", "opacity-0");

  setTimeout(() => {
    toast.classList.add("opacity-0");
    setTimeout(() => toast.classList.add("hidden"), 300);
  }, 3000);
}
