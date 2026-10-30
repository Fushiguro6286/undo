// Original placeholder listing art: one flat silhouette per product type, filled with the variant color.
// Also the "listing photo" that Day 3's photo match compares against (rasterized with sharp).

export const COLOR_HEX: Record<string, string> = {
  "Sky Blue": "#7cb8e4", Navy: "#1f2f57", White: "#f4f4f1", "Heather Grey": "#a3a5a8", Forest: "#2f5d3a",
  Olive: "#6b6b3a", Black: "#222222", Sand: "#d8c6a1", Rust: "#a6512b", Charcoal: "#45484d", Natural: "#e9dfc8",
};

const SHAPES: Record<string, string> = {
  tee: "M70 40 L100 28 Q120 44 140 28 L170 40 L196 78 L170 92 L162 80 L162 200 L78 200 L78 80 L70 92 L44 78 Z",
  shirt: "M72 38 L104 28 L120 52 L136 28 L168 38 L194 100 L170 108 L162 90 L162 204 L78 204 L78 90 L70 108 L46 100 Z",
  hoodie: "M74 46 Q90 18 120 16 Q150 18 166 46 L192 64 L206 170 L182 174 L170 104 L170 206 L70 206 L70 104 L58 174 L34 170 L48 64 Z",
  jacket: "M72 34 L106 24 L120 40 L134 24 L168 34 L198 70 L206 196 L180 198 L170 96 L170 210 L70 210 L70 96 L60 198 L34 196 L42 70 Z",
  socks: "M96 30 L136 30 L136 140 L170 172 Q182 196 158 206 L112 206 Q92 202 96 180 Z",
  beanie: "M56 150 Q56 60 120 56 Q184 60 184 150 Z M50 150 L190 150 L190 180 L50 180 Z",
  tote: "M60 90 L180 90 L170 210 L70 210 Z M92 90 Q92 34 120 34 Q148 34 148 90 L138 90 Q138 46 120 46 Q102 46 102 90 Z",
};

export function productSvg(type: string, color: string, size = 240): string {
  const fill = COLOR_HEX[color] ?? "#999999";
  const path = SHAPES[type] ?? SHAPES.tee;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="${size}" height="${size}"><rect width="240" height="240" fill="#efeee9"/><path d="${path}" fill="${fill}" stroke="#2b2b2b" stroke-width="3" stroke-linejoin="round" fill-rule="evenodd"/></svg>`;
}

export const productSvgDataUri = (type: string, color: string) => `data:image/svg+xml;utf8,${encodeURIComponent(productSvg(type, color))}`;
