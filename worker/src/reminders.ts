import type { Env } from "./types";
import { getThreads } from "./smartsheet";

// TypeScript port of reminders.py's get_flagged_threads — same priority order,
// so the browser dashboard and (eventually) a scheduled email digest never
// disagree about what counts as "needs attention":
//   1. an explicit next_followup_date that's due or overdue (the precise,
//      intentional trigger set during post-meeting capture)
//   2. marked Dormant
//   3. stale — no next_followup_date was ever set AND no encounter logged in
//      `staleDays` (this is the answer to "what if a follow-up date was never
//      provided but the thread clearly needs one" — it still surfaces, just
//      via a slower, less precise signal than an explicit date)
//   4. never reviewed at all (no last_encounter_date on record)

export interface FlaggedThread {
  thread_id: string;
  current_state: string | null;
  last_encounter_date: string | null;
  next_followup_date: string | null;
  days_since: number | null;
  reason: string;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value.slice(0, 10));
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

export async function getFlaggedThreads(env: Env, staleDays = 14): Promise<FlaggedThread[]> {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const threads = await getThreads(env);

  const flagged: (FlaggedThread & { sortKey: [number, number] })[] = [];

  for (const t of threads) {
    if (!t.thread_id) continue;

    const lastDate = parseDate(t.last_encounter_date);
    const followupDate = parseDate(t.next_followup_date);
    const daysSince = lastDate ? daysBetween(today, lastDate) : null;

    const isDue = followupDate !== null && followupDate <= today;
    const isDormant = t.current_state === "Dormant";
    const isStale = followupDate === null && daysSince !== null && daysSince >= staleDays;
    const neverReviewed = followupDate === null && daysSince === null;

    if (!(isDue || isDormant || isStale || neverReviewed)) continue;

    const reasons: string[] = [];
    if (isDue) reasons.push(`follow-up was due ${t.next_followup_date}`);
    if (isDormant) reasons.push("marked Dormant");
    if (isStale) reasons.push(`no encounter in ${daysSince} days`);
    if (neverReviewed) reasons.push("no last_encounter_date on record");

    flagged.push({
      thread_id: t.thread_id,
      current_state: t.current_state,
      last_encounter_date: t.last_encounter_date,
      next_followup_date: t.next_followup_date,
      days_since: daysSince,
      reason: reasons.join(", "),
      sortKey: [isDue ? 0 : isDormant ? 1 : 2, -(daysSince ?? 999999)],
    });
  }

  flagged.sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1]);
  return flagged.map(({ sortKey: _sortKey, ...f }) => f);
}
