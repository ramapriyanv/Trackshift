import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ GET: vi.fn(), POST: vi.fn() }));
vi.mock("@/auth", () => ({ handlers: mocks }));
import { GET, POST } from "./route";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("production authentication routes", () => {
  it.each(["GET", "POST"] as const)("keeps Spotify tokens out of the public %s session response", async (method) => {
    mocks[method].mockResolvedValue(Response.json({
      accessToken: "private-access-token", refreshToken: "private-refresh-token", expires: "2027-01-01", error: undefined,
      user: { name: "Listener", email: "listener@example.test", image: null, accessToken: "nested-private-token" },
    }, { headers: { "Set-Cookie": "session=renewed; HttpOnly; Secure" } }));
    const req = new NextRequest("http://127.0.0.1:3000/api/auth/session", { method });
    const response = await (method === "GET" ? GET(req) : POST(req));
    const body = await response.json();
    expect(body).toEqual({ user: { name: "Listener", email: "listener@example.test", image: null }, expires: "2027-01-01" });
    expect(response.headers.get("set-cookie")).toContain("session=renewed");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses the configured HTTPS origin for production OAuth callbacks", async () => {
    vi.stubEnv("AUTH_URL", "https://trackshift.example.test");
    const original = new Response(null, { status: 302, headers: { Location: "https://trackshift.example.test/app" } });
    mocks.GET.mockResolvedValue(original);
    const response = await GET(new NextRequest("http://127.0.0.1:3000/api/auth/callback/spotify?code=test-only-code", {
      headers: { "x-forwarded-host": "unexpected.example.test", "x-forwarded-proto": "http" },
    }));
    expect(mocks.GET.mock.calls[0][0].url).toBe("https://trackshift.example.test/api/auth/callback/spotify?code=test-only-code");
    expect(mocks.GET.mock.calls[0][0].nextUrl.origin).toBe("https://trackshift.example.test");
    expect(response).toBe(original);
  });

  it("keeps unauthenticated sessions null", async () => {
    mocks.GET.mockResolvedValue(Response.json(null));
    expect(await (await GET(new NextRequest("http://127.0.0.1:3000/api/auth/session"))).json()).toBeNull();
  });
});
