"""Rendu final 1080x1920 depuis les rushs ORIGINAUX (pleine qualité).

Chaque segment est rendu séparément (recadrage, sous-titres incrustés, audio PCM exact),
puis les segments sont assemblés sans réencodage vidéo. Avantages : peu de mémoire même
avec des rushs 4K HEVC, une seule compression vidéo, et pas de décalage son/image.
"""
import re
import shutil
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import config, media, planner, store, subtitles

FPS = config.OUT_FPS


def _frames(t: float) -> float:
    """Durée arrondie à l'image près (évite toute dérive son/image à l'assemblage)."""
    return max(1, round(t * FPS)) / FPS


def _framing_filter(seg: dict, info: dict) -> str:
    W, H = config.OUT_W, config.OUT_H
    framing = seg.get("framing", "crop")
    if framing == "fit":
        return (f"split[fa][fb];[fa]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,"
                f"gblur=sigma=10,eq=brightness=-0.06,scale={W}:{H}[bg];"
                f"[fb]scale={W}:{H}:force_original_aspect_ratio=decrease[fg];"
                f"[bg][fg]overlay=(W-w)/2:(H-h)/2")
    cx = float(seg.get("crop_x", 0.5))
    return (f"crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':"
            f"x='max(0,min(iw-ow,{cx:.3f}*iw-ow/2))':y='(ih-oh)/2',"
            f"scale={W}:{H}:flags=lanczos")


def _segment_cmd(seg: dict, sources: dict, out: Path, ass: str | None) -> list[str]:
    dur = seg["_dur"]
    main = sources[seg["source"]]
    if seg.get("overlay"):
        vis, vstart = sources[seg["overlay"]["source"]], seg["overlay"]["start"]
    else:
        vis, vstart = main, seg["start"]

    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
           *media.hwaccel_args(), "-ss", f"{vstart:.3f}", "-t", f"{dur + 0.5:.3f}", "-i", vis["path"]]
    keep = seg["audio"] == "keep" and main["info"]["has_audio"]
    if keep and seg.get("overlay"):
        cmd += ["-ss", f"{seg['start']:.3f}", "-t", f"{dur + 0.5:.3f}", "-i", main["path"]]
        a_in = "1:a:0"
    elif keep:
        a_in = "0:a:0"
    else:
        cmd += ["-f", "lavfi", "-t", f"{dur + 0.5:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
        a_in = "1:a:0"

    v = (f"[0:v:0]{media.tonemap_chain(vis['info'])}{_framing_filter(seg, vis['info'])},"
         f"tpad=stop_mode=clone:stop_duration=1,fps={FPS},setsar=1,format=yuv420p")
    if ass:
        v += f",ass={ass}"
    a = (f"[{a_in}]aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo,"
         f"afade=t=in:d=0.02,afade=t=out:st={max(0, dur - 0.03):.3f}:d=0.03,apad,atrim=0:{dur:.4f}")
    cmd += ["-filter_complex", f"{v}[v];{a}[a]", "-map", "[v]", "-map", "[a]",
            "-t", f"{dur:.4f}", *media.h264_args("master"), "-pix_fmt", "yuv420p",
            "-c:a", "pcm_s16le", str(out)]
    return cmd


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "clip"


def render_clip(project: dict, clip: dict, on_progress=None) -> Path:
    pid = project["id"]
    sources = {s["id"]: s for s in project["sources"]}
    segs = [dict(s) for s in clip["segments"]]
    if not segs:
        raise ValueError("Ce clip ne contient aucun segment.")
    for s in segs:
        for sid in [s["source"]] + ([s["overlay"]["source"]] if s.get("overlay") else []):
            if not Path(sources[sid]["path"]).exists():
                raise FileNotFoundError(f"Rush introuvable (disque débranché ?) : {sources[sid]['path']}")
        s["_dur"] = _frames(s["end"] - s["start"])
    total = sum(s["_dur"] for s in segs)

    words_by_source = {}
    for sid in {s["source"] for s in segs}:
        tr = planner.load_transcript(pid, sid)
        words_by_source[sid] = [w for seg in tr.get("segments", []) for w in seg["words"]]
    evs = subtitles.events(subtitles.clip_words(segs, words_by_source), clip.get("hook", ""),
                           total, clip.get("subtitles", True))

    work = store.project_dir(pid) / "render" / clip["id"]
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)

    jobs, offset = [], 0.0
    for i, s in enumerate(segs):
        ass_name = f"seg_{i:03d}.ass"
        has_ass = subtitles.write_ass(work / ass_name, evs, (offset, offset + s["_dur"]))
        out = work / f"seg_{i:03d}.mov"
        jobs.append((out, _segment_cmd(s, sources, out, ass_name if has_ass else None)))
        offset += s["_dur"]

    done = 0

    def run(job):
        out, cmd = job
        media._run_with_progress(cmd, 0, None, cwd=work)  # cwd : chemins .ass sans échappement
        return out

    # 2 segments en parallèle : bon compromis pour l'encodeur matériel des puces M
    with ThreadPoolExecutor(max_workers=2) as pool:
        for _ in pool.map(run, jobs):
            done += 1
            if on_progress:
                on_progress(0.9 * done / len(jobs))

    (work / "list.txt").write_text("".join(f"file '{o.name}'\n" for o, _ in jobs), encoding="utf-8")

    export_dir = store.project_dir(pid) / "exports"
    export_dir.mkdir(exist_ok=True)
    final = export_dir / f"{_slug(clip['title'])}-{clip['id']}.mp4"

    any_voice = any(s["audio"] == "keep" for s in segs)
    music = (config.MUSIC_DIR / clip["music"]) if clip.get("music") else None
    cmd = ["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
           "-f", "concat", "-safe", "0", "-i", "list.txt"]
    if music and music.exists():
        mvol = 0.22 if any_voice else 0.9
        cmd += ["-stream_loop", "-1", "-i", str(music)]
        graph = (f"[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,asplit=2[vo][sc];"
                 f"[1:a]aresample=48000,aformat=channel_layouts=stereo,volume={mvol},"
                 f"afade=t=in:d=0.5,afade=t=out:st={max(0, total - 1.5):.2f}:d=1.5[m];"
                 f"[m][sc]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[md];"
                 f"[vo][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[a]")
    else:
        graph = f"[0:a]loudnorm=I={config.TARGET_LUFS}:TP=-1.5:LRA=11,aresample=48000[a]"
    cmd += ["-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-t", f"{total:.3f}", "-movflags", "+faststart",
            str(final.resolve())]
    media._run_with_progress(cmd, 0, None, cwd=work)

    caption = f"{clip.get('caption', '')}\n\n{' '.join(clip.get('hashtags', []))}\n"
    final.with_suffix(".txt").write_text(caption, encoding="utf-8")
    shutil.rmtree(work, ignore_errors=True)
    if on_progress:
        on_progress(1.0)
    return final


def export_info(path: Path) -> dict:
    return {"file": path.name, "size": path.stat().st_size, "at": time.time()}
