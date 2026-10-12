#!/usr/bin/env node
// Translation workflow ("language dictionary").
//
//   node tools/i18n.mjs export en            -> translations/en.json   (source text + empty targets)
//   node tools/i18n.mjs import en [file]     -> writes i18n.en into every page + content/ui/en.json
//   node tools/i18n.mjs status               -> how much of each language is translated
//
// The export lists every translatable string of the default language once, keyed by a
// stable id (page path + field). Fill the "target" values (by hand, translator, or an
// AI assistant), then import. Pages are cloned from the default language so structure,
// images and links stay identical; only the text is replaced. Untranslated ids keep the
// default-language text so nothing breaks, and are reported by `status`.
import fs from "node:fs";
import path from "node:path";
import { visit } from "../src/lib/translatable.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const [cmd, lang, fileArg] = process.argv.slice(2);
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content/site.json"), "utf8"));
const DEF = site.defaultLang || "es";

function* pageFiles(dir = path.join(ROOT, "content/pages")) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* pageFiles(p); else if (e.name.endsWith(".json")) yield p;
  }
}
const strip = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

// (the string extractor is shared with the CMS: src/lib/translatable.mjs)
const load = () => [...pageFiles()].map((f) => ({ f, page: JSON.parse(fs.readFileSync(f, "utf8")) }));
const outFile = (l) => path.join(ROOT, "translations", `${l}.json`);

if (cmd === "export" && lang) {
  const units = {};
  const prev = fs.existsSync(outFile(lang)) ? JSON.parse(fs.readFileSync(outFile(lang), "utf8")) : { units: {} };
  for (const { page } of load()) {
    const t = page.i18n && page.i18n[DEF];
    if (!t) continue;
    visit(page, t, (id, value) => { units[id] = { source: value, target: (prev.units[id] && prev.units[id].target) || "" }; });
  }
  const ui = JSON.parse(fs.readFileSync(path.join(ROOT, `content/ui/${DEF}.json`), "utf8"));
  const uiTarget = fs.existsSync(path.join(ROOT, `content/ui/${lang}.json`)) ? JSON.parse(fs.readFileSync(path.join(ROOT, `content/ui/${lang}.json`), "utf8")) : {};
  const uiUnits = Object.fromEntries(Object.entries(ui).map(([k, v]) => [k, { source: v, target: uiTarget[k] || "" }]));
  fs.mkdirSync(path.dirname(outFile(lang)), { recursive: true });
  fs.writeFileSync(outFile(lang), JSON.stringify({ lang, from: DEF, note: "Fill in every empty \"target\". HTML tags (<a>, <strong>, <br>) must be kept as they are.", ui: uiUnits, units }, null, 2) + "\n");
  const n = Object.keys(units).length, done = Object.values(units).filter((u) => u.target).length;
  console.log(`exported ${n} strings (${done} already translated) -> ${path.relative(ROOT, outFile(lang))}`);
} else if (cmd === "import" && lang) {
  const file = fileArg ? path.resolve(fileArg) : outFile(lang);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  let applied = 0, missing = 0, pages = 0;
  for (const { f, page } of load()) {
    const src = page.i18n && page.i18n[DEF];
    if (!src) continue;
    const t = JSON.parse(JSON.stringify(src));
    visit(page, t, (id, value, set) => {
      const u = data.units[id];
      if (u && u.target && u.target.trim()) { set(u.target.trim()); applied++; } else missing++;
    });
    t.published = true;
    page.i18n[lang] = t;
    fs.writeFileSync(f, JSON.stringify(page, null, 2) + "\n");
    pages++;
  }
  const ui = {};
  for (const [k, u] of Object.entries(data.ui || {})) if (u.target) ui[k] = u.target;
  if (Object.keys(ui).length) fs.writeFileSync(path.join(ROOT, `content/ui/${lang}.json`), JSON.stringify(ui, null, 2) + "\n");
  console.log(`imported ${lang}: ${applied} strings applied, ${missing} left in ${DEF}, ${pages} pages written.`);
  console.log(`Set languages.${lang}.published = true in content/site.json (or CMS → Site settings) to publish.`);
} else if (cmd === "collect") {
  // unique source strings in first-appearance order -> translations/strings.json
  const seen = new Map();
  for (const { page } of load()) {
    const t = page.i18n && page.i18n[DEF];
    if (t) visit(page, t, (id, value) => { if (!seen.has(value)) seen.set(value, 0); seen.set(value, seen.get(value) + 1); });
  }
  const list = [...seen.keys()];
  fs.mkdirSync(path.join(ROOT, "translations"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "translations/strings.json"), JSON.stringify(list, null, 1));
  const words = list.reduce((n, v) => n + String(v).replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length, 0);
  console.log(`${list.length} unique strings, ${words} words -> translations/strings.json`);
} else if (cmd === "apply" && lang) {
  // apply translations/<lang>.json (array aligned with strings.json) to every page
  const src = JSON.parse(fs.readFileSync(path.join(ROOT, "translations/strings.json"), "utf8"));
  const tgt = JSON.parse(fs.readFileSync(path.join(ROOT, `translations/${lang}.json`), "utf8"));
  if (tgt.length !== src.length) { console.error(`length mismatch: ${tgt.length} translations for ${src.length} strings`); process.exit(1); }
  const map = new Map(src.map((v, i) => [v, tgt[i]]));
  const tagCount = (h) => (String(h).match(/<[a-z]/gi) || []).length;
  let bad = 0;
  for (const [v, tr] of map) if (tagCount(v) !== tagCount(tr)) { bad++; console.warn("TAG MISMATCH:", v.slice(0, 60), "=>", String(tr).slice(0, 60)); }
  let applied = 0, missing = 0, pages = 0;
  for (const { f, page } of load()) {
    const s0 = page.i18n && page.i18n[DEF];
    if (!s0) continue;
    const t = JSON.parse(JSON.stringify(s0));
    visit(page, t, (id, value, set) => { const tr = map.get(value); if (tr && String(tr).trim()) { set(String(tr).trim()); applied++; } else missing++; });
    t.published = true;
    page.i18n[lang] = t;
    fs.writeFileSync(f, JSON.stringify(page, null, 2) + "\n");
    pages++;
  }
  console.log(`applied ${lang}: ${applied} strings in ${pages} pages (${missing} untranslated, ${bad} tag warnings)`);
} else if (cmd === "status") {
  const rows = {};
  for (const { page } of load()) for (const [l, t] of Object.entries(page.i18n || {})) { rows[l] = rows[l] || { pages: 0 }; rows[l].pages++; void t; }
  console.table(rows);
} else {
  console.log("usage: node tools/i18n.mjs export <lang> | import <lang> [file] | status");
}
