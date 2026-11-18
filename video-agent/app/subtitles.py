"""Sous-titres dynamiques (mot en cours surligné) et texte d'accroche, au format ASS (libass)."""
from . import config

HIGHLIGHT = "&H0000E6FF&"  # jaune vif (format ASS : &HBBGGRR&)

HEADER = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {config.OUT_W}
PlayResY: {config.OUT_H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Arial Black,84,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,2,90,90,560,1
Style: Hook,Arial Black,72,&H00141414,&H00141414,&H00FFFFFF,&H00FFFFFF,-1,0,0,0,100,100,0,0,3,22,0,8,110,110,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ts(t: float) -> str:
    t = max(0.0, t)
    cs = int(round(t * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _esc(text: str) -> str:
    return text.replace("\\", "/").replace("{", "(").replace("}", ")").replace("\n", " ")


def clip_words(segments: list[dict], words_by_source: dict) -> list[dict]:
    """Mots prononcés, replacés sur la timeline du clip monté."""
    out, offset = [], 0.0
    for seg in segments:
        dur = seg["_dur"]
        if seg["audio"] == "keep":
            for w in words_by_source.get(seg["source"], []):
                if w["s"] >= seg["start"] - 0.05 and w["e"] <= seg["end"] + 0.05:
                    s = offset + max(0.0, w["s"] - seg["start"])
                    e = offset + min(dur, w["e"] - seg["start"])
                    if e > s:
                        out.append({"w": w["w"], "s": s, "e": e, "seg": seg["id"]})
        offset += dur
    return out


def _chunks(words: list[dict], max_words=3, max_chars=18) -> list[list[dict]]:
    chunks, cur = [], []
    for i, w in enumerate(words):
        if cur and (len(cur) >= max_words
                    or len(" ".join(x["w"] for x in cur + [w])) > max_chars
                    or w["s"] - cur[-1]["e"] > 0.5
                    or w["seg"] != cur[-1]["seg"]):
            chunks.append(cur)
            cur = []
        cur.append(w)
        if w["w"][-1:] in ".?!,…":
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    return chunks


def events(words: list[dict], hook: str, total: float, show_subs: bool = True) -> list[tuple]:
    """Liste (début, fin, style, texte) sur la timeline du clip."""
    evs = []
    if hook.strip():
        evs.append((0.0, min(3.0, total), "Hook", _esc(hook.strip().upper())))
    if not show_subs:
        return evs
    chunks = _chunks(words)
    for ci, chunk in enumerate(chunks):
        next_start = chunks[ci + 1][0]["s"] if ci + 1 < len(chunks) else total
        end_chunk = min(chunk[-1]["e"] + 0.25, next_start)
        for i, w in enumerate(chunk):
            s = chunk[0]["s"] if i == 0 else w["s"]
            e = chunk[i + 1]["s"] if i + 1 < len(chunk) else end_chunk
            parts = []
            for j, x in enumerate(chunk):
                txt = _esc(x["w"].upper())
                parts.append(f"{{\\c{HIGHLIGHT}}}{txt}{{\\c&HFFFFFF&}}" if j == i else txt)
            if e > s:
                evs.append((s, e, "Sub", " ".join(parts)))
    return evs


def write_ass(path, evs: list[tuple], window: tuple[float, float]) -> bool:
    """Écrit les événements visibles dans [a, b), recalés à 0. Renvoie False si rien à afficher."""
    a, b = window
    lines = []
    for s, e, style, text in evs:
        s2, e2 = max(s, a), min(e, b)
        if e2 - s2 > 0.02:
            lines.append(f"Dialogue: 0,{_ts(s2 - a)},{_ts(e2 - a)},{style},,0,0,0,,{text}")
    if not lines:
        return False
    path.write_text(HEADER + "\n".join(lines) + "\n", encoding="utf-8")
    return True
