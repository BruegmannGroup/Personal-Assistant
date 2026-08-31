import type { Env, RecordRequestBody } from "./types";
import { callGeminiWithAudio, parseJsonFromText } from "./llm";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { buildPrePrompt, buildPostPrompt, buildFollowupIdentifyPrompt, buildFollowupReviewPrompt } from "./prompts";
import type { PendingBriefContext } from "./prompts";
import { saveAudioRecording, loadAudioRecording } from "./audio";
import {
  getThreads,
  getEncounters,
  getEncountersForThread,
  setPendingPreBrief,
  pushEncounter,
  pushMomentumReview,
} from "./smartsheet";
import type { ThreadRow } from "./smartsheet";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Dashboard-Key",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function summarizeEncounters(records: any[]): string {
  return records
    .map((r, i) => {
      const commitLines = (r.commitments || [])
        .map((c: any) => `${c.description} (owner: ${c.owner}, due: ${c.due_date})`)
        .join("; ");
      return [
        `--- Encounter ${i + 1}: ${r.encounter_name} (${r.datetime_local}) ---`,
        `Purpose: ${r.pre_meeting_purpose || ""}`,
        `Hypothesis: ${r.hypothesis || ""}`,
        `Observations: ${(r.observations || []).join("; ")}`,
        `Decisions made: ${(r.decisions_made || []).join("; ")}`,
        `Commitments: ${commitLines}`,
        `Evidence required: ${(r.evidence_required || []).join("; ")}`,
        `State at the time: ${r.current_state}`,
        `Impact assessment: ${r.impact_assessment}`,
        `Next meeting objective set: ${r.next_meeting_objective || ""}`,
        "",
      ].join("\n");
    })
    .join("\n");
}

function sanitizeThreadId(raw: unknown, existing: ThreadRow[]): string {
  const slug = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  if (slug) return slug;
  // Gemini failed to produce anything usable — fall back to a timestamp slug
  // rather than silently dropping the recording.
  const fallback = `thread_${Date.now().toString(36)}`;
  return existing.some((t) => t.thread_id === fallback) ? `${fallback}_2` : fallback;
}

