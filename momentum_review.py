#!/usr/bin/env python3
"""Generate a Momentum Review for a thread before your next meeting with it.

This is the "prevent restart theater" feature from the PDF: it pulls every prior
Encounter Record for a thread (e.g. bhpro) from Smartsheet, and asks the LLM to
run the Follow-up Maturity prompt against that history — did the agreed work
happen, did it create real progress, and should the next meeting continue,
close, reassign, restart, or replace the player.

run_momentum_review() is the reusable entry point — both this CLI's main() and
dashboard.py's "Generate Momentum Review" button call it, so the two never diverge.

Usage:
  python momentum_review.py --thread-id bhpro
  python momentum_review.py --thread-id bhpro --sync-smartsheet
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from jsonschema import validate, ValidationError

from llm_client import call_llm
from smartsheet_sync import get_encounters_for_thread, push_momentum_review

REPO_ROOT = Path(__file__).resolve().parent
SYSTEM_PROMPT_PATH = REPO_ROOT / "agent" / "executive-memory-agent.system.txt"
MOMENTUM_SCHEMA_PATH = REPO_ROOT / "schemas" / "momentum-review.schema.json"


def load_system_prompt() -> str:
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def summarize_encounters(records: list[dict]) -> str:
    lines = []
    for i, r in enumerate(records, start=1):
        lines.append(f"--- Encounter {i}: {r['encounter_name']} ({r['datetime_local']}) ---")
        lines.append(f"Purpose: {r.get('pre_meeting_purpose', '')}")
        lines.append(f"Hypothesis: {r.get('hypothesis', '')}")
        lines.append(f"Observations: {'; '.join(r.get('observations', []))}")
        lines.append(f"Decisions made: {'; '.join(r.get('decisions_made', []))}")
        commitments = r.get("commitments", [])
        commit_lines = [
            f"{c.get('description')} (owner: {c.get('owner')}, due: {c.get('due_date')})" for c in commitments
        ]
        lines.append(f"Commitments: {'; '.join(commit_lines)}")
        lines.append(f"Evidence required: {'; '.join(r.get('evidence_required', []))}")
        lines.append(f"State at the time: {r.get('current_state')}")
        lines.append(f"Impact assessment: {r.get('impact_assessment')}")
        lines.append(f"Next meeting objective set: {r.get('next_meeting_objective', '')}")
        lines.append("")
    return "\n".join(lines)


def _call_llm_for_review(system_prompt: str, thread_id: str, history: str, provider: str = None, model_name: str = None) -> str:
    user_payload = {
        "instructions": (
            f"Run the Follow-up Maturity prompt (section C of your instructions) for thread_id='{thread_id}' "
            "using the encounter history below. Produce a single JSON object conforming to the "
            "momentum-review JSON Schema, under a top-level key 'momentum_review'. "
            "Be direct about whether this thread is Dormant, whether follow-up was activity without impact, "
            "and whether the next meeting should continue, close, reassign, restart, or replace the player.\n"
        ),
        "thread_id": thread_id,
        "encounter_history": history,
    }

    return call_llm(
        system_prompt=system_prompt,
        user_content=json.dumps(user_payload, ensure_ascii=False, indent=2),
        provider=provider,
        model_name=model_name,
        max_output_tokens=3000,
    )


def parse_json_object(text: str) -> dict:
    import re

    m = re.search(r"```json\s*(\{[\s\S]*?\})\s*```", text)
    if not m:
        m = re.search(r"(\{[\s\S]*\})", text)
    if not m:
        raise ValueError("No JSON object found in LLM output")
    return json.loads(m.group(1))


def run_momentum_review(
    thread_id: str, provider: str = None, model_name: str = None, sync: bool = False
) -> tuple[dict | None, str | None]:
    """Full pipeline for one thread: fetch history -> LLM -> validate -> optional
    Smartsheet sync. Returns (review, error) — review is None if generation/parsing
    failed, with error explaining why."""
    records = get_encounters_for_thread(thread_id)
    if not records:
        return None, f"No prior encounters found for thread_id='{thread_id}'. Nothing to review yet."

    history = summarize_encounters(records)
    system_prompt = load_system_prompt()
    llm_out = _call_llm_for_review(system_prompt, thread_id, history, provider=provider, model_name=model_name)

    try:
        parsed = parse_json_object(llm_out)
    except Exception as e:
        return None, f"Failed to parse JSON from LLM output: {e}"

    review = parsed.get("momentum_review", parsed)

    schema = json.loads(MOMENTUM_SCHEMA_PATH.read_text(encoding="utf-8"))
    validation_warning = None
    try:
        validate(instance=review, schema=schema)
    except ValidationError as e:
        validation_warning = str(e)

    if sync:
        push_momentum_review(review)

    return review, validation_warning


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--thread-id", required=True, help="e.g. bhpro")
    p.add_argument("--llm-provider", default=None, help="gemini | openai | anthropic (default: $LLM_PROVIDER or gemini)")
    p.add_argument("--llm-model", default=None, help="Model name (default: the chosen provider's own default)")
    p.add_argument("--out", default=None, help="Output JSON path (default: <thread-id>_momentum_review.json)")
    p.add_argument("--sync-smartsheet", action="store_true", help="Write the review back to the Momentum Thread Register")
    args = p.parse_args()

    out_path = args.out or f"{args.thread_id}_momentum_review.json"

    print(f"Fetching prior encounters for thread '{args.thread_id}'...")
    review, error = run_momentum_review(
        args.thread_id, provider=args.llm_provider, model_name=args.llm_model, sync=args.sync_smartsheet
    )

    if review is None:
        print(error)
        return
    if error:
        print("Warning: momentum-review schema validation failed:", error)

    Path(out_path).write_text(json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Momentum review saved to {out_path}")
    print(f"\nThread state: {review.get('thread_state')}")
    print(f"Recommended next-meeting objective: {review.get('recommended_objective_for_next_meeting')}")
    for flag in review.get("weak_followup_flags", []):
        print(f"  [{flag['flag_type']}] {flag['statement']} -> {flag['recommendation']}")

    if args.sync_smartsheet:
        print("Synced to Smartsheet.")


if __name__ == "__main__":
    main()
