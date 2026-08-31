import type { Env } from "./types";

// TypeScript port of smartsheet_sync.py — same two sheets, same dynamic column-map
// lookup (column IDs are never hardcoded, matching the fix for the 404 bug the
// Python side hit earlier), same upsert-thread-row pattern.

const API = "https://api.smartsheet.com/2.0";

function headers(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.SMARTSHEET_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function req(env: Env, path: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(`${API}${path}`, { ...init, headers: headers(env) });
  if (!resp.ok) {
    throw new Error(`Smartsheet ${init?.method || "GET"} ${path} failed: ${resp.status} ${await resp.text()}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

export async function getColumnMap(env: Env, sheetId: string): Promise<Record<string, number>> {
  const data = await req(env, `/sheets/${sheetId}/columns`);
  const map: Record<string, number> = {};
  for (const c of data.data || []) map[c.title] = c.id;
  return map;
}

function cellsFromFields(columnMap: Record<string, number>, fields: Record<string, any>) {
  const cells: { columnId: number; value: any }[] = [];
  for (const [title, value] of Object.entries(fields)) {
    const colId = columnMap[title];
    if (colId === undefined || value === null || value === undefined) continue;
    cells.push({ columnId: colId, value });
  }
  return cells;
}

async function getAllRows(env: Env, sheetId: string): Promise<any[]> {
  const data = await req(env, `/sheets/${sheetId}`);
  return data.rows || [];
}

function rowCellValue(row: any, columnMap: Record<string, number>, title: string) {
  const colId = columnMap[title];
  for (const cell of row.cells || []) {
    if (cell.columnId === colId) return cell.value ?? null;
  }
  return null;
}

async function findThreadRow(env: Env, columnMap: Record<string, number>, threadId: string) {
  const rows = await getAllRows(env, env.THREAD_SHEET_ID);
  for (const row of rows) {
    if (rowCellValue(row, columnMap, "thread_id") === threadId) return row;
  }
  return null;
}

async function upsertThreadRow(env: Env, threadId: string, fields: Record<string, any>) {
  const columnMap = await getColumnMap(env, env.THREAD_SHEET_ID);
  const cells = cellsFromFields(columnMap, { Title: threadId, thread_id: threadId, ...fields });
  const existing = await findThreadRow(env, columnMap, threadId);
  if (existing) {
    await req(env, `/sheets/${env.THREAD_SHEET_ID}/rows`, {
      method: "PUT",
      body: JSON.stringify([{ id: existing.id, cells }]),
    });
  } else {
    await req(env, `/sheets/${env.THREAD_SHEET_ID}/rows`, {
      method: "POST",
      body: JSON.stringify([{ toBottom: true, cells }]),
    });
  }
}

export interface ThreadRow {
  thread_id: string | null;
  organizations: string | null;
  current_state: string | null;
  last_encounter_date: string | null;
  next_followup_date: string | null;
  pending_pre_meeting_brief: string | null;
  pending_pre_meeting_recorded_at: string | null;
  last_followup_reviewed_at: string | null;
  meeting_recommendation_decision: string | null;
  meeting_recommendation_rationale: string | null;
  audio_recording_key: string | null;
  last_momentum_review_json: string | null;
}

export async function getThreads(env: Env): Promise<ThreadRow[]> {
  const columnMap = await getColumnMap(env, env.THREAD_SHEET_ID);
  const rows = await getAllRows(env, env.THREAD_SHEET_ID);
  return rows.map((row) => ({
    thread_id: rowCellValue(row, columnMap, "thread_id"),
    organizations: rowCellValue(row, columnMap, "organizations"),
    current_state: rowCellValue(row, columnMap, "current_state"),
    last_encounter_date: rowCellValue(row, columnMap, "last_encounter_date"),
    next_followup_date: rowCellValue(row, columnMap, "next_followup_date"),
    pending_pre_meeting_brief: rowCellValue(row, columnMap, "pending_pre_meeting_brief"),
    pending_pre_meeting_recorded_at: rowCellValue(row, columnMap, "pending_pre_meeting_recorded_at"),
    last_followup_reviewed_at: rowCellValue(row, columnMap, "last_followup_reviewed_at"),
    meeting_recommendation_decision: rowCellValue(row, columnMap, "meeting_recommendation_decision"),
    meeting_recommendation_rationale: rowCellValue(row, columnMap, "meeting_recommendation_rationale"),
    audio_recording_key: rowCellValue(row, columnMap, "audio_recording_key"),
    last_momentum_review_json: rowCellValue(row, columnMap, "last_momentum_review_json"),
  }));
}

export async function getEncounters(env: Env): Promise<any[]> {
  const columnMap = await getColumnMap(env, env.ENCOUNTER_SHEET_ID);
  const rows = await getAllRows(env, env.ENCOUNTER_SHEET_ID);
  const records: any[] = [];
  for (const row of rows) {
    const raw = rowCellValue(row, columnMap, "record_json");
    if (raw) records.push(JSON.parse(raw));
  }
  records.sort((a, b) => String(b.datetime_local || "").localeCompare(String(a.datetime_local || "")));
  return records;
}

export async function getEncountersForThread(env: Env, threadId: string): Promise<any[]> {
  const all = await getEncounters(env);
  return all
    .filter((r) => r.thread_id === threadId)
    .sort((a, b) => String(a.datetime_local || "").localeCompare(String(b.datetime_local || "")));
}

export async function getThreadById(env: Env, threadId: string): Promise<ThreadRow | null> {
  const threads = await getThreads(env);
  return threads.find((t) => t.thread_id === threadId) || null;
}

export async function setPendingPreBrief(
  env: Env,
  threadId: string,
  briefJson: string,
  organization?: string
): Promise<void> {
  await upsertThreadRow(env, threadId, {
    pending_pre_meeting_brief: briefJson,
    pending_pre_meeting_recorded_at: new Date().toISOString().slice(0, 10),
    ...(organization ? { organizations: organization } : {}),
  });
}

function commitmentsSummary(commitments: any[] | undefined): string {
  return (commitments || [])
    .map(
      (c) =>
        `${c.description} — owner: ${c.owner} — due: ${c.due_date || "no due date"} — evidence: ${
          c.evidence_required || "n/a"
        }`
    )
    .join("\n");
}

export async function pushEncounter(env: Env, record: any): Promise<void> {
  const columnMap = await getColumnMap(env, env.ENCOUNTER_SHEET_ID);
  const fields = {
    Title: record.encounter_name,
    datetime_local: record.datetime_local,
    local_timezone: record.local_timezone,
    location: record.location,
    organization: record.organization,
    people_present: (record.people_present || []).join("; "),
    meeting_type: record.meeting_type,
    thread_id: record.thread_id,
    pre_meeting_purpose: record.pre_meeting_purpose || "",
    hypothesis: record.hypothesis || "",
    success_criteria: (record.success_criteria || []).join("\n"),
    observations: (record.observations || []).join("\n"),
    decisions_made: (record.decisions_made || []).join("\n"),
    commitments_summary: commitmentsSummary(record.commitments),
    next_logical_action: record.next_logical_action || "",
    current_state: record.current_state,
    impact_assessment: record.impact_assessment,
    failure_mode: record.failure_mode,
    next_meeting_objective: record.next_meeting_objective || "",
    next_meeting_date: record.next_meeting_date,
    close_restart_decision: record.close_restart_decision,
    momentum_status: record.momentum_status || "",
    recommended_next_action: record.recommended_next_action || "",
    topics: (record.topics || []).join("; "),
    record_json: JSON.stringify(record),
    audio_recording_key: record.audio_recording_key || null,
  };
  const cells = cellsFromFields(columnMap, fields);
  await req(env, `/sheets/${env.ENCOUNTER_SHEET_ID}/rows`, {
    method: "POST",
    body: JSON.stringify([{ toBottom: true, cells }]),
  });

  // New encounter consumes and clears whatever pre-meeting brief was pending.
  await upsertThreadRow(env, record.thread_id, {
    organizations: record.organization,
    current_state: record.current_state,
    last_encounter_date: String(record.datetime_local || "").slice(0, 10),
    next_followup_date: record.next_meeting_date,
    pending_pre_meeting_brief: "",
  });
}

export async function pushMomentumReview(env: Env, review: any): Promise<void> {
  const columnMap = await getColumnMap(env, env.THREAD_SHEET_ID);
  const rec = review.meeting_recommendation || {};
  const fields = {
    Title: review.thread_name,
    thread_id: review.thread_id,
    category_name: review.category_name || "",
    organizations: review.organizations || "",
    current_state: review.thread_state,
    last_momentum_review_json: JSON.stringify(review),
    last_followup_reviewed_at: new Date().toISOString().slice(0, 10),
    meeting_recommendation_decision: rec.decision || "",
    meeting_recommendation_rationale: rec.rationale || "",
    audio_recording_key: review.audio_recording_key || null,
  };
  const cells = cellsFromFields(columnMap, fields);
  const existing = await findThreadRow(env, columnMap, review.thread_id);
  if (existing) {
    await req(env, `/sheets/${env.THREAD_SHEET_ID}/rows`, {
      method: "PUT",
      body: JSON.stringify([{ id: existing.id, cells }]),
    });
  } else {
    await req(env, `/sheets/${env.THREAD_SHEET_ID}/rows`, {
      method: "POST",
      body: JSON.stringify([{ toBottom: true, cells }]),
    });
  }
}
