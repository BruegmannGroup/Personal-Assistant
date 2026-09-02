Smartsheet setup for the Momentum Agent

1) Generate a personal access token
   - Log in to https://app.smartsheet.com
   - Click your avatar (top right) -> Apps & Integrations -> API Access
   - Click "Generate new access token", name it (e.g. "momentum-agent"), copy it —
     Smartsheet only shows it once.

2) Store the token
   Create a .env file in the repo root (gitignored) containing:
     SMARTSHEET_API_TOKEN=your-token-here
     GEMINI_API_KEY=your-gemini-key-here
   (transcribe_and_extract.py and momentum_review.py both load .env automatically.)

3) Install dependencies
   pip install -r requirements.txt

4) Run the one-time setup script
   python setup_smartsheet.py

   This creates two sheets under your Smartsheet account if they don't already exist:
     - Executive Encounter Register
     - Momentum Thread Register
   and saves their IDs to smartsheet_config.json (gitignored — environment-specific,
   not a secret, but no need to commit it).

   Re-running this script is safe: it detects existing sheets by name and reuses them.
   Since you own the sheets outright (they're created under your own account), there
   are no tenant admin-consent or permission-scope issues like SharePoint/Graph had.

5) Using it
   - python transcribe_and_extract.py --audio meeting.m4a --metadata metadata.json \
       --out result.json --sync-smartsheet
     pushes the validated encounter_record as a new row in the Executive Encounter
     Register and upserts the thread's summary row in the Momentum Thread Register.
   - python momentum_review.py --thread-id bhpro --sync-smartsheet
     pulls every prior encounter for that thread_id, generates the Follow-up Maturity
     review, and writes it back to the thread's row.

Notes
- thread_id is a short stable slug you (or the LLM extraction) assign per company/
  relationship, e.g. "bhpro", "akwa", "evorack-thailand". Use the same slug across
  encounters for a company so they group together — this is what momentum_review.py
  filters on.
- record_json / last_momentum_review_json columns hold the full structured JSON for
  each row — that's what the scripts read back. The other columns exist so you can
  browse and skim records directly in the Smartsheet grid view.
- Smartsheet cell text has a practical size limit (a few thousand characters). A
  single encounter's record_json should comfortably fit; if you start hitting limits
  with very long transcript-derived records, trim narrative fields before syncing.
