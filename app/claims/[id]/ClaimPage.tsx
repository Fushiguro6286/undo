"use client";
import { useCallback, useEffect, useState } from "react";
import { productSvgDataUri } from "@/src/store/art";
import { itemName, variantBySku, type Variant } from "@/src/store/catalog";

type Vision = { challenge_code_found: string | null; size_tag_text: string | null; dominant_color: string | null; item_type: string | null; damage_detected: boolean; confidence: number; notes: string };
type Assessment = { decision: "NEEDS_NEW_PHOTO" | "READY"; signals: string[]; returnRequired: boolean; photoMatches: { kind: string; ref: string; distance: number }[] };
type Claim = {
  id: string; type: string; description: string; challengeCode: string; status: string; deliveryContested: boolean;
  order: { paypalOrderId: string; amount: string | null; chosenItem: Variant | null; intent: { mode: string; cart: { sku: string }[] | null } | null };
  shipment: { deliveredAt: string | null; trackingNumber: string | null } | null;
  evidence: { id: string; photoPath: string; visionResult: Vision | null }[];
  assessment: Assessment | null;
  faultParty: string | null;
  reasons: { code: string }[] | null;
  offers: { id: string; action: string; amount: string | null; chosen: boolean; explanation: { buyer: string; label: string; verdict: string; source: string } | null }[];
  moneyActions: { kind: string; amount: string | null; paypalRef: string | null; status: string }[];
  escalateUrl: string;
};

const PARTY_TEXT: Record<string, string> = {
  MERCHANT: "The store is at fault",
  CARRIER: "The item was damaged in transit",
  AGENT: "Your shopping agent is at fault",
  BUYER: "This order matches what was approved",
  UNCLEAR: "A person needs to look at this claim",
};
const OPEN = ["AWAITING_PHOTO", "NEEDS_NEW_PHOTO", "DECIDED", "OFFERED"];
const STATUS_TEXT: Record<string, string> = {
  QUEUED: "Your choice is waiting for the store's approval.",
  AWAITING_RETURN: "Send the item back. Your refund is paid when the store receives it.",
  IN_REVIEW: "A person at the store is reviewing your claim.",
  REFUND_SENT: "Your refund was sent through PayPal. Waiting for PayPal's confirmation.",
  RESOLVED: "Resolved.",
  DENIED: "Your claim was denied under the store's policy.",
  ESCALATED: "This claim is with PayPal. PayPal makes the final decision.",
  PAYOUT_SENT: "Your agent's platform is paying you back through PayPal. Waiting for PayPal's confirmation.",
  PAYOUT_FAILED: "The payout from your agent's platform did not go through. A person at the store will follow up.",
  RESPOND_IN_PAYPAL: "This payment is disputed in PayPal, so PayPal decides it. Undo will not send a separate refund.",
  ANSWERED_IN_PAYPAL: "The store answered your PayPal case with its records. PayPal makes the final decision.",
  RESOLVED_BY_PAYPAL: "PayPal decided this case.",
};

const SIGNAL_TEXT: Record<string, string> = {
  PHOTO_MATCHES_LISTING: "This photo matches the store's own listing photo.",
  PHOTO_MATCHES_EARLIER_CLAIM: "This photo matches a photo from another claim.",
  LOW_VISION_CONFIDENCE: "The photo was hard to read.",
  VISION_FAILED: "The photo couldn't be analyzed automatically.",
  DELIVERY_DATE_CONTESTED: "You disputed the delivery date.",
};

