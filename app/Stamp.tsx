// The rubber-stamp verdict used on claims, judge runs and the home page. Purely visual: the words come from the ruling.
const PARTY: Record<string, { text: string; tone: string }> = {
  MERCHANT: { text: "Merchant at fault", tone: "" },
  CARRIER: { text: "Carrier at fault", tone: "" },
  AGENT: { text: "Agent at fault", tone: "" },
  BUYER: { text: "Claim denied", tone: "stamp-ink" },
  UNCLEAR: { text: "Sent to a person", tone: "stamp-warn" },
};

export function Stamp({ party, text, sub, tone, delay }: { party?: string | null; text?: string; sub?: string; tone?: "ok" | "ink" | "warn"; delay?: number }) {
  const p = party ? PARTY[party] : undefined;
  const label = text ?? p?.text;
  if (!label) return null;
  const cls = tone ? `stamp-${tone}` : p?.tone ?? "";
  return (
    <span className={`stamp ${cls}`} style={delay ? ({ "--d": `${delay}s` } as React.CSSProperties) : undefined} role="img" aria-label={sub ? `${label}: ${sub}` : label}>
      {label}
      {sub && <small>{sub}</small>}
    </span>
  );
}
