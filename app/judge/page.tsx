// Judge mode landing page (spec section 18): three live one-click scenarios, the recorded runs, and how to try
// everything by hand.
import { notFound } from "next/navigation";
import { DEMO_CHALLENGE_CODE } from "@/src/claims/code";
import { judgeMode } from "@/src/judge";
import { STORE_NAME } from "@/src/store/catalog";
import { JudgeRun } from "./JudgeRun";

export const dynamic = "force-dynamic";
export const metadata = { title: "Judge mode · Undo" };

const SAMPLES = [
  ["correct-item.jpg", "Correct item (sky-blue tee, size M)"],
  ["wrong-color.jpg", "Wrong color (navy tee)"],
  ["wrong-size.jpg", "Wrong size (tag reads L)"],
  ["damaged.jpg", "Damaged in transit"],
  ["reused-listing.jpg", "The store's own listing photo, reused"],
  ["no-code.jpg", "No challenge code visible"],
];

export default function Page() {
  if (!judgeMode()) notFound();
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Undo · judge mode</p>
        <h1>Try Undo in the PayPal sandbox</h1>
        <p className="muted">
          {STORE_NAME} is a fictional store. Every button below runs the real flow on a paid sandbox order: the vision model reads the photo, the
          fault engine decides, the store&apos;s rules make the offers, and PayPal moves the (sandbox) money.
        </p>
      </header>

      <JudgeRun scenario="merchant" title="1 · Merchant at fault" blurb="The buyer ordered a sky-blue tee and a navy one arrived." expect="MERCHANT; the buyer's agent picks the keep-it partial refund; PayPal refunds it (auto-approved, inside the store's limit)." />
      <JudgeRun scenario="denial" title="2 · Denied" blurb="“My agent bought this without asking me.” The person approved this exact cart on PayPal, and the right item arrived." expect="BUYER; denied, citing the PayPal approval and the intent hash, with Escalate to PayPal offered." />
      <JudgeRun scenario="agent" title="3 · Agent at fault" blurb="The person approved a ceiling for a size M tee. Their agent bought size L." expect="AGENT; the agent platform pays the buyer through PayPal Payouts." />

      <section className="card">
        <h2>The other ten scenarios</h2>
        <p>
          <a href="/evals">Measured results</a> for all 13 scenarios: the recorded live run of each, with its real PayPal ids, plus the rules-only check on every
          fixture.
        </p>
      </section>

      <section className="card">
        <h2>Try it by hand</h2>
        <ol className="small">
          <li><a href="/">The store</a>: ask for an item; approve on PayPal with a sandbox buyer login from the README.</li>
          <li>On the order, open a claim and upload one of the sample photos below. On judge-mode pool orders the code <code>{DEMO_CHALLENGE_CODE}</code> printed on them is accepted; real claims always get a fresh code.</li>
          <li><a href="/merchant">Merchant console</a> (password in the README): the approval queue, evidence viewer, claim timeline and audit badge. <a href="/merchant/grid">Plain AG Grid version</a>.</li>
          <li>Claude Desktop as the buyer&apos;s agent: add <code>/mcp</code> on this site as a custom connector (README).</li>
        </ol>
        <ul className="judge-samples small">
          {SAMPLES.map(([file, text]) => (
            <li key={file}>
              <a href={`/samples/${file}`} download>
                <img src={`/samples/${file}`} alt={text} loading="lazy" />
                <span>{text}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <p className="muted small">Limits: each visitor can start 6 live runs an hour, and the AI has a daily spending cap; if it is reached, claims go to a person instead of the AI.</p>
    </main>
  );
}
