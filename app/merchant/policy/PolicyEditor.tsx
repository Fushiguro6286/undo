"use client";
import { useCallback, useEffect, useState } from "react";

type Change = { path: string; from: unknown; to: unknown };
type Version = { id: string; version: number; sourceText: string; approvedAt: string | null; createdAt: string; policy: Record<string, unknown>; diff: Change[] };
type Overview = { active: { version: number; policy: Record<string, unknown>; sourceText: string | null; builtIn: boolean }; versions: Version[] };
type Draft = { id: string; version: number; policy: Record<string, unknown>; diff: Change[] };

const flat = (o: unknown, prefix = ""): [string, unknown][] =>
  o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => flat(v, prefix ? `${prefix}.${k}` : k)) : [[prefix, o]];
const show = (v: unknown) => (v === undefined ? "—" : String(v));

function Rules({ policy, diff }: { policy: Record<string, unknown>; diff?: Change[] }) {
  const changed = new Map(diff?.map((c) => [c.path, c]));
  return (
    <dl className="facts">
      {flat(policy).filter(([path]) => path !== "version").map(([path, value]) => {
        const c = changed.get(path);
        return [
          <dt key={`${path}-t`}>{path}</dt>,
          <dd key={`${path}-d`} className={c ? "warn" : undefined}>{c ? <><s>{show(c.from)}</s> → <strong>{show(c.to)}</strong></> : show(value)}</dd>,
        ];
      })}
    </dl>
  );
}

export function PolicyEditor({ sample }: { sample: string }) {
  const [key, setKey] = useState("");
  const [text, setText] = useState(sample);
  const [overview, setOverview] = useState<Overview>();
  const [draft, setDraft] = useState<Draft>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const call = useCallback(async (path: string, body?: unknown) => {
    const res = await fetch(path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-merchant-key": key }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
    return json;
  }, [key]);

  const load = useCallback(() => call("/api/merchant/policy").then(setOverview), [call]);
  const run = (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    fn().catch((e) => setError(e.message)).finally(() => setBusy(false));
  };

  useEffect(() => {
    try { setKey(sessionStorage.getItem("undo-merchant-key") ?? ""); } catch {}
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem("undo-merchant-key", key); } catch {}
    load().catch((e) => setError(e.message));
  }, [key, load]);

  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Merchant · Return policy</p>
        <h1>Your rules decide every remedy</h1>
        <p className="muted">Write your policy in plain words. Undo turns it into rules, shows you exactly what changes, and uses nothing until you approve it.</p>
      </header>

      <section className="card">
        <label className="row">
          <span className="muted">Merchant password</span>
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" />
        </label>
      </section>

      <section className="card">
        <h2>Policy text</h2>
        <textarea className="policy-text" value={text} onChange={(e) => setText(e.target.value)} rows={12} aria-label="Policy text" />
        <div className="row">
          <button disabled={busy} onClick={() => run(async () => { setDraft(await call("/api/merchant/policy", { text })); await load(); })}>{busy ? "Working…" : "Compile into rules"}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {draft && (
        <section className="card">
          <h2>Draft version {draft.version}</h2>
          <p className="muted">{draft.diff.length ? `${draft.diff.length} rule${draft.diff.length > 1 ? "s" : ""} change from the active policy (highlighted).` : "No rule changes from the active policy."}</p>
          <Rules policy={draft.policy} diff={draft.diff} />
          <div className="row">
            <button disabled={busy} onClick={() => run(async () => { await call(`/api/merchant/policy/${draft.id}/approve`, {}); setDraft(undefined); await load(); })}>Approve version {draft.version}</button>
          </div>
        </section>
      )}

      {overview && (
        <section className="card">
          <h2>Active: version {overview.active.version}{overview.active.builtIn ? " (built-in default)" : ""}</h2>
          <Rules policy={overview.active.policy} />
          {overview.versions.length > 0 && (
            <>
              <h2 className="spaced">History</h2>
              <ul className="history">
                {overview.versions.map((v) => (
                  <li key={v.id}>
                    <strong>v{v.version}</strong> · {v.approvedAt ? `approved ${new Date(v.approvedAt).toLocaleString()}` : "draft, not approved"} · {v.diff.length ? `${v.diff.length} difference${v.diff.length > 1 ? "s" : ""} from active` : "same as active"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </main>
  );
}
