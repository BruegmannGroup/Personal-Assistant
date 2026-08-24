#!/usr/bin/env python3
"""
Local transcription (faster-whisper) -> LLM extraction (pluggable: Gemini/OpenAI/Anthropic)

Usage examples:
  # basic local transcription + LLM extraction
  python transcribe_and_extract.py --audio /path/to/meeting.m4a --out out.json

  # include metadata JSON for pre-meeting fields (e.g. produced by pre_meeting.py)
  python transcribe_and_extract.py --audio meeting.m4a --metadata metadata.json --out out.json

  # skip audio/transcription entirely and test extraction on typed-up notes
  python transcribe_and_extract.py --transcript-file notes.txt --out out.json

  # use a different LLM provider/model for this run
  python transcribe_and_extract.py --transcript-file notes.txt --llm-provider openai --llm-model gpt-4o

Notes:
- This is a prototype. It assumes a single speaker (no diarization needed).
- LLM provider defaults to $LLM_PROVIDER (gemini/openai/anthropic), or gemini if unset —
  see llm_client.py. Provide that provider's API key in environment or via .env.
- The script loads the system prompt from agent/executive-memory-agent.system.txt in the repo.
"""

import argparse
import json
from datetime import datetime
from pathlib import Path
from faster_whisper import WhisperModel

from jsonschema import validate, ValidationError

from llm_client import call_llm

REPO_ROOT = Path(__file__).resolve().parent
SYSTEM_PROMPT_PATH = REPO_ROOT / "agent" / "executive-memory-agent.system.txt"
MOMENTUM_SCHEMA_PATH = REPO_ROOT / "schemas" / "momentum-review.schema.json"
ENCOUNTER_SCHEMA_PATH = REPO_ROOT / "schemas" / "encounter-record.schema.json"


def load_system_prompt():
    if not SYSTEM_PROMPT_PATH.exists():
        return ""  # caller should ensure file present
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def transcribe_local(audio_path: str, model_size: str = "small"):
    """Run faster-whisper transcription locally.

    Returns: list of segments: {start, end, text, confidence}
    """
    print(f"Loading Whisper model '{model_size}' (cpu, int8)...")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")

    print(f"Transcribing {audio_path}...")
    segments, info = model.transcribe(audio_path, beam_size=5)

    out = []
    for seg in segments:
        # faster-whisper segment: has .start, .end, .text and sometimes .avg_logprob
        confidence = None
        if hasattr(seg, "avg_logprob"):
            confidence = getattr(seg, "avg_logprob")
        out.append({
            "start": float(seg.start),
            "end": float(seg.end),
            "text": seg.text.strip(),
            "confidence": confidence,
        })
    return out, info


def merge_segments(segs, gap_threshold=0.5):
    if not segs:
        return []
    merged = [dict(segs[0])]
    for seg in segs[1:]:
        prev = merged[-1]
        if seg["start"] - prev["end"] <= gap_threshold:
            # merge
            prev["end"] = seg["end"]
            prev["text"] = prev["text"].rstrip() + " " + seg["text"].lstrip()
            a = prev.get("confidence")
            b = seg.get("confidence")
            if a is None or b is None:
                prev["confidence"] = None
            else:
                prev["confidence"] = (a + b) / 2.0
        else:
            merged.append(dict(seg))
    return merged


def detect_low_confidence(segments, require_confidence=False):
    """Return indexes of segments that should be human-reviewed.

    - If per-segment avg_logprob is unavailable, mark as review when require_confidence=True.
    - If avg_logprob exists, treat very low logprobs as suspicious. avg_logprob is typically negative.
    """
    flags = []
    for i, s in enumerate(segments):
        c = s.get("confidence")
        if c is None:
            if require_confidence:
                flags.append(i)
        else:
            # heuristic: avg_logprob closer to 0 is better; values below -1.5 are suspect for small models
            try:
                if float(c) < -1.5:
                    flags.append(i)
            except Exception:
                flags.append(i)
    return flags


def build_transcript_text(segments):
    return "\n".join([f"[{s['start']:.2f}-{s['end']:.2f}] {s['text']}" for s in segments])


