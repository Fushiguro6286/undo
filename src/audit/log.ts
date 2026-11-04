// Hash-chained audit log (CLAUDE.md section 12): hash = sha256(prev_hash + payload_hash). Every decision and money
// action is appended; GET /api/audit/verify re-checks the whole chain.
import { createHash } from "node:crypto";
import { asc, desc, sql } from "drizzle-orm";
import { db } from "../db";
import { auditEvents } from "../db/schema";
import { canonicalJson } from "../intent/record";

export const GENESIS = "0".repeat(64);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const payloadHash = (payload: unknown) => sha256(canonicalJson(payload));
export const chainHash = (prevHash: string, pHash: string) => sha256(prevHash + pHash);

export async function audit(claimId: string | null, event: string, payload: Record<string, unknown>) {
  const pHash = payloadHash(payload);
  return db().transaction(async (tx) => {
    // One writer at a time, so two appends can never share a prev_hash and fork the chain.
    await tx.execute(sql`select pg_advisory_xact_lock(7412001)`);
    const [last] = await tx.select({ hash: auditEvents.hash }).from(auditEvents).orderBy(desc(auditEvents.seq)).limit(1);
    const prevHash = last?.hash ?? GENESIS;
    const [row] = await tx.insert(auditEvents).values({ claimId, event, payload, payloadHash: pHash, prevHash, hash: chainHash(prevHash, pHash) }).returning({ seq: auditEvents.seq });
    return row.seq;
  });
}

type Row = { seq: number; payload: unknown; payloadHash: string; prevHash: string; hash: string };

/** Pure: checks every link, payload hash and chain hash in seq order. */
export function verifyChain(rows: Row[]): { ok: boolean; count: number; brokenAt: number | null; problem: string | null } {
  let prev = GENESIS;
  for (const r of rows) {
    const problem =
      r.prevHash !== prev ? "prev_hash does not match the previous event" :
      r.payloadHash !== payloadHash(r.payload) ? "payload was changed after it was logged" :
      r.hash !== chainHash(r.prevHash, r.payloadHash) ? "hash does not match" : null;
    if (problem) return { ok: false, count: rows.length, brokenAt: r.seq, problem };
    prev = r.hash;
  }
  return { ok: true, count: rows.length, brokenAt: null, problem: null };
}

// shortcut: verifies the whole table in one read; page through it if the log grows past ~100k events.
export async function verifyAudit() {
  const rows = await db().select().from(auditEvents).orderBy(asc(auditEvents.seq));
  return { ...verifyChain(rows), head: rows.at(-1)?.hash ?? GENESIS, checkedAt: new Date().toISOString() };
}
