"""Apprentissage par tes corrections (sans entraîner de modèle).

À chaque rendu final, on garde ce que l'agent avait proposé, ce que tu en as fait et ton avis.
Avant chaque nouvelle proposition, l'agent relit :
  - tes règles de style (regles.md, que tu valides toi-même),
  - tes meilleurs montages validés (exemples concrets de ce que tu veux).
Le journal (exemples.jsonl) pourra aussi servir plus tard à ré-entraîner un modèle local (LoRA).
"""
import json
import threading
import time

from . import config, llm, planner, store

DIR = config.HOME / "apprentissage"
EXAMPLES = DIR / "exemples.jsonl"
RULES = DIR / "regles.md"
_lock = threading.Lock()
DIR.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------------ description lisible d'un montage

def snapshot(project: dict, clip: dict) -> dict:
    """Le montage décrit en mots (plans, paroles), utilisable sans les vidéos."""
    sources = {s["id"]: s for s in project["sources"]}
    words: dict[str, list] = {}
    segs = []
    for g in clip.get("segments", []):
        src = sources.get(g["source"])
        if not src:
            continue
        if src["id"] not in words:
            tr = planner.load_transcript(project["id"], src["id"])
            words[src["id"]] = [w for s in tr.get("segments", []) for w in s["words"]]
        spoken = " ".join(w["w"] for w in words[src["id"]]
                          if g["audio"] == "keep" and w["s"] >= g["start"] - 0.05 and w["e"] <= g["end"] + 0.05)
        vis = sources.get((g.get("overlay") or {}).get("source")) or src
        vt = g["overlay"]["start"] if g.get("overlay") else g["start"]
        shot = planner._shot_at(vis, vt + 0.5) or {}
        segs.append({
            "source": src["label"], "debut": round(g["start"], 2), "fin": round(g["end"], 2),
            "duree": round(g["end"] - g["start"], 2), "son": g["audio"],
            "image": vis["label"] + (f" ({shot.get('description', '')})" if shot.get("description") else ""),
            "illustration": bool(g.get("overlay")), "cadrage": g.get("framing", "crop"),
            "paroles": spoken,
        })
    return {"accroche": clip.get("hook", ""), "legende": clip.get("caption", ""),
            "hashtags": clip.get("hashtags", []), "plans": segs,
            "duree_totale": round(sum(s["duree"] for s in segs), 1)}


def corrections(prop: dict | None, final: dict) -> list[str]:
    """Ce que tu as changé par rapport à la proposition, en phrases courtes."""
    if not prop:
        return ["montage fait à la main (pas de proposition de l'agent)"]
    out = []
    if prop["accroche"].strip() != final["accroche"].strip():
        out.append(f"accroche « {prop['accroche']} » → « {final['accroche']} »")

    def key(s):
        return (s["source"], s["image"].split(" (")[0])

    def overlap(a, b):
        return max(0.0, min(a["fin"], b["fin"]) - max(a["debut"], b["debut"]))

    matched, order = set(), []
    for fs in final["plans"]:
        best = max((i for i, ps in enumerate(prop["plans"]) if i not in matched and ps["source"] == fs["source"]
                    and overlap(ps, fs) > 0.5 * min(ps["duree"], fs["duree"])),
                   key=lambda i: overlap(prop["plans"][i], fs), default=None)
        if best is None:
            out.append(f"plan ajouté : {fs['image']} ({fs['duree']} s)")
            continue
        matched.add(best)
        order.append(best)
        ps = prop["plans"][best]
        if abs(ps["duree"] - fs["duree"]) > 0.3:
            out.append(f"durée ajustée {fs['source']} : {ps['duree']} s → {fs['duree']} s")
        if key(ps) != key(fs):
            out.append(f"image changée : {ps['image']} → {fs['image']}")
        if ps["son"] != fs["son"]:
            out.append(f"son {'coupé' if fs['son'] == 'mute' else 'gardé'} sur {fs['source']}")
    for i, ps in enumerate(prop["plans"]):
        if i not in matched:
            out.append(f"plan retiré : {ps['image']} ({ps['duree']} s)"
                       + (f" « {ps['paroles'][:80]} »" if ps["paroles"] else ""))
    if order != sorted(order):
        out.append("ordre des plans modifié")
    if abs(prop["duree_totale"] - final["duree_totale"]) > 1:
        out.append(f"durée totale {prop['duree_totale']} s → {final['duree_totale']} s")
    if prop["legende"].strip() != final["legende"].strip():
        out.append("légende réécrite")
    return out or ["validé sans modification"]


# ------------------------------------------------------------------ journal

def _read() -> list[dict]:
    if not EXAMPLES.exists():
        return []
    out = []
    for line in EXAMPLES.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _write(entries: list[dict]) -> None:
    tmp = EXAMPLES.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in entries), encoding="utf-8")
    tmp.replace(EXAMPLES)


def _upsert(entry: dict) -> None:
    with _lock:
        entries = [e for e in _read() if e.get("clip") != entry["clip"]]
        entries.append(entry)
        _write(entries)


