// PayPal REST client: OAuth (cached), sandbox-only base URL, PayPal-Request-Id, and errors that never carry tokens.

export const SANDBOX_BASE_URL = "https://api-m.sandbox.paypal.com";

/** Throws unless the configured PayPal host is the sandbox. Called at startup and by every client. */
export function assertSandbox(baseUrl: string | undefined = process.env.PAYPAL_BASE_URL): string {
  if (baseUrl?.replace(/\/+$/, "") !== SANDBOX_BASE_URL || (process.env.PAYPAL_ENV ?? "sandbox") !== "sandbox") {
    throw new Error(`Refusing to run: PAYPAL_BASE_URL must be ${SANDBOX_BASE_URL} and PAYPAL_ENV must be sandbox.`);
  }
  return SANDBOX_BASE_URL;
}

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly issues: string[],
    readonly debugId?: string,
  ) {
    super(`PayPal ${status} ${code}${issues.length ? `: ${issues.join(", ")}` : ""}${debugId ? ` (debug_id ${debugId})` : ""}`);
    this.name = "PayPalError";
  }
}

export type RequestOptions = {
  body?: unknown;
  form?: FormData; // multipart (provide-evidence); Content-Type is set by fetch
  requestId?: string; // PayPal-Request-Id: same id => PayPal returns the original result, never a second action
  headers?: Record<string, string>;
};

type Token = { value: string; expiresAt: number; scope: string; appId: string };

export function createPayPalClient(opts: { clientId?: string; clientSecret?: string; baseUrl?: string }) {
  const base = assertSandbox(opts.baseUrl ?? process.env.PAYPAL_BASE_URL);
  const { clientId, clientSecret } = opts;
  if (!clientId || !clientSecret) throw new Error("PayPal client id or secret is missing");
  let token: Token | undefined;

  async function getToken(): Promise<Token> {
    if (token && token.expiresAt - 60_000 > Date.now()) return token;
    const res = await fetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      throw new PayPalError(res.status, json.error ?? "OAUTH_FAILED", [json.error_description].filter(Boolean), res.headers.get("paypal-debug-id") ?? undefined);
    }
    token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000, scope: json.scope ?? "", appId: json.app_id ?? "" };
    return token;
  }

  async function request<T = any>(method: string, path: string, o: RequestOptions = {}): Promise<T> {
    const { value } = await getToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${value}`, Prefer: "return=representation", ...o.headers };
    if (o.requestId) headers["PayPal-Request-Id"] = o.requestId;
    let body: BodyInit | undefined;
    if (o.form) body = o.form;
    else {
      headers["Content-Type"] = "application/json"; // PayPal returns 415 on body-less POSTs (capture, authorize) without it
      if (o.body !== undefined) body = JSON.stringify(o.body);
    }
    const res = await fetch(`${base}${path}`, { method, headers, body });
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const issues = (json?.details ?? []).map((d: any) => d.issue ?? d.description).filter(Boolean);
      throw new PayPalError(res.status, json?.name ?? json?.error ?? `HTTP_${res.status}`, issues, json?.debug_id ?? res.headers.get("paypal-debug-id") ?? undefined);
    }
    return json as T;
  }

  return {
    request,
    /** OAuth check without exposing the token. */
    async whoami() {
      const t = await getToken();
      return { appId: t.appId, scopes: t.scope.split(" ").filter(Boolean), expiresInSec: Math.round((t.expiresAt - Date.now()) / 1000) };
    },
  };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

let merchantClient: PayPalClient | undefined;
let agentPlatformClient: PayPalClient | undefined;

/** The store's REST app: orders, captures, refunds, tracking, disputes, webhooks. */
export const merchant = () =>
  (merchantClient ??= createPayPalClient({ clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET }));

/** The agent platform's REST app: pays agent-fault payouts. */
export const agentPlatform = () =>
  (agentPlatformClient ??= createPayPalClient({ clientId: process.env.AGENT_PLATFORM_CLIENT_ID, clientSecret: process.env.AGENT_PLATFORM_CLIENT_SECRET }));
