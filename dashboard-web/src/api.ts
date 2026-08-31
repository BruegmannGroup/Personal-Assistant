import type { Stage, Thread, Encounter } from "./types";

const WORKER_URL = (import.meta.env.VITE_WORKER_URL as string | undefined) || "";
const KEY_STORAGE = "momentum_dashboard_key";

export function getStoredKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}

export function setStoredKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!WORKER_URL) {
    throw new Error("VITE_WORKER_URL is not set — see dashboard-web/.env.example.");
  }
  const key = getStoredKey();
  const resp = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      "X-Dashboard-Key": key || "",
    },
  });
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

// <audio src> can't send the X-Dashboard-Key header, so the key travels as a
// query param instead — the Worker's /api/audio route accepts either.
export function audioUrl(key: string): string {
  const dashboardKey = getStoredKey() || "";
  return `${WORKER_URL}/api/audio?key=${encodeURIComponent(key)}&dashboard_key=${encodeURIComponent(dashboardKey)}`;
}
