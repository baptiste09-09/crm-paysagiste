"""Transcription locale avec horodatage au mot (rien n'est envoyé sur Internet).

- Mac Apple Silicon : mlx-whisper (utilise le GPU de la puce M).
- Autres machines : faster-whisper sur CPU.
"""
import re
from pathlib import Path

from . import config

# Phrases que Whisper "invente" sur les silences en français (bruit, vent, machines)
_HALLUCINATIONS = re.compile(
    r"amara\.org|sous-titr|merci d'avoir regard|abonnez-vous|n'oubliez pas de vous abonner|"
    r"merci de votre attention|soustitreur|❤",
    re.I,
)


# Vocabulaire métier : aide Whisper à bien orthographier les termes du paysagisme
PROMPT = ("Chantier de paysagisme : gazon, pelouse, haie, taille, élagage, débroussaillage, terrassement, "
          "mini-pelle, dalles, terrasse, bordures, massif, paillage, arrosage automatique, clôture, devis.")
_PROMPT_TERMS = [t.strip(" .").lower() for t in PROMPT.split(":")[1].split(",")]


def engine_name() -> str:
    try:
        import mlx_whisper  # noqa: F401
        return "mlx-whisper"
    except ImportError:
        pass
    try:
        import faster_whisper  # noqa: F401
        return "faster-whisper"
    except ImportError:
        return ""


def _clean(segments: list[dict]) -> list[dict]:
    out = []
    for seg in segments:
        text = seg["text"].strip()
        if not text or _HALLUCINATIONS.search(text):
            continue
        if sum(term in text.lower() for term in _PROMPT_TERMS) >= 4:  # Whisper a recopié le vocabulaire
            continue
        if seg.get("no_speech", 0) > 0.6 and seg.get("logprob", 0) < -0.8:
            continue
        words = [w for w in seg["words"] if w["w"].strip()]
        if not words:
            continue
        out.append({"start": words[0]["s"], "end": words[-1]["e"], "text": text, "words": words})
    return out


def transcribe(wav: Path) -> dict:
    engine = engine_name()
    if not engine:
        return {"engine": None, "segments": [],
                "warning": "Aucun moteur Whisper installé : montage sur l'image uniquement."}

    segments = []
    if engine == "mlx-whisper":
        import mlx_whisper

        result = mlx_whisper.transcribe(
            str(wav),
            path_or_hf_repo=config.WHISPER_MODEL_MLX,
            language=config.LANGUAGE,
            word_timestamps=True,
            condition_on_previous_text=False,  # limite les répétitions en boucle
            initial_prompt=PROMPT,
        )
        for s in result.get("segments", []):
            segments.append({
                "text": s.get("text", ""),
                "no_speech": s.get("no_speech_prob", 0),
                "logprob": s.get("avg_logprob", 0),
                "words": [{"w": w["word"].strip(), "s": round(w["start"], 3), "e": round(w["end"], 3)}
                          for w in s.get("words", [])],
            })
    else:
        from faster_whisper import WhisperModel

        model = WhisperModel(config.WHISPER_MODEL_CPU, device="auto", compute_type="int8")
        result, _info = model.transcribe(
            str(wav), language=config.LANGUAGE, word_timestamps=True,
            vad_filter=True, condition_on_previous_text=False, initial_prompt=PROMPT,
        )
        for s in result:
            segments.append({
                "text": s.text,
                "no_speech": s.no_speech_prob,
                "logprob": s.avg_logprob,
                "words": [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)}
                          for w in (s.words or [])],
            })
    return {"engine": engine, "segments": _clean(segments)}


def words_between(transcript: dict, start: float, end: float) -> list[dict]:
    return [w for seg in transcript.get("segments", []) for w in seg["words"]
            if w["s"] >= start - 0.05 and w["e"] <= end + 0.05]


def text_between(transcript: dict, start: float, end: float) -> str:
    return " ".join(w["w"] for w in words_between(transcript, start, end))
