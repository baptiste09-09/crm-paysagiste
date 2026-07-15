import { deriveKey, encryptJSON, decryptJSON } from "./crypto";
import { API_BASE } from "./config";

// Le "code de synchronisation" est une phrase choisie par l'utilisateur, connue
// uniquement de ses appareils. Elle sert à :
//  1. calculer un identifiant opaque (hash) sous lequel le serveur range le blob
//  2. dériver une clé de chiffrement AES-256-GCM pour le contenu
// Le serveur ne voit jamais le code en clair, ni les données en clair.

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const hashBuf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getKeyId(code) {
  // Préfixe pour éviter toute collision avec d'autres usages futurs du même hash.
  return sha256Hex(`crm-paysagiste-sync::${code}`);
}

async function pullRaw(keyId) {
  const res = await fetch(`${API_BASE}/sync/pull?keyId=${encodeURIComponent(keyId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("sync-pull-failed");
  return res.json(); // { saltB64, blob, lastModified }
}

export async function pullSync(code) {
  const keyId = await getKeyId(code);
  const raw = await pullRaw(keyId);
  if (!raw) return null;
  const { key } = await deriveKey(code, raw.saltB64);
  const data = await decryptJSON(key, raw.blob);
  return { data, lastModified: raw.lastModified };
}

export async function pushSync(code, payload) {
  const keyId = await getKeyId(code);
  // Réutilise le même sel que la synchro précédente si elle existe, pour dériver
  // systématiquement la même clé à partir du même code.
  const existing = await pullRaw(keyId).catch(() => null);
  const { key, saltB64 } = await deriveKey(code, existing?.saltB64 || null);
  const blob = await encryptJSON(key, payload);
  const res = await fetch(`${API_BASE}/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyId, saltB64, blob, lastModified: payload.lastModified }),
  });
  if (!res.ok) throw new Error("sync-push-failed");
  return res.json();
}
