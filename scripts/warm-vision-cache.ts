// Pre-reads every judge sample photo with the vision model and stores the result, so judge runs never wait on the model.
// Usage: npx tsx --env-file=.env [--env-file=.env.neon] scripts/warm-vision-cache.ts
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { visionCache } from "../src/db/schema";
import { analyzePhoto } from "../src/claims/vision";

for (const f of readdirSync("public/samples").filter((f) => /\.(jpe?g|png|webp)$/i.test(f))) {
  // Same normalisation as claim intake (src/claims/claims.ts), so the sha256 matches an upload of this file.
  const jpeg = await sharp(readFileSync(`public/samples/${f}`)).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
  const sha256 = createHash("sha256").update(jpeg).digest("hex");
  const [row] = await db().select().from(visionCache).where(eq(visionCache.sha256, sha256));
  if (row) { console.log(`${f}: already cached`); continue; }
  const t = Date.now();
  try {
    const result = await analyzePhoto(jpeg);
    await db().insert(visionCache).values({ sha256, result }).onConflictDoNothing();
    console.log(`${f}: cached in ${((Date.now() - t) / 1000).toFixed(1)} s · code=${result.challenge_code_found} color=${result.dominant_color} damage=${result.damage_detected} conf=${result.confidence}`);
  } catch (e) {
    console.log(`${f}: FAILED (${(e as Error).message})`);
  }
}
process.exit(0);
