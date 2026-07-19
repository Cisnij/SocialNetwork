import { authFetch } from "../authenticate/auth.js";
import { API } from "./config.js";

/**
 * POST multipart files to chat upload endpoint.
 * Backend: field name `files`, response `{ attachments: [...] }`.
 */
export async function uploadChatFiles(convId, fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return [];

  const fd = new FormData();
  for (const f of files) fd.append("files", f);

  const res = await authFetch(API.chatUpload(convId), {
    method: "POST",
    body: fd,
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || body.detail || "Upload thất bại");
  }

  const attachments = body.attachments;
  if (!Array.isArray(attachments)) {
    throw new Error("Phản hồi upload không hợp lệ");
  }

  return attachments
    .map((a) => a.id ?? a.attachment_id)
    .filter((id) => id != null);
}

/**
 * Send message over WebSocket (text and/or attachments).
 * Matches ChatConsumer.save_message contract.
 */
export function sendChatWsMessage(ws, { text = "", attachmentIds = [] } = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket chưa kết nối");
  }
  const ids = attachmentIds.filter((id) => id != null);
  const trimmed = String(text || "").trim();
  if (!trimmed && !ids.length) {
    throw new Error("Tin nhắn trống");
  }

  ws.send(
    JSON.stringify({
      message: trimmed,
      message_type: ids.length ? "file" : "text",
      attachment_ids: ids,
    })
  );
}
