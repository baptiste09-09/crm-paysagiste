"""Stockage des projets : un dossier par projet, un project.json écrit de façon atomique."""
import json
import os
import re
import threading
import time
import uuid
from pathlib import Path

from . import config

_lock = threading.RLock()


def _slug(text: str) -> str:
    text = re.sub(r"[^\w\s-]", "", text.lower(), flags=re.UNICODE)
    return re.sub(r"[\s_-]+", "-", text).strip("-")[:40] or "projet"


def project_dir(pid: str) -> Path:
    if not re.fullmatch(r"[\w-]+", pid):
        raise ValueError("identifiant de projet invalide")
    return config.PROJECTS_DIR / pid


def source_dir(pid: str, sid: str) -> Path:
    if not re.fullmatch(r"[\w-]+", sid):
        raise ValueError("identifiant de rush invalide")
    d = project_dir(pid) / "sources" / sid
    d.mkdir(parents=True, exist_ok=True)
    return d


def _path(pid: str) -> Path:
    return project_dir(pid) / "project.json"


def load(pid: str) -> dict:
    with _lock:
        return json.loads(_path(pid).read_text(encoding="utf-8"))


def save(project: dict) -> None:
    with _lock:
        p = _path(project["id"])
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(project, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, p)


def update(pid: str, fn):
    """Lit, modifie via fn(project) et réécrit sous verrou. Renvoie ce que fn renvoie."""
    with _lock:
        project = load(pid)
        result = fn(project)
        save(project)
        return result


def create(name: str) -> dict:
    pid = f"{time.strftime('%Y%m%d')}-{_slug(name)}-{uuid.uuid4().hex[:4]}"
    project_dir(pid).mkdir(parents=True, exist_ok=True)
    project = {
        "id": pid,
        "name": name.strip() or "Sans titre",
        "created": time.time(),
        "brief": {
            "sujet": "",
            "ville": "",
            "ton": "dynamique et concret",
            "cta": "Demandez votre devis gratuit",
            "nb_clips": 3,
            "duree": 35,
            "musique": "",
            "notes": "",
        },
        "sources": [],
        "clips": [],
    }
    save(project)
    return project


def list_projects() -> list[dict]:
    out = []
    for p in sorted(config.PROJECTS_DIR.glob("*/project.json"), reverse=True):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        out.append({
            "id": data["id"],
            "name": data["name"],
            "created": data.get("created"),
            "sources": len(data.get("sources", [])),
            "clips": len(data.get("clips", [])),
            "size": sum(s.get("size", 0) for s in data.get("sources", [])),
        })
    return out


def find_source(project: dict, sid: str) -> dict:
    for s in project["sources"]:
        if s["id"] == sid:
            return s
    raise KeyError(sid)


def find_clip(project: dict, cid: str) -> dict:
    for c in project["clips"]:
        if c["id"] == cid:
            return c
    raise KeyError(cid)


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:6]}"
