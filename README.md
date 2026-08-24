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

## Browser recording dashboard (recommended)

The primary way to run all three stages is now the browser dashboard in `dashboard-web/`,
hosted on GitHub Pages: a speaker-icon record button, a Pre / Post / Follow-up stage
selector, and a Home view with per-thread status (nothing recorded / pre only / both) and
an aggregate action-items table. It talks to a small Cloudflare Worker (`worker/`) that holds
the Smartsheet token and Gemini API key server-side — GitHub Pages is static-only and can't
hold secrets, so nothing sensitive ever ships in the frontend bundle. Audio goes straight to
Gemini as multimodal input (no separate transcription step) and is written to the same two
Smartsheet sheets the CLI tools use, so both stay in sync.

**One-time setup:**
1. `cd worker && npm install`
2. `npx wrangler login`
3. Set secrets: `npx wrangler secret put SMARTSHEET_API_TOKEN`, `npx wrangler secret put GEMINI_API_KEY`,
   and `npx wrangler secret put DASHBOARD_KEY` (invent a passphrase — this is what the
   dashboard asks you for on first load).
4. `npx wrangler deploy` — copy the `https://....workers.dev` URL it prints.
5. `cd ../dashboard-web && npm install`, then set the `VITE_WORKER_URL` GitHub Actions repo
   variable (Settings -> Secrets and variables -> Actions -> Variables) to that URL.
6. In GitHub repo Settings -> Pages, set Source to "GitHub Actions".
7. Push to `main` (or run the "Deploy dashboard to GitHub Pages" workflow manually) — the
   dashboard deploys to `https://<org>.github.io/Personal-Assistant/`.

For local frontend development: copy `dashboard-web/.env.example` to `dashboard-web/.env`,
fill in `VITE_WORKER_URL`, then `npm run dev` (and `npx wrangler dev` in `worker/` if you
want to hit a local copy of the Worker instead of the deployed one).

The CLI tools (`pre_meeting.py`, `transcribe_and_extract.py`, `live_capture.py`,
`momentum_review.py`) and the Streamlit `dashboard.py` all keep working unchanged as an
offline fallback if the Worker/dashboard is ever unavailable.

## Files

- [agent/executive-memory-agent.system.txt](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/agent/executive-memory-agent.system.txt) — system prompt
- [agent/prompt.txt](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/agent/prompt.txt) — pre/post/follow-up question sets
- [schemas/encounter-record.schema.json](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/schemas/encounter-record.schema.json)
- [schemas/momentum-review.schema.json](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/schemas/momentum-review.schema.json)
- [pre_meeting.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/pre_meeting.py) — Stage A: asks the six pre-meeting questions, shows prior open commitments for the thread, saves a metadata file for Stage B
- [transcribe_and_extract.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/transcribe_and_extract.py) — Stage B: local faster-whisper transcription + LLM extraction into a validated Encounter Record (`run_pipeline()` is the reusable entry point)
- [audio_capture.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/audio_capture.py) — cross-platform live audio capture (mic and, where the OS exposes one, a loopback/system-audio device), no Teams/Graph API involved
- [live_capture.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/live_capture.py) — records a meeting live (`--list-devices` to pick your input(s)), then feeds straight into Stage B's pipeline — the "stay present during the call" alternative to Teams transcript pull
- [reminders.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/reminders.py) — shared "what needs attention" logic (`get_flagged_threads`) used by both `check_reminders.py` and `dashboard.py`, so they never disagree
- [check_reminders.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/check_reminders.py) — Stage C trigger (CLI): prints which threads need a momentum review before their next meeting
- [dashboard.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/dashboard.py) — Stage C trigger (UI, `streamlit run dashboard.py`): same reminder banner with a one-click trigger, plus per-meeting and aggregate action-item views
- [momentum_review.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/momentum_review.py) — Stage C: generates the Follow-up Maturity review for a thread from its prior encounters (`run_momentum_review()` is the reusable entry point both the CLI and dashboard call)
- [llm_client.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/llm_client.py) — pluggable LLM layer (Gemini/OpenAI/Anthropic); every script above calls through this, never a provider SDK directly
- [smartsheet_sync.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/smartsheet_sync.py) — pushes validated records to Smartsheet
- [setup_smartsheet.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/setup_smartsheet.py) — one-time script to create the Smartsheet sheets
- [SMARTSHEET_SETUP.md](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/SMARTSHEET_SETUP.md) — setup instructions
- [worker/](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/worker) — Cloudflare Worker backing the browser dashboard: holds the Smartsheet/Gemini secrets, does audio -> Gemini -> Smartsheet for all three stages (`src/index.ts` router, `src/smartsheet.ts` TS port of `smartsheet_sync.py`, `src/prompts.ts` stage-specific extraction prompts)
- [dashboard-web/](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/dashboard-web) — React + Vite browser dashboard (GitHub Pages): record button, Pre/Post/Follow-up stages, Home view with per-thread status and action items
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