async function handleRecord(env: Env, body: RecordRequestBody): Promise<Response> {
  const { stage, audio_base64, mime_type } = body;
  if (!stage || !audio_base64 || !mime_type) {
    return json({ error: "stage, audio_base64, and mime_type are required" }, 400);
  }
  if (!["pre", "post", "followup"].includes(stage)) {
    return json({ error: "stage must be one of pre | post | followup" }, 400);
  }

  // Persist the raw recording to R2 before doing anything else with it, so a
  // failed Gemini call or Smartsheet write never loses the original audio —
  // it stays retrievable via /api/audio?key=... and can be reprocessed by hand.
  // Not keyed by thread_id: at this point nothing has determined it yet — that's
  // the LLM's job below, using the existing-threads context fetched next.
  const audioKey = await saveAudioRecording(env, stage, audio_base64, mime_type);
  const threads = await getThreads(env);

  if (stage === "pre") {
    const prompt = buildPrePrompt(threads);
    const raw = await callGeminiWithAudio(env, SYSTEM_PROMPT, prompt, audio_base64, mime_type, 2000);
    const brief = parseJsonFromText(raw);
    const threadId = sanitizeThreadId(brief.thread_id, threads);
    brief.thread_id = threadId;
    brief.audio_recording_key = audioKey;
    await setPendingPreBrief(env, threadId, JSON.stringify(brief), brief.organization);
    return json({ stage, thread_id: threadId, extracted: brief, audio_recording_key: audioKey });
  }

  if (stage === "post") {
    const pendingBriefs: PendingBriefContext[] = threads
      .filter((t) => t.thread_id && t.pending_pre_meeting_brief)
      .map((t) => ({
        thread_id: t.thread_id as string,
        organization: t.organizations,
        brief: JSON.parse(t.pending_pre_meeting_brief as string),
      }));
    const referenceDate = new Date().toISOString().slice(0, 16);
    const prompt = buildPostPrompt(threads, pendingBriefs, referenceDate);
    const raw = await callGeminiWithAudio(env, SYSTEM_PROMPT, prompt, audio_base64, mime_type, 8000);
    const parsed = parseJsonFromText(raw);
    const record = parsed.encounter_record || parsed;

    const threadId = sanitizeThreadId(record.thread_id, threads);
    const hadPendingBrief = pendingBriefs.some((p) => p.thread_id === threadId);
    record.thread_id = threadId;
    if (!record.datetime_local) record.datetime_local = referenceDate;
    record.audio_recording_key = audioKey;

    await pushEncounter(env, record);

    if (parsed.momentum_review) {
      parsed.momentum_review.thread_id = threadId;
      await pushMomentumReview(env, parsed.momentum_review);
    }

    return json({
      stage,
      thread_id: threadId,
      extracted: record,
      audio_recording_key: audioKey,
      note: hadPendingBrief ? null : "No pre-meeting brief was found for this thread — recorded from this audio alone.",
    });
  }

  // followup — never creates a new thread; there's nothing to follow up on
  // without prior history, so this is a two-call flow: first resolve which
  // existing thread the audio is about, then fetch its real history to ground
  // the actual review.
  if (!threads.length) {
    return json({ error: "No threads exist yet — record a pre or post-meeting brief first." }, 400);
  }
  const identifyPrompt = buildFollowupIdentifyPrompt(threads);
  const identifyRaw = await callGeminiWithAudio(env, SYSTEM_PROMPT, identifyPrompt, audio_base64, mime_type, 200);
  const identified = parseJsonFromText(identifyRaw);
  const threadId = String(identified.thread_id || "");
  if (!threads.some((t) => t.thread_id === threadId)) {
    return json(
      { error: "Couldn't confidently match this recording to an existing thread — mention the organization or relationship by name and try again." },
      400
    );
  }

  const history = await getEncountersForThread(env, threadId);
  if (!history.length) {
    return json({ error: `No prior encounters found for thread_id='${threadId}'. Nothing to review yet.` }, 400);
  }
  const reviewPrompt = buildFollowupReviewPrompt(threadId, summarizeEncounters(history));
  const raw = await callGeminiWithAudio(env, SYSTEM_PROMPT, reviewPrompt, audio_base64, mime_type, 3000);
  const parsed = parseJsonFromText(raw);
  const review = parsed.momentum_review || parsed;
  review.thread_id = threadId;
  review.audio_recording_key = audioKey;

  await pushMomentumReview(env, review);
  return json({ stage, thread_id: threadId, extracted: review, audio_recording_key: audioKey });
}

async function handleAudioGet(env: Env, key: string): Promise<Response> {
  const obj = await loadAudioRecording(env, key);
  if (!obj) return json({ error: "Recording not found" }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

function checkAuth(request: Request, env: Env, url: URL): boolean {
  // <audio src> can't attach custom headers, so the audio route also accepts
  // the key as a query param — every other route requires the header.
  const headerKey = request.headers.get("X-Dashboard-Key");
  const queryKey = url.searchParams.get("dashboard_key");
  return headerKey === env.DASHBOARD_KEY || queryKey === env.DASHBOARD_KEY;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (!checkAuth(request, env, url)) {
      return json({ error: "Unauthorized — missing or incorrect dashboard key" }, 401);
    }

    try {
      if (url.pathname === "/api/threads" && request.method === "GET") {
        return json({ threads: await getThreads(env) });
      }

      if (url.pathname === "/api/encounters" && request.method === "GET") {
        return json({ encounters: await getEncounters(env) });
      }

      if (url.pathname === "/api/record" && request.method === "POST") {
        const body = (await request.json()) as RecordRequestBody;
        return await handleRecord(env, body);
      }

      if (url.pathname === "/api/audio" && request.method === "GET") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "key query param is required" }, 400);
        return await handleAudioGet(env, key);
      }

      return json({ error: "Not found" }, 404);
    } catch (err: any) {
      return json({ error: err?.message || String(err) }, 500);
    }
  },
};
