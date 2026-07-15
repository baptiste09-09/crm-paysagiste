import "dotenv/config";
import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

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

app.post("/api/extract-client", async (req, res) => {
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY manquante côté serveur (voir server/.env)" });
  }
  const text = (req.body?.text || "").toString().slice(0, 6000);
  if (!text.trim()) {
    return res.status(400).json({ error: "Texte vide" });
  }

  try {
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
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      console.error("Anthropic API error:", anthropicResponse.status, errText);
      return res.status(502).json({ error: "Échec de l'appel à l'API Anthropic" });
    }

    const data = await anthropicResponse.json();
    const raw = (data.content || []).map((b) => b.text || "").join("").trim();
    const cleaned = raw.replace(/^```json\s*|^```\s*|```$/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({ error: "Réponse IA non exploitable" });
    }

    return res.json(parsed);
  } catch (e) {
    console.error("Erreur extraction:", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Backend CRM Paysagiste sur http://localhost:${PORT}`);
  if (!ANTHROPIC_API_KEY) {
    console.warn("⚠️  ANTHROPIC_API_KEY n'est pas définie — copie server/.env.example en server/.env et renseigne ta clé.");
  }
});
