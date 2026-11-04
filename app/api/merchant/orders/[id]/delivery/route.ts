import { z } from "zod";
import { handle, requireMerchant } from "@/src/http";
import { recordDelivery } from "@/src/claims/claims";

const Input = z.object({ deliveredAt: z.iso.datetime({ offset: true }).optional(), trackingNumber: z.string().max(40).optional() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireMerchant(req);
    const { deliveredAt, trackingNumber } = Input.parse(await req.json());
    return recordDelivery((await ctx.params).id, deliveredAt ? new Date(deliveredAt) : new Date(), trackingNumber);
  });
}
