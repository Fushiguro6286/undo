import { handle } from "@/src/http";
import { verifyAudit } from "@/src/audit/log";

export const dynamic = "force-dynamic";

/** Re-checks the whole hash chain. Public: it reveals only whether the log is intact. */
export async function GET() {
  return handle(async () => {
    const { ok, count, brokenAt, problem, head, checkedAt } = await verifyAudit();
    return { ok, count, brokenAt, problem, head, checkedAt };
  });
}