def call_llm_extract(system_prompt: str, transcript: str, metadata: dict = None, provider: str = None, model_name: str = None):
    encounter_schema = json.loads(ENCOUNTER_SCHEMA_PATH.read_text(encoding="utf-8"))
    momentum_schema = json.loads(MOMENTUM_SCHEMA_PATH.read_text(encoding="utf-8"))

    user_payload = {
        "instructions": (
            "Produce a single JSON object with two top-level keys: 'encounter_record' and 'momentum_review'.\n"
            "encounter_record MUST validate against the encounter_record_schema given below: use exactly the "
            "property names it defines, use exactly one of the listed enum values for any enum property (never "
            "free text — e.g. meeting_type, current_state, impact_assessment, failure_mode, close_restart_decision), "
            "match each property's declared type (arrays must be JSON arrays, not strings), and include no "
            "properties beyond those the schema defines (additionalProperties is false) — do not invent extra "
            "top-level keys such as 'follow_up_questions'; open questions belong as [OPEN QUESTION] entries in "
            "epistemic_log instead.\n"
            "thread_id must be a short stable slug for the company/relationship, e.g. 'bhpro', 'akwa', so this "
            "encounter groups with prior and future encounters on the same thread.\n"
            "Use any values already given in metadata verbatim (encounter_name, datetime_local, local_timezone, "
            "location, organization, meeting_type, thread_id, etc.) rather than re-deriving them. datetime_local "
            "is required and must never be null — if it isn't stated in the transcript or metadata, fall back to "
            "metadata.reference_date.\n"
            "momentum_review should conform to momentum_review_schema. Omit it (set to null) if this is a first "
            "encounter on a thread with nothing prior to review.\n"
            "next_meeting_date: if a follow-up date was promised or clearly implied in the transcript or metadata, "
            "set it (YYYY-MM-DD). Otherwise set it to null — do not guess.\n"
            "topics: 1-4 short (1-3 word) thematic tags for what was actually discussed, e.g. ['Budget', "
            "'Suppliers', 'Risks'] — not the same as thread_id or organization.\n"
            "Label statements explicitly by type: [FACT], [ASSUMPTION], [HYPOTHESIS], [DECISION], [COMMITMENT], [OPEN QUESTION], [RECOMMENDATION].\n"
            "If something is unclear or low-confidence, add an [OPEN QUESTION] entry to epistemic_log rather than invent details.\n"
        ),
        "encounter_record_schema": encounter_schema,
        "momentum_review_schema": momentum_schema,
        "metadata": metadata or {},
        "transcript": transcript,
    }

    print(f"Calling LLM ({provider or 'default provider'}) to extract structured records...")
    return call_llm(
        system_prompt=system_prompt,
        user_content=json.dumps(user_payload, ensure_ascii=False, indent=2),
        provider=provider,
        model_name=model_name,
    )


def try_parse_json_from_text(text: str):
    # Try to extract the first JSON object in the returned text
    import re

    # Find code block with ```json ... ``` or top-level {
    m = re.search(r"```json\s*(\{[\s\S]*?\})\s*```", text)
    if not m:
        m = re.search(r"(\{[\s\S]*\})", text)
    if not m:
        raise ValueError("No JSON object found in LLM output")
    jstr = m.group(1)
    return json.loads(jstr)


def validate_against_schema(instance, schema_path: Path, label: str) -> bool:
    if not schema_path.exists():
        print(f"{label} schema not found locally; skipping JSON Schema validation.")
        return True
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    try:
        validate(instance=instance, schema=schema)
        return True
    except ValidationError as e:
        print(f"{label} schema validation failed:", e)
        return False


def validate_extracted(parsed: dict) -> tuple[bool, bool]:
    """Returns (encounter_ok, momentum_ok). momentum_review may legitimately be absent."""
    encounter = parsed.get("encounter_record", {})
    encounter_ok = validate_against_schema(encounter, ENCOUNTER_SCHEMA_PATH, "Encounter Record")

    momentum = parsed.get("momentum_review")
    if momentum:
        momentum_ok = validate_against_schema(momentum, MOMENTUM_SCHEMA_PATH, "Momentum Review")
    else:
        momentum_ok = True

    return encounter_ok, momentum_ok


