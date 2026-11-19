#!/bin/bash
# Double-clic sur ce fichier dans le Finder pour lancer l'agent de montage.
cd "$(dirname "$0")" || exit 1

pause() { read -r -p "Appuie sur Entrée pour fermer…"; }

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg manque. Installe-le dans le Terminal avec :  brew install ffmpeg"
  pause; exit 1
fi

PY=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
    PY="$candidate"; break
  fi
done
if [ -z "$PY" ]; then
  echo "Python 3.10 ou plus récent est requis. Installe-le avec :  brew install python@3.12"
  pause; exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "Première installation (quelques minutes)…"
  "$PY" -m venv .venv && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -r requirements.txt || { pause; exit 1; }
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "VIDEO_AGENT_TOKEN=$(openssl rand -hex 8)" >> .env   # lien stable pour le téléphone
fi

# IA locale (gratuite) : Ollama + modèles open source, téléchargés une seule fois
read -r IA_V IA_M MODEL_V MODEL_T < <(.venv/bin/python -c \
  "from app import config as c; print(c.IA_VISION, c.IA_MONTAGE, c.LOCAL_VISION_MODEL, c.LOCAL_TEXT_MODEL)")
NEEDED=""
[ "$IA_V" != "claude" ] && NEEDED="$MODEL_V"
[ "$IA_M" != "claude" ] && NEEDED="$NEEDED $MODEL_T"
if [ -n "$NEEDED" ]; then
  if ! command -v ollama >/dev/null 2>&1; then
    echo "Ollama manque (IA locale gratuite). Installe-le avec :  brew install ollama"
    pause; exit 1
  fi
  if ! curl -s --max-time 2 http://127.0.0.1:11434/api/tags >/dev/null; then
    echo "Démarrage d'Ollama…"
    (ollama serve >/dev/null 2>&1 &)
    sleep 3
  fi
  for m in $NEEDED; do
    if ! ollama list | awk 'NR>1 {print $1}' | grep -Fxq "$m"; then
      echo "Téléchargement du modèle $m (une seule fois, plusieurs Go)…"
      ollama pull "$m" || { pause; exit 1; }
    fi
  done
fi

exec .venv/bin/python -m app
