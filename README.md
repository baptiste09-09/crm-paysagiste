# Carnet Paysagiste — app autonome

Ancien artefact Claude.ai converti en vraie app React (Vite) + petit backend Express.

## Ce qui a changé par rapport au fichier original

- `window.storage` → remplacé par `src/storage.js` (localStorage, même interface `get/set/delete`).
- L'appel direct à `api.anthropic.com` depuis le navigateur → supprimé. La clé API n'a plus
  aucune raison d'exister côté client. Le frontend appelle désormais `/api/extract-client`,
  et c'est `server/index.js` qui détient la clé et interroge Anthropic.
- Bugs de code PIN (fermeture React périmée sur la validation à 6 chiffres, écran bloqué
  après "Code oublié") corrigés.
- `loadData()` : la lecture de `clients` et `tasks` est maintenant isolée clé par clé, une
  erreur sur l'une n'efface plus les données correctement chargées de l'autre.
- Dates codées en dur ("2026-07-13") remplacées par la date réelle du jour (`src/utils/date.js`).
- Le calendrier mensuel démarre sur le mois courant et se navigue (avant fixé sur juillet 2026).
- `formatDate` ne plante plus sur une valeur vide.

## Installation

Deux parties à installer séparément : le frontend (racine) et le backend (`server/`).

```bash
# 1. Frontend
npm install

# 2. Backend
cd server
npm install
cp .env.example .env
# puis ouvre server/.env et colle ta clé Anthropic (ANTHROPIC_API_KEY=...)
cd ..
```

## Lancer en développement

Il faut deux terminaux ouverts en parallèle :

```bash
# Terminal 1 — backend (port 3001)
cd server
npm start

# Terminal 2 — frontend (port 5173)
npm run dev
```

Ouvre http://localhost:5173 — Vite redirige automatiquement les appels `/api/*` vers le
backend (voir `vite.config.js`).

## Build production

```bash
npm run build
```

Génère `dist/`. Pour la mise en prod, sers ces fichiers statiques (ex. Nginx, Vercel, Netlify)
et déploie `server/` séparément (ou en tant que fonction serverless) avec `ANTHROPIC_API_KEY`
définie dans les variables d'environnement de l'hébergeur — jamais dans le code du frontend.

## Déploiement (GitHub + Vercel + Render)

Le dépôt git est déjà initialisé avec un premier commit. Pour déployer :

```bash
git remote add origin https://github.com/TON-PSEUDO/crm-paysagiste.git
git push -u origin main
```

Puis :
- **Backend** → importe le repo sur [Render](https://render.com), Root Directory `server`,
  Build `npm install`, Start `npm start`, variable d'env `ANTHROPIC_API_KEY`.
- **Frontend** → importe le repo sur [Vercel](https://vercel.com), Framework `Vite`,
  variable d'env `VITE_API_URL` = URL Render + `/api`.

Détails complets dans `DEPLOY_GITHUB.md` (fourni séparément).

## Synchroniser entre plusieurs appareils

Un bouton **"Synchroniser"** est disponible dans le menu latéral.

1. La première fois, choisis une **phrase secrète** (6 caractères min.) — la même sur
   tous tes appareils (téléphone, ordinateur...).
2. Clique "Synchroniser" sur un appareil : ça envoie tes données (chiffrées avec
   cette phrase) vers le backend.
3. Sur l'autre appareil, configure la **même phrase**, puis clique "Synchroniser" :
   comme les données distantes sont plus récentes, l'app te propose de les récupérer.
4. Ensuite, clique "Synchroniser" après chaque session pour garder les deux appareils à jour.

**Comment ça marche :** le serveur ne stocke qu'un blob chiffré, indexé par un hash
de ta phrase secrète — il ne voit jamais tes données en clair, ni la phrase elle-même.
La synchro compare simplement "quel appareil a été modifié le plus récemment" :
pas de fusion automatique intelligente. Si tu modifies les deux appareils sans
synchroniser entre les deux, les modifications les plus anciennes seront écrasées.
→ Prends l'habitude de synchroniser avant et après chaque session.

⚠️ Sur le plan gratuit de Render, le fichier de stockage de synchro n'est pas
garanti persistant sur le long terme (peut être remis à zéro lors d'un redéploiement).
Pour un usage sérieux et durable, remplacer `server/sync-store.json` par une vraie
base de données (Postgres, Redis, etc.).

## Limites connues

- Le stockage utilise `localStorage` (limite ~5-10 Mo selon les navigateurs). Pour un usage
  intensif ou beaucoup de clients/photos, migrer vers IndexedDB serait plus robuste.
- Le PIN chiffre les données uniquement sur l'appareil : s'il est oublié, les données
  existantes ne sont pas récupérables (comportement voulu, pas un bug).
- L'import IA ne lit que du texte collé ou des fichiers `.txt` ; le PDF n'est pas branché.
