import type { Env } from "./types";

// Every recording is written to R2 before it's used for anything else, so the
// original audio survives even if the Gemini call or the Smartsheet write fails
// afterward — nothing is ever processed from memory alone and then discarded.

function extensionFor(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a";
  return "audio";
}

export function buildAudioKey(stage: string, mimeType: string): string {
  // Not nested under a thread id: for pre/post/followup the recording is saved
  // *before* the LLM has determined which thread it belongs to (see index.ts),
  // so the key can't depend on that yet.
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const rand = Math.random().toString(16).slice(2, 8);
  return `${stage}/${ts}-${rand}.${extensionFor(mimeType)}`;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function saveAudioRecording(
  env: Env,
  stage: string,
  audioBase64: string,
  mimeType: string
): Promise<string> {
  const key = buildAudioKey(stage, mimeType);
  const bytes = base64ToBytes(audioBase64);
  await env.AUDIO_BUCKET.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  return key;
}

export async function loadAudioRecording(env: Env, key: string): Promise<R2ObjectBody | null> {
  return env.AUDIO_BUCKET.get(key);
}
