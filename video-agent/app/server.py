"""API + interface web (Mac et téléphone sur le même Wi-Fi)."""
import json
import os
import re
import shutil
import time
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, jobs, learning, llm, media, pipeline, store, transcribe

app = FastAPI(title="Agent montage vidéo")
STATIC = Path(__file__).parent / "static"


# ------------------------------------------------------------------ accès

@app.middleware("http")
async def token_guard(request: Request, call_next):
    token = (request.query_params.get("t") or request.headers.get("x-token")
             or request.cookies.get("va_token"))
    if token != config.TOKEN:
        if request.url.path.startswith("/api") or request.url.path.startswith("/files"):
            return JSONResponse({"detail": "Jeton manquant"}, status_code=401)
        return HTMLResponse("<h3>Accès refusé</h3><p>Ouvre le lien complet affiché dans le Terminal du Mac "
                            "(il contient ?t=…), ou scanne le QR code.</p>", status_code=401)
    response = await call_next(request)
    if request.query_params.get("t"):
        response.set_cookie("va_token", config.TOKEN, max_age=3600 * 24 * 365, samesite="lax")
    return response


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


def _project(pid: str) -> dict:
    try:
        return store.load(pid)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Projet introuvable")


# ------------------------------------------------------------------ infos

@app.get("/api/info")
def info():
    ok = bool(shutil.which("ffmpeg"))
    return {
        "ffmpeg": ok,
        "hw_encoder": ok and config.IS_MAC and "h264_videotoolbox" in media.available_encoders(),
        "hdr_tonemap": ok and "zscale" in media.available_filters(),
        "whisper": transcribe.engine_name() or None,
        "ia": llm.status(),
        "music": pipeline.music_files(),
        "music_dir": str(config.MUSIC_DIR),
        "home": str(config.HOME),
        "free_gb": round(shutil.disk_usage(config.HOME).free / 1e9, 1),
    }


@app.get("/api/jobs")
def list_jobs(pid: str | None = None):
    return jobs.list_jobs(pid)


# ------------------------------------------------------------------ projets

@app.get("/api/projects")
def projects():
    return store.list_projects()


@app.post("/api/projects")
def create_project(payload: dict = Body(...)):
    return store.create(payload.get("name", ""))


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    return _project(pid)


@app.get("/api/projects/{pid}/transcripts")
def transcripts(pid: str):
    """Mots horodatés de chaque rush, format compact [mot, début, fin] (prévisualisation)."""
    project = _project(pid)
    out = {}
    for s in project["sources"]:
        if s.get("status") == "pret":
            tr = pipeline.planner.load_transcript(pid, s["id"])
            out[s["id"]] = [[w["w"], w["s"], w["e"]] for seg in tr.get("segments", []) for w in seg["words"]]
    return out


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    _project(pid)
    shutil.rmtree(store.project_dir(pid), ignore_errors=True)  # les rushs ajoutés par dossier ne sont pas touchés
    return {"ok": True}


@app.put("/api/projects/{pid}/brief")
def save_brief(pid: str, payload: dict = Body(...)):
    allowed = {"sujet", "ville", "ton", "cta", "nb_clips", "duree", "musique", "notes"}

    def fn(p):
        for k, v in payload.items():
            if k in allowed:
                p["brief"][k] = v
        p["brief"]["nb_clips"] = max(1, min(8, int(p["brief"].get("nb_clips") or 3)))
        p["brief"]["duree"] = max(8, min(180, int(p["brief"].get("duree") or 35)))
        return p["brief"]
    return store.update(pid, fn)


# ------------------------------------------------------------------ rushs

MEDIA_EXTS = config.VIDEO_EXTS | config.AUDIO_EXTS  # vidéos + voix off (mémos vocaux)


def _scan(path: Path) -> list[Path]:
    if path.is_file():
        return [path] if path.suffix.lower() in MEDIA_EXTS else []
    files = []
    for root, dirs, names in os.walk(path):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for n in names:
            # "._xxx" = métadonnées macOS sur disques exFAT, pas des vidéos
            if not n.startswith(".") and Path(n).suffix.lower() in MEDIA_EXTS:
                files.append(Path(root) / n)
    return sorted(files)


