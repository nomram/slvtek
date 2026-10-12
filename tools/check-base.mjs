#!/usr/bin/env node
// Verifies a sub-path build (SITE_BASE): every internal URL carries the base and resolves to a file.
//   MSYS_NO_PATHCONV=1 SITE_BASE=/repo node src/build.mjs --out crawl/dist-preview
//   node tools/check-base.mjs crawl/dist-preview /repo
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "dist");
const base = (process.argv[3] || "").replace(/\/+$/, "");
if (!base) { console.error("usage: check-base.mjs <dir> </base>"); process.exit(2); }

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name === "assets" || e.name === "cms") continue; walk(p); } else if (/\.(html|css)$/.test(e.name)) files.push(p);
  }
})(dir);

const resolves = (rel) => {
  let p;
  try { p = decodeURIComponent(rel.split(/[?#]/)[0]); } catch { return false; }
  p = p.normalize("NFC");
  const abs = path.join(dir, p);
  for (const c of p.endsWith("/") ? [path.join(abs, "index.html")] : [abs, abs + ".html", path.join(abs, "index.html")]) {
    try { if (fs.statSync(c).isFile()) return true; } catch { /* next */ }
  }
  return false;
};

let urls = 0, unprefixed = [], missing = [];
const seen = new Set();
const check = (u, where) => {
  if (!u.startsWith("/") || u.startsWith("//")) return;
  urls++;
  if (!(u === base || u.startsWith(base + "/") || u.startsWith(base + "?") || u.startsWith(base + "#"))) { unprefixed.push(`${where}: ${u}`); return; }
  const rel = u.slice(base.length) || "/";
  const key = rel.split(/[?#]/)[0];
  if (seen.has(key)) return;
  seen.add(key);
  if (!resolves(rel)) missing.push(`${where}: ${u}`);
};
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  const where = path.relative(dir, f);
  if (f.endsWith(".css")) { for (const m of text.matchAll(/url\(\s*["']?(\/[^)"']+)["']?\s*\)/g)) check(m[1], where); continue; }
  for (const m of text.matchAll(/\b(?:href|src|poster)=["'](\/[^"']*)["']/g)) check(m[1], where);
  for (const m of text.matchAll(/\bsrcset=["']([^"']*)["']/g)) for (const part of m[1].split(",")) check(part.trim().split(/\s+/)[0], where);
}
// robots / noindex for previews
const robots = fs.readFileSync(path.join(dir, "robots.txt"), "utf8");
const home = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const noindexOk = /Disallow: \//.test(robots) && /<meta name="robots" content="noindex,nofollow">/.test(home);
const cfg = (home.match(/id="bk-config">([\s\S]*?)<\/script>/) || [])[1] || "";
const cfgOk = cfg.includes(`"searchIndex":"${base}/search-index.json"`);

console.log(`files checked: ${files.length}, internal URLs: ${urls}, unique targets: ${seen.size}`);
console.log(`not prefixed: ${unprefixed.length}${unprefixed.length ? "\n  " + unprefixed.slice(0, 8).join("\n  ") : ""}`);
console.log(`do not resolve: ${missing.length}${missing.length ? "\n  " + missing.slice(0, 8).join("\n  ") : ""}`);
console.log(`noindex + robots disallow: ${noindexOk ? "ok" : "MISSING"} | search-index path in config: ${cfgOk ? "ok" : "MISSING"}`);
process.exit(unprefixed.length || missing.length || !noindexOk || !cfgOk ? 1 : 0);
