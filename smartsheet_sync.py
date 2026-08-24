"""Sync Encounter Records and Momentum Threads to Smartsheet.

Smartsheet cells are scalar (no nested arrays/objects), so structured fields
(commitments, observations, epistemic_log, etc.) are stored two ways on each row:
  - a human-readable flattened text rendering, for browsing/editing in Smartsheet
  - a full JSON blob in `record_json`, which this module reads back for programmatic
    use (e.g. building a Momentum Review from prior encounters)

Run setup_smartsheet.py once before using this module — it creates the two sheets
and writes smartsheet_config.json with their IDs.

Auth: set SMARTSHEET_API_TOKEN (env var or .env) to a personal access token from
Smartsheet -> Account -> Apps & Integrations -> API Access -> Generate new access token.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

REPO_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = REPO_ROOT / "smartsheet_config.json"

API = "https://api.smartsheet.com/2.0"

ENCOUNTER_SHEET_NAME = "Executive Encounter Register"
THREAD_SHEET_NAME = "Momentum Thread Register"


def _headers() -> dict:
    token = os.environ.get("SMARTSHEET_API_TOKEN")
    if not token:
        raise RuntimeError("SMARTSHEET_API_TOKEN not set in environment or .env")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise RuntimeError(
            f"{CONFIG_PATH.name} not found. Run `python setup_smartsheet.py` first."
        )
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def _join(items: list | None, sep: str = "\n") -> str:
    return sep.join(str(i) for i in (items or []))


def _commitments_summary(commitments: list[dict] | None) -> str:
    lines = []
    for c in commitments or []:
        due = c.get("due_date") or "no due date"
        evidence = c.get("evidence_required") or "n/a"
        lines.append(f"{c.get('description')} — owner: {c.get('owner')} — due: {due} — evidence: {evidence}")
    return "\n".join(lines)


def get_column_map(sheet_id: int) -> dict[str, int]:
    resp = requests.get(f"{API}/sheets/{sheet_id}/columns", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return {c["title"]: c["id"] for c in resp.json().get("data", [])}


def _cells_from_fields(column_map: dict[str, int], fields: dict) -> list[dict]:
    cells = []
    for title, value in fields.items():
        col_id = column_map.get(title)
        if col_id is None or value is None:
            continue
        cells.append({"columnId": col_id, "value": value})
    return cells


def _get_all_rows(sheet_id: int) -> list[dict]:
    resp = requests.get(f"{API}/sheets/{sheet_id}", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json().get("rows", [])


def _row_cell_value(row: dict, column_map: dict[str, int], title: str):
    col_id = column_map.get(title)
    for cell in row.get("cells", []):
        if cell.get("columnId") == col_id:
            return cell.get("value")
    return None


def push_encounter_record(record: dict) -> dict:
    """Add a Smartsheet row for one validated encounter_record."""
    config = _load_config()
    sheet_id = config["encounter_sheet_id"]
    column_map = get_column_map(sheet_id)

    fields = {
        "Title": record["encounter_name"],
        "datetime_local": record["datetime_local"],
        "local_timezone": record["local_timezone"],
        "location": record["location"],
        "organization": record["organization"],
        "people_present": _join(record.get("people_present"), sep="; "),
        "meeting_type": record["meeting_type"],
        "thread_id": record["thread_id"],
        "pre_meeting_purpose": record.get("pre_meeting_purpose", ""),
        "hypothesis": record.get("hypothesis", ""),
        "success_criteria": _join(record.get("success_criteria")),
        "observations": _join(record.get("observations")),
        "decisions_made": _join(record.get("decisions_made")),
        "commitments_summary": _commitments_summary(record.get("commitments")),
        "next_logical_action": record.get("next_logical_action", ""),
        "current_state": record["current_state"],
        "impact_assessment": record["impact_assessment"],
        "failure_mode": record["failure_mode"],
        "next_meeting_objective": record.get("next_meeting_objective", ""),
        "next_meeting_date": record.get("next_meeting_date"),
        "close_restart_decision": record["close_restart_decision"],
        "momentum_status": record.get("momentum_status", ""),
        "recommended_next_action": record.get("recommended_next_action", ""),
        "topics": _join(record.get("topics"), sep="; "),
        "record_json": json.dumps(record, ensure_ascii=False),
    }

    row = {"toBottom": True, "cells": _cells_from_fields(column_map, fields)}
    resp = requests.post(f"{API}/sheets/{sheet_id}/rows", headers=_headers(), json=[row], timeout=30)
    resp.raise_for_status()
    _upsert_thread(record)
    return resp.json()


def _find_thread_row(thread_id: str) -> dict | None:
    config = _load_config()
    sheet_id = config["thread_sheet_id"]
    column_map = get_column_map(sheet_id)
    for row in _get_all_rows(sheet_id):
        if _row_cell_value(row, column_map, "thread_id") == thread_id:
            return row
    return None


def _upsert_thread(record: dict) -> None:
    """Keep the Momentum Thread Register's summary row for this thread current."""
    config = _load_config()
    sheet_id = config["thread_sheet_id"]
    column_map = get_column_map(sheet_id)

    fields = {
        "Title": record["thread_id"],
        "thread_id": record["thread_id"],
        "organizations": record["organization"],
        "current_state": record["current_state"],
        "last_encounter_date": record["datetime_local"][:10],
        "next_followup_date": record.get("next_meeting_date"),
    }
    cells = _cells_from_fields(column_map, fields)

    existing = _find_thread_row(record["thread_id"])
    if existing:
        row = {"id": existing["id"], "cells": cells}
        resp = requests.put(f"{API}/sheets/{sheet_id}/rows", headers=_headers(), json=[row], timeout=30)
    else:
        row = {"toBottom": True, "cells": cells}
        resp = requests.post(f"{API}/sheets/{sheet_id}/rows", headers=_headers(), json=[row], timeout=30)
    resp.raise_for_status()


