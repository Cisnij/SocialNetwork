/**
 * Safe DOM helpers — prefer textContent over innerHTML for user/API data.
 */

export function el(tag, className = "", attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "text") node.textContent = String(value);
    else if (key === "htmlFor") node.htmlFor = value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, String(value));
  }
  return node;
}

export function textEl(tag, className, text) {
  return el(tag, className, { text: text ?? "" });
}

export function clear(node) {
  node?.replaceChildren();
}

export function img(src, className, alt = "") {
  return el("img", className, { src: src || "", alt });
}
