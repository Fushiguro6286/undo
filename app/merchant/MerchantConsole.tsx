"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { login, refresh, useConsole } from "@/src/console/widgets";

// AG Studio runs in the browser only.
const Studio = dynamic(() => import("@/src/console/Studio"), { ssr: false, loading: () => <p className="muted uc-pad">Loading the console…</p> });

export function MerchantConsole({ licenseKey }: { licenseKey?: string }) {
  const { data } = useConsole();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const enter = (pw: string) => {
    setBusy(true);
    setError(undefined);
    login(pw)
      .then(() => { try { sessionStorage.setItem("undo-merchant-key", pw); } catch {} })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  useEffect(() => {
    let pw: string | null = null;
    try { pw = sessionStorage.getItem("undo-merchant-key"); } catch {}
    if (pw) enter(pw);
  }, []);
  // Webhook confirmations land on the server; poll so the queue and statuses stay current.
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => refresh().catch(() => {}), 20_000);
    return () => clearInterval(t);
  }, [!!data]);

  if (!data) {
    return (
      <main className="page">
        <header className="hero">
          <p className="eyebrow">Fernleaf Goods · Merchant console</p>
          <h1>Claims on agent purchases</h1>
          <p className="muted">Approve remedies, check the evidence, and see that every decision is on the audit chain.</p>
        </header>
        <form className="card" onSubmit={(e) => { e.preventDefault(); enter(password); }}>
          <label className="row">
            <span className="muted">Merchant password (in the README for judges)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </label>
          <div className="row"><button disabled={busy}>{busy ? "Checking…" : "Open console"}</button></div>
          {error && <p className="error" role="alert">{error}</p>}
        </form>
      </main>
    );
  }
  return (
    <main className="uc-page">
      <header className="uc-top">
        <div>
          <p className="eyebrow">Fernleaf Goods · Merchant console</p>
          <h1>Claims on agent purchases</h1>
        </div>
        <a href="/merchant/policy">Return policy →</a>
      </header>
      <Studio licenseKey={licenseKey} />
    </main>
  );
}