def _base(project: dict, clip: dict) -> dict:
    b = project["brief"]
    return {"clip": clip["id"], "date": time.strftime("%Y-%m-%d %H:%M"), "projet": project["name"],
            "brief": {k: b.get(k) for k in ("sujet", "ton", "cta", "duree", "notes")},
            "titre": clip.get("title", ""), "angle": clip.get("angle", ""),
            "note": clip.get("note"), "avis": clip.get("avis", ""), "proposition": clip.get("proposal")}


def record_validated(project: dict, clip: dict) -> None:
    final = snapshot(project, clip)
    _upsert({**_base(project, clip), "statut": "valide", "final": final,
             "corrections": corrections(clip.get("proposal"), final)})


def record_rejected(project: dict, clip: dict) -> None:
    if clip.get("proposal") and clip.get("status") == "brouillon":
        _upsert({**_base(project, clip), "statut": "rejete", "final": None,
                 "corrections": ["proposition supprimée sans être utilisée"]})


def update_feedback(clip_id: str, note, avis: str) -> None:
    with _lock:
        entries = _read()
        for e in entries:
            if e.get("clip") == clip_id:
                e["note"], e["avis"] = note, avis
                _write(entries)
                return


def stats() -> dict:
    entries = _read()
    notes = [e["note"] for e in entries if e.get("note")]
    return {"valides": sum(e["statut"] == "valide" for e in entries),
            "rejetes": sum(e["statut"] == "rejete" for e in entries),
            "note_moyenne": round(sum(notes) / len(notes), 1) if notes else None,
            "recents": [{"date": e["date"], "titre": e["titre"], "statut": e["statut"], "note": e.get("note"),
                         "corrections": e["corrections"][:4]} for e in reversed(entries[-5:])]}


# ------------------------------------------------------------------ ce que l'agent relit

def rules() -> str:
    return RULES.read_text(encoding="utf-8") if RULES.exists() else ""


def save_rules(text: str) -> None:
    RULES.write_text(text.strip() + "\n", encoding="utf-8")


def _plans_text(snap: dict) -> str:
    lines = [f"accroche « {snap['accroche']} », {snap['duree_totale']} s"]
    for i, s in enumerate(snap["plans"][:14], 1):
        txt = f"  {i}. {s['image']}, {s['duree']} s"
        if s["paroles"]:
            txt += f", paroles « {s['paroles'][:90]} »"
        if s["illustration"]:
            txt += " (image par-dessus la parole)"
        lines.append(txt)
    return "\n".join(lines)


def examples_text(n: int = 3) -> str:
    """Les meilleurs montages validés récents, avec ce que tu avais corrigé."""
    valid = [e for e in _read() if e["statut"] == "valide" and (e.get("note") or 3) >= 3]
    valid.sort(key=lambda e: (e.get("note") or 3, e["date"]), reverse=True)
    blocks = []
    for e in valid[:n]:
        b = [f"### Montage validé ({e['projet']} ; sujet : {e['brief'].get('sujet') or '—'} ; "
             f"note {e.get('note') or '—'}/5)"]
        if e.get("proposition"):
            b.append("Ce que l'agent avait proposé :\n" + _plans_text(e["proposition"]))
        b.append("Version finale du monteur :\n" + _plans_text(e["final"]))
        b.append("Corrections : " + " ; ".join(e["corrections"]))
        if e.get("avis"):
            b.append(f"Avis du monteur : {e['avis']}")
        blocks.append("\n".join(b))
    return "\n\n".join(blocks)


SUGGEST_SYSTEM = """Tu aides un monteur vidéo (entreprise de paysagisme, Reels/TikTok) à formaliser son style.
À partir de ses corrections et avis sur les propositions d'un agent de montage, déduis des règles de
montage courtes, concrètes et vérifiables (ex. « Commencer par le résultat final, jamais par l'avant »,
« Plans d'illustration de 2 s maximum »). Uniquement des règles appuyées par plusieurs corrections ou par
un avis explicite. Pas de règles déjà présentes dans la liste existante. 8 règles maximum."""

SUGGEST_SCHEMA = {"type": "object", "properties": {"regles": {"type": "array", "items": {"type": "string"}}},
                  "required": ["regles"], "additionalProperties": False}


def suggest_rules() -> list[str]:
    entries = _read()[-15:]
    if not entries:
        raise llm.LLMError("Aucun montage validé ou rejeté pour l'instant : fais quelques rendus d'abord.")
    lines = []
    for e in entries:
        lines.append(f"- [{e['statut']}, note {e.get('note') or '—'}] {e['titre']} : "
                     + " ; ".join(e["corrections"]) + (f" | avis : {e['avis']}" if e.get("avis") else ""))
    content = [{"type": "text", "text": "Règles existantes :\n" + (rules() or "(aucune)")
                + "\n\nCorrections récentes du monteur :\n" + "\n".join(lines)}]
    data, _cost = llm.structured(config.IA_MONTAGE, llm.montage_model(), SUGGEST_SYSTEM, content,
                                 SUGGEST_SCHEMA, effort="medium", max_tokens=8000)
    return [r.strip() for r in data["regles"] if r.strip()][:8]


def export() -> dict:
    return {"exporte_le": time.strftime("%Y-%m-%d %H:%M"), "regles": rules(), "exemples": _read()}
