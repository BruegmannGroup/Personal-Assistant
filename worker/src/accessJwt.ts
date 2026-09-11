import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Env } from "./types";

// Cloudflare Access authenticates the user at the edge and attaches a signed
// JWT to every request it forwards. Verifying that signature — rather than
// trusting the header's presence — is what makes this safe: preview URLs and
// any other hostname not covered by the Access application would otherwise
// reach the Worker with headers an attacker controls.

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedForDomain = "";

function jwks(teamDomain: string) {
  if (!cachedJwks || cachedForDomain !== teamDomain) {
    cachedJwks = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    cachedForDomain = teamDomain;
  }
  return cachedJwks;
}

export interface AccessIdentity {
  email: string;
  subject: string;
}

function readToken(request: Request): string | null {
  // Fetch/XHR requests carry the assertion header. Browser-initiated requests
  // (<audio src>, <a href>) carry the CF_Authorization cookie instead — which
  // is exactly why the dashboard passphrase is no longer needed for playback.
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;

  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

/** Returns the verified Access identity, or null if the request has none. */
export async function verifyAccessJwt(request: Request, env: Env): Promise<AccessIdentity | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const token = readToken(request);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, jwks(env.ACCESS_TEAM_DOMAIN), {
      issuer: `https://${env.ACCESS_TEAM_DOMAIN}`,
      audience: env.ACCESS_AUD,
    });
    return {
      email: typeof payload.email === "string" ? payload.email : "",
      subject: typeof payload.sub === "string" ? payload.sub : "",
    };
  } catch {
    return null;
  }
}
