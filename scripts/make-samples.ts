// Generates the judge sample photos in /public/samples (all for a Sky Blue tee, size M, order).
// Each shows the demo challenge code UNDO-DEMO except no-code.jpg. Usage: npx tsx scripts/make-samples.ts
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { DEMO_CHALLENGE_CODE } from "../src/claims/code";
import { COLOR_HEX, productPhoto, productSvg } from "../src/store/art";

const OUT = "public/samples";
const TEE = productSvg("tee", "Sky Blue").match(/<path d="([^"]+)"/)![1];

function scene(o: { color: string; tag: string; code: boolean; damaged?: boolean }) {
  const fill = COLOR_HEX[o.color];
  const grain = Array.from({ length: 14 }, (_, i) => `<path d="M0 ${40 + i * 64} Q450 ${20 + i * 64 + (i % 3) * 18} 900 ${48 + i * 64}" stroke="#6f5338" stroke-opacity=".35" stroke-width="${2 + (i % 3)}" fill="none"/>`).join("");
  const damage = o.damaged
    ? `<path d="M96 120 L104 132 L98 141 L108 152 L101 163 L110 176 L100 170 L93 158 L99 149 L90 138 L97 129 Z" fill="#3b2a1e"/>
       <ellipse cx="140" cy="160" rx="13" ry="9" fill="#6b4a2a" fill-opacity=".55"/>
       <path d="M150 96 l6 4 l-3 6 l7 5" stroke="#3b2a1e" stroke-width="2" fill="none"/>`
    : "";
  const note = o.code
    ? `<g transform="translate(520 650) rotate(7)"><rect width="340" height="150" rx="4" fill="#fbfaf3" stroke="#d8d4c4"/>
         <text x="170" y="92" font-family="Segoe Print, Comic Sans MS, cursive" font-size="38" text-anchor="middle" fill="#1b2a6b">${DEMO_CHALLENGE_CODE}</text></g>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900">
    <defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#a7825c"/><stop offset="1" stop-color="#8a6845"/></linearGradient>
    <radialGradient id="l" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></radialGradient></defs>
    <rect width="900" height="900" fill="url(#t)"/>${grain}
    <g transform="translate(150 70) scale(2.6) rotate(-5 120 120)">
      <path d="${TEE}" fill="#000" fill-opacity=".25" transform="translate(4 5)"/>
      <path d="${TEE}" fill="${fill}" stroke="#2b2b2b" stroke-width="1.2" stroke-linejoin="round"/>
      <path d="M100 28 Q120 50 140 28" stroke="#000" stroke-opacity=".25" stroke-width="2" fill="none"/>
      <rect x="109" y="44" width="22" height="17" rx="1.5" fill="#fff" stroke="#888" stroke-width=".6"/>
      <text x="120" y="57.5" font-family="Arial, sans-serif" font-weight="700" font-size="12" text-anchor="middle" fill="#111">${o.tag}</text>
      ${damage}
    </g>${note}
    <rect width="900" height="900" fill="url(#l)"/></svg>`;
}

async function listingWithCode() {
  const listing = await sharp(`public${productPhoto("tee", "Sky Blue")}`).resize(900).png().toBuffer();
  const note = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="825"><g transform="translate(560 700) rotate(-3)"><rect width="320" height="100" fill="#fff" stroke="#ccc"/>
    <text x="160" y="64" font-family="Segoe Print, Comic Sans MS, cursive" font-size="34" text-anchor="middle" fill="#1b2a6b">${DEMO_CHALLENGE_CODE}</text></g></svg>`;
  return sharp(listing).composite([{ input: Buffer.from(note) }]);
}

mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2); // optional: regenerate just these files, e.g. reused-listing.jpg
const jpg = async (s: ReturnType<typeof sharp>, name: string) => (only.length && !only.includes(name)) || s.jpeg({ quality: 86 }).toFile(`${OUT}/${name}`).then(() => console.log(`${OUT}/${name}`));
await jpg(sharp(Buffer.from(scene({ color: "Sky Blue", tag: "M", code: true }))), "correct-item.jpg");
await jpg(sharp(Buffer.from(scene({ color: "Navy", tag: "M", code: true }))), "wrong-color.jpg");
await jpg(sharp(Buffer.from(scene({ color: "Sky Blue", tag: "L", code: true }))), "wrong-size.jpg");
await jpg(sharp(Buffer.from(scene({ color: "Sky Blue", tag: "M", code: true, damaged: true }))), "damaged.jpg");
await jpg(sharp(Buffer.from(scene({ color: "Sky Blue", tag: "M", code: false }))), "no-code.jpg");
await jpg(await listingWithCode(), "reused-listing.jpg");
