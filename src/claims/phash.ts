// Perceptual hash to catch reused listing photos and photos reused across claims.
// A 16x16 difference hash (256 bits) on a lightly blurred greyscale image. Chosen over DCT pHash after measuring:
// the store's flat, symmetric listing art leaves half the DCT terms near zero, so pHash drifted 16-24 bits on a
// mere recompress. dHash16: edited copies (resize, JPEG, code overlay, 5% crop) 3-6 bits, other products >= 28 bits.
import sharp from "sharp";

/** Max Hamming distance (of 256 bits) that counts as "the same photo". Override with PHASH_MATCH_THRESHOLD. */
export const PHASH_MATCH_THRESHOLD = Number(process.env.PHASH_MATCH_THRESHOLD ?? 16);

const N = 16;

/** 64 hex characters. Stable under resizing, recompression and small overlays; changes when the scene changes. */
export async function phash(image: Buffer): Promise<string> {
  const px = await sharp(image)
    .rotate()
    .flatten({ background: "#ffffff" })
    .greyscale()
    .blur(2)
    .resize(N + 1, N, { fit: "fill" })
    .raw()
    .toBuffer(); // greyscale + no alpha => 1 byte per pixel
  let bits = 0n;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) bits = (bits << 1n) | (px[y * (N + 1) + x] > px[y * (N + 1) + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(N * N / 4, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  for (; x; x >>= 1n) n += Number(x & 1n);
  return n;
}

export type PhotoMatch = { kind: "listing" | "earlier_claim"; ref: string; distance: number };
export type HashedPhoto = { kind: PhotoMatch["kind"]; ref: string; hash: string };

/** Every candidate within the threshold, closest first. */
export function findMatches(hash: string, candidates: HashedPhoto[], threshold = PHASH_MATCH_THRESHOLD): PhotoMatch[] {
  return candidates
    .map((c) => ({ kind: c.kind, ref: c.ref, distance: hamming(hash, c.hash) }))
    .filter((m) => m.distance <= threshold)
    .sort((a, b) => a.distance - b.distance);
}
