// Writes src/store/listing-hashes.json: the perceptual hash of every listing photo in public/products, which the
// photo-reuse check compares claim photos against. Re-run after changing a product photo: npx tsx scripts/hash-listings.ts
import { readFileSync, writeFileSync } from "node:fs";
import { phash } from "../src/claims/phash";
import { productPhoto } from "../src/store/art";
import { PRODUCTS } from "../src/store/catalog";

export async function listingHashes() {
  const out: Record<string, string> = {};
  for (const p of PRODUCTS) for (const c of p.colors) out[`${p.id}/${c}`] = await phash(readFileSync(`public${productPhoto(p.type, c)}`));
  return out;
}

if (process.argv[1]?.endsWith("hash-listings.ts")) {
  writeFileSync("src/store/listing-hashes.json", JSON.stringify(await listingHashes(), null, 1) + "\n");
  console.log("src/store/listing-hashes.json");
}
