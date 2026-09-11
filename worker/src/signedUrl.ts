import type { Env } from "./types";

// Short-lived signed URLs for audio playback.
//
// `<audio src>` and `<a href>` cannot attach custom headers, so the audio route
// used to accept the dashboard passphrase as a query parameter. That put a
// long-lived secret into browser history, Cloudflare logs and Referer headers,
// where it stayed valid forever. Instead the Worker now signs one URL per
// recording, scoped to that object key and valid for a few minutes.
//
// The signing key is derived from DASHBOARD_KEY rather than being its own
// secret, so there is nothing extra to set with `wrangler secret put`. Rotating
// DASHBOARD_KEY therefore also invalidates every outstanding audio link, which
// is the behaviour you want anyway.

const PURPOSE = "audio-url-v1";
const DEFAULT_TTL_SECONDS = 300;

async function signingKey(env: Env): Promise<CryptoKey> {
  const material = new TextEncoder().encode(`${env.DASHBOARD_KEY}:${PURPOSE}`);
  const digest = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function payload(key: string, exp: number): Uint8Array {
  return new TextEncoder().encode(`${key}:${exp}`);
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Build a relative, signed /api/audio URL for one R2 object key. */
export async function buildSignedAudioUrl(
  env: Env,
  key: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = await crypto.subtle.sign("HMAC", await signingKey(env), payload(key, exp));
  const params = new URLSearchParams({ key, exp: String(exp), sig: toBase64Url(signature) });
  return `/api/audio?${params.toString()}`;
}

/** Verify a signed audio URL. Returns false for anything malformed or expired. */
export async function verifyAudioSignature(
  env: Env,
  key: string,
  exp: string | null,
  sig: string | null
): Promise<boolean> {
  if (!key || !exp || !sig) return false;

  const expiresAt = Number(exp);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)) return false;

  let signature: Uint8Array;
  try {
    signature = fromBase64Url(sig);
  } catch {
    return false;
  }

  // crypto.subtle.verify compares in constant time.
  return crypto.subtle.verify("HMAC", await signingKey(env), signature, payload(key, expiresAt));
}
