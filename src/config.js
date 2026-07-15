// URL de base du backend.
// - En dev (npm run dev) : "/api" → redirigé vers localhost:3001 par vite.config.js
// - En prod (GitHub Pages, etc.) : définis VITE_API_URL dans les secrets/variables
//   de build (ex: https://ton-backend.onrender.com), sinon ça pointera vers "/api"
//   sur le même domaine — ce qui ne marchera pas sur un hébergement statique pur.
//
// ⚠️ En Vite, les variables d'environnement client doivent commencer par VITE_
// et se lisent via import.meta.env (PAS process.env, qui n'existe pas dans le navigateur).

export const API_BASE = import.meta.env.VITE_API_URL || "/api";