def push_momentum_review(review: dict) -> None:
    """Store the latest momentum review JSON on the thread's summary row."""
    from datetime import datetime

    config = _load_config()
    sheet_id = config["thread_sheet_id"]
    column_map = get_column_map(sheet_id)

    recommendation = review.get("meeting_recommendation") or {}
    fields = {
        "Title": review["thread_name"],
        "thread_id": review["thread_id"],
        "category_name": review.get("category_name", ""),
        "organizations": review.get("organizations", ""),
        "current_state": review["thread_state"],
        "last_momentum_review_json": json.dumps(review, ensure_ascii=False),
        "last_followup_reviewed_at": datetime.now().date().isoformat(),
        "meeting_recommendation_decision": recommendation.get("decision", ""),
        "meeting_recommendation_rationale": recommendation.get("rationale", ""),
    }
    cells = _cells_from_fields(column_map, fields)

    existing = _find_thread_row(review["thread_id"])
    if existing:
        row = {"id": existing["id"], "cells": cells}
        resp = requests.put(f"{API}/sheets/{sheet_id}/rows", headers=_headers(), json=[row], timeout=30)
    else:
        row = {"toBottom": True, "cells": cells}
        resp = requests.post(f"{API}/sheets/{sheet_id}/rows", headers=_headers(), json=[row], timeout=30)
    resp.raise_for_status()


def get_all_encounters() -> list[dict]:
    """Return every encounter_record JSON payload across all threads, newest first —
    used by dashboard.py for the meeting list and the aggregate action-items view."""
    config = _load_config()
    sheet_id = config["encounter_sheet_id"]
    column_map = get_column_map(sheet_id)

    records = []
    for row in _get_all_rows(sheet_id):
        raw = _row_cell_value(row, column_map, "record_json")
        if raw:
            records.append(json.loads(raw))

    records.sort(key=lambda r: r.get("datetime_local", ""), reverse=True)
    return records


def get_encounters_for_thread(thread_id: str) -> list[dict]:
    """Return prior encounter_record JSON payloads for a thread, oldest first."""
    config = _load_config()
    sheet_id = config["encounter_sheet_id"]
    column_map = get_column_map(sheet_id)

    records = []
    for row in _get_all_rows(sheet_id):
        if _row_cell_value(row, column_map, "thread_id") != thread_id:
            continue
        raw = _row_cell_value(row, column_map, "record_json")
        if raw:
            records.append(json.loads(raw))

    records.sort(key=lambda r: r.get("datetime_local", ""))
    return records


def get_all_threads() -> list[dict]:
    """Return every row of the Momentum Thread Register as plain dicts —
    used by reminders.py to scan for Dormant/stale/due threads."""
    config = _load_config()
    sheet_id = config["thread_sheet_id"]
    column_map = get_column_map(sheet_id)

    threads = []
    for row in _get_all_rows(sheet_id):
        threads.append({
            "thread_id": _row_cell_value(row, column_map, "thread_id"),
            "current_state": _row_cell_value(row, column_map, "current_state"),
            "last_encounter_date": _row_cell_value(row, column_map, "last_encounter_date"),
            "next_followup_date": _row_cell_value(row, column_map, "next_followup_date"),
        })
    return threads
