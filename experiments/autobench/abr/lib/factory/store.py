"""The I/O surface a factory family's code solver uses, with two interchangeable back ends.

ToolStore  calls AutomationBench's own tools (api_fetch through bridge.Rollout: the app's own model path, the path a
           model arm uses). Needs the AutomationBench venv.
WorldStore applies the same reads and writes directly to the world dict ("abr-apply"): the same records with the same
           fields, ids from a per-trigger seeded RNG. Standard library only; ~1000x faster, so gates can run every
           control on every dev stream. Gate G12 proves the two produce the same world (generated ids and clocks
           masked) on dev streams.

A solver gets `store_for(ctx)` and never sees which back end it has. Writes are buffered and applied by flush().
"""
from __future__ import annotations

import base64
import json
import random
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

from . import world as W

UTC = timezone.utc
SHEETS = "https://sheets.googleapis.com/v4/spreadsheets"
SLACK = "https://slack.com/api/chat.postMessage"
GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me"
JIRA = "https://company.atlassian.net/rest/api/3/issue"


class StoreError(RuntimeError):
    pass


class _Base:
    def __init__(self):
        self.ops: list[tuple] = []

    def set_cells(self, ss: str, sheet: str, key_col: str, key: str, cells: dict, row_id: int | None = None):
        self.ops.append(("cells", ss, sheet, key_col, key, {k: str(v) for k, v in cells.items()}, row_id))

    def append(self, ss: str, sheet: str, values: list):
        self.ops.append(("append", ss, sheet, [str(v) for v in values]))

    def post(self, channel: str, text: str):
        self.ops.append(("post", channel, text))

    def mail(self, to: str, subject: str, body: str):
        self.ops.append(("mail", to, subject, body))

    def issue(self, project: str, issuetype: str, summary: str, description: str = ""):
        self.ops.append(("issue", project, issuetype, summary, description))


class WorldStore(_Base):
    """abr-apply: direct application to `world` (mutated in place by flush)."""

    def __init__(self, world: dict, at: str, seed: int):
        super().__init__()
        self.world, self.at, self.rng = world, datetime.fromisoformat(at.replace("Z", "+00:00")), random.Random(seed)
        self.tick = 0

    def _hex(self, n):
        return "".join(self.rng.choice("0123456789abcdef") for _ in range(n))

    def _clock(self) -> datetime:
        self.tick += 1
        return self.at + timedelta(milliseconds=self.tick)

    def rows(self, ss: str, sheet: str) -> list[dict]:
        return W.table(self.world, ss, sheet)

    def message(self, mid: str) -> dict:
        m = next((x for x in self.world["gmail"]["messages"] if x["id"] == mid), None)
        if m is None:
            raise StoreError(f"message {mid} not found")
        return {"from": m.get("from_"), "to": m.get("to"), "subject": m.get("subject"), "body_plain": m.get("body_plain")}

    def flush(self):
        w = self.world
        for op in self.ops:
            kind = op[0]
            if kind == "cells":
                _, ss, sheet, key_col, key, cells, row_id = op
                ws = W.ws_of(w, ss, sheet)
                cands = [r for r in w["google_sheets"]["rows"] if r["spreadsheet_id"] == ss and r["worksheet_id"] == ws["id"]
                         and str(r["cells"].get(key_col, "")) == key]
                if row_id is not None:
                    cands = [r for r in cands if r["row_id"] == row_id] or cands
                if len(cands) != 1:
                    raise StoreError(f"cannot locate {sheet} row {key!r} ({len(cands)} candidates)")
                cands[0]["cells"] = dict(cands[0]["cells"], **cells)
            elif kind == "append":
                _, ss, sheet, values = op
                ws = W.ws_of(w, ss, sheet)
                ids = [r["row_id"] for r in w["google_sheets"]["rows"] if r["spreadsheet_id"] == ss and r["worksheet_id"] == ws["id"]]
                cells = {h: (values[i] if i < len(values) else "") for i, h in enumerate(ws["headers"])}
                w["google_sheets"]["rows"].append(W.row(self._hex(32), ss, ws["id"], max(ids, default=1) + 1, cells))
            elif kind == "post":
                _, channel, text = op
                ch = next((c for c in w["slack"]["channels"] if c["name"] == channel.lstrip("#") or c["id"] == channel), None)
                if ch is None:
                    raise StoreError(f"channel {channel} not found")
                t = self._clock()
                w["slack"]["messages"].append(W.slack_message(f"{int(t.timestamp())}.{self.rng.randrange(10**6):06d}", ch["id"],
                                                              "USLACKBOT", text, t.replace(tzinfo=None).isoformat(),
                                                              is_bot=True, bot_name="Zapier"))
            elif kind == "mail":
                _, to, subject, body = op
                t = self._clock()
                ms = int(t.timestamp() * 1000)
                m = W.gmail_message(self._hex(16), self._hex(16), "user@gmail.com", [to], subject, body, ms, labels=("SENT",),
                                    is_read=True, html=f"<html><body>{body}</body></html>", snippet=body[:100])
                m["internal_date"] = ms + 1
                w["gmail"]["messages"].append(m)
            elif kind == "issue":
                _, project, itype, summary, desc = op
                t = self._clock()
                w["jira"]["actions"].setdefault("create_issue", []).append(
                    {"id": "jira_" + self._hex(32), "action_key": "create_issue",
                     "params": {"project": project, "issuetype": itype, "summary": summary, "description": desc},
                     "created_at": t.strftime("%Y-%m-%dT%H:%M:%S.%f") + "Z"})
        self.ops = []


