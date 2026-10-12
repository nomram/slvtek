#!/usr/bin/env node
// Downloads the poster picture of every YouTube video used on the site, once, and stores it in
// assets-src/yt/<id>.webp. The site then shows the local picture until the visitor clicks play, so no
// request goes to YouTube/Google before that click (GDPR friendly, and the picture is there instantly).
//   node tools/fetch-yt-thumbs.mjs          fetch missing thumbnails
//   node tools/fetch-yt-thumbs.mjs --force  fetch all again
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "assets-src/yt");
const force = process.argv.includes("--force");
fs.mkdirSync(OUT, { recursive: true });

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".json") ? [path.join(d, e.name)] : []));
const ids = new Set();
const visit = (o) => { if (Array.isArray(o)) o.forEach(visit); else if (o && typeof o === "object") { if (o.type === "video" && typeof o.id === "string" && o.id) ids.add(o.id); Object.values(o).forEach(visit); } };
for (const f of walk(path.join(ROOT, "content/pages"))) visit(JSON.parse(fs.readFileSync(f, "utf8")));

const SIZES = ["maxresdefault", "sddefault", "hqdefault"]; // 16:9 first; hqdefault has black bars
let got = 0, had = 0, missing = [];
for (const id of ids) {
  const file = path.join(OUT, `${id}.webp`);
  if (!force && fs.existsSync(file)) { had++; continue; }
  let ok = false;
  for (const size of SIZES) {
    try {
      const r = await fetch(`https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}.jpg`);
      if (!r.ok) continue;
      let img = sharp(Buffer.from(await r.arrayBuffer()));
      const m = await img.metadata();
      if (size === "hqdefault" || (m.height && m.width / m.height < 1.5)) {
        // 4:3 frame with black bars: cut them away to get the 16:9 picture
        const h = Math.round((m.width * 9) / 16);
        img = img.extract({ left: 0, top: Math.max(0, Math.round((m.height - h) / 2)), width: m.width, height: Math.min(h, m.height) });
      }
      await img.resize({ width: 960, withoutEnlargement: true }).webp({ quality: 74 }).toFile(file);
      ok = true; got++;
      break;
    } catch { /* try the next size */ }
  }
  if (!ok) missing.push(id);
}
console.log(`video thumbnails: ${got} fetched, ${had} already there, ${missing.length} unavailable${missing.length ? " (" + missing.join(", ") + ")" : ""}`);
