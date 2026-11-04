"""World builders and host-only deltas for factory families, in AutomationBench's own dumped WorldState shape.

The shapes were read off AutomationBench's handlers (scratchpad probe, 2026-11-04: values_append, rows PUT,
chat.postMessage, messages/send, jira issue create) so a world built here round-trips through WorldState unchanged
(gate G1 checks it in the AutomationBench venv). Standard library only.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone

UTC = timezone.utc


def row(rid: str, ss: str, ws: str, row_id: int, cells: dict) -> dict:
    return {"id": rid, "spreadsheet_id": ss, "worksheet_id": ws, "row_id": row_id, "cells": dict(cells),
            "background_color": None, "text_color": None, "text_format_bold": False, "text_format_italic": False,
            "text_format_strikethrough": False, "timezone": False}


def sheets(spec: list[dict]) -> dict:
    """spec: [{id, title, worksheets: [{id, title, headers, rows: [(rid, cells)]}]}] -> google_sheets."""
    out = {"spreadsheets": [], "worksheets": [], "rows": []}
    for ss in spec:
        out["spreadsheets"].append({"id": ss["id"], "title": ss["title"], "drive": None, "spreadsheet_to_copy": None,
                                    "headers": []})
        for ws in ss["worksheets"]:
            out["worksheets"].append({"id": ws["id"], "spreadsheet_id": ss["id"], "title": ws["title"],
                                      "headers": list(ws["headers"]), "overwrite": False, "copy_to": None})
            for k, (rid, cells) in enumerate(ws["rows"]):
                full = {h: str(cells.get(h, "")) for h in ws["headers"]}
                out["rows"].append(row(rid, ss["id"], ws["id"], k + 2, full))
    return out


def slack_user(uid: str, username: str, name: str, email=None, is_bot=False) -> dict:
    return {"id": uid, "username": username, "name": name, "email": email, "first_name": None, "last_name": None,
            "title": None, "phone": None, "status_text": None, "status_emoji": None, "is_admin": False,
            "is_owner": False, "is_bot": is_bot, "is_deleted": False, "tz": None, "tz_label": None}


def slack_channel(cid: str, name: str, members: list[str], topic: str) -> dict:
    return {"id": cid, "name": name, "is_channel": True, "is_private": False, "is_archived": False,
            "is_general": False, "topic": topic, "purpose": None, "creator_id": None, "created": None,
            "member_ids": list(members), "channel_type": "public"}


def slack_message(ts: str, channel_id: str, user_id: str, text: str, created_at: str, is_bot=False, bot_name=None) -> dict:
    return {"id": None, "ts": ts, "channel_id": channel_id, "user_id": user_id, "text": text, "thread_ts": None,
            "reply_count": 0, "is_bot": is_bot, "bot_name": bot_name, "bot_icon": None, "reactions": [],
            "attachments": [], "created_at": created_at, "edited_at": None, "is_deleted": False,
            "scheduled_message_id": None, "post_at": None}


def gmail_message(mid: str, thread: str, frm: str, to: list[str], subject: str, body: str, ms: int,
                  labels=("INBOX",), from_name=None, is_read=False, html=None, snippet=None) -> dict:
    return {"id": mid, "thread_id": thread, "from_": frm, "from_name": from_name, "to": list(to), "cc": [], "bcc": [],
            "reply_to": None, "in_reply_to": None, "subject": subject, "body_plain": body, "body_html": html,
            "snippet": snippet, "label_ids": list(labels), "attachment_ids": [], "is_read": is_read,
            "is_starred": False, "has_attachments": False, "date": ms, "internal_date": ms, "size_estimate": 1000}


def jira(projects: list[tuple[str, str, str]]) -> dict:
    return {"actions": {"project": [{"id": f"jira_project_{k.lower()}", "action_key": "project",
                                     "params": {"key": k, "name": n, "projectTypeKey": t},
                                     "created_at": "2025-06-02T09:00:00Z"} for k, n, t in projects]},
            "issues": [], "projects": []}


def ws_of(world: dict, ss: str, title: str) -> dict:
    return next(w for w in world["google_sheets"]["worksheets"] if w["spreadsheet_id"] == ss and w["title"] == title)


def table(world: dict, ss: str, title: str) -> list[dict]:
    """Rows of a worksheet in row order (cells as strings) with '_row_id' and '_id'."""
    ws = ws_of(world, ss, title)
    rows = sorted((r for r in world["google_sheets"]["rows"] if r["spreadsheet_id"] == ss and r["worksheet_id"] == ws["id"]),
                  key=lambda r: r["row_id"])
    return [{**{h: str(r["cells"].get(h, "")) for h in ws["headers"]}, "_row_id": r["row_id"], "_id": r["id"]} for r in rows]


def apply_delta(world: dict, delta: list, at: str) -> dict:
    """Host-only world ops before a trigger fires, then meta.current_time = trigger time. Ops:
    insert_row {ss, sheet, rid, cells}; update_row {ss, sheet, key_col, key, cells} (the first row whose key column
    equals key, exactly); add_email {message}. An update whose row the arm deleted raises (loud, never silent)."""
    w = copy.deepcopy(world)
    rows = w["google_sheets"]["rows"]
    for op in delta:
        if op["op"] == "insert_row":
            ws = ws_of(w, op["ss"], op["sheet"])
            if any(r["id"] == op["rid"] for r in rows):
                raise ValueError(f"row {op['rid']} already exists")
            ids = [r["row_id"] for r in rows if r["spreadsheet_id"] == op["ss"] and r["worksheet_id"] == ws["id"]]
            full = {h: str(op["cells"].get(h, "")) for h in ws["headers"]}
            rows.append(row(op["rid"], op["ss"], ws["id"], max(ids, default=1) + 1, full))
        elif op["op"] == "update_row":
            ws = ws_of(w, op["ss"], op["sheet"])
            hit = sorted((r for r in rows if r["spreadsheet_id"] == op["ss"] and r["worksheet_id"] == ws["id"]
                          and str(r["cells"].get(op["key_col"], "")) == op["key"]), key=lambda r: r["row_id"])
            if not hit:
                raise ValueError(f"row {op['key']} to update is missing in {op['sheet']}")
            hit[0]["cells"] = dict(hit[0]["cells"], **{k: str(v) for k, v in op["cells"].items()})
        elif op["op"] == "add_email":
            w["gmail"]["messages"].append(copy.deepcopy(op["message"]))
        else:
            raise ValueError(f"unsupported delta op {op['op']!r}")
    w["meta"]["current_time"] = at
    return w


def at_ms(at: str) -> int:
    return int(datetime.fromisoformat(at.replace("Z", "+00:00")).timestamp() * 1000)
