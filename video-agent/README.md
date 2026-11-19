# Agent montage vidéo (Reels / TikTok / Shorts)

Outil local qui transforme un lot de rushs bruts (10 Go et plus) en plusieurs vidéos verticales
prêtes à publier : sous-titres animés, accroche, recadrage 9:16, musique, niveau sonore réseaux.
Tu valides et ajustes chaque montage avant le rendu final.

**Gratuit et open source par défaut** : FFmpeg, Whisper et des modèles d'IA open source (Qwen, via
Ollama) tournent sur le Mac. Aucun abonnement, aucune clé API. Claude reste disponible en option payante.

**Le Mac fait le travail lourd, le téléphone sert de télécommande** : depuis le Galaxy (même Wi-Fi),
tu envoies des rushs, tu valides les montages et tu télécharges la vidéo finale dans la galerie.

## Pourquoi une app locale et pas un artifact web

Un artifact tourne dans un navigateur : la mémoire d'un onglet et FFmpeg compilé pour le web
(limité à environ 2 Go par fichier, sans accélération matérielle) ne tiennent pas 10 Go de rushs 4K.
Envoyer 10 Go dans le cloud à chaque chantier coûterait aussi du temps de transfert.
Ici, les rushs restent sur le Mac et sont lus sur place. Avec l'IA locale (par défaut), rien ne part
sur Internet ; avec l'option Claude, seules de petites vignettes et le texte transcrit sont envoyés.

## Comment ça marche

```
Rushs vidéo + voix off (dossier du Mac, disque externe ou envoi depuis le téléphone)
  │  1. FFmpeg lit chaque fichier UNE fois → proxy 960p + son 16 kHz + 1 image/s + coupes de plans
  │  2. Whisper transcrit la parole sur le Mac (mlx-whisper, GPU de la puce M), mot par mot,
  │     celle filmée sur le chantier comme celle des voix off enregistrées à part
  │  3. L'IA décrit chaque plan (3 vignettes) : contenu, tags, qualité, intérêt, position du sujet
  ▼
Catalogue (plans décrits + paroles horodatées) + ton brief
  │  4. L'IA (l'agent monteur) propose N clips : accroche, segments, plans d'illustration, légende
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
   brew install ffmpeg python@3.12 ollama
   brew services start ollama
   ```
2. Double-cliquer sur `video-agent/lancer.command`. Au premier lancement, il installe tout seul :
   - les dépendances Python ;
   - les modèles d'IA open source (une seule fois, environ 11 Go : `qwen2.5vl:7b` ≈ 6 Go pour les
     images et `qwen2.5:7b` ≈ 5 Go pour le montage ; `qwen2.5:14b` ≈ 9 Go si le Mac a 32 Go de RAM) ;
   - le modèle de transcription Whisper (≈ 1,5 Go, à la première analyse).

   Si macOS bloque le fichier : clic droit → Ouvrir, ou Réglages → Confidentialité et sécurité →
   « Ouvrir quand même ». Accepte la demande « autoriser les connexions entrantes » (sinon le
   téléphone ne pourra pas se connecter).
3. Le Terminal affiche deux liens et un QR code. Scanne le QR code avec le téléphone
   et ajoute la page à l'écran d'accueil. Le lien reste le même d'un lancement à l'autre.

Lancement manuel équivalent :
```bash
cd video-agent
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
ollama pull qwen2.5vl:7b && ollama pull qwen2.5:7b
.venv/bin/python -m app
```

## Utilisation

1. **Rushs** : *Dossier du Mac* (disque externe accepté, sous-dossiers inclus) ou *Envoyer vidéos / voix off*.
   Les fichiers son (.m4a, .mp3, .wav…) sont traités comme des voix off (V01, V02…).
   Puis *Analyser*.
2. **Brief** : chantier, ville, ton, appel à l'action, nombre de clips, durée, consignes.
3. **Clips** : *Proposer N montages*. Pour chaque clip : aperçu, réglage des segments (± 0,2 s),
   son on/off, plan d'illustration par-dessus la parole, recadrage gauche/droite ou image entière
   sur fond flouté, textes. Puis *Rendu final* et *Télécharger*.

