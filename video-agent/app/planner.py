"""L'agent monteur : l'IA (locale ou Claude) lit le catalogue des rushs (plans décrits + paroles horodatées)
et propose plusieurs clips verticaux. Le plan de montage est ensuite nettoyé ici
(coupes calées sur les mots, silences retirés) avant d'être soumis à validation."""
import json

from . import config, llm, store

SYSTEM = """Tu es le monteur vidéo d'une entreprise de paysagisme. Tu crées des vidéos verticales courtes
(Reels Instagram, TikTok, YouTube Shorts) à partir du catalogue de rushs bruts fourni.

Règles de montage :
1. Accroche dans les 2 premières secondes : le plan le plus fort (résultat, avant/après, machine en action)
   ou la phrase la plus percutante. Jamais d'introduction lente ("Bonjour, aujourd'hui on va...").
2. Rythme : plans d'illustration de 1,5 à 4 s. La parole peut durer plus longtemps, mais recouvre-la d'un plan
   d'illustration (overlay) au moins toutes les 4 s pour garder du mouvement à l'écran.
3. Parole : coupe aux limites de phrases, en t'appuyant sur les horodatages. Retire hésitations, répétitions et
   faux départs. Ne coupe jamais au milieu d'un mot.
4. Structure : accroche -> contexte -> travaux -> résultat -> appel à l'action.
5. Utilise les plans de qualité >= 3. N'utilise jamais un plan tagué "inutilisable".
6. Chaque clip a un angle différent (avant/après, process accéléré, conseil du pro, détail technique...).
   Évite de réutiliser les mêmes extraits d'un clip à l'autre.
7. Respecte la durée cible à ±20 %.

Format :
- Les temps sont en secondes dans le rush source (source_id = "R01", "R02"...).
- Un segment est un extrait [start, end] d'un rush. audio = "garder" pour la parole ou un son utile
  (moteur, eau), "couper" sinon (la musique prend le relais).
- overlay : liste vide, ou un seul plan d'illustration affiché PAR-DESSUS pendant toute la durée du segment
  (le son reste celui du segment). C'est la technique à utiliser pendant la parole.
  Donne son source_id et son start ; la durée est celle du segment, vérifie que le plan est assez long.
- Voix off : les rushs "Voix off" (V01, V02...) sont du son seul, sans image. Tout segment pris dans une
  voix off a audio = "garder" et DOIT avoir un overlay issu d'un rush vidéo. Pour changer d'image pendant
  une longue phrase, découpe la voix off en segments consécutifs (la fin de l'un = le début du suivant,
  dans une pause entre deux mots), chacun avec un overlay différent. Voix off et parole filmée sur le
  chantier peuvent se mélanger dans un même clip.
- La musique sera ajoutée dans TikTok/Instagram : ne compte pas dessus pour combler un silence de plus
  de 3 s sans son utile.
- cadrage : "recadrer" (plein écran vertical, par défaut) ou "entier" (image entière sur fond flouté,
  pour les plans larges horizontaux où le recadrage perdrait l'essentiel, comme un drone ou un avant/après).
- accroche : texte affiché à l'écran au début, 7 mots maximum, sans hashtag.
- legende : texte du post (2 à 4 phrases) qui se termine par l'appel à l'action.
- hashtags : 5 à 10, pertinents et locaux si une ville est donnée."""

SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "titre": {"type": "string"},
                    "angle": {"type": "string"},
                    "accroche": {"type": "string"},
                    "legende": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                    "segments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_id": {"type": "string"},
                                "start": {"type": "number"},
                                "end": {"type": "number"},
                                "audio": {"type": "string", "enum": ["garder", "couper"]},
                                "cadrage": {"type": "string", "enum": ["recadrer", "entier"]},
                                "overlay": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "source_id": {"type": "string"},
                                            "start": {"type": "number"},
                                        },
                                        "required": ["source_id", "start"],
                                        "additionalProperties": False,
                                    },
                                },
                                "raison": {"type": "string"},
                            },
                            "required": ["source_id", "start", "end", "audio", "cadrage", "overlay", "raison"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["titre", "angle", "accroche", "legende", "hashtags", "segments"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clips"],
    "additionalProperties": False,
}


# ---------------------------------------------------------------- catalogue

def _phrases(transcript: dict) -> list[tuple[float, float, str]]:
    """Découpe fine de la parole (pauses, ponctuation) pour donner des points de coupe précis."""
    out, cur = [], []
    words = [w for seg in transcript.get("segments", []) for w in seg["words"]]
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        if (nxt is None or nxt["s"] - w["e"] > 0.35 or w["w"][-1:] in ".?!…" or len(cur) >= 14):
            out.append((cur[0]["s"], cur[-1]["e"], " ".join(x["w"] for x in cur)))
            cur = []
    return out


def load_transcript(pid: str, sid: str) -> dict:
    p = store.source_dir(pid, sid) / "transcript.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"segments": []}


def catalog(project: dict, compact: bool = False) -> str:
    """compact : sans les plans inutilisables ou de mauvaise qualité (contexte limité des modèles locaux)."""
    lines = []
    for src in project["sources"]:
        if src.get("status") != "pret":
            continue
        tr = load_transcript(project["id"], src["id"])
        info = src["info"]
        if not info.get("has_video", True):
            lines.append(f"\n## Voix off {src['label']} — {src['name']} — {info['duration']:.1f} s — son seul, sans image")
            phrases = _phrases(tr)
            lines += ["Paroles horodatées :"] + [f"[{a:.2f}–{b:.2f}] {t}" for a, b, t in phrases] \
                if phrases else ["(aucune parole détectée)"]
            continue
        lines.append(f"\n## Rush {src['label']} — {src['name']} — {info['duration']:.1f} s — "
                     f"{info['orientation']} — parole : {'oui' if tr.get('segments') else 'non'}")
        lines.append("Plans (id | début–fin | qualité q, intérêt i | sujet_x | tags | description) :")
        for sh in src.get("shots", []):
            if compact and ("inutilisable" in sh.get("tags", []) or sh.get("qualite", 3) <= 2):
                continue
            lines.append(f"{sh['id']} | {sh['start']:.1f}–{sh['end']:.1f} | q{sh.get('qualite', '?')} "
                         f"i{sh.get('interet', '?')} | x{sh.get('sujet_x', 0.5)} | "
                         f"{','.join(sh.get('tags', []))} | {sh.get('description', '')}")
        phrases = _phrases(tr)
        if phrases:
            lines.append("Paroles horodatées :")
            lines += [f"[{a:.2f}–{b:.2f}] {t}" for a, b, t in phrases]
    return "\n".join(lines)


def brief_text(brief: dict) -> str:
    return (f"Sujet / chantier : {brief.get('sujet') or 'non précisé'}\n"
            f"Ville / zone : {brief.get('ville') or 'non précisée'}\n"
            f"Ton : {brief.get('ton')}\n"
            f"Appel à l'action : {brief.get('cta')}\n"
            f"Nombre de clips : {brief.get('nb_clips', 3)}\n"
            f"Durée cible par clip : {brief.get('duree', 35)} s\n"
            f"Consignes : {brief.get('notes') or 'aucune'}")


# ---------------------------------------------------------------- nettoyage

def _snap(start: float, end: float, words: list[dict]) -> tuple[float, float]:
    """Cale les bords d'un segment parlé sur les mots, avec une petite marge."""
    inside = [w for w in words if w["e"] > start + 0.05 and w["s"] < end - 0.05]
    if not inside:
        return start, end
    first, last = inside[0], inside[-1]
    prev = [w for w in words if w["e"] <= first["s"]]
    nxt = [w for w in words if w["s"] >= last["e"]]
    new_start = max(first["s"] - 0.10, prev[-1]["e"] if prev else 0.0)
    new_end = min(last["e"] + 0.15, nxt[0]["s"] if nxt else last["e"] + 0.15)
    # on ne déplace pas un bord qui tombe déjà dans un silence
    if abs(new_start - start) > 0.6:
        new_start = start
    if abs(new_end - end) > 0.6:
        new_end = end
    return round(new_start, 3), round(new_end, 3)


def _cut_point(t: float, words: list[dict], gap: float = 0.6) -> tuple[float, float]:
    """Coupe entre deux segments consécutifs d'un même son (voix off découpée sous plusieurs images).
    Renvoie (fin du segment précédent, début du suivant) : dans la pause la plus proche, jamais
    au milieu d'un mot, et sans répéter ni perdre de mot. Une longue pause est raccourcie."""
    best = None
    for w1, w2 in zip(words, words[1:]):
        mid = (w1["e"] + w2["s"]) / 2
        if best is None or abs(mid - t) < abs(best[0] - t):
            best = (mid, w1, w2)
    if best is None or abs(best[0] - t) > 1.5:
        return t, t
    mid, w1, w2 = best
    if w2["s"] - w1["e"] > gap:
        return round(w1["e"] + 0.15, 3), round(w2["s"] - 0.12, 3)
    return round(mid, 3), round(mid, 3)


def _tighten(seg: dict, words: list[dict], gap: float = 0.6) -> list[dict]:
    """Retire les silences > gap à l'intérieur d'un segment parlé (jump cuts)."""
    inside = [w for w in words if w["s"] >= seg["start"] - 0.01 and w["e"] <= seg["end"] + 0.01]
    if len(inside) < 2:
        return [seg]
    pieces, a = [], seg["start"]
    for w1, w2 in zip(inside, inside[1:]):
        if w2["s"] - w1["e"] > gap:
            pieces.append((a, w1["e"] + 0.15))
            a = w2["s"] - 0.12
    pieces.append((a, seg["end"]))
    if len(pieces) == 1:
        return [seg]
    out, elapsed = [], 0.0
    for a, b in pieces:
        p = dict(seg, id=store.new_id("g"), start=round(a, 3), end=round(b, 3))
        if seg.get("overlay"):  # l'illustration continue sans saut
            p["overlay"] = dict(seg["overlay"], start=round(seg["overlay"]["start"] + elapsed, 3))
        elapsed += b - a
        out.append(p)
    return out


def _shot_at(src: dict, t: float) -> dict | None:
    for sh in src.get("shots", []):
        if sh["start"] <= t <= sh["end"]:
            return sh
    return None


def by_label_id(by_label: dict, sid: str) -> dict:
    return next(s for s in by_label.values() if s["id"] == sid)


def _best_broll(sources, length: float, used: set) -> dict | None:
    """Plan d'illustration le plus intéressant, pas encore utilisé et assez long."""
    candidates = []
    for src in sources:
        if not src["info"].get("has_video", True) or src["info"]["duration"] < length:
            continue
        for sh in src.get("shots", []):
            if "inutilisable" in sh.get("tags", []):
                continue
            start = min(sh["start"], src["info"]["duration"] - length)
            fresh = (src["id"], round(start)) not in used
            candidates.append((fresh, sh.get("interet", 3) + sh.get("qualite", 3), -sh["start"], src["id"], start))
    if not candidates:
        return None
    best = max(candidates)
    return {"source": best[3], "start": round(best[4], 3)}


def clean_clip(project: dict, raw: dict, tighten: bool = True) -> dict:
    by_label = {s["label"]: s for s in project["sources"] if s.get("status") == "pret"}
    words_cache: dict[str, list] = {}

    def words(src):
        if src["id"] not in words_cache:
            tr = load_transcript(project["id"], src["id"])
            words_cache[src["id"]] = [w for seg in tr.get("segments", []) for w in seg["words"]]
        return words_cache[src["id"]]

    raws = raw["segments"]
    label = lambda s: s["source_id"].split("-")[0]  # noqa: E731
    # segments consécutifs pris dans le même son (ex. voix off sous plusieurs images) : coupe commune
    shared = {}
    for k in range(1, len(raws)):
        a, b = raws[k - 1], raws[k]
        src = by_label.get(label(b))
        if src and label(a) == label(b) and abs(float(a["end"]) - float(b["start"])) < 0.05:
            shared[k] = _cut_point(float(b["start"]), words(src))

    segments, used = [], set()
    for k, s in enumerate(raws):
        src = by_label.get(label(s))
        if not src:
            continue
        is_voice = not src["info"].get("has_video", True)
        dur_max = src["info"]["duration"]
        start, end = max(0.0, float(s["start"])), min(dur_max, float(s["end"]))
        if end - start < 0.4:
            continue
        keep = (s["audio"] == "garder" or is_voice) and src["info"]["has_audio"]
        if keep:
            start, end = _snap(start, end, words(src))
            if k in shared:
                start = shared[k][1]
            if k + 1 in shared:
                end = shared[k + 1][0]
            start, end = max(0.0, start), min(dur_max, end)
            if end - start < 0.3:
                continue
        seg = {"id": store.new_id("g"), "source": src["id"], "start": round(start, 3), "end": round(end, 3),
               "audio": "keep" if keep else "mute",
               "framing": "fit" if s.get("cadrage") == "entier" else "crop",
               "overlay": None, "why": s.get("raison", "")}
        visual_src, visual_t = src, start
        length = end - start
        for ov in s.get("overlay", [])[:1]:
            osrc = by_label.get(ov["source_id"].split("-")[0])
            if not osrc or not osrc["info"].get("has_video", True) or osrc["info"]["duration"] < length:
                continue
            ostart = min(max(0.0, float(ov["start"])), osrc["info"]["duration"] - length)
            seg["overlay"] = {"source": osrc["id"], "start": round(ostart, 3)}
            visual_src, visual_t = osrc, ostart
        if is_voice and not seg["overlay"]:  # une voix off sans image : on prend le meilleur plan libre
            pick = _best_broll(by_label.values(), length, used)
            if not pick:
                continue
            seg["overlay"] = pick
            visual_src, visual_t = by_label_id(by_label, pick["source"]), pick["start"]
        if seg["overlay"]:
            used.add((seg["overlay"]["source"], round(seg["overlay"]["start"])))
        shot = _shot_at(visual_src, visual_t + 0.5)
        seg["crop_x"] = shot.get("sujet_x", 0.5) if shot else 0.5
        if keep and tighten:
            segments.extend(_tighten(seg, words(src)))
        else:
            segments.append(seg)

    return {
        "id": store.new_id("c"),
        "title": raw["titre"],
        "angle": raw["angle"],
        "hook": raw["accroche"],
        "caption": raw["legende"],
        "hashtags": [h if h.startswith("#") else f"#{h}" for h in raw["hashtags"]],
        "segments": segments,
        "subtitles": True,
        "music": project["brief"].get("musique", ""),
        "status": "brouillon",
        "export": None,
    }


def plan(project: dict) -> tuple[list[dict], float]:
    local = config.IA_MONTAGE != "claude"
    cat = catalog(project, compact=local)
    if not cat.strip():
        raise llm.LLMError("Aucun rush analysé : lance d'abord l'analyse.")
    from . import learning  # import tardif : learning dépend de ce module

    system = SYSTEM
    style = learning.rules().strip()
    if style:
        system += ("\n\nRègles de style du monteur, PRIORITAIRES sur les règles générales ci-dessus :\n" + style)
    content = [{"type": "text", "text": f"# Catalogue des rushs\n{cat}"}]
    examples = learning.examples_text(2 if local else 3)
    if examples:
        content.append({"type": "text", "text": "# Montages déjà validés par le monteur (inspire-toi de ses "
                                                "choix et de ses corrections, pas de leurs plans)\n" + examples})
    content.append({"type": "text", "text": f"# Brief\n{brief_text(project['brief'])}\n\nPropose les clips demandés."})
    data, cost = llm.structured(config.IA_MONTAGE, llm.montage_model(), system, content, SCHEMA,
                                effort="high", max_tokens=48000)
    clips = [clean_clip(project, c) for c in data["clips"]]
    clips = [c for c in clips if c["segments"]]
    for c in clips:  # mémorisé pour comparer avec ta version finale
        c["proposal"] = learning.snapshot(project, c)
    return clips, cost
