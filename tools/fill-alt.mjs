#!/usr/bin/env node
// Fills EMPTY alt texts of content images with sensible defaults (never overwrites an
// existing alt). Run once after import; editors refine them in the CMS afterwards.
//   node tools/fill-alt.mjs [--dry]
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(import.meta.dirname, "..");
const dry = process.argv.includes("--dry");
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : e.name.endsWith(".json") && files.push(p); } })(path.join(ROOT, "content/pages"));
const pages = new Map(files.map((f) => { const j = JSON.parse(fs.readFileSync(f, "utf8")); return [j.path, { f, j }]; }));
const titleOf = (p, lang) => { const t = pages.get(p)?.j.i18n?.[lang]; return t ? t.h1 || t.title : null; };
let filled = 0;
for (const { f, j } of pages.values()) {
  for (const [lang, t] of Object.entries(j.i18n || {})) {
    const h1 = t.h1 || t.title;
    let n = 0, changed = false;
    for (const b of t.blocks || []) {
      if (b.type === "image") {
        n++;
        if (b.alt && b.alt.trim()) continue;
        const target = b.href && b.href.startsWith("/") ? titleOf(b.href, lang) || titleOf(b.href, "sv") : null;
        b.alt = target ? `${target} – logotyp` : n === 1 ? h1 : `${h1} – bild ${n}`;
        filled++; changed = true;
      }
      if (b.type === "cards") for (const it of b.items) if (it.image && !it.alt) {
        const name = it.title || titleOf(it.href, lang) || titleOf(it.href, "sv");
        if (name) { it.alt = `${name} – logotyp`; filled++; changed = true; }
      }
    }
    void changed;
  }
  if (!dry) fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
}
console.log(`${dry ? "would fill" : "filled"} ${filled} alt texts`);