def _register(pid: str, files: list[Path]) -> int:
    def fn(p):
        known = {s["path"] for s in p["sources"]}
        added = 0
        for f in files:
            if str(f) in known:
                continue
            prefix = "V" if f.suffix.lower() in config.AUDIO_EXTS else "R"  # V = voix off
            num = max([int(s["label"][1:]) for s in p["sources"] if s["label"][0] == prefix] or [0]) + 1
            p["sources"].append({"id": store.new_id("s"), "label": f"{prefix}{num:02d}", "path": str(f),
                                 "name": f.name, "size": f.stat().st_size, "status": "en_attente",
                                 "info": None, "shots": []})
            added += 1
        return added
    return store.update(pid, fn)


@app.get("/api/browse")
def browse(path: str = ""):
    p = Path(path).expanduser() if path else Path.home()
    if not p.is_dir():
        raise HTTPException(400, "Dossier introuvable")
    dirs, videos, size = [], 0, 0
    try:
        for entry in sorted(p.iterdir(), key=lambda e: e.name.lower()):
            if entry.name.startswith("."):
                continue
            if entry.is_dir():
                dirs.append({"name": entry.name, "path": str(entry)})
            elif entry.suffix.lower() in MEDIA_EXTS:
                videos += 1
                size += entry.stat().st_size
    except PermissionError:
        raise HTTPException(403, "Accès refusé par macOS : autorise le Terminal dans Réglages > "
                                 "Confidentialité > Accès complet au disque")
    shortcuts = [{"name": "Maison", "path": str(Path.home())}]
    for name in ("Movies", "Desktop", "Downloads", "Pictures"):
        if (Path.home() / name).is_dir():
            shortcuts.append({"name": name, "path": str(Path.home() / name)})
    if Path("/Volumes").is_dir():
        shortcuts.append({"name": "Disques externes", "path": "/Volumes"})
    return {"path": str(p), "parent": str(p.parent) if p.parent != p else None,
            "dirs": dirs, "videos": videos, "size": size, "shortcuts": shortcuts}


@app.post("/api/projects/{pid}/sources")
def add_sources(pid: str, payload: dict = Body(...)):
    _project(pid)
    files = []
    for raw in payload.get("paths", []):
        p = Path(raw).expanduser()
        if not p.exists():
            raise HTTPException(400, f"Introuvable : {raw}")
        files += _scan(p)
    if not files:
        raise HTTPException(400, "Aucune vidéo ni voix off trouvée à cet endroit")
    return {"added": _register(pid, files), "found": len(files)}


@app.delete("/api/projects/{pid}/sources/{sid}")
def remove_source(pid: str, sid: str):
    def fn(p):
        src = store.find_source(p, sid)
        used = [c["title"] for c in p["clips"] for s in c["segments"]
                if sid in (s["source"], (s.get("overlay") or {}).get("source"))]
        if used:
            raise HTTPException(409, f"Rush utilisé dans : {', '.join(sorted(set(used)))}")
        p["sources"].remove(src)
        return src
    src = store.update(pid, fn)
    pipeline.delete_source_cache(pid, sid)
    uploads = store.project_dir(pid) / "uploads"
    if Path(src["path"]).parent == uploads:
        Path(src["path"]).unlink(missing_ok=True)  # fichier envoyé depuis le téléphone
    return {"ok": True}


# ---------------------------------------------- envoi depuis le téléphone (reprise possible)

def _safe_name(name: str) -> str:
    name = Path(name).name
    return re.sub(r"[^\w.\- ]", "_", name)[:120] or "video.mp4"


def _upload_target(pid: str | None, name: str) -> Path:
    if pid is None:
        if Path(name).suffix.lower() not in config.AUDIO_EXTS:
            raise HTTPException(400, "Format audio non pris en charge")
        return config.MUSIC_DIR / _safe_name(name)
    if Path(name).suffix.lower() not in MEDIA_EXTS:
        raise HTTPException(400, "Format non pris en charge (vidéo ou voix off attendue)")
    d = store.project_dir(pid) / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d / _safe_name(name)


