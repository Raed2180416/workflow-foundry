"""Generated bad controls for a factory family (G5): the roster comes from compiled.json (spec.controls_roster).

null        does nothing (passes exactly the no-op share)
echo        posts the payload in the family's main channel at every trigger
naive       the family's own <= 40-line control (naive.py: what a quick script would do)
memoryless  the reference reading no state column (state of record ignored)
clause_<X>  the reference with clause X removed (no decorative clause: each must fail somewhere, G3/G5)
trap_<...>  the reference with one trap resolution broken (G6: fail-to-pass on that trap's exposed triggers)
eager       the quiet clause's control: the reference acting on row events too (bound to the family's quiet clause)
"""
from __future__ import annotations

import functools
import json


def build_controls(fam) -> dict:
    ref = fam.reference.handle
    spec = fam.spec
    main_channel = next(iter(spec["channels"].values()))
    out = {}

    def null(payload, ctx):
        return None

    def echo(payload, ctx):
        from .store import store_for
        st = store_for(ctx)
        st.post(main_channel, json.dumps(payload)[:300])
        st.flush()

    out["null"], out["echo"] = null, echo
    try:
        out["naive"] = fam._load("naive").handle
    except FileNotFoundError:
        pass
    out["memoryless"] = functools.partial(ref, flags=frozenset({"memoryless"}))
    quiet = {c["id"] for c in spec["clauses"] if "Quiet" in c["title"] or c.get("quiet")}
    for c in spec["clauses"]:
        if c["id"] in quiet:
            out[f"clause_{c['id']}"] = functools.partial(ref, flags=frozenset({"eager"}))
        else:
            out[f"clause_{c['id']}"] = functools.partial(ref, off=frozenset({c["id"]}))
    for t in spec["traps"]:
        out[t["control"]] = functools.partial(ref, flags=frozenset({t["control"]}))
    return out
