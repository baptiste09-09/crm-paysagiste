"""Analyse visuelle des plans par Claude : description, tags, qualité, position du sujet.

Seules de petites vignettes (3 images de 320 px par plan) partent vers l'API, jamais la vidéo.
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
    data, cost = llm.structured(config.VISION_MODEL, SYSTEM, content, SCHEMA, effort="low", max_tokens=16000)
    return {p["id"]: p for p in data["plans"]}, cost


def describe_shots(items: list[tuple[str, dict, Path, str]], on_progress=None) -> tuple[dict, float]:
    """items : (id, plan, chemin de la vignette, paroles). Renvoie {id: analyse}, coût total."""
    batches = [items[i:i + BATCH] for i in range(0, len(items), BATCH)]
    results, total_cost, done = {}, 0.0, 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_describe_batch, b) for b in batches]
        for fut in as_completed(futures):
            res, cost = fut.result()
            results.update(res)
            total_cost += cost
            done += 1
            if on_progress:
                on_progress(done / len(batches))
    for r in results.values():
        r["qualite"] = max(1, min(5, int(r["qualite"])))
        r["interet"] = max(1, min(5, int(r["interet"])))
        r["sujet_x"] = round(max(0.0, min(1.0, float(r["sujet_x"]))), 2)
    return results, total_cost