async def _receive_chunk(target: Path, offset: int, size: int, request: Request) -> dict:
    part = target.with_name(target.name + ".part")
    if target.exists() and target.stat().st_size == size:
        return {"offset": size, "done": True, "existing": True}
    current = part.stat().st_size if part.exists() else 0
    if offset != current:
        return JSONResponse({"offset": current, "done": False}, status_code=409)
    if shutil.disk_usage(target.parent).free < (size - current) + 2e9:
        raise HTTPException(507, "Espace disque insuffisant sur le Mac")
    with open(part, "ab") as f:
        async for chunk in request.stream():  # écrit au fil de l'eau, jamais tout en mémoire
            f.write(chunk)
    current = part.stat().st_size
    done = current >= size
    if done:
        os.replace(part, target)
    return {"offset": current, "done": done}


@app.get("/api/projects/{pid}/upload")
def upload_status(pid: str, name: str, size: int):
    target = _upload_target(pid, name)
    if target.exists() and target.stat().st_size == size:
        return {"offset": size, "done": True}
    part = target.with_name(target.name + ".part")
    return {"offset": part.stat().st_size if part.exists() else 0, "done": False}


@app.put("/api/projects/{pid}/upload")
async def upload_chunk(pid: str, name: str, offset: int, size: int, request: Request):
    _project(pid)
    target = _upload_target(pid, name)
    res = await _receive_chunk(target, offset, size, request)
    if isinstance(res, dict) and res.get("done"):
        _register(pid, [target])
    return res


@app.put("/api/music/upload")
async def upload_music(name: str, offset: int, size: int, request: Request):
    return await _receive_chunk(_upload_target(None, name), offset, size, request)


# ------------------------------------------------------------------ tâches

@app.post("/api/projects/{pid}/analyze")
def analyze(pid: str):
    project = _project(pid)
    if not project["sources"]:
        raise HTTPException(400, "Ajoute d'abord des rushs")
    if jobs.busy(pid, "analyse"):
        raise HTTPException(409, "Analyse déjà en cours")
    return jobs.submit("analyse", pid, "Analyse des rushs", pipeline.analyze_project, pid)


@app.post("/api/projects/{pid}/plan")
def plan(pid: str):
    project = _project(pid)
    if not any(s.get("status") == "pret" for s in project["sources"]):
        raise HTTPException(400, "Aucun rush analysé")
    if jobs.busy(pid, "plan"):
        raise HTTPException(409, "Proposition déjà en cours")
    return jobs.submit("plan", pid, "Proposition de montages", pipeline.plan_project, pid)


# ------------------------------------------------------------------ clips

def _validate_segments(project: dict, segments: list[dict]) -> list[dict]:
    sources = {s["id"]: s for s in project["sources"] if s.get("status") == "pret"}
    clean = []
    for s in segments:
        src = sources.get(s.get("source"))
        if not src:
            raise HTTPException(400, "Segment lié à un rush inconnu")
        dur = src["info"]["duration"]
        start, end = max(0.0, float(s["start"])), min(dur, float(s["end"]))
        if end - start < 0.2:
            raise HTTPException(400, f"Segment trop court ({src['label']} {start:.1f}s)")
        is_voice = not src["info"].get("has_video", True)
        seg = {"id": s.get("id") or store.new_id("g"), "source": src["id"], "start": round(start, 3),
               "end": round(end, 3), "audio": "keep" if s.get("audio") == "keep" or is_voice else "mute",
               "framing": "fit" if s.get("framing") == "fit" else "crop",
               "crop_x": round(max(0.0, min(1.0, float(s.get("crop_x", 0.5)))), 3),
               "overlay": None, "why": str(s.get("why", ""))[:300]}
        ov = s.get("overlay")
        if ov:
            osrc = sources.get(ov.get("source"))
            if not osrc or not osrc["info"].get("has_video", True):
                raise HTTPException(400, "Illustration liée à un rush vidéo inconnu")
            length = end - start
            if osrc["info"]["duration"] < length:
                raise HTTPException(400, f"Illustration {osrc['label']} trop courte pour ce segment")
            ostart = min(max(0.0, float(ov.get("start", 0))), osrc["info"]["duration"] - length)
            seg["overlay"] = {"source": osrc["id"], "start": round(ostart, 3)}
        elif is_voice:
            raise HTTPException(400, f"Voix off {src['label']} : ajoute une illustration (image) à ce segment")
        clean.append(seg)
    return clean


