# Agent montage vidéo (Reels / TikTok / Shorts)

Outil local qui transforme un lot de rushs bruts (10 Go et plus) en plusieurs vidéos verticales
prêtes à publier : sous-titres animés, accroche, recadrage 9:16, musique, niveau sonore réseaux.
Tu valides et ajustes chaque montage avant le rendu final.

**Le Mac fait le travail lourd, le téléphone sert de télécommande** : depuis le Galaxy (même Wi-Fi),
tu envoies des rushs, tu valides les montages et tu télécharges la vidéo finale dans la galerie.

## Pourquoi une app locale et pas un artifact web

Un artifact tourne dans un navigateur : la mémoire d'un onglet et FFmpeg compilé pour le web
(limité à environ 2 Go par fichier, sans accélération matérielle) ne tiennent pas 10 Go de rushs 4K.
Envoyer 10 Go dans le cloud à chaque chantier coûterait aussi du temps de transfert.
Ici, les rushs restent sur le Mac et sont lus sur place ; seules de petites vignettes et le texte
transcrit partent vers l'API Claude.

## Comment ça marche

```
Rushs (dossier du Mac, disque externe ou envoi depuis le téléphone)
  │  1. FFmpeg lit chaque fichier UNE fois → proxy 960p + son 16 kHz + 1 image/s + coupes de plans
  │  2. Whisper transcrit la parole sur le Mac (mlx-whisper, GPU de la puce M), mot par mot
  │  3. Claude décrit chaque plan (3 vignettes) : contenu, tags, qualité, intérêt, position du sujet
  ▼
Catalogue (plans décrits + paroles horodatées) + ton brief
  │  4. Claude (l'agent monteur) propose N clips : accroche, segments, plans d'illustration, légende
  │  5. Nettoyage automatique : coupes calées sur les mots, silences retirés
  ▼
Validation dans l'interface (ordre, durées, son, illustration, cadrage, textes)
  │  6. Rendu depuis les ORIGINAUX : 1080×1920, sous-titres mot à mot, −14 LUFS, H.264 matériel Apple
  ▼
exports/*.mp4 + légende/hashtags (.txt)
```

Ce qui permet d'encaisser de gros volumes :
- aucun fichier n'est chargé en mémoire ni copié (ajout par dossier) ;
- une seule lecture par rush pour toute l'analyse ;
- le rendu traite les segments un par un puis les assemble sans réencoder la vidéo ;
- l'envoi depuis le téléphone se fait par morceaux de 32 Mo et reprend après une coupure ;
- l'analyse est mémorisée : ajouter des rushs n'oblige pas à tout recommencer.

Testé dans un conteneur Linux sur un fichier 4K de 23,7 Go et sur des rushs horizontaux, verticaux
(rotation de téléphone) et HDR 10 bits (voir « Ce qui a été vérifié » plus bas).

## Installation sur le Mac (une seule fois)

