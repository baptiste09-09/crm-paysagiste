import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { mailConfigured, fetchInbox, fetchMessage, sendMail } from "./mail.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ---- Stockage de sync : simple fichier JSON local. ----
// Le serveur ne voit que des identifiants opaques (hash du code) et des blobs
// chiffrés — jamais le code de synchro en clair, jamais les données en clair.
// ⚠️ Sur Render (plan gratuit), le disque n'est pas garanti persistant entre
// redéploiements. Pour un usage sérieux, remplacer par une vraie base de données.
const SYNC_STORE_PATH = path.join(process.cwd(), "sync-store.json");

function readSyncStore() {
  try {
    return JSON.parse(fs.readFileSync(SYNC_STORE_PATH, "utf8"));
  } catch (e) {
    return {};
  }
}

function writeSyncStore(store) {
  try {
    fs.writeFileSync(SYNC_STORE_PATH, JSON.stringify(store));
  } catch (e) {
    console.error("Erreur écriture sync-store:", e);
  }
}

app.post("/api/sync/push", (req, res) => {
  const { keyId, saltB64, blob, lastModified } = req.body || {};
  if (!keyId || !blob || !saltB64) {
    return res.status(400).json({ error: "Requête invalide" });
  }
  const store = readSyncStore();
  store[keyId] = { saltB64, blob, lastModified: lastModified || Date.now() };
  writeSyncStore(store);
  res.json({ ok: true, lastModified: store[keyId].lastModified });
});

app.get("/api/sync/pull", (req, res) => {
  const { keyId } = req.query;
  if (!keyId) return res.status(400).json({ error: "keyId manquant" });
  const store = readSyncStore();
  const entry = store[keyId];
  if (!entry) return res.status(404).json({ error: "Aucune donnée synchronisée pour ce code" });
  res.json(entry);
});

const EXTRACTION_SYSTEM_PROMPT = `Tu extrais des informations client à partir d'un email reçu par une entreprise de paysagiste.
Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown, au format exact suivant :
{"name": "...", "address": "...", "phone": "...", "email": "...", "gardenType": "...", "status": "prospect", "notes": "...", "requestsContact": false}
- "name": nom de la personne ou de l'organisation qui écrit.
- "address": adresse postale si mentionnée, sinon chaîne vide.
- "phone": numéro de téléphone si mentionné, sinon chaîne vide.
- "email": adresse email de l'expéditeur si identifiable, sinon chaîne vide.
- "gardenType": description brève du type de jardin/espace et de la demande (ex: "Terrasse 30m², demande de devis élagage").
- "status": toujours "prospect" sauf si le texte indique clairement une relation client déjà active.
- "notes": résumé en une ou deux phrases de la demande ou des informations utiles (accès, disponibilités, contraintes).
- "requestsContact": true UNIQUEMENT si l'expéditeur demande explicitement à être rappelé, recontacté, ou à avoir un échange téléphonique/rendez-vous. false sinon.
Si une information est absente, mets une chaîne vide "". Ne rien inventer.`;

// Fonction partagée : envoie un texte brut à Claude et récupère le JSON extrait.
// Utilisée par /api/extract-client (copier-coller) ET /api/mail/extract/:uid (email direct).
async function callExtraction(text) {
  if (!ANTHROPIC_API_KEY) {
    throw Object.assign(new Error("ANTHROPIC_API_KEY manquante côté serveur (voir server/.env)"), { status: 500 });
  }
  const trimmed = (text || "").toString().slice(0, 6000);
  if (!trimmed.trim()) {
    throw Object.assign(new Error("Texte vide"), { status: 400 });
  }

  const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: "user", content: trimmed }],
    }),
  });

  if (!anthropicResponse.ok) {
    const errText = await anthropicResponse.text();
    console.error("Anthropic API error:", anthropicResponse.status, errText);
    throw Object.assign(new Error("Échec de l'appel à l'API Anthropic"), { status: 502 });
  }

  const data = await anthropicResponse.json();
  const raw = (data.content || []).map((b) => b.text || "").join("").trim();
  const cleaned = raw.replace(/^```json\s*|^```\s*|```$/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw Object.assign(new Error("Réponse IA non exploitable"), { status: 502 });
  }
}

app.post("/api/extract-client", async (req, res) => {
  try {
    const parsed = await callExtraction(req.body?.text);
    res.json(parsed);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// ---- Mail (boîte OVH Zimbra via IMAP/SMTP) ----

app.get("/api/mail/inbox", async (req, res) => {
  if (!mailConfigured()) {
    return res.status(500).json({ error: "Compte mail non configuré côté serveur (voir server/.env)" });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const messages = await fetchInbox(limit);
    res.json({ messages });
  } catch (e) {
    console.error("Erreur inbox:", e);
    res.status(502).json({ error: "Impossible de récupérer les emails (vérifie les identifiants et le serveur IMAP)" });
  }
});

app.get("/api/mail/message/:uid", async (req, res) => {
  if (!mailConfigured()) {
    return res.status(500).json({ error: "Compte mail non configuré côté serveur (voir server/.env)" });
  }
  try {
    const msg = await fetchMessage(req.params.uid);
    if (!msg) return res.status(404).json({ error: "Message introuvable" });
    res.json(msg);
  } catch (e) {
    console.error("Erreur message:", e);
    res.status(502).json({ error: "Impossible de récupérer ce message" });
  }
});

app.post("/api/mail/send", async (req, res) => {
  if (!mailConfigured()) {
    return res.status(500).json({ error: "Compte mail non configuré côté serveur (voir server/.env)" });
  }
  const { to, subject, text } = req.body || {};
  if (!to || !subject || !text) return res.status(400).json({ error: "Champs manquants (to, subject, text)" });
  try {
    await sendMail({ to, subject, text });
    res.json({ ok: true });
  } catch (e) {
    console.error("Erreur envoi:", e);
    res.status(502).json({ error: "Échec de l'envoi (vérifie les identifiants et le serveur SMTP)" });
  }
});

// Raccourci : extrait directement un client à partir d'un email de la boîte de réception
// (évite le copier-coller — réutilise la même extraction IA que /api/extract-client).
app.post("/api/mail/extract/:uid", async (req, res) => {
  if (!mailConfigured()) {
    return res.status(500).json({ error: "Compte mail non configuré côté serveur (voir server/.env)" });
  }
  try {
    const msg = await fetchMessage(req.params.uid);
    if (!msg) return res.status(404).json({ error: "Message introuvable" });
    const parsed = await callExtraction(msg.text);
    if (!parsed.email && msg.from) {
      const match = msg.from.match(/<(.+)>/);
      parsed.email = match ? match[1] : msg.from;
    }
    res.json(parsed);
  } catch (e) {
    console.error("Erreur extraction mail:", e);
    res.status(e.status || 500).json({ error: e.message || "Erreur serveur" });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend CRM Paysagiste sur http://localhost:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY n'est pas définie — copie server/.env.example en server/.env et renseigne ta clé.");
  }
  if (!mailConfigured()) {
    console.warn("⚠️  Compte mail non configuré — le module Mail sera indisponible tant que server/.env n'est pas complété.");
  }
});
