"""Tout ce qui touche FFmpeg côté analyse.

Principe pour encaisser 10 Go et plus : les rushs ne sont jamais chargés en mémoire ni
copiés. Chaque fichier est lu UNE seule fois par FFmpeg, qui produit en même temps :
  - un proxy léger (960 px, H.264) pour la prévisualisation sur Mac et téléphone,
  - l'audio 16 kHz mono pour la transcription,
  - une image par seconde (320 px) pour l'analyse visuelle,
  - la liste des changements de plan.
Le rendu final repart ensuite des originaux, en pleine qualité.
"""
import json
import math
import re
import shutil
import subprocess
import threading
from functools import lru_cache
from pathlib import Path

from . import config


class FFmpegError(RuntimeError):
    pass


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise FFmpegError(f"{tool} introuvable. Sur Mac : brew install ffmpeg")


@lru_cache(maxsize=1)
def available_filters() -> set[str]:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    return {m.group(1) for m in re.finditer(r"^\s*[T.][S.][C.]\s+(\w+)", out, re.M)}


@lru_cache(maxsize=1)
def available_encoders() -> set[str]:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return {m.group(1) for m in re.finditer(r"^\s*V\S*\s+(\w+)", out, re.M)}


def h264_args(quality: str) -> list[str]:
    """Encodeur matériel Apple si dispo (10x plus rapide), sinon x264."""
    hw = config.IS_MAC and "h264_videotoolbox" in available_encoders()
    if quality == "proxy":
        return (["-c:v", "h264_videotoolbox", "-b:v", "2500k"] if hw
                else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "26"]) + ["-g", "30"]
    # "master" : segments du rendu final, qualité quasi transparente
    return (["-c:v", "h264_videotoolbox", "-b:v", "16M", "-profile:v", "high"] if hw
            else ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-profile:v", "high"]) + ["-g", "60"]


def hwaccel_args() -> list[str]:
    return ["-hwaccel", "videotoolbox"] if config.IS_MAC else []


def _ratio(value: str | None) -> float:
    if not value or value in ("0/0", "N/A"):
        return 0.0
    if "/" in value:
        num, den = value.split("/")
        return float(num) / float(den) if float(den) else 0.0
    return float(value)


def probe(path: str | Path) -> dict:
    res = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)],
        capture_output=True, text=True,
    )
    if res.returncode != 0:
        raise FFmpegError(f"Fichier illisible : {Path(path).name} ({res.stderr.strip()[:200]})")
    data = json.loads(res.stdout)
    video = next((s for s in data["streams"] if s.get("codec_type") == "video"
                  and s.get("disposition", {}).get("attached_pic") != 1), None)
    if video is None:
        raise FFmpegError(f"Pas de piste vidéo : {Path(path).name}")
    audio = next((s for s in data["streams"] if s.get("codec_type") == "audio"), None)

    rotation = 0
    for sd in video.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(sd["rotation"])
    if not rotation and "rotate" in video.get("tags", {}):
        rotation = int(video["tags"]["rotate"])
    w, h = int(video["width"]), int(video["height"])
    if abs(rotation) % 180 == 90:
        w, h = h, w  # FFmpeg applique la rotation automatiquement : on raisonne en dimensions affichées

    duration = float(data["format"].get("duration") or video.get("duration") or 0)
    fps = _ratio(video.get("avg_frame_rate")) or _ratio(video.get("r_frame_rate")) or 30.0
    transfer = video.get("color_transfer", "")
    return {
        "duration": round(duration, 3),
        "width": w,
        "height": h,
        "fps": round(fps, 3),
        "codec": video.get("codec_name"),
        "hdr": transfer in ("smpte2084", "arib-std-b67"),
        "has_audio": audio is not None,
        "orientation": "vertical" if h > w else "horizontal",
    }


def tonemap_chain(info: dict) -> str:
    """HDR (HDR10+/HLG des smartphones) -> SDR, sinon les couleurs sortent délavées."""
    if not info.get("hdr"):
        return ""
    if "zscale" not in available_filters():
        return ""  # signalé à l'utilisateur dans l'interface
    return ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
            "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p,")


