// A minimal PDF writer for evidence packs: Helvetica text pages plus one optional JPEG page. No dependency.
// PayPal accepts PDF, JPG, PNG and GIF evidence files.

export type Jpeg = { data: Buffer; width: number; height: number };

const W = 612, H = 792, M = 54, SIZE = 10, LEAD = 14, WRAP = 96;
const PER_PAGE = Math.floor((H - 2 * M) / LEAD);

/** Latin-1 safe text: other characters become "?", and PDF string delimiters are escaped. */
const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, "?").replace(/[\\()]/g, (c) => `\\${c}`);

export function wrap(line: string, width = WRAP): string[] {
  if (line.length <= width) return [line];
  const out: string[] = [];
  let cur = "";
  for (const word of line.split(" ")) {
    if (cur && (cur + " " + word).length > width) {
      out.push(cur);
      cur = "    " + word;
    } else cur = cur ? `${cur} ${word}` : word;
    while (cur.length > width) {
      out.push(cur.slice(0, width));
      cur = "    " + cur.slice(width);
    }
  }
  if (cur) out.push(cur);
  return out;
}

export function buildPdf(title: string, lines: string[], photo?: Jpeg): Buffer {
  const all = [title, "", ...lines].flatMap((l) => wrap(l));
  const pages: string[] = [];
  for (let i = 0; i < all.length; i += PER_PAGE) {
    const body = all.slice(i, i + PER_PAGE).map((l, n) => `BT /F1 ${i === 0 && n === 0 ? 14 : SIZE} Tf ${M} ${H - M - n * LEAD} Td (${esc(l)}) Tj ET`).join("\n");
    pages.push(body);
  }
  if (photo) {
    const scale = Math.min((W - 2 * M) / photo.width, (H - 2 * M - 40) / photo.height);
    const w = Math.round(photo.width * scale), h = Math.round(photo.height * scale);
    pages.push(`BT /F1 12 Tf ${M} ${H - M} Td (Buyer's photo with the challenge code \\(as uploaded\\)) Tj ET\nq ${w} 0 0 ${h} ${M} ${H - M - 30 - h} cm /Im1 Do Q`);
  }

  // Objects: 1 catalog, 2 pages, 3 font, 4 image (optional), then a page and a content stream per page.
  const objs: (string | Buffer)[] = [];
  const first = photo ? 5 : 4;
  const kids = pages.map((_, i) => `${first + i * 2} 0 R`).join(" ");
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  if (photo) {
    objs.push(Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${photo.width} /Height ${photo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${photo.data.length} >>\nstream\n`, "latin1"),
      photo.data,
      Buffer.from("\nendstream", "latin1"),
    ]));
  }
  pages.forEach((content, i) => {
    const xo = photo ? " /XObject << /Im1 4 0 R >>" : "";
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R >>${xo} >> /Contents ${first + i * 2 + 1} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  });

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = parts[0].length;
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), typeof o === "string" ? Buffer.from(o, "latin1") : o, Buffer.from("\nendobj\n", "latin1")]);
    offsets.push(offset);
    offset += b.length;
    parts.push(b);
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`, "latin1"));
  return Buffer.concat(parts);
}
