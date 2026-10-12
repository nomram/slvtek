#!/usr/bin/env node
// Static site build: content/*.json  ->  dist/  (GitHub Pages ready)
//
//   node src/build.mjs [--out dist] [--all-langs]
//
// --all-langs also renders languages marked unpublished (for review/preview).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { renderDocument, renderNotFound, esc, flatBlocks } from "./lib/render.mjs";
import { applyBasePath } from "./lib/apply-base.mjs";
import { isHidden, visibleAncestor } from "./lib/visibility.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DIST = path.resolve(ROOT, opt("out", "dist"));
const ALL_LANGS = flag("all-langs") || process.env.BK_ALL_LANGS === "1";
const t0 = Date.now();

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const exists = (p) => fs.existsSync(p);
function copyDir(src, dst) {
  if (!exists(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// ---------- load content ----------
const site = readJson(path.join(ROOT, "content/site.json"));
const defaultLang = site.defaultLang || "es";
const uiAll = {};
for (const f of fs.readdirSync(path.join(ROOT, "content/ui"))) if (f.endsWith(".json")) uiAll[f.replace(/\.json$/, "")] = readJson(path.join(ROOT, "content/ui", f));
const uiFor = (lang) => ({ ...(uiAll[defaultLang] || {}), ...(uiAll[lang] || {}) });
const redirects = exists(path.join(ROOT, "content/redirects.json")) ? readJson(path.join(ROOT, "content/redirects.json")) : {};

const pages = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".json")) { const pg = readJson(p); pg._file = path.relative(ROOT, p); pages.set(pg.path, pg); }
  }
})(path.join(ROOT, "content/pages"));

const languages = Object.entries(site.languages || { [defaultLang]: { published: true } })
  .filter(([, l]) => l.published || ALL_LANGS).map(([c]) => c);
// A language is "live" in site-wide features (switcher/hreflang) when published or --all-langs
const siteForBuild = ALL_LANGS ? { ...site, languages: Object.fromEntries(Object.entries(site.languages).map(([c, l]) => [c, { ...l, published: true }])) } : site;

const parentOf = (p) => (p === "/" ? null : p.split("/").slice(0, -1).join("/") || "/");
const kids = new Map();
for (const p of pages.keys()) {
  const par = parentOf(p);
  if (par === null) continue;
  if (!kids.has(par)) kids.set(par, []);
  kids.get(par).push(p);
}
const titleSort = (a, b) => {
  const pa = pages.get(a), pb = pages.get(b);
  return (pa.order ?? 999) - (pb.order ?? 999) || a.localeCompare(b, "es");
};
for (const arr of kids.values()) arr.sort(titleSort);

// ---------- images ----------
const IMG_SRC = path.join(ROOT, "assets-src/img");
const IMG_OUT = path.join(DIST, "assets/img");
const CACHE = path.join(ROOT, ".cache/img");
const WIDTHS = [480, 800, 1280, 1920];
const imageInfo = new Map(); // "/assets/img/name.ext" -> {name, ext, w, h, widths}

