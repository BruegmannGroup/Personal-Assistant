#!/usr/bin/env python3
"""Reminder check — Stage C trigger (PDF section 11's dashboard, condensed to a CLI report).

There's no calendar integration in this repo, so this can't page you automatically
before a specific meeting. What it does instead: scan the Momentum Thread Register
and flag every thread whose follow-up date is due, is Dormant, or hasn't had an
encounter logged in a while, as needing a momentum review before you next meet them.
Run it each morning, or before travel, as your manual trigger for Stage C.

Uses reminders.get_flagged_threads() for the flagging logic (staleness/Dormant/due-date
fallback order) — the browser dashboard computes its own thread-status view separately.

Usage:
  python check_reminders.py
  python check_reminders.py --stale-days 21
"""

from __future__ import annotations

import argparse

from reminders import get_flagged_threads
from smartsheet_sync import get_all_threads


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--stale-days", type=int, default=14, help="Flag threads with no encounter logged in this many days (default: 14)")
    args = p.parse_args()

    threads = get_all_threads()
    if not threads:
        print("Momentum Thread Register is empty — nothing to review yet.")
        return

    flagged = get_flagged_threads(stale_days=args.stale_days)
    flagged_ids = {f["thread_id"] for f in flagged}

    if flagged:
        print(f"=== {len(flagged)} thread(s) need a momentum review before your next meeting ===\n")
        for f in flagged:
            print(f"[{f['current_state'] or 'unknown state'}] {f['thread_id']} — {f['reason']}")
            print(f"  Run: python momentum_review.py --thread-id {f['thread_id']} --sync-smartsheet\n")
    else:
        print("No threads currently need a momentum review.")

    ok = [t for t in threads if t["thread_id"] and t["thread_id"] not in flagged_ids]
    if ok:
        print(f"--- {len(ok)} thread(s) recently active, no action needed ---")
        for t in ok:
            print(f"  {t['thread_id']} [{t['current_state']}] — last encounter {t['last_encounter_date'] or 'unknown'}")


if __name__ == "__main__":
    main()
