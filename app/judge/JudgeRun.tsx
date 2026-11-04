"use client";
// One live judge scenario: reserve a pool order and open the claim (server), then upload the sample photo and pick
// the remedy through the same public endpoints a buyer's agent uses. Every step shown is a real response.
import { useState } from "react";

type Offer = { id: string; action: string; amount: string | null; explanation: { label: string } | null };
type Claim = { status: string; faultParty: string | null; reasons: { code: string }[] | null; offers: Offer[] };

async function call(path: string, init: RequestInit) {
  const res = await fetch(path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const label = (o: Offer) => `${o.explanation?.label ?? o.action}${o.amount ? ` $${o.amount}` : ""}`;

export function JudgeRun({ scenario, title, blurb, expect }: { scenario: string; title: string; blurb: string; expect: string }) {
  const [steps, setSteps] = useState<string[]>([]);
  const [claimId, setClaimId] = useState<string>();
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function run() {
    setBusy(true);
    setError(undefined);
    setSteps([]);
    setClaimId(undefined);
    setPaid(false);
    const push = (t: string) => setSteps((s) => [...s, t]);
    try {
      const j = await post("/api/judge/run", { scenario });
      j.steps.forEach(push);
      setClaimId(j.claimId);
      push(`Uploading the buyer's photo (${j.photo}, demo code UNDO-DEMO visible)…`);
      const form = new FormData();
      form.append("photo", await (await fetch(`/samples/${j.photo}`)).blob(), j.photo);
      const c: Claim = await call(`/api/claims/${j.claimId}/evidence`, { method: "POST", body: form });
      push(`Photo checked → fault: ${c.faultParty ?? "no decision"} (${(c.reasons ?? []).map((r) => r.code).join(", ") || c.status})`);
      if (c.offers.length) push(`Remedies the store's rules allow: ${c.offers.map(label).join(" · ")}`);
      const offer = c.offers.find((o) => o.action === j.choose);
      if (!offer) throw new Error(`the expected remedy ${j.choose} was not offered; open the claim to see why`);
      const { result } = await post(`/api/claims/${j.claimId}/choose`, { offer_id: offer.id });
      const ids = [result.refund?.refundId && `PayPal refund ${result.refund.refundId}`, result.payout?.payoutBatchId && `PayPal payout batch ${result.payout.payoutBatchId}`].filter(Boolean);
      setPaid(ids.length > 0);
      push(`Buyer's agent picks ${label(offer)} → ${result.status}${ids.length ? ` · ${ids.join(" · ")}` : ""}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card judge-run">
      <h2>{title}</h2>
      <p>{blurb}</p>
      <p className="muted small">Expected: {expect}</p>
      <div className="row">
        <button onClick={run} disabled={busy}>{busy ? "Running in the sandbox…" : steps.length ? "Run again" : "Run live"}</button>
      </div>
      {steps.length > 0 && (
        <ol className="judge-steps small" aria-live="polite">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {error && <p className="error" role="alert">{error}</p>}
      {claimId && !busy && (
        <p className="small">
          <a href={`/claims/${claimId}`}>Open the claim page</a>{paid && " (shows PayPal's confirmation when it lands)"} · <a href="/merchant">See it in the merchant console</a>
        </p>
      )}
    </article>
  );
}
