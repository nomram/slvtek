#!/usr/bin/env node
// Creates trimmed brand logos (whitespace removed) for the section strip and stores the
// path in each brand page as `logo`. Source: the brand's card image on /produkter.
//   node tools/make-logos.mjs
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const pagesDir = path.join(ROOT, "content/pages");
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : e.name.endsWith(".json") && files.push(p); } })(pagesDir);
const pages = new Map(files.map((f) => { const j = JSON.parse(fs.readFileSync(f, "utf8")); return [j.path, { f, j }]; }));
const listing = pages.get("/produkter");
const cards = new Map();
for (const b of listing.j.i18n.sv.blocks) if (b.type === "cards") for (const it of b.items) if (it.image) cards.set(it.href, it.image);
const slug = (p) => p.split("/").pop().normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
let made = 0;
for (const [p, { f, j }] of pages) {
  if (p.split("/").length !== 3 || !p.startsWith("/produkter/")) continue;
  const src = cards.get(p);
  if (!src) continue;
  const file = path.join(ROOT, "assets-src/img", path.basename(src));
  if (!fs.existsSync(file)) continue;
  const name = `logo-${slug(p)}`;
  try {
    const buf = await sharp(file).flatten({ background: "#ffffff" }).trim({ threshold: 18 }).toBuffer();
    const out = await sharp(buf).resize({ height: 120, withoutEnlargement: true, fit: "inside" })
      .extend({ top: 4, bottom: 4, left: 6, right: 6, background: "#ffffff" }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    fs.writeFileSync(path.join(ROOT, "assets-src/img", name + ".webp"), out.data);
    j.logo = `/assets/img/${name}.webp`;
    fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
    made++;
    console.log(p.padEnd(40), `${out.info.width}x${out.info.height}`);
  } catch (e) { console.warn("skip", p, e.message); }
}
console.log("logos:", made);
