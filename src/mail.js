import { API_BASE } from "./config";

export async function fetchInboxApi(limit = 25) {
  const res = await fetch(`${API_BASE}/mail/inbox?limit=${limit}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "inbox-failed");
  return res.json();
}

export async function fetchMessageApi(uid) {
  const res = await fetch(`${API_BASE}/mail/message/${uid}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "message-failed");
  return res.json();
}

export async function extractFromMailApi(uid) {
  const res = await fetch(`${API_BASE}/mail/extract/${uid}`, { method: "POST" });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "extract-failed");
  return res.json();
}

export async function sendMailApi({ to, subject, text }) {
  const res = await fetch(`${API_BASE}/mail/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to, subject, text }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "send-failed");
  return res.json();
}
