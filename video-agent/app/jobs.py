"""File de tâches : une seule tâche lourde à la fois (analyse, plan, rendu) pour ne pas
saturer le disque et le processeur avec 10 Go de rushs."""
import queue
import threading
import time
import traceback
import uuid

_queue: "queue.Queue[dict]" = queue.Queue()
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


class Job:
    """Poignée passée à la fonction de travail pour remonter progression et messages."""

    def __init__(self, rec: dict):
        self.rec = rec

    def progress(self, value: float, message: str | None = None) -> None:
        with _lock:
            self.rec["progress"] = round(max(0.0, min(1.0, value)), 3)
            if message:
                self.rec["message"] = message

    def add_cost(self, usd: float) -> None:
        with _lock:
            self.rec["cost"] = round(self.rec.get("cost", 0) + usd, 4)


def submit(kind: str, pid: str, label: str, fn, *args) -> dict:
    rec = {"id": uuid.uuid4().hex[:8], "kind": kind, "pid": pid, "label": label, "status": "en_attente",
           "progress": 0.0, "message": "", "cost": 0.0, "created": time.time(), "ended": None, "error": None}
    with _lock:
        _jobs[rec["id"]] = rec
    _queue.put({"rec": rec, "fn": fn, "args": args})
    return dict(rec)


def busy(pid: str, kind: str) -> bool:
    with _lock:
        return any(j["pid"] == pid and j["kind"] == kind and j["status"] in ("en_attente", "en_cours")
                   for j in _jobs.values())


def busy_clip(pid: str, label: str) -> bool:
    with _lock:
        return any(j["pid"] == pid and j["label"] == label and j["status"] in ("en_attente", "en_cours")
                   for j in _jobs.values())


def list_jobs(pid: str | None = None) -> list[dict]:
    with _lock:
        jobs = [dict(j) for j in _jobs.values() if pid is None or j["pid"] == pid]
    return sorted(jobs, key=lambda j: j["created"], reverse=True)[:30]


def _worker() -> None:
    while True:
        item = _queue.get()
        rec = item["rec"]
        with _lock:
            rec["status"] = "en_cours"
        try:
            item["fn"](Job(rec), *item["args"])
            with _lock:
                rec["status"], rec["progress"] = "termine", 1.0
        except Exception as e:  # l'erreur est affichée dans l'interface
            traceback.print_exc()
            with _lock:
                rec["status"], rec["error"] = "erreur", str(e)
        finally:
            with _lock:
                rec["ended"] = time.time()
            _queue.task_done()


threading.Thread(target=_worker, daemon=True, name="video-agent-worker").start()