export function ClaimPage({ id }: { id: string }) {
  const [claim, setClaim] = useState<Claim>();
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const call = useCallback(async (path: string, init?: RequestInit) => {
    setError(undefined);
    const res = await fetch(path, init);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    setClaim(json);
  }, []);

  useEffect(() => {
    call(`/api/claims/${id}`).catch((e) => setError(e.message));
  }, [id, call]);

  async function upload() {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("photo", file);
    try {
      await call(`/api/claims/${id}/evidence`, { method: "POST", body: form });
      setFile(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function choose(offerId: string) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/claims/${id}/choose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ offer_id: offerId }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      setClaim(json.claim);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function contest() {
    setBusy(true);
    try {
      await call(`/api/claims/${id}/contest-delivery`, { method: "POST" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!claim) return <main className="page">{error ? <p className="error" role="alert">{error}</p> : <p className="muted">Loading claim…</p>}</main>;

  const item = claim.order.chosenItem ?? variantBySku(claim.order.intent?.cart?.[0]?.sku ?? "");
  const latest = claim.evidence[0];
  const v = latest?.visionResult;
  const a = claim.assessment;
  const open = OPEN.includes(claim.status);
  const refund = claim.moneyActions.find((m) => m.kind === "refund");
  const payout = claim.moneyActions.find((m) => m.kind === "payout");

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Fernleaf Goods · Claim</p>
        <h1>Show us what arrived</h1>
        <p className="muted">PayPal order <code>{claim.order.paypalOrderId}</code>{item ? ` · ${itemName(item)} · $${claim.order.amount}` : ""}</p>
      </header>

      {open && <section className="card stack">
        <p>Write this code on a piece of paper, put it next to the item, and take one photo where both are clearly visible. Include the size tag if you can.</p>
        <p className="code" aria-label="Your one-time code">{claim.challengeCode}</p>
        <div className="row">
          <input type="file" accept="image/*" capture="environment" aria-label="Photo of the item with the code" onChange={(e) => setFile(e.target.files?.[0])} />
          <button onClick={upload} disabled={!file || busy}>{busy ? "Checking photo…" : "Upload photo"}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>}

      {claim.faultParty && (
        <section className="card stack" aria-live="polite">
          <p className="eyebrow">Decision</p>
          <h2>{PARTY_TEXT[claim.faultParty] ?? claim.faultParty}</h2>
          {claim.status === "OFFERED" ? (
            <>
              <p className="muted">These are the remedies the store&apos;s policy allows. Pick one.</p>
              <div className="offers">
                {claim.offers.map((o) => (
                  <div key={o.id} className="offer">
                    <div>
                      <strong>{o.explanation?.label ?? o.action}{o.amount ? ` · $${o.amount}` : ""}</strong>
                      <p className="muted">{o.explanation?.buyer}</p>
                      {o.explanation?.verdict === "QUEUE" && <p className="muted small">The store approves this before it is paid.</p>}
                    </div>
                    {o.action === "ESCALATE_TO_PAYPAL"
                      ? <a className="button-link" href={claim.escalateUrl} target="_blank" rel="noreferrer" onClick={() => choose(o.id)}>Open PayPal</a>
                      : <button onClick={() => choose(o.id)} disabled={busy}>Choose</button>}
                  </div>
                ))}
              </div>
              {claim.offers.some((o) => o.explanation?.source === "llm") && <p className="muted small">Explanations are written by AI; every amount comes from the store&apos;s rules.</p>}
            </>
          ) : (
            <>
              <p>{STATUS_TEXT[claim.status] ?? claim.status}</p>
              {refund && <p className="muted">Refund ${refund.amount} · PayPal refund <code>{refund.paypalRef ?? "pending"}</code> · {refund.status === "CONFIRMED" ? "confirmed by PayPal" : `PayPal status ${refund.status}`}</p>}
              {payout && <p className="muted">Paid by your agent&apos;s platform: ${payout.amount} · PayPal payout <code>{payout.paypalRef ?? "pending"}</code> · {payout.status === "CONFIRMED" ? "confirmed by PayPal" : `PayPal status ${payout.status}`}</p>}
              {claim.offers.filter((o) => o.chosen).map((o) => <p key={o.id} className="muted">You chose: {o.explanation?.label ?? o.action}{o.amount ? ` ($${o.amount})` : ""}</p>)}
              {["DENIED", "ESCALATED", "RESPOND_IN_PAYPAL"].includes(claim.status) && <p className="muted"><a href={`/api/claims/${claim.id}/evidence-pack`}>Download an evidence pack</a> (PDF: every statement cites your PayPal order, approval and photo) to file in PayPal yourself.</p>}
              {claim.status === "RESPOND_IN_PAYPAL" && <p><a href={claim.escalateUrl} target="_blank" rel="noreferrer">Open PayPal&apos;s Resolution Center</a></p>}
              {claim.status === "DENIED" && <p>Disagree? PayPal stays the final arbiter: <a href={claim.escalateUrl} target="_blank" rel="noreferrer">take it to PayPal&apos;s Resolution Center</a>.</p>}
            </>
          )}
          {error && !open && <p className="error" role="alert">{error}</p>}
        </section>
      )}

      {latest && (
        <section className="card stack">
          <h2>{a?.decision === "NEEDS_NEW_PHOTO" ? "We need a new photo" : a?.signals.length ? "A person will review this claim" : "Photo received"}</h2>
          {a?.decision === "NEEDS_NEW_PHOTO" && <p className="warn">We couldn&apos;t find your code <strong>{claim.challengeCode}</strong> in the photo. Please retake it with the code clearly visible.</p>}
          {a?.signals.map((s) => <p key={s} className="warn">{SIGNAL_TEXT[s] ?? s}</p>)}
          {a?.returnRequired && <p className="muted">For an order of this value, any remedy needs the item returned.</p>}
          <div className="evidence">
            {item && <figure><img src={productSvgDataUri(item.type, item.color)} alt={`Listing: ${itemName(item)}`} /><figcaption className="muted">What you ordered</figcaption></figure>}
            <figure><img src={latest.photoPath} alt="Your photo" /><figcaption className="muted">Your photo</figcaption></figure>
          </div>
          {v && (
            <dl className="facts">
              <dt>Code seen</dt><dd>{v.challenge_code_found ?? "none"}</dd>
              <dt>Item</dt><dd>{v.item_type ?? "unclear"}</dd>
              <dt>Color</dt><dd>{v.dominant_color ?? "unclear"}</dd>
              <dt>Size tag</dt><dd>{v.size_tag_text ?? "not readable"}</dd>
              <dt>Damage</dt><dd>{v.damage_detected ? "yes" : "none seen"}</dd>
              <dt>Confidence</dt><dd>{Math.round(v.confidence * 100)}%</dd>
              <dt>Notes</dt><dd>{v.notes}</dd>
            </dl>
          )}
        </section>
      )}

      {claim.shipment?.deliveredAt && (
        <section className="card stack">
          <p>The store reports delivery on <strong>{new Date(claim.shipment.deliveredAt).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</strong> (tracking <code>{claim.shipment.trackingNumber}</code>).</p>
          {claim.deliveryContested ? <p className="muted">You disputed this date. A person will review it.</p> : open && <div><button onClick={contest} disabled={busy}>That date is wrong</button></div>}
        </section>
      )}
    </main>
  );
}
