Next steps to run the local faster-whisper + cloud LLM prototype

For Smartsheet setup (Executive Encounter Register + Momentum Thread Register), see SMARTSHEET_SETUP.md.

1) Prerequisites
- Install ffmpeg on your system (homebrew, apt, or manual installer). Example (macOS Homebrew):
  brew install ffmpeg

2) Create and activate a virtual environment
  python3 -m venv .venv
  source .venv/bin/activate

3) Install Python requirements
  pip install -r requirements.txt

4) Set GEMINI_API_KEY (for cloud LLM extraction) — get one at https://aistudio.google.com/apikey
  export GEMINI_API_KEY="..."
  (or put it in a .env file, along with SMARTSHEET_API_TOKEN — both are loaded automatically)

5) Optional: create a metadata JSON for pre-meeting fields
Example metadata.json:
{
  "encounter_name": "BHPro Factory Visit",
  "datetime_local": "2026-10-05T09:00:00",
  "local_timezone": "Asia/Bangkok",
  "location": "Ayutthaya",
  "organization": "BHPro",
  "people_present": ["Christopher"],
  "meeting_type": "supplier_visit",
  "pre_meeting_purpose": "Inspect production quality and assess partnership fit",
  "hypothesis": "BHPro may be viable if quality & pricing align",
  "success_criteria": ["Confidence in production quality", "EvoRack quote for Thailand"]
}

6) Run transcription + extraction
  python transcribe_and_extract.py --audio /path/to/audio.m4a --metadata metadata.json --out result.json

7) Review output
- result.json will contain:
  - raw transcript (timestamped)
  - merged segments
  - low-confidence segment indexes
  - llm_response_text (raw LLM output)
  - extracted JSON (expect encounter_record & momentum_review)

8) Smartsheet sync (done — see SMARTSHEET_SETUP.md)
- schemas/encounter-record.schema.json now exists; transcribe_and_extract.py validates
  both encounter_record and momentum_review before saving.
- smartsheet_sync.py / setup_smartsheet.py push validated records to two Smartsheet
  sheets (Executive Encounter Register, Momentum Thread Register) via a personal
  access token — no admin consent or permission-scope issues, since the sheets are
  owned outright by whoever generates the token.
- Run `python setup_smartsheet.py` once, then pass `--sync-smartsheet` to
  transcribe_and_extract.py.
- momentum_review.py pulls all prior encounters for a thread_id from Smartsheet and
  generates the Follow-up Maturity review (PDF section 6C) — run this before any
  return visit to check whether the thread is Dormant or actually advanced.

9) Human validation UI (still open)
- Build a small UI that shows the transcript and extracted commitments/decisions with linked transcript snippets.
- Allow quick edits to owners/due dates/evidence before syncing to Smartsheet.

10) Production considerations
- If you need stronger accuracy for accents or noisy environments, upgrade to the "medium" model in faster-whisper or pre-process audio (noise reduction).
- For long audio (>60 minutes) consider chunking and incremental transcription.
- To avoid cloud LLM calls for sensitive content, run extraction on a private LLM / self-hosted model.
- ffmpeg is required (step 1) and was not detected on this machine as of the last check — install it before running transcribe_and_extract.py.

11) Follow-ups I can help implement
- Small Flask/FastAPI service to accept audio uploads, run local transcription, call the LLM, and store results.
- Minimal React/Streamlit validation UI to confirm low-confidence parts and finalize records before Smartsheet sync.
- A "morning prompt" / "end-of-day debrief" scheduled job (local cron, or a Smartsheet automation) per PDF section 10.
