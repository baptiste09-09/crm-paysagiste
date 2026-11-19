"""Appel à l'IA avec une réponse JSON imposée par un schéma.

Deux moteurs interchangeables :
  - "local"  : modèle open source sur le Mac via Ollama. Gratuit, rien ne quitte la machine.
  - "claude" : API Anthropic. Payant, meilleure qualité de montage.
"""
import json
import os
import urllib.error
import urllib.request

import anthropic

from . import config

# Modèles qui acceptent le repli automatique côté serveur en cas de refus
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5-2"}
# $ par million de tokens (entrée, sortie) — pour afficher une estimation du coût
_PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50)}


class LLMError(RuntimeError):
    pass


def structured(backend: str, model: str, system: str, content: list, schema: dict,
               effort: str = "medium", max_tokens: int = 32000) -> tuple[dict, float]:
    """Renvoie (données JSON conformes au schéma, coût estimé en $ ; 0 en local)."""
    if backend == "claude":
        return _claude(model, system, content, schema, effort, max_tokens)
    return _ollama(model, system, content, schema), 0.0


# ------------------------------------------------------------------ IA locale (Ollama)

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # Ollama est sur le Mac


def _call_ollama(path: str, payload: dict | None, timeout: float) -> dict:
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(config.OLLAMA_URL + path, data=data,
                                 headers={"Content-Type": "application/json"})
    with _opener.open(req, timeout=timeout) as r:
        return json.loads(r.read())


def _ollama(model: str, system: str, content: list, schema: dict) -> dict:
    prompt = "\n\n".join(b["text"] for b in content if b["type"] == "text")
    images = [b["source"]["data"] for b in content if b["type"] == "image"]
    # estimation grossière : ~3 caractères par token en français, ~400 tokens par image
    est = (len(system) + len(prompt)) // 3 + 400 * len(images) + 1500
    if est > config.LOCAL_MAX_CTX - 4096:
        raise LLMError(f"Trop de rushs d'un coup pour l'IA locale (~{est} tokens, limite {config.LOCAL_MAX_CTX}). "
                       "Répartis les rushs en plusieurs projets, ou augmente LOCAL_MAX_CTX si le Mac a 32 Go.")
    # paliers fixes : changer de taille de contexte obligerait Ollama à recharger le modèle
    num_ctx = next(c for c in (8192, 16384, 32768, 65536, 131072) if c >= min(est * 1.3 + 4096, config.LOCAL_MAX_CTX))
    user = {"role": "user", "content": prompt}
    if images:
        user["images"] = images
    payload = {"model": model, "stream": False, "format": schema, "keep_alive": "10m",
               "messages": [{"role": "system", "content": system}, user],
               "options": {"num_ctx": num_ctx, "temperature": 0.2}}
    try:
        data = _call_ollama("/api/chat", payload, timeout=1800)
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        if e.code == 404:
            raise LLMError(f"Modèle {model} absent. Dans le Terminal : ollama pull {model}")
        raise LLMError(f"Erreur Ollama {e.code} : {body[:200]}")
    except (urllib.error.URLError, ConnectionError, TimeoutError):
        raise LLMError("Ollama ne répond pas : ouvre l'app Ollama ou lance « brew services start ollama ».")
    text = data.get("message", {}).get("content", "")
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        raise LLMError(f"Réponse illisible du modèle {model} ({e}). Réessaie.")


def unload(model: str) -> None:
    """Libère la mémoire d'un modèle local (utile sur un Mac 16 Go). Sans effet si Ollama est arrêté."""
    try:
        _call_ollama("/api/generate", {"model": model, "keep_alive": 0}, timeout=30)
    except Exception:
        pass


# ------------------------------------------------------------------ Claude (API payante)

_client = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(max_retries=4, timeout=900)
    return _client


def cost_usd(model: str, usage) -> float:
    pin, pout = _PRICES.get(model, (4.0, 20.0))
    inp = (usage.input_tokens or 0) + (usage.cache_creation_input_tokens or 0) * 1.25 \
        + (usage.cache_read_input_tokens or 0) * 0.1
    return inp * pin / 1e6 + (usage.output_tokens or 0) * pout / 1e6


def _claude(model: str, system: str, content: list, schema: dict,
            effort: str, max_tokens: int) -> tuple[dict, float]:
    kwargs = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": content}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
    )
    if model in _FALLBACK_MODELS:
        kwargs.update(betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    try:
        with _get_client().beta.messages.stream(**kwargs) as stream:
            msg = stream.get_final_message()
    except anthropic.AuthenticationError:
        raise LLMError("Clé API Anthropic refusée : vérifie ANTHROPIC_API_KEY dans video-agent/.env")
    except anthropic.PermissionDeniedError as e:
        raise LLMError(f"Accès refusé par l'API Claude : {e.message}")
    except anthropic.NotFoundError:
        raise LLMError(f"Modèle inconnu : {model} (variable CLAUDE_MODEL)")
    except anthropic.RateLimitError:
        raise LLMError("Limite de débit de l'API Claude atteinte, réessaie dans une minute.")
    except anthropic.APIStatusError as e:
        raise LLMError(f"Erreur API Claude {e.status_code} : {e.message}")
    except anthropic.APIConnectionError:
        raise LLMError("Impossible de joindre l'API Claude (connexion Internet ?).")
    except anthropic.AnthropicError as e:  # ex. aucune clé configurée
        raise LLMError(f"Configuration Claude incomplète : {e}")

    if msg.stop_reason == "refusal":
        raise LLMError("Claude a refusé cette demande.")
    if msg.stop_reason == "max_tokens":
        raise LLMError("Réponse de Claude tronquée (trop de rushs d'un coup ?). Réduis le nombre de clips.")
    text = "".join(b.text for b in msg.content if b.type == "text")
    try:
        return json.loads(text), cost_usd(model, msg.usage)
    except json.JSONDecodeError as e:
        raise LLMError(f"Réponse JSON invalide : {e}")


# ------------------------------------------------------------------ état (affiché dans l'interface)

def vision_model() -> str:
    return config.LOCAL_VISION_MODEL if config.IA_VISION != "claude" else config.VISION_MODEL


def montage_model() -> str:
    return config.LOCAL_TEXT_MODEL if config.IA_MONTAGE != "claude" else config.CLAUDE_MODEL


def status() -> dict:
    out = {"vision": config.IA_VISION, "montage": config.IA_MONTAGE,
           "models": [vision_model(), montage_model()], "ok": True, "detail": ""}
    local = [m for b, m in ((config.IA_VISION, vision_model()), (config.IA_MONTAGE, montage_model()))
             if b != "claude"]
    if local:
        try:
            names = {m["name"] for m in _call_ollama("/api/tags", None, timeout=3).get("models", [])}
        except Exception:
            return {**out, "ok": False, "detail": "Ollama arrêté"}
        missing = sorted({m for m in local if m not in names and f"{m}:latest" not in names})
        if missing:
            return {**out, "ok": False, "detail": "Modèle à télécharger : " + ", ".join(missing)}
    if "claude" in (config.IA_VISION, config.IA_MONTAGE) and not (
            os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return {**out, "ok": False, "detail": "Clé Claude absente"}
    return out