async function processImages() {
  if (!exists(IMG_SRC)) return;
  let sharp = null;
  try { sharp = (await import("sharp")).default; } catch { console.warn("! sharp not installed: images are copied without variants"); }
  fs.mkdirSync(IMG_OUT, { recursive: true });
  fs.mkdirSync(CACHE, { recursive: true });
  const indexFile = path.join(ROOT, ".cache/img-index.json");
  const idx = exists(indexFile) ? readJson(indexFile) : {};
  const files = fs.readdirSync(IMG_SRC).filter((f) => !f.startsWith("."));
  let made = 0;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const f = queue.shift();
      const src = path.join(IMG_SRC, f);
      const st = fs.statSync(src);
      const ext = path.extname(f).slice(1).toLowerCase();
      const name = f.slice(0, -ext.length - 1);
      const key = `${st.size}-${Math.round(st.mtimeMs)}`;
      let rec = idx[f];
      if (!rec || rec.key !== key) {
        rec = { key, w: 0, h: 0, widths: [] };
        if (sharp) {
          const meta = await sharp(src).metadata();
          rec.w = meta.width || 0; rec.h = meta.height || 0;
          if (ext === "webp" || ext === "jpg" || ext === "jpeg" || ext === "png") {
            const ws = rec.w <= WIDTHS[0] ? [rec.w] : [...WIDTHS.filter((w) => w < rec.w), ...(rec.w <= WIDTHS[WIDTHS.length - 1] ? [rec.w] : [])];
            rec.widths = ws;
            for (const w of ws) {
              const out = path.join(CACHE, `${name}-${w}.webp`);
              await sharp(src).resize({ width: w, withoutEnlargement: true }).webp({ quality: w >= 1280 ? 74 : 78, effort: 4 }).toFile(out);
              made++;
            }
          }
        }
        idx[f] = rec;
      }
      imageInfo.set(`/assets/img/${f}`, { name, ext, w: rec.w, h: rec.h, widths: rec.widths });
      // masters + variants to dist
      fs.copyFileSync(src, path.join(IMG_OUT, f));
      for (const w of rec.widths) {
        const c = path.join(CACHE, `${name}-${w}.webp`);
        if (exists(c)) fs.copyFileSync(c, path.join(IMG_OUT, `${name}-${w}.webp`));
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  fs.writeFileSync(indexFile, JSON.stringify(idx));
  return made;
}

// ---------- docs ----------
const fileSizes = new Map();
const docInfoMap = new Map(); // "/assets/docs/x.pdf" -> {pages, thumb, thumbW, thumbH}
async function processDocs() {
  const src = path.join(ROOT, "assets-src/docs");
  if (!exists(src)) return 0;
  const dst = path.join(DIST, "assets/docs");
  const thumbDst = path.join(DIST, "assets/doc-thumbs");
  const cacheDir = path.join(ROOT, ".cache/docs");
  fs.mkdirSync(dst, { recursive: true });
  fs.mkdirSync(thumbDst, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  let mupdf = null, sharp = null;
  try { mupdf = await import("mupdf"); sharp = (await import("sharp")).default; } catch { console.warn("! mupdf/sharp missing: no PDF thumbnails"); }
  const idxFile = path.join(ROOT, ".cache/docs-index.json");
  const idx = exists(idxFile) ? readJson(idxFile) : {};
  let made = 0;
  for (const f of fs.readdirSync(src)) {
    const p = path.join(src, f);
    const st = fs.statSync(p);
    fs.copyFileSync(p, path.join(dst, f));
    const href = `/assets/docs/${f}`;
    fileSizes.set(href, st.size);
    if (!mupdf || !/.pdf$/i.test(f)) continue;
    const key = `${st.size}-${Math.round(st.mtimeMs)}`;
    const name = f.replace(/.pdf$/i, "");
    const thumbFile = path.join(cacheDir, name + ".webp");
    let rec = idx[f];
    if (!rec || rec.key !== key || !exists(thumbFile)) {
      try {
        const doc = mupdf.Document.openDocument(fs.readFileSync(p), "application/pdf");
        const pages = doc.countPages();
        const page = doc.loadPage(0);
        const b = page.getBounds();
        const w = 360, scale = w / (b[2] - b[0]);
        const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
        const png = Buffer.from(pix.asPNG());
        const out = await sharp(png).webp({ quality: 72 }).toFile(thumbFile);
        rec = { key, pages, w: out.width, h: out.height };
        made++;
      } catch (e) { rec = { key, pages: 0, w: 0, h: 0, error: String(e.message || e) }; }
      idx[f] = rec;
    }
    if (rec.w) {
      fs.copyFileSync(thumbFile, path.join(thumbDst, name + ".webp"));
      docInfoMap.set(href, { pages: rec.pages, thumb: `/assets/doc-thumbs/${name}.webp`, thumbW: rec.w, thumbH: rec.h });
    } else if (rec.pages) docInfoMap.set(href, { pages: rec.pages });
  }
  fs.writeFileSync(idxFile, JSON.stringify(idx));
  return made;
}

// ---------- url helpers ----------
const urlStyle = site.urlStyle || "file";
const origin = site.origin.replace(/\/+$/, "");
function urlFor(p, lang) {
  const prefix = lang === defaultLang ? "" : "/" + lang;
  if (p === "/") return prefix ? prefix + "/" : "/";
  const u = prefix + p.split("/").map((s) => (s ? encodeURIComponent(s) : s)).join("/");
  return urlStyle === "directory" ? u + "/" : u;
}
function fileFor(p, lang) {
  const prefix = lang === defaultLang ? [] : [lang];
  const segs = p === "/" ? [] : p.split("/").filter(Boolean);
  if (!segs.length) return path.join(...prefix, "index.html");
  if (urlStyle === "directory") return path.join(...prefix, ...segs, "index.html");
  return path.join(...prefix, ...segs.slice(0, -1), segs[segs.length - 1] + ".html");
}
const trOf = (p, lang) => {
  const pg = pages.get(p);
  if (!pg || pg.published === false) return null;
  if (isHidden(pages, p, lang, defaultLang)) return null; // hidden for this language (hideIn)
  const t = pg.i18n && pg.i18n[lang];
  if (!t || t.published === false) return null;
  if (lang !== defaultLang && !ALL_LANGS && !(site.languages[lang] && site.languages[lang].published)) return null;
  return t;
};

// poster pictures of the YouTube videos (tools/fetch-yt-thumbs.mjs): shown until the visitor presses play
const YT_SRC = path.join(ROOT, "assets-src/yt");
const ytThumbs = new Set(exists(YT_SRC) ? fs.readdirSync(YT_SRC).filter((f) => f.endsWith(".webp")).map((f) => f.slice(0, -5)) : []);

function makeCtx(lang) {
  return {
    site: siteForBuild, lang, defaultLang, ui: uiFor(lang),
    pages,
    url: (p, l = lang) => urlFor(p, l),
    abs: (u) => origin + u,
    tr: trOf,
    hidden: (p, l = lang) => isHidden(pages, p, l, defaultLang),
    visibleAncestor: (p, l = lang) => visibleAncestor(pages, p, l, defaultLang),
    children: (p) => kids.get(p) || [],
    image: (src) => imageInfo.get(src) || null,
    fileSize: (href) => fileSizes.get(href) || null,
    docInfo: (href) => docInfoMap.get(href) || null,
    ytThumb: (id) => (ytThumbs.has(id) ? `/assets/yt/${id}.webp` : null),
    searchIndexUrl: lang === defaultLang ? "/search-index.json" : `/${lang}/search-index.json`
  };
}

// ---------- main ----------
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
if (ytThumbs.size) { fs.mkdirSync(path.join(DIST, "assets/yt"), { recursive: true }); for (const id of ytThumbs) fs.copyFileSync(path.join(YT_SRC, id + ".webp"), path.join(DIST, "assets/yt", id + ".webp")); }

copyDir(path.join(ROOT, "static"), DIST);
const made = await processImages();
const docsMade = await processDocs();

// css/js (+ cache-busting version)
const cssSrc = path.join(ROOT, "src/css/site.css"), jsSrc = path.join(ROOT, "src/js/site.js");
fs.mkdirSync(path.join(DIST, "css"), { recursive: true });
fs.mkdirSync(path.join(DIST, "js"), { recursive: true });
fs.copyFileSync(cssSrc, path.join(DIST, "css/site.css"));
fs.copyFileSync(jsSrc, path.join(DIST, "js/site.js"));
const assetVersion = crypto.createHash("md5").update(fs.readFileSync(cssSrc)).update(fs.readFileSync(jsSrc)).digest("hex").slice(0, 8);

// plain text of a page for the search index
const indexText = (t) => flatBlocks(t.blocks).flatMap((b) => {
  if (b.type === "text") return [b.html];
  if (b.type === "heading") return [b.text];
  if (b.type === "list") return b.items;
  if (b.type === "cards") return b.items.map((i) => (i.title || "") + " " + (i.text || ""));
  if (b.type === "datasheet") return [...(b.intro || []), ...(b.groups || []).flatMap((g) => g.rows.map((r) => r.label + " " + (r.metric || "") + " " + (r.us || "")))];
  if (b.type === "chips") return b.items;
  if (b.type === "modules") return (b.items || []).map((i) => [i.title, i.text, ...(i.bullets || [])].filter(Boolean).join(" "));
  if (b.type === "table") return (b.rows || []).map((r) => r.join(" "));
  if (b.type === "cta") return [b.title, b.text].filter(Boolean);
  return [];
}).join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

let rendered = 0;
const sitemapEntries = [];
const searchIndexes = {};
const hl = (code) => (siteForBuild.languages[code] && siteForBuild.languages[code].htmlLang) || code;
const writePage = (rel, html) => {
  const out = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
};

for (const lang of languages) {
  const ctx = makeCtx(lang);
  for (const [p, page] of pages) {
    const t = trOf(p, lang);
    if (!t) continue;
    writePage(fileFor(p, lang), renderDocument(ctx, page, t, { assetVersion }));
    rendered++;
    sitemapEntries.push({ p, lang, updated: page.updated || null });
    {
      const text = indexText(t);
      // words of the other languages, for matching only: searching "drill mast" on the Spanish site still finds the page
      const other = languages.filter((l) => l !== lang).map((l) => { const o = trOf(p, l); return o ? [o.h1 || o.title, ...(o.tags || []), indexText(o).slice(0, 500)].join(" ") : ""; }).join(" ").replace(/\s+/g, " ").trim();
      (searchIndexes[lang] = searchIndexes[lang] || []).push({ u: urlFor(p, lang), t: t.h1 || t.title, x: text.slice(0, 1500), g: t.tags || [], ...(other ? { o: other } : {}), d: p === "/" ? 0 : p.split("/").filter(Boolean).length });
    }
  }
}

// 404
writePage("404.html", renderNotFound(makeCtx(defaultLang)));

// redirect stubs (GitHub Pages cannot send 301s; meta refresh + canonical is the static equivalent)
for (const [from, to] of Object.entries(redirects)) {
  const target = origin + urlFor(to, defaultLang);
  const html = `<!doctype html><html lang="${esc(defaultLang)}"><head><meta charset="utf-8"><title>${esc(site.name)}</title><meta name="robots" content="noindex"><link rel="canonical" href="${esc(target)}"><meta http-equiv="refresh" content="0; url=${esc(urlFor(to, defaultLang))}"></head><body><p><a href="${esc(urlFor(to, defaultLang))}">${esc(site.name)}</a></p><script>location.replace(${JSON.stringify(urlFor(to, defaultLang))})</script></body></html>`;
  writePage(fileFor(from, defaultLang), html);
}

// sitemap with hreflang alternates
const byPath = new Map();
for (const e of sitemapEntries) { if (!byPath.has(e.p)) byPath.set(e.p, []); byPath.get(e.p).push(e); }
const sm = [];
for (const [p, es] of byPath) {
  for (const e of es) {
    const alts = es.length > 1
      ? es.map((a) => `    <xhtml:link rel="alternate" hreflang="${hl(a.lang)}" href="${esc(origin + urlFor(p, a.lang))}"/>`).join("\n") +
        `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(origin + urlFor(p, defaultLang))}"/>`
      : "";
    sm.push(`  <url>\n    <loc>${esc(origin + urlFor(p, e.lang))}</loc>${e.updated ? `\n    <lastmod>${e.updated}</lastmod>` : ""}${alts ? "\n" + alts : ""}\n  </url>`);
  }
}
writePage("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${sm.join("\n")}\n</urlset>\n`);
writePage("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
for (const [lang, idx] of Object.entries(searchIndexes)) writePage(lang === defaultLang ? "search-index.json" : path.join(lang, "search-index.json"), JSON.stringify(idx));
writePage(".nojekyll", "");
try {
  const host = new URL(origin).hostname;
  if (!host.endsWith("github.io")) writePage("CNAME", host + "\n");
} catch { /* ignore */ }
writePage("site.webmanifest", JSON.stringify({
  name: site.legalName || site.name, short_name: site.name, start_url: "/", display: "browser",
  theme_color: (site.theme && site.theme.dark) || "#293a51", background_color: "#ffffff",
  icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
}));

// hidden CMS (not linked from the site, not in the sitemap, noindex)
const adminPath = (site.adminPath || "/cms/").replace(/^\/+|\/+$/g, "");
if (adminPath && exists(path.join(ROOT, "admin"))) {
  const adminOut = path.join(DIST, adminPath);
  copyDir(path.join(ROOT, "admin"), adminOut);
  fs.copyFileSync(path.join(ROOT, "src/lib/render.mjs"), path.join(adminOut, "render.mjs"));
  fs.copyFileSync(path.join(ROOT, "src/lib/translatable.mjs"), path.join(adminOut, "translatable.mjs"));
  fs.copyFileSync(path.join(ROOT, "src/lib/basepath.mjs"), path.join(adminOut, "basepath.mjs"));
  fs.copyFileSync(path.join(ROOT, "src/lib/visibility.mjs"), path.join(adminOut, "visibility.mjs"));
  fs.copyFileSync(cssSrc, path.join(adminOut, "site.css"));
  // what the visual editor needs to draw images / documents exactly like the built site
  fs.writeFileSync(path.join(adminOut, "manifest.json"), JSON.stringify({
    images: Object.fromEntries(imageInfo),
    docs: Object.fromEntries([...fileSizes].filter(([h]) => /\.pdf$/i.test(h)).map(([h, size]) => [h, { size, ...(docInfoMap.get(h) || {}) }]))
  }));
}

// ---------- sub-path deployment (GitHub project pages) ----------
// SITE_BASE=/repo prefixes every root-absolute URL so the site works at https://user.github.io/repo/.
// (CI does this as a separate step after the checks: tools/apply-base.mjs.) Such a build is a preview: noindex.
const SITE_BASE = process.env.SITE_BASE || "";
if (SITE_BASE) console.log(`base path ${SITE_BASE}: rewrote ${applyBasePath(DIST, SITE_BASE)} files (preview build, noindex)`);

const mb = (n) => (n / 1e6).toFixed(1);
let total = 0;
(function size(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? size(p) : (total += fs.statSync(p).size); } })(DIST);
console.log(`built ${rendered} pages (${languages.join(", ")}) | ${imageInfo.size} images${made ? ` (${made} variants made)` : " (cached)"} | ${fileSizes.size} docs (${docInfoMap.size} thumbs${docsMade ? `, ${docsMade} new` : ""}) | dist ${mb(total)} MB | ${((Date.now() - t0) / 1000).toFixed(1)}s`);
