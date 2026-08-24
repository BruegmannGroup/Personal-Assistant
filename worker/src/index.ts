import type { Env, RecordRequestBody } from "./types";
import { callGeminiWithAudio, parseJsonFromText } from "./llm";
import { SYSTEM_PROMPT } from "./systemPrompt";
import { buildPrePrompt, buildPostPrompt, buildFollowupPrompt } from "./prompts";
import {
  getThreads,
  getEncounters,
  getEncountersForThread,
  getThreadById,
  setPendingPreBrief,
  pushEncounter,
  pushMomentumReview,
} from "./smartsheet";

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

async function handleRecord(env: Env, body: RecordRequestBody): Promise<Response> {
  const { thread_id, stage, audio_base64, mime_type } = body;
  if (!thread_id || !stage || !audio_base64 || !mime_type) {
    return json({ error: "thread_id, stage, audio_base64, and mime_type are required" }, 400);
  }
  if (!["pre", "post", "followup"].includes(stage)) {
    return json({ error: "stage must be one of pre | post | followup" }, 400);
  }

  if (stage === "pre") {
    const prompt = buildPrePrompt(thread_id);
    const raw = await callGeminiWithAudio(env, SYSTEM_PROMPT, prompt, audio_base64, mime_type, 2000);
    const brief = parseJsonFromText(raw);
    await setPendingPreBrief(env, thread_id, JSON.stringify(brief), body.organization);
    return json({ stage, thread_id, extracted: brief });
  }

  if (stage === "post") {
    const thread = await getThreadById(env, thread_id);
    const pendingPreBrief = thread?.pending_pre_meeting_brief ? JSON.parse(thread.pending_pre_meeting_brief) : null;
    const referenceDate = new Date().toISOString().slice(0, 16);
    const prompt = buildPostPrompt(thread_id, pendingPreBrief, referenceDate);
    const raw = await callGeminiWithAudio(env, SYSTEM_PROMPT, prompt, audio_base64, mime_type, 8000);
    const parsed = parseJsonFromText(raw);
    const record = parsed.encounter_record || parsed;

    // Fields the UI collected directly (thread picker, org/location typed once) win
    // over anything the LLM inferred, same precedence --metadata already has in
    // run_pipeline() on the Python side.
    record.thread_id = thread_id;
    if (body.organization) record.organization = body.organization;
    if (body.encounter_name) record.encounter_name = body.encounter_name;
    if (body.location) record.location = body.location;
    if (!record.datetime_local) record.datetime_local = referenceDate;

    await pushEncounter(env, record);

    if (parsed.momentum_review) {
      await pushMomentumReview(env, parsed.momentum_review);
    }

    return json({ stage, thread_id, extracted: record });
  }

  // followup
  const history = await getEncountersForThread(env, thread_id);
  if (!history.length) {
    return json({ error: `No prior encounters found for thread_id='${thread_id}'. Nothing to review yet.` }, 400);
  }
  const prompt = buildFollowupPrompt(thread_id, summarizeEncounters(history));
  const raw = await callGeminiWithAudio(env, SYSTEM_PROMPT, prompt, audio_base64, mime_type, 3000);
  const parsed = parseJsonFromText(raw);
  const review = parsed.momentum_review || parsed;
  review.thread_id = thread_id;

  await pushMomentumReview(env, review);
  return json({ stage, thread_id, extracted: review });
}

function checkAuth(request: Request, env: Env): boolean {
  return request.headers.get("X-Dashboard-Key") === env.DASHBOARD_KEY;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (!checkAuth(request, env)) {
      return json({ error: "Unauthorized — missing or incorrect X-Dashboard-Key header" }, 401);
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

      return json({ error: "Not found" }, 404);
    } catch (err: any) {
      return json({ error: err?.message || String(err) }, 500);
    }
  },
};
