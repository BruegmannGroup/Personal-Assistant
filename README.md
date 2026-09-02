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

| Stage | When | Where |
|---|---|---|
| A. Pre-meeting | Before a meaningful meeting/visit | Record button, "Pre-meeting" tab |
| B. Post-meeting capture | Right after (asks/extracts when the follow-up should occur) | Record button, "Post-meeting" tab |
| C. Follow-up maturity | Triggered by that follow-up date (or staleness/Dormant as fallback) | Record button, "Follow-up" tab — or the "Generate review"/"Refresh review" button on a thread's detail card, no recording needed |

The **browser dashboard** (`dashboard-web/`, hosted on GitHub Pages) is the one place all of
this happens: a speaker-icon record button with a Pre / Post / Follow-up stage selector, a
Home view sorted by next follow-up date with per-thread status (nothing recorded / pre only /
both) and a hold/skip/reschedule recommendation, and a per-thread detail card (click a row)
showing the latest encounter and momentum review with a button to regenerate the review from
history alone, no re-recording needed. It talks to a small Cloudflare Worker (`worker/`) that
holds the Smartsheet token and Gemini API key server-side — GitHub Pages is static-only and
can't hold secrets, so nothing sensitive ever ships in the frontend bundle. Audio goes
straight to Gemini as multimodal input (no separate transcription step, and no thread id to
type — Gemini matches the organization/relationship mentioned to an existing thread or starts
a new one), written to the same two Smartsheet sheets the CLI tools use, and the raw recording
is saved to Cloudflare R2 before anything else happens to it — so a failed Gemini call or
Smartsheet write never loses the original audio, and every processed recording has a
"listen to this" link in the dashboard.

There used to be a second, Streamlit-based dashboard (`dashboard.py`) for viewing encounters
and triggering Stage C — it's been retired now that the browser dashboard covers everything
it did (plus recording, thread status, and the same review-refresh button), to avoid having
two separate "dashboards" to keep straight.

**One-time setup:**
1. `cd worker && npm install`
2. `npx wrangler login`
3. `npx wrangler r2 bucket create momentum-dashboard-audio` (R2 has a free tier — 10GB
   storage/month — plenty for voice memos).
4. Set secrets: `npx wrangler secret put SMARTSHEET_API_TOKEN`, `npx wrangler secret put GEMINI_API_KEY`,
   and `npx wrangler secret put DASHBOARD_KEY` (invent a passphrase — this is what the
   dashboard asks you for on first load).
5. `npx wrangler deploy` — copy the `https://....workers.dev` URL it prints.
6. `cd ../dashboard-web && npm install`, then set the `VITE_WORKER_URL` GitHub Actions repo
   variable (Settings -> Secrets and variables -> Actions -> Variables) to that URL.
7. In GitHub repo Settings -> Pages, set Source to "GitHub Actions".
8. Push to `main` (or run the "Deploy dashboard to GitHub Pages" workflow manually) — the
   dashboard deploys to `https://<org>.github.io/Personal-Assistant/`.

For local frontend development: copy `dashboard-web/.env.example` to `dashboard-web/.env`,
fill in `VITE_WORKER_URL`, then `npm run dev` (and `npx wrangler dev` in `worker/` if you
want to hit a local copy of the Worker instead of the deployed one).

**Deploying the frontend to Heroku instead of GitHub Pages:** the Worker stays on Cloudflare
either way (nothing there changes — CORS is already wide open, so it doesn't care which
frontend origin calls it). Only `dashboard-web/` moves. This repo is a monorepo (the Heroku
app root and `dashboard-web/` aren't the same directory), so it needs
`heroku-buildpack-monorepo` to point Heroku at the right subdirectory, plus the Node and
static buildpacks, in this order:
```
heroku create <app-name>
heroku buildpacks:add -a <app-name> https://github.com/heroku/heroku-buildpack-monorepo.git
heroku buildpacks:add -a <app-name> heroku/nodejs
heroku buildpacks:add -a <app-name> https://github.com/heroku/heroku-buildpack-static.git
heroku config:set -a <app-name> APP_BASE=dashboard-web
heroku config:set -a <app-name> NPM_CONFIG_PRODUCTION=false
heroku config:set -a <app-name> VITE_WORKER_URL=<the workers.dev URL from step 5 above>
git push heroku main
```
`NPM_CONFIG_PRODUCTION=false` matters — without it, Heroku's Node buildpack skips
devDependencies (which is where `vite`/`typescript` live), and the build step fails.
`dashboard-web/static.json` (`{"root": "dist"}`) tells the static buildpack where the built
site ends up; `heroku-postbuild` in `dashboard-web/package.json` is what actually runs the
build. No `Procfile` needed — the static buildpack supplies its own web process.
`vite.config.ts`'s `base` defaults to `/` (correct for Heroku's own domain root); only the
GitHub Actions workflow overrides it to `/Personal-Assistant/` for GitHub Pages, so both
targets can coexist without either breaking the other.

