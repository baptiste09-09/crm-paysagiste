"""Appel à Claude avec sortie JSON garantie par schéma (structured outputs)."""
import json

import anthropic

# Modèles qui acceptent le repli automatique côté serveur en cas de refus
_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-fable-5-2"}
# $ par million de tokens (entrée, sortie) — pour afficher une estimation du coût
_PRICES = {"claude-opus-5-5": (4.0, 20.0), "claude-sonnet-5-5": (2.0, 10.0), "claude-haiku-5-5": (0.10, 0.50)}


class LLMError(RuntimeError):
    pass


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


def structured(model: str, system: str, content: list, schema: dict,
               effort: str = "medium", max_tokens: int = 32000) -> tuple[dict, float]:
    """Renvoie (données JSON conformes au schéma, coût estimé en $)."""
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
