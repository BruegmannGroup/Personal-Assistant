#!/usr/bin/env python3
"""Pre-meeting prompt — Stage A of the three prompt moments (PDF section 6A).

Run this before a meaningful meeting/visit. It asks the same six questions as
agent/prompt.txt's "Pre Meeting" block, pulls this thread's prior commitments
from Smartsheet automatically (if any exist) so you're checking against real
data instead of memory, and saves a metadata file shaped exactly for
transcribe_and_extract.py's --metadata flag — so your stated intent shows up
in the actual encounter record instead of being reconstructed from scratch
after the fact.

Usage:
  python pre_meeting.py
  python pre_meeting.py --out bhpro_pre.json
  # later:
  python transcribe_and_extract.py --audio meeting.m4a --metadata bhpro_pre.json --sync-smartsheet
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path


def ask(prompt: str, required: bool = True) -> str:
    while True:
        answer = input(f"{prompt}\n> ").strip()
        if answer or not required:
            return answer
        print("(required — please enter something)")


def ask_list(prompt: str) -> list[str]:
    raw = input(f"{prompt} (comma-separated, blank to skip)\n> ").strip()
    return [item.strip() for item in raw.split(",") if item.strip()]


def show_prior_context(thread_id: str) -> None:
    try:
        from smartsheet_sync import get_encounters_for_thread
    except Exception as e:
        print(f"(couldn't check Smartsheet for prior context: {e})")
        return

    try:
        records = get_encounters_for_thread(thread_id)
    except Exception as e:
        print(f"(couldn't check Smartsheet for prior context: {e})")
        return

    if not records:
        print(f"No prior encounters found for thread_id='{thread_id}' — this looks like a first meeting.")
        return

    last = records[-1]
    print(f"\n--- Prior context for thread '{thread_id}' ({len(records)} prior encounter(s)) ---")
    print(f"Last encounter: {last.get('encounter_name')} ({last.get('datetime_local')})")
    print(f"Last state: {last.get('current_state')}")
    print(f"Objective set for this meeting: {last.get('next_meeting_objective', '(none stated)')}")
    open_commitments = [
        c for c in last.get("commitments", [])
    ]
    if open_commitments:
        print("Open commitments from last time:")
        for c in open_commitments:
            print(f"  - {c.get('description')} (owner: {c.get('owner')}, due: {c.get('due_date')})")
    print(f"Tip: run `python momentum_review.py --thread-id {thread_id}` for the full follow-up maturity review before you go in.\n")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", default=None, help="Output metadata JSON path (default: <thread-id>_pre_meeting.json)")
    args = p.parse_args()

    print("Pre-meeting brief — answer briefly, this feeds directly into your post-meeting record.\n")

    thread_id = ask("Thread id (short stable slug for this company/relationship, e.g. 'bhpro'):")
    show_prior_context(thread_id)

    encounter_name = ask("Encounter name (e.g. 'BHPro Factory Visit'):")
    organization = ask("Organization:")
    location = ask("Location:")
    local_timezone = ask("Local timezone (e.g. 'Asia/Bangkok'):", required=False) or "UTC"
    meeting_type = ask(
        "Meeting type (customer / supplier / agent / internal / bd_visit / factory_review / dinner / other):"
    )

    print("\n--- The six pre-meeting questions (PDF section 6A) ---")
    why = ask("1. Why am I meeting them?")
    learn = ask("2. What am I trying to learn, validate, or decide?")
    hypothesis = ask("3. What hypothesis am I testing?")
    useful = ask("4. What would make this meeting useful?")
    waste = ask("5. What would make this meeting a waste of time?")
    prior_check = ask("6. What prior commitments or open threads should be checked?", required=False)

    metadata = {
        "thread_id": thread_id,
        "encounter_name": encounter_name,
        "datetime_local": datetime.now().isoformat(timespec="minutes"),
        "local_timezone": local_timezone,
        "location": location,
        "organization": organization,
        "meeting_type": meeting_type,
        "pre_meeting_purpose": why,
        "hypothesis": hypothesis,
        "success_criteria": [learn, useful],
        "prior_commitments_to_check": [c.strip() for c in prior_check.split(",") if c.strip()],
        "waste_of_time_criteria": waste,
    }

    out_path = args.out or f"{thread_id}_pre_meeting.json"
    Path(out_path).write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\nSaved pre-meeting brief to {out_path}")
    print("After the meeting, run:")
    print(f"  python transcribe_and_extract.py --audio <recording> --metadata {out_path} --sync-smartsheet")


if __name__ == "__main__":
    main()
