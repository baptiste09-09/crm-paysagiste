"""Analyse visuelle des plans par l'IA : description, tags, qualité, position du sujet.

L'IA reçoit 3 petites images (320 px) par plan, jamais la vidéo. En mode local (par défaut),
rien ne quitte le Mac.
"""
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from . import config, llm

TAGS = ["avant", "apres", "travaux", "machine", "drone", "face_camera", "detail", "plan_large",
        "vegetal", "resultat", "equipe", "transition", "inutilisable"]

SYSTEM = """Tu es assistant monteur vidéo pour une entreprise de paysagisme (création et entretien de jardins).
Tu reçois des plans issus de rushs bruts filmés au smartphone ou au drone. Chaque plan est montré par
3 images côte à côte : début, milieu et fin du plan.

Pour chaque plan, renvoie :
- description : 20 mots maximum, concrète (ce qu'on voit, l'action, le cadrage). Pas d'interprétation.
- tags : parmi la liste imposée. "inutilisable" si flou, tremblé, sous/surexposé, objectif masqué, sol filmé par erreur.
- qualite : 1 à 5 (netteté, stabilité, exposition, cadrage).
- interet : 1 à 5, potentiel pour accrocher sur Instagram/TikTok (résultat spectaculaire, avant/après, machine en action = élevé ; plan vide ou banal = faible).
- sujet_x : position horizontale du sujet principal entre 0 (bord gauche) et 1 (bord droit), sert à recadrer en vertical 9:16.
Utilise exactement l'identifiant fourni pour chaque plan."""

SCHEMA = {
    "type": "object",
    "properties": {
        "plans": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "description": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string", "enum": TAGS}},
                    "qualite": {"type": "integer"},
                    "interet": {"type": "integer"},
                    "sujet_x": {"type": "number"},
                },
                "required": ["id", "description", "tags", "qualite", "interet", "sujet_x"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["plans"],
    "additionalProperties": False,
}

BATCH = 12


def _describe_batch(items: list[tuple[str, dict, Path, str]]) -> tuple[dict, float]:
    content = [{"type": "text", "text": f"{len(items)} plans à décrire."}]
    for shot_id, shot, strip, speech in items:
        label = f"Plan {shot_id} — {shot['end'] - shot['start']:.1f} s"
        if speech:
            label += f" — paroles : « {speech[:200]} »"
        content.append({"type": "text", "text": label})
        content.append({"type": "image", "source": {
            "type": "base64", "media_type": "image/jpeg",
            "data": base64.standard_b64encode(strip.read_bytes()).decode()}})
    data, cost = llm.structured(config.IA_VISION, llm.vision_model(), SYSTEM, content, SCHEMA,
                                effort="low", max_tokens=16000)
    plans = data["plans"]
    if len(items) == 1 and len(plans) == 1:  # un petit modèle peut mal recopier l'identifiant
        plans[0]["id"] = items[0][0]
    return {p["id"]: p for p in plans}, cost


def describe_shots(items: list[tuple[str, dict, Path, str]], on_progress=None) -> tuple[dict, float]:
    """items : (id, plan, chemin de la vignette, paroles). Renvoie {id: analyse}, coût total."""
    local = config.IA_VISION != "claude"
    size = 1 if local else BATCH  # un plan par requête : plus fiable avec un modèle local
    batches = [items[i:i + size] for i in range(0, len(items), size)]
    results, total_cost, done = {}, 0.0, 0
    with ThreadPoolExecutor(max_workers=1 if local else 4) as pool:  # Ollama traite une requête à la fois
        futures = [pool.submit(_describe_batch, b) for b in batches]
        errors = []
        for fut in as_completed(futures):
            try:
                res, cost = fut.result()
                results.update(res)
                total_cost += cost
            except llm.LLMError as e:  # un plan raté n'arrête pas l'analyse du rush
                errors.append(e)
            done += 1
            if on_progress:
                on_progress(done / len(batches))
    if errors and not results:  # tout a échoué : IA indisponible, on remonte la cause
        raise errors[0]
    for r in results.values():
        r["qualite"] = max(1, min(5, int(r["qualite"])))
        r["interet"] = max(1, min(5, int(r["interet"])))
        r["sujet_x"] = round(max(0.0, min(1.0, float(r["sujet_x"]))), 2)
    return results, total_cost
