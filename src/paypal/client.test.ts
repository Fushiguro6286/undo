import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSandbox, createPayPalClient, PayPalError, SANDBOX_BASE_URL } from "./client";

const SECRET_TOKEN = "A21AAsecret-token-value";

function mockFetch(handler: (url: string, init: RequestInit) => Response) {
  const fn = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fn);
  return fn;
}
const tokenResponse = () =>
  new Response(JSON.stringify({ access_token: SECRET_TOKEN, expires_in: 32400, scope: "a b", app_id: "APP-1" }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("assertSandbox", () => {
  it("accepts the sandbox host, with or without a trailing slash", () => {
    expect(assertSandbox(SANDBOX_BASE_URL)).toBe(SANDBOX_BASE_URL);
    expect(assertSandbox(SANDBOX_BASE_URL + "/")).toBe(SANDBOX_BASE_URL);
    expect(assertSandbox(undefined)).toBe(SANDBOX_BASE_URL);
  });
  it("refuses live, empty and look-alike hosts", () => {
    for (const url of ["https://api-m.paypal.com", "", "https://api-m.sandbox.paypal.com.evil.com"]) {
      expect(() => assertSandbox(url)).toThrow(/Refusing to run/);
    }
  });
  it("refuses when the client is built for a live host", () => {
    expect(() => createPayPalClient({ clientId: "x", clientSecret: "y", baseUrl: "https://api-m.paypal.com" })).toThrow(/Refusing/);
  });
});

describe("request", () => {
  const client = () => createPayPalClient({ clientId: "id", clientSecret: "secret", baseUrl: SANDBOX_BASE_URL });

  it("sends PayPal-Request-Id and caches the OAuth token", async () => {
    const f = mockFetch((url) => (url.endsWith("/v1/oauth2/token") ? tokenResponse() : new Response(JSON.stringify({ id: "R1" }), { status: 201 })));
    const c = client();
    await c.request("POST", "/v2/payments/captures/C1/refund", { body: { amount: { value: "1.00", currency_code: "USD" } }, requestId: "claim1:refund:1" });
    await c.request("GET", "/v2/payments/refunds/R1");
    const calls = f.mock.calls.map(([u]) => u);
    expect(calls.filter((u) => u.endsWith("/v1/oauth2/token"))).toHaveLength(1);
    const headers = f.mock.calls[1][1].headers as Record<string, string>;
    expect(headers["PayPal-Request-Id"]).toBe("claim1:refund:1");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends Content-Type JSON on body-less POSTs (PayPal 415s without it), but not on multipart", async () => {
    const f = mockFetch((url) => (url.endsWith("/v1/oauth2/token") ? tokenResponse() : new Response("{}", { status: 201 })));
    const c = client();
    await c.request("POST", "/v2/checkout/orders/O1/capture", { requestId: "r1" });
    await c.request("POST", "/v1/customer/disputes/D1/provide-evidence", { form: new FormData() });
    const [capture, multipart] = f.mock.calls.slice(1).map(([, init]) => init.headers as Record<string, string>);
    expect(capture["Content-Type"]).toBe("application/json");
    expect(multipart["Content-Type"]).toBeUndefined();
  });

  it("throws PayPalError with name, issues and debug id, never the token", async () => {
    mockFetch((url) =>
      url.endsWith("/v1/oauth2/token")
        ? tokenResponse()
        : new Response(JSON.stringify({ name: "UNPROCESSABLE_ENTITY", details: [{ issue: "TRANSACTION_DISPUTED" }], debug_id: "dbg1" }), { status: 422 }),
    );
    const err = await client().request("POST", "/v2/payments/captures/C1/refund", { body: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(PayPalError);
    expect(err.issues).toEqual(["TRANSACTION_DISPUTED"]);
    expect(err.debugId).toBe("dbg1");
    expect(JSON.stringify(err) + err.message + err.stack).not.toContain(SECRET_TOKEN);
  });

  it("reports OAuth failure without leaking the secret", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: "invalid_client", error_description: "Client Authentication failed" }), { status: 401 }));
    const err = await client().whoami().catch((e) => e);
    expect(err.code).toBe("invalid_client");
    expect(err.message).not.toContain("secret");
  });

  it("whoami returns app id and scopes but no token", async () => {
    mockFetch(() => tokenResponse());
    const w = await client().whoami();
    expect(w).toMatchObject({ appId: "APP-1", scopes: ["a", "b"] });
    expect(JSON.stringify(w)).not.toContain(SECRET_TOKEN);
  });
});