The CLI tools (`pre_meeting.py`, `transcribe_and_extract.py`, `live_capture.py`,
`momentum_review.py`) still work unchanged as an offline fallback if the Worker/dashboard is
ever unavailable — they're typed/local-audio-file-based rather than browser-recording-based,
but hit the same Smartsheet sheets.

## Files

- [agent/executive-memory-agent.system.txt](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/agent/executive-memory-agent.system.txt) — system prompt
- [agent/prompt.txt](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/agent/prompt.txt) — pre/post/follow-up question sets
- [schemas/encounter-record.schema.json](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/schemas/encounter-record.schema.json)
- [schemas/momentum-review.schema.json](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/schemas/momentum-review.schema.json)
- [pre_meeting.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/pre_meeting.py) — Stage A: asks the six pre-meeting questions, shows prior open commitments for the thread, saves a metadata file for Stage B
- [transcribe_and_extract.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/transcribe_and_extract.py) — Stage B: local faster-whisper transcription + LLM extraction into a validated Encounter Record (`run_pipeline()` is the reusable entry point)
- [audio_capture.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/audio_capture.py) — cross-platform live audio capture (mic and, where the OS exposes one, a loopback/system-audio device), no Teams/Graph API involved
- [live_capture.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/live_capture.py) — records a meeting live (`--list-devices` to pick your input(s)), then feeds straight into Stage B's pipeline — the "stay present during the call" alternative to Teams transcript pull
- [reminders.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/reminders.py) — shared "what needs attention" logic (`get_flagged_threads`), used by `check_reminders.py`
- [check_reminders.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/check_reminders.py) — Stage C trigger (CLI): prints which threads need a momentum review before their next meeting
- [momentum_review.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/momentum_review.py) — Stage C: generates the Follow-up Maturity review for a thread from its prior encounters (`run_momentum_review()` is the reusable entry point; the browser dashboard's "Generate review" button does the same thing via the Worker's `/api/review` instead)
- [llm_client.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/llm_client.py) — pluggable LLM layer (Gemini/OpenAI/Anthropic); every script above calls through this, never a provider SDK directly
- [smartsheet_sync.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/smartsheet_sync.py) — pushes validated records to Smartsheet
- [setup_smartsheet.py](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/setup_smartsheet.py) — one-time script to create the Smartsheet sheets
- [SMARTSHEET_SETUP.md](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/SMARTSHEET_SETUP.md) — setup instructions
- [worker/](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/worker) — Cloudflare Worker backing the browser dashboard: holds the Smartsheet/Gemini secrets, does audio -> Gemini -> Smartsheet for all three stages (`POST /api/record`), plus a no-audio review refresh (`POST /api/review`) (`src/index.ts` router, `src/smartsheet.ts` TS port of `smartsheet_sync.py`, `src/prompts.ts` stage-specific extraction prompts)
- [dashboard-web/](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/dashboard-web) — React + Vite browser dashboard (GitHub Pages): record button, Pre/Post/Follow-up stages, Home view sorted by next follow-up date with per-thread status and action items, clickable thread rows with a full detail card
- [NEXT_STEPS.md](/Users/anushasrinivasan/Library/CloudStorage/OneDrive-Bruegmann/Documents/Github/Personal-Assistant/NEXT_STEPS.md) — how to run the pipeline end to end, what's still open

## Usage

**Normal path** (browser dashboard): open the deployed `dashboard-web` URL, click **Record**,
pick a stage (Pre-meeting / Post-meeting / Follow-up), tap the speaker icon, talk, tap again to
stop. That's it — no thread id, no forms. Click **Home** to see thread status, next follow-up
dates, and action items; click a thread row for the full detail card, including a button to
regenerate its momentum review without recording anything.

**Offline/CLI fallback:**
1. **Before** a meeting: `python pre_meeting.py` — answer the six questions, get a metadata file back.
2. **After**: `python transcribe_and_extract.py --audio meeting.m4a --metadata <file from step 1> --sync-smartsheet`
   (also asks/extracts a `next_meeting_date` — when the follow-up should occur, if one was set).
3. **Periodically**: `python check_reminders.py` prints which threads are due for a momentum
   review (by their `next_meeting_date`, or Dormant/staleness as a fallback), and
   `python momentum_review.py --thread-id <id> --sync-smartsheet` generates one.

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