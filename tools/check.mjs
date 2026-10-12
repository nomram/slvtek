#!/usr/bin/env node
// Post-build quality gate: SEO basics, broken links/images, URL parity with the old site.
//   node tools/check.mjs [--dist dist] [--parity content/legacy-urls.txt]
// Exit code 1 on errors (warnings do not fail the build).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DIST = path.resolve(ROOT, opt("dist", "dist"));
const site = JSON.parse(fs.readFileSync(path.join(ROOT, "content/site.json"), "utf8"));
const errors = [], warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

const htmlFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "assets" && path.relative(DIST, p).replace(/\\/g, "/") !== (site.adminPath || "/cms/").replace(/^\/|\/$/g, "")) walk(p); }
    else if (e.name.endsWith(".html")) htmlFiles.push(p);
  }
})(DIST);

// GitHub-Pages-style resolution of a site-relative URL
function resolves(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split(/[?#]/)[0]); } catch { return false; }
  p = p.normalize("NFC");
  const abs = path.join(DIST, p);
  const cands = p.endsWith("/") ? [path.join(abs, "index.html")] : [abs, abs + ".html", path.join(abs, "index.html")];
  return cands.some((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
}

const titles = new Map(), descs = new Map();
let pageCount = 0;
for (const f of htmlFiles) {
  const rel = path.relative(DIST, f).replace(/\\/g, "/");
  const html = fs.readFileSync(f, "utf8");
  if (/<meta name="robots" content="noindex/.test(html) && !/rel="canonical"/.test(html)) continue;
  const isStub = /http-equiv="refresh"/.test(html);
  if (isStub || rel === "404.html") continue;
  pageCount++;
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
  const h1s = (html.match(/<h1[\s>]/g) || []).length;
  if (!title) err(`${rel}: missing <title>`);
  else {
    if (title.length > 70) warn(`${rel}: title ${title.length} chars`);
    const lk = ((html.match(/<html lang="([a-z-]+)"/) || [])[1] || "") + "|" + title;
    if (titles.has(lk)) warn(`${rel}: duplicate title with ${titles.get(lk)}`); else titles.set(lk, rel);
  }
  if (!desc) err(`${rel}: missing meta description`);
  else {
    if (desc.length < 50) warn(`${rel}: short description (${desc.length})`);
    if (desc.length > 170) warn(`${rel}: long description (${desc.length})`);
    const dk = ((html.match(/<html lang="([a-z-]+)"/) || [])[1] || "") + "|" + desc;
    if (descs.has(dk)) warn(`${rel}: duplicate description with ${descs.get(dk)}`); else descs.set(dk, rel);
  }
  if (h1s !== 1) err(`${rel}: ${h1s} <h1> elements`);
  if (!/<link rel="canonical" href="https?:\/\//.test(html)) err(`${rel}: missing canonical`);
  if (!/<html lang="[a-z-]+"/.test(html)) err(`${rel}: missing html lang`);
  for (const m of html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt="/.test(m[0])) err(`${rel}: <img> without alt: ${m[0].slice(0, 80)}`);
    for (const s of m[0].matchAll(/\b(?:src|srcset)="([^"]+)"/g)) {
      for (const part of s[1].split(",")) {
        const u = part.trim().split(/\s+/)[0];
        if (u.startsWith("/") && !resolves(u)) err(`${rel}: missing image ${u}`);
      }
    }
  }
  for (const m of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    const h = m[1].replace(/&amp;/g, "&");
    if (h.startsWith("/") && !h.startsWith("//") && !resolves(h)) err(`${rel}: broken link ${h}`);
  }
  // one JSON-LD graph that parses
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { err(`${rel}: invalid JSON-LD`); }
  }
}

// sitemap
const smPath = path.join(DIST, "sitemap.xml");
const smUrls = [];
if (fs.existsSync(smPath)) {
  const sm = fs.readFileSync(smPath, "utf8");
  for (const m of sm.matchAll(/<loc>([^<]+)<\/loc>/g)) smUrls.push(m[1].replace(/&amp;/g, "&"));
  const origin = site.origin.replace(/\/+$/, "");
  for (const u of smUrls) {
    if (!u.startsWith(origin)) { err(`sitemap: foreign URL ${u}`); continue; }
    if (!resolves(u.slice(origin.length) || "/")) err(`sitemap: URL does not resolve ${u}`);
  }
} else err("sitemap.xml missing");

// URL parity with the old site (SEO: keep every ranking URL alive)
const parityFile = path.resolve(ROOT, opt("parity", "content/legacy-urls.txt"));
let parityMissing = 0, parityTotal = 0;
if (fs.existsSync(parityFile)) {
  const origin = site.origin.replace(/\/+$/, "");
  const want = new Set(["/"]);
  for (const l of fs.readFileSync(parityFile, "utf8").split(/\r?\n/)) { const t = l.trim(); if (t && !t.startsWith("#")) want.add(t); }
  const have = new Set(smUrls.map((u) => { try { return decodeURIComponent(u.slice(origin.length) || "/").replace(/\/+$/, "") || "/"; } catch { return u; } }));
  for (const p of want) { parityTotal++; if (!have.has(p)) { parityMissing++; err(`parity: old URL ${p} is not in the new sitemap`); } }
}

console.log(`checked ${pageCount} pages, ${smUrls.length} sitemap URLs${parityTotal ? `, parity ${parityTotal - parityMissing}/${parityTotal}` : ""}`);
if (warnings.length) { console.log(`\n${warnings.length} warning(s):`); warnings.slice(0, 25).forEach((w) => console.log("  ~ " + w)); if (warnings.length > 25) console.log(`  … ${warnings.length - 25} more`); }
if (errors.length) { console.log(`\n${errors.length} error(s):`); errors.slice(0, 40).forEach((e) => console.log("  ✗ " + e)); if (errors.length > 40) console.log(`  … ${errors.length - 40} more`); process.exit(1); }
console.log("\nall checks passed");
