import type { Env } from "./types";
import { getAllRows, rowCellValue, req } from "./smartsheet";

// Get dormant threads with no follow-up date set and alert_state != dismissed
export interface DormantThread {
  thread_id: string;
  organizations: string | null;
  last_encounter_date: string | null;
  days_since: number | null;
}

export async function getDormantThreads(env: Env, columnMap: Record<string, number>): Promise<DormantThread[]> {
  const rows = await getAllRows(env, env.THREAD_SHEET_ID);
  const today = new Date(new Date().toISOString().slice(0, 10));

  const dormant: DormantThread[] = [];

  for (const t of rows) {
    const threadId = rowCellValue(t, columnMap, "thread_id");
    if (!threadId) continue;
    if (rowCellValue(t, columnMap, "next_followup_date")) continue;
    if (rowCellValue(t, columnMap, "current_state") !== "Dormant") continue;
    if (rowCellValue(t, columnMap, "alert_state") === "dismissed") continue;

    const lastDate = rowCellValue(t, columnMap, "last_encounter_date");
    const lastDateObj = lastDate ? new Date(lastDate.slice(0, 10)) : null;
    const daysSince = lastDateObj ? Math.round((today.getTime() - lastDateObj.getTime()) / (1000 * 60 * 60 * 24)) : null;

    dormant.push({
      thread_id: threadId,
      organizations: rowCellValue(t, columnMap, "organizations"),
      last_encounter_date: lastDate,
      days_since: daysSince,
    });
  }

  return dormant;
}

// Set alert state for a thread (uses pre-fetched columnMap)
export async function setThreadAlertState(env: Env, threadId: string, state: string, columnMap: Record<string, number>): Promise<void> {
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

// Dismiss alert for a thread (set alert_state = dismissed)
export async function dismissThreadAlert(env: Env, threadId: string, columnMap: Record<string, number>): Promise<void> {
  await setThreadAlertState(env, threadId, "dismissed", columnMap);
}
