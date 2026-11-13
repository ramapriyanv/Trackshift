import { NextRequest } from "next/server";
import { handlers } from "@/auth";

// Next.js dev normalizes req.url to its bound hostname ("localhost"), which
// breaks OAuth: Spotify only accepts the registered loopback IP 127.0.0.1
// ("localhost" is not allowed for new Spotify apps). NextRequest re-normalizes
// any URL passed to it, so next-auth's own AUTH_URL override cannot fix this.
// Rebuild the request as a plain Request with the origin the browser actually
// used (from the host headers) so both OAuth legs send the registered
// redirect URI.
function withPublicOrigin(req: NextRequest): NextRequest {
  const configuredOrigin = process.env.AUTH_URL;
  if (configuredOrigin) {
    const original = new URL(req.url);
    const publicUrl = new URL(`${original.pathname}${original.search}`, new URL(configuredOrigin).origin);
    return new NextRequest(publicUrl, req);
  }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) return req;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const url = new URL(req.url);
  const publicUrl = `${proto}://${host}${url.pathname}${url.search}`;
  return new Request(publicUrl, req) as NextRequest;
}

async function handle(req: NextRequest, method: "GET" | "POST") {
  const response = await handlers[method](withPublicOrigin(req));
  // Server-side auth() still receives the Spotify token. The public session
  // endpoint must only expose presentation data, for both reads and updates.
  if (new URL(req.url).pathname !== "/api/auth/session" || !response.ok) return response;
  const session = await response.json();
  const publicSession = session ? {
    user: session.user ? { name: session.user.name, email: session.user.email, image: session.user.image } : undefined,
    expires: session.expires,
    error: session.error,
  } : null;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("Cache-Control", "no-store");
  return Response.json(publicSession, { status: response.status, headers });
}

export const GET = (req: NextRequest) => handle(req, "GET");
export const POST = (req: NextRequest) => handle(req, "POST");
