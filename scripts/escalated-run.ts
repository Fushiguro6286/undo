// Escalated claim run (spec section 13), recorded as a replay in /evals/recordings/dispute-<id>.json for the video
// and for judges. Advances one PayPal-linked step at a time (require-evidence -> provide-evidence or accept-claim ->
// adjudicate), waiting for PayPal between steps, until the dispute is resolved or the time runs out.
// accept-claim makes PayPal refund the buyer, so it only runs with --accept (the human's go-ahead).
// Usage: npx tsx --env-file=.env --env-file=.env.neon scripts/escalated-run.ts <disputeId> [--accept] [--minutes=25]
import { mkdirSync, writeFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { db } from "../src/db";
import { auditEvents, disputes } from "../src/db/schema";
import { advanceDispute, type Step } from "../src/disputes/respond";

const id = process.argv[2];
if (!id || id.startsWith("--")) throw new Error("usage: escalated-run.ts <disputeId> [--accept]");
const allowAccept = process.argv.includes("--accept");
const minutes = Number(process.argv.find((a) => a.startsWith("--minutes="))?.split("=")[1] ?? 25);
const started = new Date();
const steps: (Step & { at: string })[] = [];
const deadline = Date.now() + minutes * 60_000;

while (Date.now() < deadline) {
  let s: Step;
  try {
    s = await advanceDispute(id, "escalated-run script", { allowAccept });
  } catch (e) {
    // A refused step is part of the record (e.g. PayPal rejecting an evidence type); the run stops there.
    steps.push({ step: "WAITING", disputeId: id, status: "ERROR", stage: null, links: [], detail: { error: (e as Error).message }, at: new Date().toISOString() });
    console.log(`error: ${(e as Error).message}`);
    break;
  }
  const last = steps.at(-1);
  if (s.step !== "WAITING" || last?.step !== "WAITING" || last.status !== s.status) {
    steps.push({ ...s, at: new Date().toISOString() });
    console.log(`${new Date().toISOString().slice(11, 19)} ${s.step} status=${s.status} stage=${s.stage} links=[${s.links.join(", ")}]${s.detail ? ` ${JSON.stringify(s.detail).slice(0, 160)}` : ""}`);
  }
  if (s.step === "RESOLVED" || s.detail?.needs) break;
  await new Promise((r) => setTimeout(r, s.step === "WAITING" ? 30_000 : 10_000));
}

const [row] = await db().select().from(disputes).where(eq(disputes.paypalDisputeId, id));
const timeline = row?.claimId ? (await db().select({ seq: auditEvents.seq, event: auditEvents.event, at: auditEvents.createdAt, hash: auditEvents.hash }).from(auditEvents).where(eq(auditEvents.claimId, row.claimId)).orderBy(asc(auditEvents.seq))) : [];
mkdirSync("evals/recordings", { recursive: true });
const file = `evals/recordings/dispute-${id}.json`;
writeFileSync(file, JSON.stringify({
  kind: "escalated-claim-replay",
  note: "Recorded from real PayPal sandbox calls. require-evidence and adjudicate are sandbox-only steps; adjudicate stands in for PayPal's decision.",
  disputeId: id, claimId: row?.claimId ?? null, linkedToUndoClaim: !!row?.claimId,
  startedAt: started.toISOString(), finishedAt: new Date().toISOString(),
  final: steps.at(-1) ?? null, steps, auditTimeline: timeline,
}, null, 2));
console.log(`recorded ${steps.length} step(s) -> ${file}`);
process.exit(0);
