import type { Env } from "./types";
import { getThreads, getColumnMap, getAllRows, rowCellValue, req } from "./smartsheet";

// Get dormant threads with no follow-up date set and alert_state != dismissed
export interface DormantThread {
  thread_id: string;
  organizations: string | null;
  last_encounter_date: string | null;
  days_since: number | null;
}

export async function getDormantThreads(env: Env): Promise<DormantThread[]> {
  const threads = await getThreads(env);
  const today = new Date(new Date().toISOString().slice(0, 10));

  const dormant: DormantThread[] = [];

  for (const t of threads) {
    if (!t.thread_id) continue;
    if (t.next_followup_date) continue; // Skip threads with follow-up dates
    if (t.current_state !== "Dormant") continue;

    // Check alert_state - skip if dismissed
    if (t.alert_state === "dismissed") continue;

    const lastDate = t.last_encounter_date ? new Date(t.last_encounter_date.slice(0, 10)) : null;
    const daysSince = lastDate ? Math.round((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) : null;

    dormant.push({
      thread_id: t.thread_id,
      organizations: t.organizations,
      last_encounter_date: t.last_encounter_date,
      days_since: daysSince,
    });
  }

  return dormant;
}

// Dismiss alert for a thread (set alert_state = dismissed)
export async function dismissThreadAlert(env: Env, threadId: string): Promise<void> {
  await setThreadAlertState(env, threadId, "dismissed");
}

// Set alert state for a thread
export async function setThreadAlertState(env: Env, threadId: string, state: string): Promise<void> {
  const columnMap = await getColumnMap(env, env.THREAD_SHEET_ID);
  const rows = await getAllRows(env, env.THREAD_SHEET_ID);

  const row = rows.find((r: any) => rowCellValue(r, columnMap, "thread_id") === threadId);
  if (!row) return;

  const cells: { columnId: number; value: string }[] = [];

  const alertStateCol = columnMap["alert_state"];
  if (alertStateCol !== undefined) {
    cells.push({ columnId: alertStateCol, value: state });
  }

  const lastAlertCol = columnMap["last_alert_sent"];
  if (lastAlertCol !== undefined) {
    cells.push({ columnId: lastAlertCol, value: new Date().toISOString().slice(0, 10) });
  }

  if (cells.length > 0) {
    await req(env, `/sheets/${env.THREAD_SHEET_ID}/rows`, {
      method: "PUT",
      body: JSON.stringify([{ id: row.id, cells }]),
    });
  }
}