1. Installer [Homebrew](https://brew.sh) si besoin, puis dans le Terminal :
   ```bash
   brew install ffmpeg python@3.12
   ```
2. Créer une clé API sur [console.anthropic.com](https://console.anthropic.com) (menu *API keys*).
3. Double-cliquer sur `video-agent/lancer.command`.
   - Au premier lancement, il installe les dépendances puis ouvre `.env` : colle ta clé après
     `ANTHROPIC_API_KEY=`, enregistre et relance.
   - Si macOS bloque le fichier : clic droit → Ouvrir.
   - Accepte la demande « autoriser les connexions entrantes » (sinon le téléphone ne pourra pas se connecter).
4. Le Terminal affiche deux liens et un QR code. Scanne le QR code avec le téléphone
   et ajoute la page à l'écran d'accueil. Le lien reste le même d'un lancement à l'autre.

Lancement manuel équivalent :
```bash
cd video-agent
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env   # puis renseigner la clé
.venv/bin/python -m app
```

## Utilisation

1. **Rushs** : *Dossier du Mac* (disque externe accepté, sous-dossiers inclus) ou *Envoyer depuis cet appareil*.
   Puis *Analyser*.
2. **Brief** : chantier, ville, ton, appel à l'action, nombre de clips, durée, consignes.
3. **Clips** : *Proposer N montages*. Pour chaque clip : aperçu, réglage des segments (± 0,2 s),
   son on/off, plan d'illustration par-dessus la parole, recadrage gauche/droite ou image entière
   sur fond flouté, textes. Puis *Rendu final* et *Télécharger*.

Musique : dépose des fichiers libres de droits dans `~/VideoAgent/musique` ou via le brief.
Sur un compte professionnel, Instagram et TikTok limitent l'accès aux musiques commerciales :
les sons tendance s'ajoutent dans l'appli au moment de publier.

## Réglages conseillés pour le Galaxy S24 Ultra

- **Format** : 4K 30 i/s ou 1080p 60 i/s. Filmer à la verticale ce qui sera de la parole face caméra ;
  l'horizontal est recadré automatiquement (position du sujet détectée par Claude, ajustable).
- **HDR10+** : géré (conversion en SDR), mais désactiver « Vidéo HDR10+ » dans l'appareil photo
  donne des couleurs plus fidèles et une analyse plus rapide.
- **Transfert vers le Mac** : par la page web (Wi-Fi), ou par câble USB-C avec
  [OpenMTP](https://openmtp.ganeshrvel.com) pour 10 Go et plus (souvent plus rapide et plus fiable).
- **Son** : un micro-cravate améliore nettement la transcription en extérieur (vent, machines).

## Coût

- Transcription, analyse et rendu : sur le Mac, gratuit.
- API Claude : le coût réel de chaque tâche s'affiche à la fin. Ordre de grandeur estimé avec
  Claude Opus 5.5 : environ 1 à 4 $ par lot de 10 Go selon la durée filmée (10 Go ≈ 25 à 30 min
  en 4K, beaucoup plus en 1080p). La part principale est l'analyse des images ; pour la diviser,
  mettre `VISION_MODEL=claude-haiku-5-5` dans `.env` (descriptions moins fines).

## Confidentialité

- Les vidéos ne quittent pas le Mac. Partent vers l'API Claude : vignettes 320 px et texte transcrit.
- Le serveur écoute sur le Wi-Fi local et exige un jeton (présent dans le lien / QR code).
  Ne pas l'utiliser sur un Wi-Fi public.

## Limites actuelles

- Pas de suivi automatique du visage : recadrage fixe par segment (réglable).
- Pas de transitions animées ni d'étalonnage : coupes franches, adaptées aux formats courts.
- Aperçu en basse définition et changement de plan pas toujours fluide sur téléphone ; le rendu final est exact.
- Pas de publication automatique sur Instagram/TikTok : téléchargement puis publication depuis l'appli.

## Ce qui a été vérifié

Dans un conteneur Linux (FFmpeg 6.1, sans GPU Apple, sans clé API ni modèle Whisper) :
analyse d'un fichier 4K de 23,7 Go en 201 s sur 4 cœurs CPU (RAM max : 89 Mo pour l'app,
441 Mo pour FFmpeg) puis rendu d'un clip depuis ce fichier (1,6 Go de RAM max), chaîne analyse → plan → rendu sur rushs de synthèse
(Claude et Whisper simulés), sortie 1080×1920 à la durée exacte prévue, −15 LUFS avec musique,
interface pilotée en format téléphone, envoi interrompu puis repris (fichier identique à l'octet).
Non vérifié ici, à valider au premier lancement sur le Mac : mlx-whisper, l'encodeur matériel Apple,
et les vraies réponses de Claude.

## Structure

```
app/
  media.py       FFmpeg : analyse en une passe, découpe en plans, vignettes
  transcribe.py  Whisper local, mots horodatés, filtre des phrases inventées sur les silences
  analyze.py     Claude vision : description / qualité / position du sujet par plan
  planner.py     Claude monteur : propose les clips ; nettoyage des coupes
  render.py      rendu 9:16 depuis les originaux, assemblage sans réencodage vidéo
  subtitles.py   sous-titres ASS mot à mot + accroche
  server.py      API + envoi par morceaux ; jobs.py file de tâches ; store.py projets
  static/        interface web (Mac et téléphone)
```
Données : `~/VideoAgent/projects/<projet>/` (proxys ≈ quelques % de la taille des rushs, exports).
