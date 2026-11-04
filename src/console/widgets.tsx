"use client";
// The console's shared state (a tiny store the widgets subscribe to) and the two custom AG Studio widgets:
// the approval queue and the evidence viewer. Every action goes to the merchant API, which runs the evaluator
// before the money router; nothing here can pay on its own.
import { useState, useSyncExternalStore } from "react";
import type { ConsoleData } from "./data";
import { ACTIONS } from "../policy/evaluator";
import { productSvgDataUri } from "../store/art";

type Claim = ConsoleData["claims"][number];
type Approval = ConsoleData["approvals"][number];
type State = { data?: ConsoleData; selected?: string; notice?: { text: string; error?: boolean }; busy?: string };

let state: State = {};
let key = "";
const subs = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
export const useConsole = () => useSyncExternalStore(subscribe, () => state, () => state);

async function call(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-merchant-key": key },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

export async function login(password: string) {
  key = password;
  set({ data: await call("/api/merchant/console") });
}
export const refresh = () => call("/api/merchant/console").then((data) => set({ data }));
const select = (claimId: string) => set({ selected: claimId });

async function act(id: string, fn: () => Promise<{ text: string }>) {
  set({ busy: id, notice: undefined });
  try {
    set({ notice: await fn() });
    await refresh();
  } catch (e) {
    set({ notice: { text: (e as Error).message, error: true } });
  } finally {
    set({ busy: undefined });
  }
}

type Result = { status?: string; refund?: { refundId?: string; amount?: string } };
const describe = (r: Result) =>
  r.refund?.refundId ? `Refund ${r.refund.refundId} sent to PayPal: $${r.refund.amount}. PayPal confirms it by webhook.` : `Done: ${r.status ?? "OK"}.`;

const approve = (a: Approval, amount?: string) =>
  act(a.id, async () => ({ text: describe(await call(`/api/merchant/approvals/${a.id}`, { decision: "approve", ...(amount !== undefined && { amount }) })) }));
const reject = (a: Approval) => act(a.id, async () => (await call(`/api/merchant/approvals/${a.id}`, { decision: "reject" }), { text: "Rejected. The buyer's other options stay open." }));
const propose = (a: Approval, p: { action: string; amount: string | null; asParty: string }) =>
  act(a.id, async () => {
    const r = await call(`/api/merchant/claims/${a.claimId}/propose`, p);
    if (r.verdict === "BLOCK") throw new Error(`Blocked by your policy: ${r.reasons.join(", ")}`);
    return { text: "Proposal checked against your policy and added to the queue. Approve it to pay." };
  });

const label = (action: string) => action.charAt(0) + action.slice(1).toLowerCase().replaceAll("_", " ");
const money = (v: string | null | undefined) => (v ? `$${v}` : "");
const PARTIES = ["MERCHANT", "CARRIER", "AGENT", "BUYER"];
const REMEDIES = ACTIONS.filter((a) => a !== "HUMAN_REVIEW" && a !== "ESCALATE_TO_PAYPAL");

function Notice() {
  const { notice } = useConsole();
  return notice ? <p className={notice.error ? "error" : "uc-ok"} role="status">{notice.text}</p> : null;
}

function QueueItem({ a, claim }: { a: Approval; claim?: Claim }) {
  const { busy } = useConsole();
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState({ asParty: "MERCHANT", action: "PARTIAL_REFUND_KEEP_ITEM", amount: "" });
  const why = (a.explanation as { merchant?: string } | null)?.merchant;
  const review = a.action === "HUMAN_REVIEW";
  const off = busy !== undefined;
  return (
    <article className="uc-item">
      <header className="uc-head">
        <strong>{label(a.action)} {money(a.amount)}</strong>
        <span className={`uc-party uc-${(a.faultParty ?? "none").toLowerCase()}`}>{a.faultParty ?? "No ruling"}</span>
      </header>
      <p className="muted uc-small">
        {claim?.item?.name ?? "Order"} · paid {money(a.orderAmount)} · order {a.paypalOrderId} · proposed by {a.proposedBy === "system" ? "Undo" : a.proposedBy}
      </p>
      {why && <p className="uc-small">{why}</p>}
      {review ? (
        <div className="uc-actions">
          <select aria-label="Who is at fault" value={draft.asParty} onChange={(e) => setDraft({ ...draft, asParty: e.target.value })}>
            {PARTIES.map((p) => <option key={p}>{p}</option>)}
          </select>
          <select aria-label="Remedy" value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}>
            {REMEDIES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
          </select>
          <input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
          <button disabled={off} onClick={() => propose(a, { ...draft, amount: draft.amount.trim() || null })}>Propose</button>
          <button className="uc-ghost" disabled={off} onClick={() => reject(a)}>Dismiss</button>
          <button className="uc-ghost" onClick={() => select(a.claimId)}>Evidence</button>
        </div>
      ) : (
        <div className="uc-actions">
          {edit === null ? (
            <>
              <button disabled={off} onClick={() => approve(a)}>{busy === a.id ? "Working…" : `Approve ${money(a.amount)}`}</button>
              {a.amount && <button className="uc-ghost" disabled={off} onClick={() => setEdit(a.amount ?? "")}>Edit amount</button>}
            </>
          ) : (
            <>
              <input aria-label="New amount" inputMode="decimal" value={edit} onChange={(e) => setEdit(e.target.value)} />
              <button disabled={off} onClick={() => approve(a, edit.trim())}>{busy === a.id ? "Working…" : `Approve $${edit}`}</button>
              <button className="uc-ghost" onClick={() => setEdit(null)}>Cancel</button>
            </>
          )}
          <button className="uc-ghost" disabled={off} onClick={() => reject(a)}>Reject</button>
          <button className="uc-ghost" onClick={() => select(a.claimId)}>Evidence</button>
        </div>
      )}
    </article>
  );
}

export function ApprovalQueue() {
  const { data } = useConsole();
  if (!data) return <p className="muted uc-pad">Loading…</p>;
  return (
    <div className="uc-widget">
      <Notice />
      {data.approvals.length ? (
        data.approvals.map((a) => <QueueItem key={a.id} a={a} claim={data.claims.find((c) => c.id === a.claimId)} />)
      ) : (
        <p className="muted">Nothing waiting. Remedies inside your auto-approve limit are paid automatically.</p>
      )}
    </div>
  );
}

function AuditBadge({ audit }: { audit: ConsoleData["audit"] }) {
  return audit.ok ? (
    <span className="uc-badge uc-badge-ok" title={`Checked ${new Date(audit.checkedAt).toLocaleTimeString()}`}>✓ Audit chain verified · {audit.count} events</span>
  ) : (
    <span className="uc-badge uc-badge-bad">✗ Audit chain broken at event {audit.brokenAt}</span>
  );
}

const yesNo = (v: boolean | null | undefined) => (v == null ? "—" : v ? "yes" : "no");

export function EvidenceViewer() {
  const { data, selected } = useConsole();
  if (!data) return <p className="muted uc-pad">Loading…</p>;
  const c = data.claims.find((x) => x.id === selected) ?? data.claims.find((x) => x.photoPath) ?? data.claims[0];
  if (!c) return <div className="uc-widget"><AuditBadge audit={data.audit} /><p className="muted">No claims yet.</p></div>;
  const v = c.vision;
  return (
    <div className="uc-widget">
      <div className="uc-head">
        <select aria-label="Claim" value={c.id} onChange={(e) => select(e.target.value)}>
          {data.claims.map((x) => (
            <option key={x.id} value={x.id}>{x.item?.name ?? "Order"} · {x.faultParty ?? x.status} · {x.id.slice(0, 8)}</option>
          ))}
        </select>
        <AuditBadge audit={data.audit} />
      </div>
      <div className="uc-photos">
        <figure>
          {c.item ? <img src={productSvgDataUri(c.item.type, c.item.color)} alt={`Listing photo: ${c.item.name}`} /> : <div className="uc-nophoto">No listing</div>}
          <figcaption className="muted">Ordered: {c.item?.name ?? "unknown"}</figcaption>
        </figure>
        <figure>
          {c.photoPath ? <img src={c.photoPath} alt="Photo of the delivered item" /> : <div className="uc-nophoto">No photo yet</div>}
          <figcaption className="muted">Delivered (buyer's photo)</figcaption>
        </figure>
      </div>
      <h4>Fault: {c.faultParty ?? "no decision yet"} <span className="muted uc-small">· {c.status} · {c.mode ?? ""} · {money(c.amount)}</span></h4>
      <ul className="uc-reasons">
        {[...c.signals, ...c.reasons].map((r, n) => <li key={n}><code>{r.code}</code> {r.text}</li>)}
      </ul>
      {v && (
        <dl className="facts uc-small">
          <dt>Challenge code</dt><dd>{v.challenge_code_found ?? "not found"}</dd>
          <dt>Size tag</dt><dd>{v.size_tag_text ?? "—"}</dd>
          <dt>Color</dt><dd>{v.dominant_color ?? "—"}</dd>
          <dt>Item type</dt><dd>{v.item_type ?? "—"}</dd>
          <dt>Damage</dt><dd>{yesNo(v.damage_detected)}</dd>
          <dt>Confidence</dt><dd>{Math.round(v.confidence * 100)}%</dd>
          <dt>Vision notes</dt><dd>{v.notes}</dd>
        </dl>
      )}
      {c.description && <p className="uc-small"><span className="muted">Buyer wrote:</span> “{c.description}”</p>}
    </div>
  );
}
