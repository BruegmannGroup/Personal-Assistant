# Personal-Assistant

Executive meeting and interaction intelligence agent for Christopher.

## What this implements

This repository now includes:

- A strict **system prompt** for an executive operating-chain agent
- A structured **Encounter Record** JSON schema
- A structured **Momentum Review** JSON schema

The agent treats interactions as an operating chain:

Intent -> Encounter -> Observation -> Commitment -> Evidence -> Outcome -> Impact -> Next Action or Conclusion

## The three prompt moments

Every relationship/thread moves through the same operating chain, and each stage
has its own tool:

| Stage | When | Tool |
|---|---|---|
| A. Pre-meeting | Before a meaningful meeting/visit | `pre_meeting.py` |
| B. Post-meeting capture | Right after (asks/extracts when the follow-up should occur) | `transcribe_and_extract.py` |
| C. Follow-up maturity | Triggered by that follow-up date (or staleness/Dormant as fallback) | `dashboard.py` or `check_reminders.py` to see it's due, `momentum_review.py` to generate it |

`dashboard.py` (Streamlit) is the visual home for all of this — a banner surfaces threads
due for Stage C with a one-click trigger, plus a per-meeting Summary/Decisions/Actions/Topics
view and an aggregate Action Items list across every encounter.

## Files

- [agent/executive-memory-agent.system.txt](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/agent/executive-memory-agent.system.txt) — system prompt
- [agent/prompt.txt](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/agent/prompt.txt) — pre/post/follow-up question sets
- [schemas/encounter-record.schema.json](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/schemas/encounter-record.schema.json)
- [schemas/momentum-review.schema.json](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/schemas/momentum-review.schema.json)
- [pre_meeting.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/pre_meeting.py) — Stage A: asks the six pre-meeting questions, shows prior open commitments for the thread, saves a metadata file for Stage B
- [transcribe_and_extract.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/transcribe_and_extract.py) — Stage B: local faster-whisper transcription + LLM extraction into a validated Encounter Record
- [reminders.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/reminders.py) — shared "what needs attention" logic (`get_flagged_threads`) used by both `check_reminders.py` and `dashboard.py`, so they never disagree
- [check_reminders.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/check_reminders.py) — Stage C trigger (CLI): prints which threads need a momentum review before their next meeting
- [dashboard.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/dashboard.py) — Stage C trigger (UI, `streamlit run dashboard.py`): same reminder banner with a one-click trigger, plus per-meeting and aggregate action-item views
- [momentum_review.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/momentum_review.py) — Stage C: generates the Follow-up Maturity review for a thread from its prior encounters (`run_momentum_review()` is the reusable entry point both the CLI and dashboard call)
- [llm_client.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/llm_client.py) — pluggable LLM layer (Gemini/OpenAI/Anthropic); every script above calls through this, never a provider SDK directly
- [smartsheet_sync.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/smartsheet_sync.py) — pushes validated records to Smartsheet
- [setup_smartsheet.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/setup_smartsheet.py) — one-time script to create the Smartsheet sheets
- [SMARTSHEET_SETUP.md](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/SMARTSHEET_SETUP.md) — setup instructions
- [NEXT_STEPS.md](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/NEXT_STEPS.md) — how to run the pipeline end to end, what's still open

## Usage

1. **Before** a meeting: `python pre_meeting.py` — answer the six questions, get a metadata file back.
2. **After**: `python transcribe_and_extract.py --audio meeting.m4a --metadata <file from step 1> --sync-smartsheet`
   (also asks/extracts a `next_meeting_date` — when the follow-up should occur, if one was set).
3. **Periodically**, or just leave it open: `streamlit run dashboard.py` — the banner at the
   top shows which threads are due for a momentum review (by their `next_meeting_date`, or
   Dormant/staleness as a fallback for threads with no date set), with a button that
   generates and syncs it right there. `python check_reminders.py` gives the same list as text.

Every thread moves through: Discovery -> Validation -> Development -> Adoption -> Conclusion, or stalls into Dormant — the agent's most important job is catching that last one early.

## Switching LLM providers

Set `LLM_PROVIDER=gemini|openai|anthropic` (env var or `.env`), or pass `--llm-provider`
to any script. Each provider reads its own API key (`GEMINI_API_KEY` / `OPENAI_API_KEY` /
`ANTHROPIC_API_KEY`). Adding a new provider means adding one class to `llm_client.py` —
nothing else in the repo references a provider SDK directly.

## Expected output behavior

The agent always distinguishes:

- fact
- assumption
- hypothesis
- decision
- commitment
- open question
- recommendation

And it explicitly flags:

- activity without impact
- weak ownership
- repeated meetings with no progression
- when to close, reassign, restart, or shift thread ownership