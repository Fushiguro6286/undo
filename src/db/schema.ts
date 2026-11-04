// Data model from CLAUDE.md section 6. Money is numeric(12,2), read back as strings (same as PayPal).
import { bigserial, boolean, customType, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const intents = pgTable("intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  buyerRef: text("buyer_ref").notNull(),
  limits: jsonb("limits").notNull(), // { item, size, color, max_price, deadline }
  cart: jsonb("cart"),
  mode: text("mode").$type<"CONFIRMED" | "DELEGATED">().notNull(),
  hash: text("hash").notNull().unique(), // sha256 hex, also the PayPal custom_id
  createdAt: createdAt(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  paypalOrderId: text("paypal_order_id").notNull().unique(),
  intentId: uuid("intent_id").references(() => intents.id),
  paypalIntent: text("paypal_intent").$type<"CAPTURE" | "AUTHORIZE">().notNull(),
  ceiling: money("ceiling"),
  authorizationId: text("authorization_id"),
  captureId: text("capture_id"),
  amount: money("amount"),
  currency: text("currency").notNull().default("USD"),
  chosenItem: jsonb("chosen_item"),
  agentPickSku: text("agent_pick_sku"), // DELEGATED via MCP: the agent's pick, captured right after the buyer approves the ceiling
  promisedBy: timestamp("promised_by", { withTimezone: true }),
  status: text("status").notNull(),
  pool: boolean("pool").notNull().default(false),
  createdAt: createdAt(),
});

export const shipments = pgTable("shipments", {
  orderId: uuid("order_id").primaryKey().references(() => orders.id),
  trackingNumber: text("tracking_number"),
  carrier: text("carrier"),
  status: text("status"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }), // merchant-reported
});

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  type: text("type").notNull(),
  description: text("description").notNull().default(""), // buyer's words: data, never instructions
  deliveryContested: boolean("delivery_contested").notNull().default(false),
  challengeCode: text("challenge_code").notNull(),
  faultParty: text("fault_party"),
  reasons: jsonb("reasons"),
  status: text("status").notNull(),
  createdAt: createdAt(),
});

export const evidence = pgTable("evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  photoPath: text("photo_path").notNull(), // URL path that serves the photo
  photo: bytea("photo").notNull(), // normalized JPEG, kept in Postgres because Render's disk is wiped on deploy
  phash: text("phash"),
  visionResult: jsonb("vision_result"),
  fraudSignals: jsonb("fraud_signals"),
  createdAt: createdAt(),
});

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  merchantId: text("merchant_id").notNull(),
  sourceText: text("source_text").notNull(),
  rules: jsonb("rules").notNull(),
  version: integer("version").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  action: text("action").notNull(),
  amount: money("amount"),
  currency: text("currency").notNull().default("USD"),
  ruleIds: jsonb("rule_ids").notNull(),
  explanation: jsonb("explanation"), // { buyer, merchant }
  chosen: boolean("chosen").notNull().default(false),
});

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  offerId: uuid("offer_id").references(() => offers.id),
  proposedBy: text("proposed_by").$type<"system" | "studio_agent">().notNull(),
  status: text("status").notNull(),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const moneyActions = pgTable("money_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").references(() => claims.id),
  lane: text("lane").notNull(),
  kind: text("kind").$type<"refund" | "capture" | "void" | "payout">().notNull(),
  paypalRef: text("paypal_ref"),
  requestId: text("request_id").notNull().unique(),
  amount: money("amount"),
  status: text("status").notNull(),
  createdAt: createdAt(),
});

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id").notNull().references(() => claims.id),
  payoutBatchId: text("payout_batch_id").notNull().unique(),
  amount: money("amount").notNull(),
  status: text("status").notNull(),
});

export const disputes = pgTable("disputes", {
  paypalDisputeId: text("paypal_dispute_id").primaryKey(),
  claimId: uuid("claim_id").references(() => claims.id),
  stage: text("stage"),
  status: text("status"),
  lastPolled: timestamp("last_polled", { withTimezone: true }),
  openedInAdvance: boolean("opened_in_advance").notNull().default(false),
  used: boolean("used").notNull().default(false),
});

export const auditEvents = pgTable("audit_events", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  claimId: uuid("claim_id"),
  event: text("event").notNull(),
  payload: jsonb("payload").notNull(), // kept so the chain can be re-checked against the facts, and for the claim timeline
  payloadHash: text("payload_hash").notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
  createdAt: createdAt(),
});
