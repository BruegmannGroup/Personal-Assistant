"""Shared "what needs attention" logic for Stage C, used by check_reminders.py (CLI).

Priority order: an explicit next_followup_date that's due or overdue is the precise,
intentional trigger (set during post-meeting capture — "when should the follow-up
occur?"). The generic staleness/Dormant heuristic is only a fallback for threads
where no such date was ever set.
"""

from __future__ import annotations

from datetime import date, datetime

from smartsheet_sync import get_all_threads


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value[:10]).date()
    except ValueError:
        return None


def get_flagged_threads(stale_days: int = 14) -> list[dict]:
    """Return threads needing a momentum review before their next meeting, each as
    {thread_id, current_state, last_encounter_date, next_followup_date, days_since, reason},
    sorted with the most urgent first (overdue follow-up date, then Dormant, then stale)."""
    today = date.today()
    flagged = []

    for t in get_all_threads():
        thread_id = t["thread_id"]
        if not thread_id:
            continue

        current_state = t["current_state"]
        last_date = _parse_date(t["last_encounter_date"])
        followup_date = _parse_date(t["next_followup_date"])
        days_since = (today - last_date).days if last_date else None

        is_due = followup_date is not None and followup_date <= today
        is_dormant = current_state == "Dormant"
        is_stale = followup_date is None and days_since is not None and days_since >= stale_days
        never_reviewed = followup_date is None and days_since is None

        if not (is_due or is_dormant or is_stale or never_reviewed):
            continue

        reasons = []
        if is_due:
            reasons.append(f"follow-up was due {followup_date.isoformat()}")
        if is_dormant:
            reasons.append("marked Dormant")
        if is_stale:
            reasons.append(f"no encounter in {days_since} days")
        if never_reviewed:
            reasons.append("no last_encounter_date on record")

        flagged.append({
            "thread_id": thread_id,
            "current_state": current_state,
            "last_encounter_date": t["last_encounter_date"],
            "next_followup_date": t["next_followup_date"],
            "days_since": days_since,
            "reason": ", ".join(reasons),
            "_sort_key": (0 if is_due else 1 if is_dormant else 2, -(days_since or 999999)),
        })

    flagged.sort(key=lambda f: f["_sort_key"])
    for f in flagged:
        del f["_sort_key"]
    return flagged
