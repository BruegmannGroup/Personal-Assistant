import type { Stage, Thread, Encounter, FlaggedThread } from "./types";

// Empty = same origin. The dashboard and the API are served by one Worker, so
// requests go to relative paths like /api/threads. Set VITE_WORKER_URL only when
// running the frontend separately from the Worker (e.g. `vite dev`) — note that
// Access cookies will not be sent cross-origin, so dev needs its own approach.
const WORKER_URL = (import.meta.env.VITE_WORKER_URL as string | undefined) || "";
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Cloudflare Access authenticates the request: same-origin calls carry the
  // CF_Authorization cookie automatically, and Access adds a signed JWT the
  // Worker verifies. There is no application-level passphrase any more.
  const resp = await fetch(`${WORKER_URL}${path}`, init);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `Request failed: ${resp.status}`);
  }
  return resp.json() as Promise<T>;
}

export function fetchThreads(): Promise<{ threads: Thread[] }> {
  return apiFetch("/api/threads");
}

export function fetchEncounters(): Promise<{ encounters: Encounter[] }> {
  return apiFetch("/api/encounters");
}

export interface RecordPayload {
  stage: Stage;
  audio_base64: string;
  mime_type: string;
}

export interface RecordResult {
  stage: Stage;
  thread_id: string;
  extracted: unknown;
  audio_recording_key: string;
  note?: string | null;
}

export function postRecording(payload: RecordPayload): Promise<RecordResult> {
  return apiFetch("/api/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchFlagged(): Promise<{ flagged: FlaggedThread[] }> {
  return apiFetch("/api/flagged");
}

export function generateReview(threadId: string): Promise<{ thread_id: string; extracted: unknown }> {
  return apiFetch("/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ thread_id: threadId }),
  });
}

// No secret in the URL: <audio src> and <a href> are same-origin, so the browser
// attaches the Access cookie for us and the Worker verifies it like any other request.
export function audioUrl(key: string): string {
  return `${WORKER_URL}/api/audio?key=${encodeURIComponent(key)}`;
}

// Dismiss alert for a dormant thread (uses cron token auth, not dashboard key)
export async function dismissAlert(threadId: string, cronToken: string): Promise<{ dismissed: boolean; thread_id: string }> {
  const resp = await fetch(`${WORKER_URL}/cron/dismiss?thread_id=${encodeURIComponent(threadId)}&token=${encodeURIComponent(cronToken)}`);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `Request failed: ${resp.status}`);
  }
  return resp.json() as Promise<{ dismissed: boolean; thread_id: string }>;
}