### Ta voix : sur le chantier ou en voix off

- **Parole filmée** : l'agent garde les meilleures phrases, coupe les hésitations et peut couvrir ta voix
  avec des plans de chantier pour garder du mouvement à l'écran.
- **Voix off** (dictaphone du S24, fichier son) : l'agent pose les images sur ta voix et change de plan
  dans les pauses, sans couper un mot. Chaque passage de voix off a forcément une image ; si l'agent
  n'en a pas choisi, il prend le meilleur plan disponible, que tu peux changer.
- Les deux peuvent se mélanger dans un même clip. Les sous-titres suivent les deux.
- Conseil voix off : enregistre au calme (la voiture fait une bonne cabine), téléphone à 15–20 cm,
  une idée par fichier. Laisse une petite pause entre les phrases : c'est là que l'agent coupe.

### Musique

Par défaut, **l'export n'a pas de musique** : tu ajoutes le son dans TikTok ou Instagram au moment de
publier. Les passages sans voix sont alors silencieux dans l'export et la musique de l'appli les remplit.
Dans l'éditeur de l'appli, baisse le curseur de la musique par rapport au son d'origine pour que ta voix
reste compréhensible. Sur un compte professionnel, le catalogue de musiques commerciales est limité.

Option : une musique libre de droits intégrée par l'agent (choix par clip, fichiers dans
`~/VideoAgent/musique`). Elle est alors baissée automatiquement quand tu parles et remonte dans les pauses.

## Faire progresser l'agent : il apprend de tes corrections

Pas besoin d'entraîner un modèle pour qu'il travaille « à ton image » :

1. **Tu corriges et tu notes.** Sur chaque clip : ordre, durées, images, accroche… puis une note
   (1 à 5★) et un avis libre dans « Ton avis pour l'agent ».
2. **Le rendu final vaut validation.** L'agent enregistre sa proposition, ta version finale, la liste
   de tes corrections (plan retiré, accroche changée, durée raccourcie…) et ton avis. Une proposition
   supprimée sans être utilisée est aussi retenue.
3. **Il relit avant chaque proposition** tes règles de style et tes meilleurs montages validés
   (2 à 3 exemples). Effet immédiat, gratuit.
4. **Il propose des règles** (Brief → « Ce que l'agent apprend de toi » → « Proposer des règles d'après
   mes corrections ») ; tu coches celles qui sont justes. Tu restes le seul à décider.
5. **Exporter le journal** (même écran) : un fichier à me renvoyer pour que j'affine les consignes de l'agent.

Fichiers : `~/VideoAgent/apprentissage/regles.md` (tes règles) et `exemples.jsonl` (le journal).

Plus tard, avec une centaine de montages validés, ce journal pourra servir à ré-entraîner le modèle local
(technique LoRA, faisable sur le Mac). C'est seulement utile si les règles + exemples ne suffisent plus :
on mesurera avant.

## Réglages conseillés pour le Galaxy S24 Ultra

- **Format** : 4K 30 i/s ou 1080p 60 i/s. Filmer à la verticale ce qui sera de la parole face caméra ;
  l'horizontal est recadré automatiquement (position du sujet détectée par l'IA, ajustable).
- **HDR10+** : géré (conversion en SDR), mais désactiver « Vidéo HDR10+ » dans l'appareil photo
  donne des couleurs plus fidèles et une analyse plus rapide.