@app.put("/api/projects/{pid}/clips/{cid}")
def save_clip(pid: str, cid: str, payload: dict = Body(...)):
    project = _project(pid)
    segments = _validate_segments(project, payload.get("segments", []))

    edit_keys = ("title", "hook", "caption", "music", "hashtags", "subtitles", "segments")

    def fn(p):
        c = store.find_clip(p, cid)
        before = json.dumps([c.get(k) for k in edit_keys], sort_keys=True)
        for k in ("title", "hook", "caption", "music"):
            if k in payload:
                c[k] = str(payload[k])
        if "hashtags" in payload:
            c["hashtags"] = [h if h.startswith("#") else f"#{h}" for h in payload["hashtags"] if h]
        if "subtitles" in payload:
            c["subtitles"] = bool(payload["subtitles"])
        c["segments"] = segments
        if "note" in payload:  # ton avis pour l'agent (1 à 5)
            c["note"] = max(1, min(5, int(payload["note"]))) if payload["note"] else None
        if "avis" in payload:
            c["avis"] = str(payload["avis"])[:1500]
        changed = json.dumps([c.get(k) for k in edit_keys], sort_keys=True) != before
        if c.get("status") == "rendu" and changed:
            c["status"] = "modifie"
        return c
    clip = store.update(pid, fn)
    learning.update_feedback(cid, clip.get("note"), clip.get("avis", ""))
    return clip


@app.post("/api/projects/{pid}/clips")
def new_clip(pid: str):
    def fn(p):
        c = {"id": store.new_id("c"), "title": "Nouveau clip", "angle": "manuel", "hook": "", "caption": "",
             "hashtags": [], "segments": [], "subtitles": True, "music": p["brief"].get("musique", ""),
             "status": "brouillon", "export": None}
        p["clips"].append(c)
        return c
    return store.update(pid, fn)


@app.delete("/api/projects/{pid}/clips/{cid}")
def delete_clip(pid: str, cid: str):
    def fn(p):
        c = store.find_clip(p, cid)
        p["clips"].remove(c)
        return c
    project = _project(pid)
    clip = store.update(pid, fn)
    learning.record_rejected(project, clip)  # une proposition jetée est aussi une information
    return {"ok": True}


# ------------------------------------------------------------------ apprentissage

@app.get("/api/apprentissage")
def learning_state():
    return {**learning.stats(), "regles": learning.rules()}


@app.put("/api/apprentissage/regles")
def learning_rules(payload: dict = Body(...)):
    learning.save_rules(str(payload.get("texte", ""))[:8000])
    return {"regles": learning.rules()}


@app.post("/api/apprentissage/suggestions")
def learning_suggest():
    try:
        return {"regles": learning.suggest_rules()}
    except llm.LLMError as e:
        raise HTTPException(400, str(e))


@app.get("/api/apprentissage/export")
def learning_export():
    return JSONResponse(learning.export(), headers={
        "Content-Disposition": f'attachment; filename="apprentissage-{time.strftime("%Y%m%d")}.json"'})


@app.post("/api/projects/{pid}/clips/{cid}/render")
def render(pid: str, cid: str):
    project = _project(pid)
    clip = store.find_clip(project, cid)
    if not clip["segments"]:
        raise HTTPException(400, "Clip vide")
    if jobs.busy_clip(pid, f"Rendu : {clip['title']}"):
        raise HTTPException(409, "Rendu déjà en cours")
    return jobs.submit("rendu", pid, f"Rendu : {clip['title']}", pipeline.render_project_clip, pid, cid)


# ------------------------------------------------------------------ fichiers

@app.get("/files/{pid}/src/{sid}/{kind}/{name}")
def source_file(pid: str, sid: str, kind: str, name: str):
    if kind not in ("proxy", "strips", "frames") or not re.fullmatch(r"[\w.\-]+", name):
        raise HTTPException(404)
    base = store.project_dir(pid) / "sources" / sid
    path = base / "proxy.mp4" if kind == "proxy" else base / kind / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, headers={"Cache-Control": "max-age=86400"})


@app.get("/files/{pid}/exports/{name}")
def export_file(pid: str, name: str, download: int = 0):
    if not re.fullmatch(r"[\w.\-]+", name):
        raise HTTPException(404)
    path = store.project_dir(pid) / "exports" / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, filename=name if download else None)
