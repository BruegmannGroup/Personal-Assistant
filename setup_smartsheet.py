#!/usr/bin/env python3
"""One-time setup: create the Executive Encounter Register and Momentum Thread
Register sheets in Smartsheet, and save their IDs locally.

Requires SMARTSHEET_API_TOKEN (env var or .env) — generate one at
Smartsheet -> Account -> Apps & Integrations -> API Access -> Generate new access token.

Safe to re-run: if a sheet with the right name already exists (including one you
created by hand), it's reused as-is rather than duplicated. It does not attempt
to add missing columns to a sheet you already created by hand — for a clean
setup, let this script create both sheets from scratch.

Usage:
  python setup_smartsheet.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API = "https://api.smartsheet.com/2.0"
REPO_ROOT = Path(__file__).resolve().parent
CONFIG_PATH = REPO_ROOT / "smartsheet_config.json"


def _headers() -> dict:
    token = os.environ.get("SMARTSHEET_API_TOKEN")
    if not token:
        raise RuntimeError("SMARTSHEET_API_TOKEN not set in environment or .env")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _text_column(title: str, primary: bool = False) -> dict:
    col = {"title": title, "type": "TEXT_NUMBER"}
    if primary:
        col["primary"] = True
    return col


def _picklist_column(title: str, options: list[str]) -> dict:
    return {"title": title, "type": "PICKLIST", "options": options}


def _date_column(title: str) -> dict:
    return {"title": title, "type": "DATE"}


ENCOUNTER_COLUMNS = [
    _text_column("Title", primary=True),
    # Smartsheet's API 500s when creating a column with type DATETIME (unlike DATE,
    # it isn't actually creatable via this endpoint despite being a documented type
    # value) — stored as plain text instead, which also preserves full ISO timestamps.
    _text_column("datetime_local"),
    _text_column("local_timezone"),
    _text_column("location"),
    _text_column("organization"),
    _text_column("people_present"),
    _picklist_column(
        "meeting_type",
        ["customer", "supplier", "agent", "internal", "bd_visit", "factory_review", "dinner", "other"],
    ),
    _text_column("thread_id"),
    _text_column("pre_meeting_purpose"),
    _text_column("hypothesis"),
    _text_column("success_criteria"),
    _text_column("observations"),
    _text_column("decisions_made"),
    _text_column("commitments_summary"),
    _text_column("next_logical_action"),
    _picklist_column(
        "current_state",
        ["Discovery", "Validation", "Development", "Adoption", "Conclusion", "Dormant"],
    ),
    _picklist_column(
        "impact_assessment",
        ["positive_impact", "partial_impact", "no_impact", "unknown"],
    ),
    _picklist_column(
        "failure_mode",
        ["none", "no_owner", "no_economics", "no_capability", "no_customer_pull", "no_decision", "no_evidence"],
    ),
    _text_column("next_meeting_objective"),
    _date_column("next_meeting_date"),
    _picklist_column(
        "close_restart_decision",
        ["continue", "close", "reassign", "restart", "replace_player", "not_applicable"],
    ),
    _text_column("momentum_status"),
    _text_column("recommended_next_action"),
    _text_column("topics"),
    _text_column("record_json"),
]

THREAD_COLUMNS = [
    _text_column("Title", primary=True),
    _text_column("thread_id"),
    _text_column("category_name"),
    _text_column("organizations"),
    _picklist_column(
        "current_state",
        ["Discovery", "Validation", "Development", "Adoption", "Conclusion", "Dormant"],
    ),
    _date_column("last_encounter_date"),
    _date_column("next_followup_date"),
    _text_column("last_momentum_review_json"),
    # Written by the browser recording dashboard (worker/): a pre-meeting brief
    # recorded before an encounter exists yet has nowhere else to live until the
    # matching post-meeting recording creates the Encounter row and consumes it.
    _text_column("pending_pre_meeting_brief"),
    _date_column("pending_pre_meeting_recorded_at"),
    _date_column("last_followup_reviewed_at"),
    _text_column("meeting_recommendation_decision"),
    _text_column("meeting_recommendation_rationale"),
]


def get_existing_columns(sheet_id: int) -> list[dict]:
    resp = requests.get(f"{API}/sheets/{sheet_id}/columns", headers=_headers(), timeout=30)
    resp.raise_for_status()
    return resp.json().get("data", [])


def ensure_columns(sheet_id: int, columns: list[dict]) -> None:
    """Add any of the given columns that don't already exist on the sheet by title.
    Safe to call repeatedly — lets re-running setup_smartsheet.py backfill new
    columns onto sheets created by an earlier version of ENCOUNTER_COLUMNS/THREAD_COLUMNS.

    Unlike sheet *creation* (where column order is implicit from array position),
    adding columns to an *existing* sheet requires each one to specify an explicit
    'index' — the insertion point, appended after the current last column. All
    columns in one batch request must share the same index; Smartsheet places them
    in the order given, starting there."""
    existing_cols = get_existing_columns(sheet_id)
    existing_titles = {c["title"] for c in existing_cols}
    next_index = len(existing_cols)

    missing = [c for c in columns if c["title"] not in existing_titles]
    if not missing:
        return
    missing = [{**c, "index": next_index} for c in missing]

    resp = requests.post(f"{API}/sheets/{sheet_id}/columns", headers=_headers(), json=missing, timeout=30)
    if resp.status_code >= 400:
        print(f"  Smartsheet error adding columns: {resp.status_code} {resp.text}")
    resp.raise_for_status()
    for c in missing:
        print(f"  Added column '{c['title']}'.")


def find_sheet_by_name(name: str) -> int | None:
    resp = requests.get(f"{API}/sheets", headers=_headers(), timeout=30, params={"includeAll": True})
    resp.raise_for_status()
    target = name.strip().lower()
    for sheet in resp.json().get("data", []):
        if sheet.get("name", "").strip().lower() == target:
            return sheet["id"]
    return None


def ensure_sheet(name: str, columns: list[dict]) -> int:
    existing = find_sheet_by_name(name)
    if existing:
        print(f"Sheet '{name}' already exists (id={existing}); reconciling columns...")
        ensure_columns(existing, columns)
        return existing

    resp = requests.post(
        f"{API}/sheets",
        headers=_headers(),
        json={"name": name, "columns": columns},
        timeout=30,
    )
    if resp.status_code >= 400:
        print(f"  Smartsheet error {resp.status_code}: {resp.text}")
    resp.raise_for_status()
    sheet_id = resp.json()["result"]["id"]
    print(f"Created sheet '{name}' (id={sheet_id}).")
    return sheet_id


def main():
    encounter_sheet_id = ensure_sheet("Executive Encounter Register", ENCOUNTER_COLUMNS)
    thread_sheet_id = ensure_sheet("Momentum Thread Register", THREAD_COLUMNS)

    config = {
        "encounter_sheet_id": encounter_sheet_id,
        "thread_sheet_id": thread_sheet_id,
    }
    CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding="utf-8")
    print(f"Saved config to {CONFIG_PATH}")


if __name__ == "__main__":
    main()
