#!/usr/bin/env node
// Labelled contact sheets of a folder of images (for visual review).
//   node tools/contact-sheet.mjs <dir> [out-prefix] [cols] [per-sheet]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const dir = path.resolve(process.argv[2] || ".");
const prefix = path.resolve(process.argv[3] || path.join(dir, "..", "sheet"));
const cols = +process.argv[4] || 6;
const per = +process.argv[5] || 24;
const W = 260, H = 200, LABEL = 30, GAP = 6;
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
let sheet = 0;
for (let off = 0; off < files.length; off += per) {
  const chunk = files.slice(off, off + per);
  const rows = Math.ceil(chunk.length / cols);
  const comps = [];
  for (let i = 0; i < chunk.length; i++) {
    const x = (i % cols) * (W + GAP) + GAP, y = Math.floor(i / cols) * (H + LABEL + GAP) + GAP;
    const file = path.join(dir, chunk[i]);
    const meta = await sharp(file).metadata();
    const img = await sharp(file).resize(W, H, { fit: "cover" }).toBuffer();
    comps.push({ input: img, left: x, top: y });
    const label = `${off + i + 1}. ${chunk[i].replace(/\.\w+$/, "")} ${meta.width}x${meta.height}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${LABEL}"><rect width="100%" height="100%" fill="#222"/><text x="4" y="19" font-family="Arial" font-size="12" fill="#fff">${esc(label.slice(0, 40))}</text></svg>`;
    comps.push({ input: Buffer.from(svg), left: x, top: y + H });
  }
  const out = `${prefix}-${++sheet}.jpg`;
  await sharp({ create: { width: cols * (W + GAP) + GAP, height: rows * (H + LABEL + GAP) + GAP, channels: 3, background: "#111" } })
    .composite(comps).jpeg({ quality: 82 }).toFile(out);
  console.log("wrote", out, chunk.length, "images");
}