class ToolStore(_Base):
    """The same API through AutomationBench's api_fetch (abr.lib.host.Ctx)."""

    def __init__(self, ctx):
        super().__init__()
        self.ctx = ctx
        self._ws_ids: dict = {}

    def rows(self, ss: str, sheet: str) -> list[dict]:
        r = self.ctx.fetch_json("GET", f"{SHEETS}/{ss}/values/{quote(sheet)}")
        vals = r.get("values") or []
        if not vals:
            return []
        hdr = [str(h) for h in vals[0]]
        return [{**dict(zip(hdr, [str(v) for v in x] + [""] * (len(hdr) - len(x)))), "_row_id": k + 2}
                for k, x in enumerate(vals[1:])]

    def message(self, mid: str) -> dict:
        m = self.ctx.fetch_json("GET", f"{GMAIL}/messages/{quote(str(mid))}")
        if not isinstance(m, dict) or "error" in m:
            raise StoreError(f"message {mid} not found")
        return {"from": m.get("from"), "to": m.get("to"), "subject": m.get("subject"), "body_plain": m.get("body_plain")}

    def flush(self):
        reqs = []
        cell_ops = [op for op in self.ops if op[0] == "cells"]
        if cell_ops:
            looks = self.ctx.fetch_many([("GET", f"{SHEETS}/{op[1]}/values/{quote(op[2])}:lookup",
                                          {"lookupKey": op[3], "lookupValue": op[4], "rowCount": 50}) for op in cell_ops])
            located = {}
            for op, res in zip(cell_ops, looks):
                cands = [x for x in (res.get("rows") or []) if str((x.get("cells") or {}).get(op[3], "")) == op[4]]
                if op[6] is not None:
                    cands = [x for x in cands if x.get("row_id") == op[6]] or cands
                if len(cands) != 1:
                    raise StoreError(f"cannot locate {op[2]} row {op[4]!r} ({len(cands)} candidates)")
                located[id(op)] = cands[0]
        for op in self.ops:
            kind = op[0]
            if kind == "cells":
                c = located[id(op)]
                reqs.append(("PUT", f"{SHEETS}/{op[1]}/values/{quote(str(c['worksheet_id']))}/rows/{c['row_id']}", None,
                             {"cells": op[5]}))
            elif kind == "append":
                reqs.append(("POST", f"{SHEETS}/{op[1]}/values/{quote(op[2])}:append", {"valueInputOption": "RAW"},
                             {"values": [op[3]]}))
            elif kind == "post":
                reqs.append(("POST", SLACK, None, {"channel": op[1].lstrip("#"), "text": op[2]}))
            elif kind == "mail":
                raw = f"To: {op[1]}\r\nSubject: {op[2]}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{op[3]}"
                reqs.append(("POST", f"{GMAIL}/messages/send", None,
                             {"raw": base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii")}))
            elif kind == "issue":
                reqs.append(("POST", JIRA, None, {"fields": {"project": {"key": op[1]}, "issuetype": {"name": op[2]},
                                                             "summary": op[3], "description": op[4]}}))
        self.ops = []
        if reqs:
            outs = self.ctx.fetch_many(reqs)
            bad = [o for o in outs if isinstance(o, dict) and (o.get("error") or o.get("ok") is False or o.get("success") is False)]
            if bad:
                raise StoreError(f"write failed: {json.dumps(bad[0])[:300]}")


class FastCtx:
    """What the harness hands a code solver in fast mode: a WorldStore and nothing else (no truth, no generator)."""

    def __init__(self, world: dict, at: str, seed: int):
        self.store = WorldStore(world, at, seed)
        self.steps = 0
        self.calls = 0


def store_for(ctx):
    return ctx.store if isinstance(ctx, FastCtx) else ToolStore(ctx)
