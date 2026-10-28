import { sql } from "drizzle-orm";
import { db } from "@/src/db";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = "not configured";
  if (process.env.DATABASE_URL) {
    try {
      await db().execute(sql`select 1`);
      database = "ok";
    } catch {
      database = "error";
    }
  }
  return Response.json({ ok: true, paypalEnv: "sandbox", database });
}