def _run_with_progress(cmd: list[str], duration: float, on_progress=None, cwd=None) -> str:
    """Lance FFmpeg, remonte la progression (0..1), renvoie stderr."""
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                            cwd=cwd, bufsize=1)
    err_lines: list[str] = []

    def _drain():
        for line in proc.stderr:
            err_lines.append(line)

    t = threading.Thread(target=_drain, daemon=True)
    t.start()
    for line in proc.stdout:
        if line.startswith("out_time_us=") and on_progress and duration > 0:
            try:
                on_progress(min(1.0, int(line.split("=")[1]) / 1e6 / duration))
            except ValueError:
                pass
    proc.wait()
    t.join(timeout=5)
    stderr = "".join(err_lines)
    if proc.returncode != 0:
        tail = "\n".join(stderr.strip().splitlines()[-12:])
        raise FFmpegError(f"FFmpeg a échoué ({proc.returncode}) :\n{tail}")
    return stderr


def ingest(src: str | Path, out_dir: Path, info: dict, on_progress=None) -> list[float]:
    """Passe unique sur le rush original. Renvoie les instants de changement de plan."""
    frames_dir = out_dir / "frames"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)

    pre = tonemap_chain(info)
    graph = (
        f"[0:v:0]{pre}split=3[p0][f0][s0];"
        "[p0]scale=w='if(gte(iw,ih),960,-2)':h='if(gte(iw,ih),-2,960)',format=yuv420p[pv];"
        "[f0]fps=1,scale=320:320:force_original_aspect_ratio=decrease[fr];"
        "[s0]scale=160:-2,select='gt(scene,0.30)',showinfo[sc]"
    )
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats",
           *hwaccel_args(), "-i", str(src), "-filter_complex", graph,
           # 1) proxy
           "-map", "[pv]", "-map", "0:a:0?", *h264_args("proxy"),
           "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart",
           str(out_dir / "proxy.mp4")]
    if info["has_audio"]:
        # 2) audio pour Whisper
        cmd += ["-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(out_dir / "audio.wav")]
    cmd += [
        # 3) 1 image/seconde
        "-map", "[fr]", "-fps_mode", "vfr", "-q:v", "5", str(frames_dir / "%06d.jpg"),
        # 4) détection de plans (rien n'est écrit)
        "-map", "[sc]", "-fps_mode", "vfr", "-f", "null", "-",
    ]
    stderr = _run_with_progress(cmd, info["duration"], on_progress)
    cuts = sorted({round(float(m), 3) for m in re.findall(r"pts_time:\s*([\d.]+)", stderr)})
    return cuts


def build_shots(duration: float, cuts: list[float], min_len=1.0, max_len=9.0) -> list[dict]:
    """Découpe en plans : coupes détectées + découpage des prises longues (fréquent au téléphone)."""
    bounds = [0.0] + [c for c in cuts if 0 < c < duration] + [duration]
    raw = []
    for a, b in zip(bounds, bounds[1:]):
        if raw and (b - a) < min_len:
            raw[-1][1] = b  # plan trop court : fusionné avec le précédent
        else:
            raw.append([a, b])
    if len(raw) > 1 and raw[0][1] - raw[0][0] < min_len:
        raw[1][0] = raw[0][0]
        raw.pop(0)
    shots = []
    for a, b in raw:
        n = max(1, math.ceil((b - a) / max_len))
        step = (b - a) / n
        for i in range(n):
            shots.append({"start": round(a + i * step, 3), "end": round(a + (i + 1) * step, 3)})
    return shots


def frame_path(out_dir: Path, t: float) -> Path | None:
    frames = out_dir / "frames"
    idx = int(t) + 1
    for candidate in (idx, idx - 1, idx + 1):
        p = frames / f"{candidate:06d}.jpg"
        if p.exists():
            return p
    existing = sorted(frames.glob("*.jpg"))
    return existing[-1] if existing else None


def make_strip(out_dir: Path, start: float, end: float, dest: Path) -> Path | None:
    """3 images (début / milieu / fin du plan) côte à côte : le modèle voit le mouvement."""
    from PIL import Image

    length = end - start
    paths = []
    for frac in (0.15, 0.5, 0.85):
        p = frame_path(out_dir, start + frac * length)
        if p:
            paths.append(p)
    if not paths:
        return None
    images = [Image.open(p).convert("RGB") for p in paths]
    h = min(im.height for im in images)
    images = [im if im.height == h else im.resize((round(im.width * h / im.height), h)) for im in images]
    strip = Image.new("RGB", (sum(im.width for im in images) + 4 * (len(images) - 1), h), (0, 0, 0))
    x = 0
    for im in images:
        strip.paste(im, (x, 0))
        x += im.width + 4
    dest.parent.mkdir(parents=True, exist_ok=True)
    strip.save(dest, "JPEG", quality=80)
    return dest
