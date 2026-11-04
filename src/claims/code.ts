// One-time challenge codes. The person photographs the item with the code visible, which proves the photo is new.
import { randomInt } from "node:crypto";

/** Judge mode only: pool orders also accept this code, which is printed on the sample photos. */
export const DEMO_CHALLENGE_CODE = "UNDO-DEMO";

// No 0/O, 1/I/L: the code is often handwritten and read back by the vision model.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const newChallengeCode = () => `UNDO-${Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Compares what the vision model read ("undo 7f3a.") with the claim's code. The model never sees the expected code. */
export function codeMatches(found: string | null | undefined, expected: string, acceptDemoCode = false): boolean {
  if (!found) return false;
  const f = norm(found);
  return f === norm(expected) || (acceptDemoCode && f === norm(DEMO_CHALLENGE_CODE));
}
