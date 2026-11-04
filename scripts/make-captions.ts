// Builds docs/captions.srt from the narration in DEMO.md: each beat's lines are split into short captions and
// spread over that beat's time slot in proportion to their length. Usage: npx tsx scripts/make-captions.ts
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync("DEMO.md", "utf8");
const beats = [...md.matchAll(/^## Beat \d .*?· (\d+):(\d+)–(\d+):(\d+)[\s\S]*?\*\*Narration:\*\*\n> (.+)/gm)].map((m) => ({
  start: +m[1] * 60 + +m[2], end: +m[3] * 60 + +m[4], text: m[5].trim(),
}));
if (beats.length !== 6) throw new Error(`expected 6 beats in DEMO.md, found ${beats.length}`);

/** A caption of at most 12 words: split at a comma near the middle, else in half, until every piece fits. */
function split(words: string[]): string[] {
  if (words.length <= 12) return [words.join(" ")];
  const commas = words.map((w, i) => (w.endsWith(",") && i >= 3 && i <= words.length - 4 ? i : -1)).filter((i) => i >= 0);
  const mid = words.length / 2;
  const comma = commas.sort((x, y) => Math.abs(x - mid) - Math.abs(y - mid))[0];
  const cut = comma !== undefined ? comma + 1 : Math.ceil(mid);
  return [...split(words.slice(0, cut)), ...split(words.slice(cut))];
}
const chunks = (text: string) => (text.match(/[^.!?]+[.!?]+["”]?/g) ?? [text]).flatMap((s) => split(s.trim().split(/\s+/)));

const ts = (sec: number) => {
  const ms = Math.round(sec * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

const lines: string[] = [];
let n = 0;
for (const b of beats) {
  const cs = chunks(b.text);
  const total = cs.reduce((a, c) => a + c.length, 0);
  let t = b.start + 0.3;
  const span = b.end - b.start - 0.6;
  for (const c of cs) {
    const d = (span * c.length) / total;
    lines.push(String(++n), `${ts(t)} --> ${ts(t + d - 0.05)}`, c, "");
    t += d;
  }
}
writeFileSync("docs/captions.srt", lines.join("\n"));
console.log(`docs/captions.srt: ${n} captions, last ends ${ts(beats.at(-1)!.end - 0.3)}`);