def run_pipeline(
    audio_path: str = None,
    transcript_file: str = None,
    metadata: dict = None,
    model_size: str = "small",
    require_confidence: bool = False,
    provider: str = None,
    model_name: str = None,
    sync_smartsheet: bool = False,
    out_path: str = "out.json",
) -> dict:
    """Full pipeline: transcript (from audio or a file) -> LLM extraction -> schema
    validation -> optional Smartsheet sync -> saved to out_path. Reusable entry point —
    both this CLI's main() and live_capture.py call it, so the two never diverge.

    Exactly one of audio_path / transcript_file must be given.
    Returns the same dict that's written to out_path.
    """
    if bool(audio_path) == bool(transcript_file):
        raise ValueError("Provide exactly one of audio_path or transcript_file.")

    metadata = dict(metadata or {})
    metadata.setdefault("reference_date", datetime.now().isoformat(timespec="minutes"))

    system_prompt = load_system_prompt()
    if not system_prompt:
        print("Warning: system prompt file not found. Place agent/executive-memory-agent.system.txt in repo.")

    if transcript_file:
        transcript_text = Path(transcript_file).read_text(encoding="utf-8")
        merged = []
        low_flags = []
    else:
        segments, info = transcribe_local(audio_path, model_size=model_size)
        merged = merge_segments(segments)
        low_flags = detect_low_confidence(merged, require_confidence=require_confidence)
        transcript_text = build_transcript_text(merged)

    # Build LLM request
    try:
        llm_out = call_llm_extract(system_prompt, transcript_text, metadata=metadata, provider=provider, model_name=model_name)
    except Exception as e:
        print("LLM call failed:", e)
        print("Saving raw transcript and exiting.")
        final = {"transcript": transcript_text, "segments": merged, "low_confidence": low_flags}
        Path(out_path).write_text(json.dumps(final, indent=2), encoding="utf-8")
        return final

    # Try to parse JSON from LLM response
    try:
        parsed = try_parse_json_from_text(llm_out)
    except Exception as e:
        print("Failed to parse JSON from LLM output:", e)
        print("Saving raw LLM output to file for inspection.")
        final = {"llm_raw": llm_out, "transcript": transcript_text, "segments": merged}
        Path(out_path).write_text(json.dumps(final, indent=2), encoding="utf-8")
        return final

    # Validate extracted records against their schemas
    encounter_ok, momentum_ok = validate_extracted(parsed)
    if not encounter_ok:
        print("Warning: encounter-record schema validation failed. Review before trusting this record.")
    if not momentum_ok:
        print("Warning: momentum-review schema validation failed. Review before trusting this record.")

    # Attach provenance and raw artifacts
    final = {
        "transcript": transcript_text,
        "segments": merged,
        "low_confidence_segment_indexes": low_flags,
        "llm_response_text": llm_out,
        "extracted": parsed,
    }
    Path(out_path).write_text(json.dumps(final, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. Output saved to {out_path}")

    if sync_smartsheet:
        if not encounter_ok:
            print("Skipping Smartsheet sync: encounter record failed schema validation.")
        else:
            from smartsheet_sync import push_encounter_record

            print("Pushing encounter record to Smartsheet...")
            push_encounter_record(parsed["encounter_record"])
            print("Synced to Smartsheet.")

    return final


def main():
    p = argparse.ArgumentParser()
    input_group = p.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--audio", help="Path to audio file (wav/mp3/m4a)")
    input_group.add_argument(
        "--transcript-file",
        help="Skip transcription and use this plain-text transcript file instead — "
        "handy for testing extraction/validation/sync without recording audio or installing ffmpeg.",
    )
    p.add_argument("--model", default="small", help="faster-whisper model size: small/medium")
    p.add_argument("--metadata", help="Optional JSON file with metadata (encounter_name, people_present, etc.)")
    p.add_argument("--out", default="out.json", help="Output JSON file with final results")
    p.add_argument("--require-confidence", action="store_true", help="Treat missing confidence as low and require human review")
    p.add_argument("--llm-provider", default=None, help="gemini | openai | anthropic (default: $LLM_PROVIDER or gemini)")
    p.add_argument("--llm-model", default=None, help="Model name (default: the chosen provider's own default)")
    p.add_argument("--sync-smartsheet", action="store_true", help="Push the validated encounter record to Smartsheet (requires setup_smartsheet.py to have been run)")
    args = p.parse_args()

    metadata = {}
    if args.metadata:
        metadata = json.loads(Path(args.metadata).read_text(encoding="utf-8"))

    run_pipeline(
        audio_path=args.audio,
        transcript_file=args.transcript_file,
        metadata=metadata,
        model_size=args.model,
        require_confidence=args.require_confidence,
        provider=args.llm_provider,
        model_name=args.llm_model,
        sync_smartsheet=args.sync_smartsheet,
        out_path=args.out,
    )


if __name__ == "__main__":
    main()
