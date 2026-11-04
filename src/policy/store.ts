// Versioned, merchant-approved policies. A compiled draft is stored unapproved; the latest approved one is active.
import { desc, eq, isNotNull, max, and, isNull } from "drizzle-orm";
import { db } from "../db";
import { policies } from "../db/schema";
import { compilePolicy, diffPolicy } from "./compiler";
import { DEFAULT_POLICY, Policy } from "./schema";

export class PolicyError extends Error {}

const MERCHANT_ID = "fernleaf"; // single demo merchant

async function activeRow() {
  const [row] = await db().select().from(policies).where(and(eq(policies.merchantId, MERCHANT_ID), isNotNull(policies.approvedAt))).orderBy(desc(policies.approvedAt)).limit(1);
  return row;
}

/** The policy every claim is judged by: the latest approved one, else the built-in default. */
export async function activePolicy(): Promise<Policy> {
  const row = await activeRow();
  return row ? Policy.parse(row.rules) : DEFAULT_POLICY;
}

/** Compiles the text into a new unapproved version and returns it with its diff against the active policy. */
export async function compileDraft(sourceText: string) {
  const text = sourceText.trim();
  if (text.length < 20) throw new PolicyError("write the policy in a few sentences first");
  const [{ top }] = await db().select({ top: max(policies.version) }).from(policies).where(eq(policies.merchantId, MERCHANT_ID));
  let policy: Policy;
  try {
    policy = await compilePolicy(text.slice(0, 4000), Math.max(top ?? 0, DEFAULT_POLICY.version) + 1);
  } catch (e) {
    console.error("[policy compile]", (e as Error).message);
    throw new PolicyError("the policy could not be compiled into valid rules; try rewording it or try again");
  }
  const [row] = await db().insert(policies).values({ merchantId: MERCHANT_ID, sourceText: text, rules: policy, version: policy.version }).returning();
  return { id: row.id, version: row.version, policy, diff: diffPolicy(await activePolicy(), policy) };
}

export async function approvePolicy(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new PolicyError(`unknown policy ${id}`);
  const [row] = await db().update(policies).set({ approvedAt: new Date() }).where(and(eq(policies.id, id), eq(policies.merchantId, MERCHANT_ID), isNull(policies.approvedAt))).returning();
  if (!row) throw new PolicyError(`policy ${id} does not exist or is already approved`);
  return { id: row.id, version: row.version, approvedAt: row.approvedAt };
}

/** Active policy plus recent versions, each with its diff against the active one. */
export async function policyOverview() {
  const active = await activeRow();
  const current = active ? Policy.parse(active.rules) : DEFAULT_POLICY;
  const rows = await db().select().from(policies).where(eq(policies.merchantId, MERCHANT_ID)).orderBy(desc(policies.version)).limit(10);
  return {
    active: { id: active?.id ?? null, version: current.version, policy: current, sourceText: active?.sourceText ?? null, builtIn: !active },
    versions: rows.map((r) => ({ id: r.id, version: r.version, sourceText: r.sourceText, approvedAt: r.approvedAt, createdAt: r.createdAt, policy: r.rules, diff: diffPolicy(current, Policy.parse(r.rules)) })),
  };
}
