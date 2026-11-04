"""Pure helpers that were byte-identical across the AB-R families (B0 extraction, 2026-11-04).

Each function here is the exact body the families carried; `tools/b0_extract.py` replaced only definitions whose source
hash matched the canonical copy, so behaviour cannot drift. Needs only the standard library.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

UTC = timezone.utc


def canon(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(obj) -> str:
    return hashlib.sha256((obj if isinstance(obj, str) else canon(obj)).encode("utf-8")).hexdigest()


def iso_z(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


class PlanError(RuntimeError):
    pass


def _chan(world: dict, name: str) -> str:
    return next(c["id"] for c in world["slack"]["channels"] if c["name"] == name)


def _chan_id(world: dict, name: str):
    return next((c["id"] for c in world.get("slack", {}).get("channels", []) if c.get("name") == name), None)


def is_sent(m: dict) -> bool:
    return "SENT" in (m.get("label_ids") or [])


def body_of(m: dict) -> str:
    return f"{m.get('body_plain') or ''}\n{m.get('body_html') or ''}"


def make_stream_hashes(sha_fn=sha):
    """gates.stream_hashes, bound to the family generator's sha (every family's is the canonical one above)."""
    def stream_hashes(out: dict) -> dict:
        return {k: sha_fn(out[k]) for k in ("world0", "payloads", "triggers", "truth", "end")}
    return stream_hashes
