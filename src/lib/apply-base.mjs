// Applies a base path to a finished build folder (Node only; the pure rewrite rules live in basepath.mjs).
import fs from "node:fs";
import path from "node:path";
import { rewriteHtml, rewriteCss, rewriteJsonPaths, normalizeBase } from "./basepath.mjs";

// Returns the number of files rewritten. A non-empty base also turns the build into a "preview":
// every page gets noindex and robots.txt disallows everything.
export function applyBasePath(dir, baseInput) {
  const base = normalizeBase(baseInput);
  if (!base) return 0;
  let n = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      const rel = path.relative(dir, p).replace(/\\/g, "/");
      if (/\.html$/.test(e.name)) fs.writeFileSync(p, rewriteHtml(fs.readFileSync(p, "utf8"), base, { noindex: true }));
      else if (/\.css$/.test(e.name)) fs.writeFileSync(p, rewriteCss(fs.readFileSync(p, "utf8"), base));
      else if (/(^|\/)search-index\.json$/.test(rel) || e.name === "site.webmanifest") fs.writeFileSync(p, rewriteJsonPaths(fs.readFileSync(p, "utf8"), base));
      else if (rel === "robots.txt") fs.writeFileSync(p, "User-agent: *\nDisallow: /\n");
      else continue;
      n++;
    }
  })(dir);
  return n;
}
