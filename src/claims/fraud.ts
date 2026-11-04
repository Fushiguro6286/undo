// Fraud checks (CLAUDE.md section 8), pure. Any signal makes the fault engine return UNCLEAR (a person decides).
import { toCents } from "../money/cents";
import type { PhotoMatch } from "./phash";

export const MIN_VISION_CONFIDENCE = 0.6;

export type FraudSignal =
  | "PHOTO_MATCHES_LISTING"
  | "PHOTO_MATCHES_EARLIER_CLAIM"
  | "LOW_VISION_CONFIDENCE"
  | "VISION_FAILED" // model error or invalid output: send to a person
  | "DELIVERY_DATE_CONTESTED";

export type Assessment = {
  /** NEEDS_NEW_PHOTO: the challenge code is missing, so no decision is made at all (check 1). */
  decision: "NEEDS_NEW_PHOTO" | "READY";
  signals: FraudSignal[];
  /** Check 3: the claim value is above requireReturnAbove, so every remedy needs a return. Not a fraud signal. */
  returnRequired: boolean;
  photoMatches: PhotoMatch[];
};

export type AssessInput = {
  codeFound: boolean;
  photoMatches: PhotoMatch[];
  visionConfidence: number | null; // null = the vision step failed
  deliveryContested: boolean;
  claimValue: string; // order capture amount, "29.00"
  requireReturnAbove: number; // policy, USD
};

export function assess(i: AssessInput, minConfidence = MIN_VISION_CONFIDENCE): Assessment {
  const signals: FraudSignal[] = [];
  if (i.photoMatches.some((m) => m.kind === "listing")) signals.push("PHOTO_MATCHES_LISTING");
  if (i.photoMatches.some((m) => m.kind === "earlier_claim")) signals.push("PHOTO_MATCHES_EARLIER_CLAIM");
  if (i.visionConfidence === null) signals.push("VISION_FAILED");
  else if (i.visionConfidence < minConfidence) signals.push("LOW_VISION_CONFIDENCE");
  if (i.deliveryContested) signals.push("DELIVERY_DATE_CONTESTED");
  return {
    decision: i.codeFound ? "READY" : "NEEDS_NEW_PHOTO",
    signals,
    returnRequired: toCents(i.claimValue) > Math.round(i.requireReturnAbove * 100),
    photoMatches: i.photoMatches,
  };
}