- **Transfert vers le Mac** : par la page web (Wi-Fi), ou par câble USB-C avec
  [OpenMTP](https://openmtp.ganeshrvel.com) pour 10 Go et plus (souvent plus rapide et plus fiable).
- **Son** : un micro-cravate améliore nettement la transcription en extérieur (vent, machines).

## Coût : 0 € par défaut

Tout tourne sur le Mac avec des logiciels libres : FFmpeg (LGPL/GPL), Whisper (MIT), Ollama (MIT),
modèles Qwen2.5 7B/14B et Qwen2.5-VL 7B (Apache 2.0). Seul coût : l'électricité.

**Pas besoin d'entraîner un modèle.** Ces modèles sont déjà entraînés ; l'agent les guide avec des
consignes de monteur et un format de réponse imposé. Entraîner son propre modèle demanderait des
milliers d'exemples annotés et beaucoup de calcul, pour un gain incertain.

### IA locale ou Claude : ce que tu gagnes et perds

| | IA locale (défaut) | Claude (option) |
|---|---|---|
| Prix | 0 € | ≈ 1 à 4 $ par lot de 10 Go (estimation) |
| Confidentialité | rien ne quitte le Mac | vignettes + texte envoyés à l'API |
| Qualité des montages | correcte, plus de retouches à la main | meilleurs choix de plans et de phrases |
| Vitesse | plus lent (le Mac fait tout ; plusieurs secondes par plan) | rapide |
| Volume par projet | limité par la mémoire : au-delà d’environ 30 à 45 min de rushs, répartir en plusieurs projets | pas de limite pratique |

Mélange possible dans `.env` : `IA_VISION=local` (la partie la plus volumineuse, gratuite) et
`IA_MONTAGE=claude` (la décision de montage, ≈ 0,10 à 0,50 $ par proposition, estimation). Pour Claude,
ajouter `ANTHROPIC_API_KEY=` (clé sur console.anthropic.com, facturée à part de l'abonnement Claude.ai).

Les modèles locaux sont interchangeables (`LOCAL_VISION_MODEL`, `LOCAL_TEXT_MODEL`) : tout modèle
d'[ollama.com/library](https://ollama.com/library) compatible images / texte peut être essayé.

## Confidentialité

- Avec l'IA locale, rien ne quitte le Mac. Avec l'option Claude : vignettes 320 px et texte transcrit.
- Le serveur écoute sur le Wi-Fi local et exige un jeton (présent dans le lien / QR code).
  Ne pas l'utiliser sur un Wi-Fi public.

## Limites actuelles

- Pas de suivi automatique du visage : recadrage fixe par segment (réglable).
- Pas de transitions animées ni d'étalonnage : coupes franches, adaptées aux formats courts.
- Aperçu en basse définition et changement de plan pas toujours fluide sur téléphone ; le rendu final est exact.
- Pas de publication automatique sur Instagram/TikTok : téléchargement puis publication depuis l'appli.

## Ce qui a été vérifié

Dans un conteneur Linux (FFmpeg 6.1, sans GPU Apple, sans clé API, sans modèle Whisper ni Ollama) :
analyse d'un fichier 4K de 23,7 Go en 201 s sur 4 cœurs CPU (RAM max : 89 Mo pour l'app,
441 Mo pour FFmpeg) puis rendu d'un clip depuis ce fichier (1,6 Go de RAM max), chaîne analyse → plan → rendu sur rushs de synthèse
(IA et Whisper simulés ; IA locale testée contre un faux serveur Ollama), sortie 1080×1920 à la durée exacte prévue, −15 LUFS avec musique,
interface pilotée en format téléphone, envoi interrompu puis repris (fichier identique à l'octet),
voix off : découpe sous plusieurs images sans mot répété ni perdu, image ajoutée automatiquement si absente.
Non vérifié ici, à valider au premier lancement sur le Mac : mlx-whisper, l'encodeur matériel Apple,
la vitesse et la qualité réelles des modèles locaux (et de Claude si activé).

## Structure

```
app/
  media.py       FFmpeg : analyse en une passe, découpe en plans, vignettes
  transcribe.py  Whisper local, mots horodatés, filtre des phrases inventées sur les silences
  llm.py         IA locale (Ollama) ou Claude, réponse JSON imposée par schéma
  analyze.py     vision : description / qualité / position du sujet par plan
  planner.py     agent monteur : propose les clips ; nettoyage des coupes
  learning.py    apprentissage : journal des corrections, règles de style, exemples relus par l'agent
  render.py      rendu 9:16 depuis les originaux, assemblage sans réencodage vidéo
  subtitles.py   sous-titres ASS mot à mot + accroche
  server.py      API + envoi par morceaux ; jobs.py file de tâches ; store.py projets
  static/        interface web (Mac et téléphone)
```
Données : `~/VideoAgent/projects/<projet>/` (proxys ≈ quelques % de la taille des rushs, exports).
