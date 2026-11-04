// Money router guards with PayPal and the database mocked: a disputed capture is never refunded, and a payout
// retry sends the same ids so PayPal can't pay twice.
import { beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.fn();
const openDisputes = vi.fn();
const writes: string[] = [];
const chain: any = new Proxy(() => chain, { get: (_t, k) => (k === "then" ? undefined : (...a: unknown[]) => (writes.push(String(k)), chain)) });

vi.mock("../db", () => ({ db: () => chain }));
vi.mock("../disputes/check", () => ({ openDisputes: (id: string) => openDisputes(id) }));
vi.mock("../paypal/client", async (orig) => {
  const real = await orig<typeof import("../paypal/client")>();
  return { ...real, merchant: () => ({ request }), agentPlatform: () => ({ request }) };
});

const { DisputedCaptureError, payoutAgentFault, refundCapture } = await import("./router");
const { PayPalError } = await import("../paypal/client");
const claimId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  request.mockReset();
  openDisputes.mockReset();
  writes.length = 0;
});

describe("disputed captures", () => {
  it("are never sent a refund when PayPal lists an open dispute", async () => {
    openDisputes.mockResolvedValue(["PP-D-1"]);
    const err = await refundCapture({ claimId, captureId: "CAP1", amount: "8.70", action: "PARTIAL_REFUND_KEEP_ITEM", version: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(DisputedCaptureError);
    expect(err.disputeIds).toEqual(["PP-D-1"]);
    expect(openDisputes).toHaveBeenCalledWith("CAP1");
    expect(request).not.toHaveBeenCalled(); // no refund call at all
    expect(writes).not.toContain("insert"); // and no money action recorded
  });

  it("turn PayPal's TRANSACTION_DISPUTED into the same guard (the dispute list can lag)", async () => {
    openDisputes.mockResolvedValue([]);
    request.mockRejectedValue(new PayPalError(422, "UNPROCESSABLE_ENTITY", ["TRANSACTION_DISPUTED"]));
    const err = await refundCapture({ claimId, captureId: "CAP1", amount: "8.70", action: "PARTIAL_REFUND_KEEP_ITEM", version: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(DisputedCaptureError);
    expect(err.source).toBe("TRANSACTION_DISPUTED");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("other PayPal errors pass through unchanged", async () => {
    openDisputes.mockResolvedValue([]);
    request.mockRejectedValue(new PayPalError(422, "UNPROCESSABLE_ENTITY", ["REFUND_AMOUNT_EXCEEDED"]));
    await expect(refundCapture({ claimId, captureId: "CAP1", amount: "99.00", action: "REFUND_ON_RETURN", version: 1 })).rejects.toBeInstanceOf(PayPalError);
  });
});

describe("agent-fault payout", () => {
  it("uses the money request id as sender_batch_id and PayPal-Request-Id, identical on a retry", async () => {
    request.mockResolvedValue({ batch_header: { payout_batch_id: "B1", batch_status: "PENDING" } });
    const a = await payoutAgentFault({ claimId, receiver: "buyer@example.com", amount: "29", version: 1 });
    await payoutAgentFault({ claimId, receiver: "buyer@example.com", amount: "29", version: 1 });
    const [first, second] = request.mock.calls;
    const id = `${claimId}:AGENT_PLATFORM_PAYOUT:1`;
    expect(first[0]).toBe("POST");
    expect(first[1]).toBe("/v1/payments/payouts");
    expect(first[2].requestId).toBe(id);
    expect(first[2].body.sender_batch_header.sender_batch_id).toBe(id);
    expect(first[2].body.items[0]).toMatchObject({ receiver: "buyer@example.com", amount: { currency: "USD", value: "29.00" }, sender_item_id: id });
    expect(id.length).toBeLessThanOrEqual(63); // PayPal's sender_item_id limit
    expect(second[2]).toEqual(first[2]);
    expect(a).toMatchObject({ payoutBatchId: "B1", amount: "29.00" });
  });

  it("refuses a zero payout", async () => {
    await expect(payoutAgentFault({ claimId, receiver: "b@example.com", amount: "0.00", version: 1 })).rejects.toThrow(/above zero/);
    expect(request).not.toHaveBeenCalled();
  });
});
