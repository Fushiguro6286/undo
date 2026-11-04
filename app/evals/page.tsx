// Measured eval results (spec section 17), from evals/results.json written by `npm run eval`. Nothing here is estimated.
import results from "@/evals/results.json";
import escalated from "@/evals/recordings/dispute-PP-R-LMM-10196447.json";

export const metadata = { title: "Evals · Undo" };

type Live = { ranAt: string; orderId: string; claimId?: string; fault?: { party: string | null; reasons: string[] }; steps: string[]; paypal: Record<string, string>; secondsToConfirmed?: number | null; visionRetried?: boolean; faultOk: boolean; remedyOk: boolean; violations: string[]; error?: string };
type Row = { id: number; name: string; expected: { party: string | null; reasons: string[] }; core: { faultOk: boolean; remedyOk: boolean; violations: string[]; fault: { party: string | null } }; live: Live | null };

type Summary = { total: number; core: { correctFault: number; correctRemedy: number; policyViolations: number; blockedActions: number }; medianSecondsToConfirmedRefund: number | null; refundsMeasured: number[] };
const r = results as unknown as { mode: string; ranAt: string; summary: Summary & { live: null | { ran: number; correctFault: number; correctRemedy: number; policyViolations: number; blockedActions: number; recordedAt: string; coreOnly: number[] }; injection: { ignoredByCore: boolean; live: null | { party: string | null; refund: string | null; sameAsScenario1: boolean } } }; scenarios: Row[] };
const s = r.summary;
const mark = (ok: boolean | undefined) => (ok === undefined ? "–" : ok ? "✓" : "✗");

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card eval-tile">
      <p className="muted small">{label}</p>
      <p className="eval-value">{value}</p>
      {note && <p className="muted small">{note}</p>}
    </div>
  );
}

// The recorded escalated case (spec section 13): real PayPal sandbox ids and times from scripts/escalated-run.ts.
const EVENT_TEXT: Record<string, string> = {
  CLAIM_OPENED: "Claim opened in Undo", EVIDENCE_ADDED: "Photo checked", FAULT_DECIDED: "Fault: merchant (wrong color)", OFFERS_CREATED: "Remedies offered by the store's rules",
  RESPOND_IN_PAYPAL: "Buyer opened a PayPal dispute instead; Undo stops making offers (Respond in PayPal)", DISPUTE_CLAIM_ACCEPTED: "Store accepted the claim in PayPal ($29.00 refund)", DISPUTE_RESOLVED: "PayPal resolved the case",
};
const esc = escalated as { disputeId: string; auditTimeline: { seq: number; event: string; at: string }[]; final: { detail?: { outcome?: string } } | null };
const hhmmss = (iso: string) => new Date(iso).toISOString().slice(11, 19);

export default function Page() {
  const live = s.live;
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Undo · measured results</p>
        <h1>13 scenarios, decided and paid in the PayPal sandbox</h1>
        <p className="muted">
          Core: the deterministic fault engine, offer rules and policy evaluator on every fixture. Live: the same scenarios run on this deployment with real sandbox orders, the vision model reading the sample photos, and PayPal confirming each refund or payout.
          Results file written {new Date(r.ranAt).toUTCString()} ({r.mode} mode).
        </p>
      </header>

      <section className="grid">
        <Tile label="Correct fault (core)" value={`${s.core.correctFault} / ${s.total}`} />
        <Tile label="Correct remedy (core)" value={`${s.core.correctRemedy} / ${s.total}`} />
        <Tile label="Policy violations" value={String(s.core.policyViolations + (live?.policyViolations ?? 0))} note={live ? "core + live" : "core"} />
        <Tile label="Blocked actions" value={String(s.core.blockedActions + (live?.blockedActions ?? 0))} note={live ? `core ${s.core.blockedActions} + live ${live.blockedActions}` : "core"} />
        <Tile label="Prompt injection (#13)" value={s.injection.ignoredByCore && (!s.injection.live || s.injection.live.sameAsScenario1) ? "Ignored" : "Check"} note={s.injection.live ? `live: ${s.injection.live.party}, same offers as #1: ${s.injection.live.sameAsScenario1 ? "yes" : "no"}` : "core"} />
        <Tile label="Median time to a confirmed refund" value={s.medianSecondsToConfirmedRefund === null ? "Not measured" : `${s.medianSecondsToConfirmedRefund} s`} note={s.refundsMeasured.length ? `claim opened to PayPal confirmation; n = ${s.refundsMeasured.length} (${s.refundsMeasured.join(", ")} s)` : undefined} />
      </section>

      {live && (
        <section className="card">
          <h2>Live sandbox run</h2>
          <p>
            {live.correctFault} / {live.ran} correct fault and {live.correctRemedy} / {live.ran} correct remedy, run {new Date(live.recordedAt).toUTCString()}.
            {live.coreOnly.length > 0 && <> Scenario {live.coreOnly.join(", ")} is core only: a real late delivery can&apos;t be produced on demand.</>}
          </p>
        </section>
      )}

      <section className="card">
        <h2>Escalated case (recorded)</h2>
        <p className="muted small">
          PayPal dispute <code>{esc.disputeId}</code> on a merchant-fault claim, run against the PayPal sandbox and recorded in{" "}
          <code>evals/recordings/dispute-{esc.disputeId}.json</code>. Outcome: <strong>{esc.final?.detail?.outcome ?? "pending"}</strong>. Times in UTC; every step is on the audit chain.
        </p>
        <ol className="small">
          {esc.auditTimeline.map((e) => <li key={e.seq}><code>{hhmmss(e.at)}</code> {EVENT_TEXT[e.event] ?? e.event}</li>)}
        </ol>
      </section>

      <section className="card">
        <h2>Scenarios</h2>
        <div className="eval-table" role="table" aria-label="Scenario results">
          <div className="eval-row eval-head" role="row">
            <span role="columnheader">#</span><span role="columnheader">Scenario</span><span role="columnheader">Expected</span><span role="columnheader">Core</span><span role="columnheader">Live</span>
          </div>
          {r.scenarios.map((x) => (
            <details key={x.id} className="eval-row" role="row">
              <summary>
                <span>{x.id}</span>
                <span>{x.name}</span>
                <span>{x.expected.party ?? "No decision"}</span>
                <span>{mark(x.core.faultOk)} fault · {mark(x.core.remedyOk)} remedy</span>
                <span>{x.live ? (x.live.error ? "error" : `${mark(x.live.faultOk)} fault · ${mark(x.live.remedyOk)} remedy`) : "core only"}</span>
              </summary>
              <div className="eval-detail small">
                <p className="muted">Expected reasons: {x.expected.reasons.join(", ") || "none"}</p>
                {x.live && (
                  <>
                    <ol>{x.live.steps.map((st, i) => <li key={i}>{st}</li>)}</ol>
                    <p className="muted">
                      PayPal order <code>{x.live.orderId}</code>
                      {Object.entries(x.live.paypal).map(([k, v]) => <span key={k}> · {k} <code>{v}</code></span>)}
                      {x.live.visionRetried && " · vision model timed out once; photo re-uploaded"}
                    </p>
                    {x.live.violations.length > 0 && <p className="error">Violations: {x.live.violations.join("; ")}</p>}
                    {x.live.error && <p className="error">{x.live.error}</p>}
                  </>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>
    </main>
  );
}
