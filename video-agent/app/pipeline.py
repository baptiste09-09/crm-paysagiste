"""Enchaînement des étapes : analyse des rushs -> plan de montage -> rendu."""
import json
import shutil
import time
from pathlib import Path

from . import analyze, config, media, planner, render, store, transcribe


def _set_source(pid: str, sid: str, **fields) -> None:
    def fn(p):
        store.find_source(p, sid).update(fields)
    store.update(pid, fn)


def _analyze_voice(pid: str, src: dict, out_dir: Path, info: dict, step) -> None:
    """Voix off (son seul) : pas d'images à analyser, seulement la transcription."""
    step(0.01, "voix off, extraction du son")
    media.ingest_audio(src["path"], out_dir, info, on_progress=lambda f: step(0.01 + 0.3 * f))
    step(0.35, "transcription locale (Whisper)")
    transcript = transcribe.transcribe(out_dir / "audio.wav")
    (out_dir / "transcript.json").write_text(json.dumps(transcript, ensure_ascii=False), encoding="utf-8")
    (out_dir / "audio.wav").unlink(missing_ok=True)
    warn = [transcript["warning"]] if transcript.get("warning") else []
    if not transcript.get("segments") and not warn:
        warn.append("Aucune parole détectée dans cette voix off.")
    _set_source(pid, src["id"], status="pret", shots=[], warnings=warn, kind="voix",
                speech=bool(transcript.get("segments")), error=None, analyzed=time.time())


def analyze_project(job, pid: str) -> None:
    media.require_ffmpeg()
    project = store.load(pid)
    todo = [s for s in project["sources"] if s.get("status") != "pret"]
    if not todo:
        job.progress(1.0, "Tous les rushs sont déjà analysés.")
        return
    n = len(todo)
    for i, src in enumerate(todo):
        base = i / n
        step = lambda f, msg=None: job.progress(base + f / n, msg)  # noqa: E731
        name = src["name"]
        try:
            out_dir = store.source_dir(pid, src["id"])
            if not Path(src["path"]).exists():
                raise FileNotFoundError(f"Fichier introuvable : {src['path']}")

            step(0, f"[{i + 1}/{n}] {name} : lecture")
            info = media.probe(src["path"])
            _set_source(pid, src["id"], info=info, status="analyse")

            if not info.get("has_video", True):
                prefix = f"[{i + 1}/{n}] {name}"
                _analyze_voice(pid, src, out_dir, info,
                               lambda f, msg=None: step(f, f"{prefix} : {msg}" if msg else None))
                continue

            step(0.01, f"[{i + 1}/{n}] {name} : proxy + audio + images (passe unique)")
            cuts = media.ingest(src["path"], out_dir, info,
                                on_progress=lambda f: step(0.01 + 0.5 * f))

            shots = media.build_shots(info["duration"], cuts)
            for k, sh in enumerate(shots, 1):
                sh["id"] = f"{src['label']}-{k:03d}"
                strip = media.make_strip(out_dir, sh["start"], sh["end"], out_dir / "strips" / f"{sh['id']}.jpg")
                sh["strip"] = strip.name if strip else None
                mid = media.frame_path(out_dir, (sh["start"] + sh["end"]) / 2)
                sh["thumb"] = mid.name if mid else None

            transcript = {"segments": []}
            if info["has_audio"] and (out_dir / "audio.wav").exists():
                step(0.55, f"[{i + 1}/{n}] {name} : transcription locale (Whisper)")
                transcript = transcribe.transcribe(out_dir / "audio.wav")
            (out_dir / "transcript.json").write_text(json.dumps(transcript, ensure_ascii=False), encoding="utf-8")

            step(0.8, f"[{i + 1}/{n}] {name} : analyse des images par Claude")
            items = [(sh["id"], sh, out_dir / "strips" / sh["strip"],
                      transcribe.text_between(transcript, sh["start"], sh["end"]))
                     for sh in shots if sh["strip"]]
            results, cost = analyze.describe_shots(items, on_progress=lambda f: step(0.8 + 0.19 * f))
            job.add_cost(cost)
            for sh in shots:
                sh.update({k: v for k, v in results.get(sh["id"], {}).items() if k != "id"})

            warn = []
            if info["hdr"] and not media.tonemap_chain(info):
                warn.append("Vidéo HDR : couleurs possiblement délavées (FFmpeg sans zscale).")
            if transcript.get("warning"):
                warn.append(transcript["warning"])
            (out_dir / "audio.wav").unlink(missing_ok=True)  # inutile après transcription
            _set_source(pid, src["id"], status="pret", shots=shots, warnings=warn,
                        speech=bool(transcript.get("segments")), error=None, analyzed=time.time())
        except Exception as e:
            _set_source(pid, src["id"], status="erreur", error=str(e))
            job.progress(base + 1 / n, f"{name} : erreur ({e})")
    job.progress(1.0, "Analyse terminée")


def plan_project(job, pid: str) -> None:
    project = store.load(pid)
    job.progress(0.1, "Claude prépare les montages…")
    clips, cost = planner.plan(project)
    job.add_cost(cost)

    def fn(p):
        p["clips"] = [c for c in p["clips"] if c.get("status") == "rendu"] + clips
    store.update(pid, fn)
    job.progress(1.0, f"{len(clips)} clip(s) proposé(s)")


def render_project_clip(job, pid: str, cid: str) -> None:
    media.require_ffmpeg()
    project = store.load(pid)
    clip = store.find_clip(project, cid)
    job.progress(0.01, f"Rendu de « {clip['title']} »")
    final = render.render_clip(project, clip, on_progress=lambda f: job.progress(f))

    def fn(p):
        c = store.find_clip(p, cid)
        c["status"] = "rendu"
        c["export"] = render.export_info(final)
    store.update(pid, fn)


def delete_source_cache(pid: str, sid: str) -> None:
    shutil.rmtree(store.project_dir(pid) / "sources" / sid, ignore_errors=True)


def music_files() -> list[str]:
    return sorted(p.name for p in config.MUSIC_DIR.iterdir()
                  if p.suffix.lower() in config.AUDIO_EXTS and not p.name.startswith("."))
