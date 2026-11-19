"""Réglages, surchargeables par variables d'environnement (ou fichier .env)."""
import os
import secrets
import sys
from pathlib import Path


def _load_dotenv() -> None:
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

IS_MAC = sys.platform == "darwin"

# Dossier de travail : proxys, transcriptions, exports. Les rushs originaux ne sont
# jamais copiés ici quand on les ajoute par dossier : ils sont lus sur place.
HOME = Path(os.environ.get("VIDEO_AGENT_HOME", Path.home() / "VideoAgent")).expanduser()
PROJECTS_DIR = HOME / "projects"
MUSIC_DIR = HOME / "musique"

HOST = os.environ.get("VIDEO_AGENT_HOST", "0.0.0.0")
PORT = int(os.environ.get("VIDEO_AGENT_PORT", "8765"))
# Jeton exigé par l'interface (le serveur écoute sur le Wi-Fi pour le téléphone).
TOKEN = os.environ.get("VIDEO_AGENT_TOKEN") or secrets.token_urlsafe(12)


def _ram_gb() -> float:
    try:
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):
        return 16.0


RAM_GB = _ram_gb()

# IA utilisée pour décrire les images (vision) et pour proposer les montages :
#   "local"  = gratuit, modèles open source exécutés sur le Mac via Ollama (par défaut)
#   "claude" = API payante d'Anthropic, meilleure qualité de montage
IA_VISION = os.environ.get("IA_VISION", "local").strip().lower()
IA_MONTAGE = os.environ.get("IA_MONTAGE", "local").strip().lower()

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
LOCAL_VISION_MODEL = os.environ.get("LOCAL_VISION_MODEL", "qwen2.5vl:7b")
# 14B si la mémoire le permet (meilleurs montages), sinon 7B
LOCAL_TEXT_MODEL = os.environ.get("LOCAL_TEXT_MODEL", "qwen2.5:14b" if RAM_GB >= 30 else "qwen2.5:7b")
LOCAL_MAX_CTX = int(os.environ.get("LOCAL_MAX_CTX", "32768"))

CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
VISION_MODEL = os.environ.get("VISION_MODEL", CLAUDE_MODEL)

LANGUAGE = os.environ.get("VIDEO_AGENT_LANG", "fr")
# mlx-whisper (Mac Apple Silicon) / faster-whisper (autres machines)
WHISPER_MODEL_MLX = os.environ.get("WHISPER_MODEL_MLX", "mlx-community/whisper-large-v3-turbo")
WHISPER_MODEL_CPU = os.environ.get("WHISPER_MODEL_CPU", "large-v3-turbo")

# Sortie réseaux sociaux
OUT_W, OUT_H, OUT_FPS = 1080, 1920, 30
TARGET_LUFS = -14  # niveau sonore visé par Instagram / TikTok / YouTube

VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".mkv", ".mts", ".m2ts", ".avi", ".webm", ".3gp"}
AUDIO_EXTS = {".mp3", ".m4a", ".wav", ".aac", ".flac", ".ogg"}

for d in (PROJECTS_DIR, MUSIC_DIR):
    d.mkdir(parents=True, exist_ok=True)
