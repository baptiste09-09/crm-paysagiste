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

**Appairage (une seule fois) :**
1. Sur le premier appareil : "Synchroniser" → "Premier appareil : générer un code" → un QR code apparaît.
2. Sur le second appareil : "Synchroniser" → "Scanner le code d'un autre appareil" → vise le QR
   avec la caméra (ou saisis le code affiché manuellement si pas de caméra).
3. C'est tout — le code (aléatoire, jamais un mot de passe à inventer) est enregistré sur les deux appareils.

**Ensuite, c'est automatique :**
- Chaque modification est poussée silencieusement vers le serveur quelques secondes après.
- Chaque appareil vérifie toutes les 20s si l'autre a des données plus récentes ; si oui, un
  bandeau discret propose "Actualiser" (jamais d'écrasement automatique sans confirmation).
- Le bouton "Synchroniser" reste utile pour forcer une vérification immédiate.

**Sécurité :** le serveur ne stocke qu'un blob chiffré, indexé par un hash du code — il ne voit
jamais le code en clair ni tes données. Le code d'appairage se transmet uniquement via QR/saisie
manuelle entre tes appareils, jamais par le réseau.

**Limite :** pas de fusion intelligente champ par champ — c'est "la version la plus récente gagne"
au niveau de l'ensemble des données. Une modification faite sur un appareil non synchronisé
depuis longtemps peut être écrasée si l'autre appareil a modifié entre-temps.

⚠️ Le scan de QR code nécessite HTTPS (ou localhost) pour accéder à la caméra — fonctionne
automatiquement une fois déployé sur Vercel, ou en local sur `localhost`.

⚠️ Sur le plan gratuit de Render, le fichier de stockage de synchro n'est pas
garanti persistant sur le long terme (peut être remis à zéro lors d'un redéploiement).
Pour un usage sérieux et durable, remplacer `server/sync-store.json` par une vraie
base de données (Postgres, Redis, etc.).

## Boîte mail pro (OVH Zimbra)

Un onglet **"Boîte mail"** permet de consulter les emails reçus, répondre, et surtout
créer un client en un clic directement depuis un email (plus besoin de copier-coller).

**Configuration (server/.env) :**
```
MAIL_IMAP_HOST=ssl0.ovh.net
MAIL_IMAP_PORT=993
MAIL_SMTP_HOST=ssl0.ovh.net
MAIL_SMTP_PORT=465
MAIL_USER=contact@tondomaine.fr
MAIL_PASSWORD=le-mot-de-passe-de-cette-boite-mail
```
Ce sont les paramètres officiels OVH (identiques pour Zimbra Starter/Pro et MX Plan).
Si `ssl0.ovh.net` ne fonctionne pas pour ton compte, vérifie l'adresse exacte dans
l'espace client OVHcloud → Web Cloud → Zimbra Mail → [ton compte] → Configuration.

**Comment ça marche :**
- Lecture : le backend se connecte en IMAP (lecture seule) à chaque appel — aucune
  connexion permanente maintenue.
- Envoi : SMTP via `nodemailer`, avec authentification.
- "Créer un client à partir de cet email" : envoie le texte de l'email à la même IA
  que le bouton "Créer via l'IA", pré-remplit une fiche client.
- Les identifiants mail restent uniquement dans `server/.env`, jamais dans le frontend.

⚠️ Si ton mot de passe de boîte mail contient des caractères spéciaux, encadre-le de
guillemets dans `.env` si besoin. Certains fournisseurs recommandent un mot de passe
d'application dédié plutôt que le mot de passe principal du compte — vérifie les
options de sécurité dans l'espace client OVHcloud si disponible pour ton offre.

## Limites connues

- Le stockage utilise `localStorage` (limite ~5-10 Mo selon les navigateurs). Pour un usage
  intensif ou beaucoup de clients/photos, migrer vers IndexedDB serait plus robuste.
- Le PIN chiffre les données uniquement sur l'appareil : s'il est oublié, les données
  existantes ne sont pas récupérables (comportement voulu, pas un bug).
- L'import IA ne lit que du texte collé ou des fichiers `.txt` ; le PDF n'est pas branché.
