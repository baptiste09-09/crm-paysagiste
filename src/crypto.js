// ---- Chiffrement local (Web Crypto API) ----
// Le PIN de l'utilisateur dérive une clé AES-256-GCM (PBKDF2, 100k itérations).
// La clé n'est JAMAIS stockée : elle vit en mémoire (state React) le temps de la session.
// Si le PIN est perdu, les données chiffrées ne sont PAS récupérables (comportement voulu).

function bufToB64(buf) {
  // Conversion par blocs : String.fromCharCode(...) plante (RangeError) au-delà
  // de ~100 Ko à cause de la limite d'arguments de la pile JavaScript.
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000; // 32 Ko
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

export async function deriveKey(pin, saltB64) {
  const enc = new TextEncoder();
  const salt = saltB64 ? b64ToBuf(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  return { key, saltB64: saltB64 || bufToB64(salt) };
}

export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(obj)));
  return JSON.stringify({ iv: bufToB64(iv), data: bufToB64(ciphertext) });
}

export async function decryptJSON(key, payload) {
  const { iv, data } = JSON.parse(payload);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBuf(iv) }, key, b64ToBuf(data));
  return JSON.parse(new TextDecoder().decode(plain));
}
