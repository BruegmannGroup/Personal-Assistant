import type { Env } from "./types";

// Gemini is the only provider used here because it's the only one of the three
// llm_client.py supports (gemini/openai/anthropic) that accepts raw audio as
// input today — see the plan file for why. Adding another audio-capable
// provider later means adding one function here, same spirit as llm_client.py's
// provider-class pattern on the Python side.

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

async function callGemini(
  env: Env,
  systemPrompt: string,
  parts: Record<string, unknown>[],
  maxOutputTokens: number
): Promise<string> {
  const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens,
      responseMimeType: "application/json",
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Gemini request failed: ${resp.status} ${text}`);
  }

  const data: any = await resp.json();
  const responseParts = data?.candidates?.[0]?.content?.parts;
  if (!responseParts || !responseParts.length) {
    throw new Error(`Gemini returned no content: ${JSON.stringify(data)}`);
  }
  return responseParts.map((p: any) => p.text || "").join("");
}

export function callGeminiWithAudio(
  env: Env,
  systemPrompt: string,
  textPrompt: string,
  audioBase64: string,
  mimeType: string,
  maxOutputTokens = 8000
): Promise<string> {
  return callGemini(
    env,
    systemPrompt,
    [{ text: textPrompt }, { inline_data: { mime_type: mimeType, data: audioBase64 } }],
    maxOutputTokens
  );
}

/** For generating a review from Smartsheet history alone — no recording involved
 * (the "refresh this review without re-recording" path). */
export function callGeminiText(
  env: Env,
  systemPrompt: string,
  textPrompt: string,
  maxOutputTokens = 3000
): Promise<string> {
  return callGemini(env, systemPrompt, [{ text: textPrompt }], maxOutputTokens);
}

export function parseJsonFromText(text: string): any {
  const fenced = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
  if (fenced) return JSON.parse(fenced[1]);
  const bare = text.match(/(\{[\s\S]*\})/);
  if (bare) return JSON.parse(bare[1]);
  throw new Error("No JSON object found in LLM output");
}
