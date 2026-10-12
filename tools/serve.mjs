#!/usr/bin/env node
// Local dev server:
//   - builds the site, serves dist/ with GitHub-Pages-style URL resolution
//   - rebuilds when content/src/static/admin/assets change
//   - exposes /__cms/* so the hidden CMS can read/write repo files from localhost
//
//   node tools/serve.mjs [--port 4173] [--all-langs]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const DIST = path.join(ROOT, "dist");
const args = process.argv.slice(2);
const port = +(args[args.indexOf("--port") + 1] || process.env.PORT || 4173);
const allLangs = args.includes("--all-langs");
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml",
  ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon",
  ".pdf": "application/pdf", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json"
};

// ---------- build ----------
let building = false, queued = false;
function build() {
  if (building) { queued = true; return; }
  building = true;
  const t = Date.now();
  const p = spawn(process.execPath, ["src/build.mjs", ...(allLangs ? ["--all-langs"] : [])], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", (code) => {
    building = false;
    console.log(code === 0 ? `[build] ${out.trim()}` : `[build FAILED ${code}]\n${out}`);
    if (queued) { queued = false; build(); }
    void t;
  });
}
let timer = null;
const rebuildSoon = () => { clearTimeout(timer); timer = setTimeout(build, 350); };
// (admin/ is served straight from source below, so editing the CMS needs no rebuild)
for (const d of ["content", "src", "static", "assets-src"]) {
  try { fs.watch(path.join(ROOT, d), { recursive: true }, rebuildSoon); } catch { /* platform without recursive watch */ }
}

// ---------- CMS file API (localhost only) ----------
const ALLOWED = ["content/", "assets-src/img/", "assets-src/docs/"];
const safeRel = (p) => {
  const rel = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.includes("..") || !ALLOWED.some((a) => rel.startsWith(a))) return null;
  return rel;
};
function listFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push({ path: path.relative(ROOT, p).replace(/\\/g, "/"), size: fs.statSync(p).size });
    }
  };
  for (const a of ALLOWED) { const d = path.join(ROOT, a); if (fs.existsSync(d)) walk(d); }
  return out;
}
const readBody = (req) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on("data", (c) => { n += c.length; if (n > 40e6) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
  req.on("end", () => resolve(Buffer.concat(chunks)));
  req.on("error", reject);
});
const json = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); };

async function cms(req, res, url) {
  const host = (req.headers.host || "").split(":")[0];
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return json(res, 403, { error: "local only" });
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: "cross-origin" });
  if (url.pathname === "/__cms/ping") return json(res, 200, { ok: true, mode: "local" });
  if (url.pathname === "/__cms/tree") return json(res, 200, { files: listFiles() });
  // AI proxy (local dev only): forwards a chat/models request to an OpenAI-compatible provider,
  // so the browser never runs into CORS. The key travels from the browser to the provider only.
  if (url.pathname === "/__cms/ai" && req.method === "POST") {
    let spec;
    try { spec = JSON.parse((await readBody(req)).toString("utf8")); } catch { return json(res, 400, { error: "bad json" }); }
    let target;
    try { target = new URL(spec.url); } catch { return json(res, 400, { error: "bad url" }); }
    const okHost = target.protocol === "https:" || ["127.0.0.1", "localhost"].includes(target.hostname);
    if (!okHost || !/^(GET|POST)$/.test(spec.method || "")) return json(res, 400, { error: "not allowed" });
    try {
      const r = await fetch(target, {
        method: spec.method,
        headers: { authorization: spec.authorization || "", ...(spec.body ? { "content-type": "application/json" } : {}) },
        body: spec.body ? JSON.stringify(spec.body) : undefined
      });
      const buf = Buffer.from(await r.arrayBuffer());
      const h = { "content-type": r.headers.get("content-type") || "application/json", "cache-control": "no-store" };
      const ra = r.headers.get("retry-after"); if (ra) h["retry-after"] = ra;
      res.writeHead(r.status, h);
      return res.end(buf);
    } catch (e) { return json(res, 502, { error: { message: "proxy: " + (e && e.message || e) } }); }
  }
  const rel = safeRel(url.searchParams.get("path"));
  if (url.pathname === "/__cms/file") {
    if (req.method === "GET") {
      if (!rel) return json(res, 400, { error: "bad path" });
      const f = path.join(ROOT, rel);
      if (!fs.existsSync(f)) return json(res, 404, { error: "not found" });
      return json(res, 200, { path: rel, content: fs.readFileSync(f, "utf8") });
    }
    if (req.method === "PUT") {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const r = safeRel(body.path);
      if (!r) return json(res, 400, { error: "bad path" });
      const f = path.join(ROOT, r);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, body.encoding === "base64" ? Buffer.from(body.content, "base64") : body.content);
      return json(res, 200, { ok: true, path: r });
    }
    if (req.method === "DELETE") {
      if (!rel) return json(res, 400, { error: "bad path" });
      fs.rmSync(path.join(ROOT, rel), { force: true });
      return json(res, 200, { ok: true });
    }
  }
  return json(res, 404, { error: "unknown endpoint" });
}

// ---------- static (GitHub Pages resolution order) ----------
function resolveFile(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return null; }
  p = p.normalize("NFC");
  if (p.includes("..")) return null;
  const abs = path.join(DIST, p);
  const tryFiles = [];
  if (p.endsWith("/")) tryFiles.push(path.join(abs, "index.html"));
  else tryFiles.push(abs, abs + ".html", path.join(abs, "index.html"));
  for (const f of tryFiles) { try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ } }
  return null;
}

// The hidden CMS is served from source: admin/ + the shared modules from src/ + the built manifest.
const ADMIN = ((JSON.parse(fs.readFileSync(path.join(ROOT, "content/site.json"), "utf8")).adminPath) || "/cms/").replace(/^\/*/, "/").replace(/\/*$/, "/");
const ADMIN_MAP = {
  "render.mjs": path.join(ROOT, "src/lib/render.mjs"),
  "translatable.mjs": path.join(ROOT, "src/lib/translatable.mjs"),
  "basepath.mjs": path.join(ROOT, "src/lib/basepath.mjs"),
  "visibility.mjs": path.join(ROOT, "src/lib/visibility.mjs"),
  "site.css": path.join(ROOT, "src/css/site.css"),
  "manifest.json": path.join(DIST, ADMIN.replace(/^\/|\/$/g, ""), "manifest.json")
};
function adminFile(pathname) {
  if (!pathname.startsWith(ADMIN)) return null;
  const rel = pathname.slice(ADMIN.length) || "index.html";
  if (rel.includes("..")) return null;
  const f = ADMIN_MAP[rel] || path.join(ROOT, "admin", rel);
  try { return fs.statSync(f).isFile() ? f : null; } catch { return null; }
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/__cms/")) return await cms(req, res, url);
    const af = adminFile(url.pathname);
    if (af) {
      let body;
      try { body = fs.readFileSync(af); } catch { res.writeHead(503); return res.end("busy"); }
      res.writeHead(200, { "content-type": MIME[path.extname(af).toLowerCase()] || "application/octet-stream", "cache-control": "no-store" });
      return res.end(body);
    }
    let file = resolveFile(url.pathname);
    let status = 200;
    if (!file) { file = path.join(DIST, "404.html"); status = 404; }
    if (!fs.existsSync(file)) { res.writeHead(503); return res.end("building…"); }
    const ext = path.extname(file).toLowerCase();
    const stream = fs.createReadStream(file);
    stream.on("open", () => {
      res.writeHead(status, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": "no-cache" });
      stream.pipe(res);
    });
    // the file can vanish while a rebuild replaces dist/: answer instead of hanging
    stream.on("error", () => { if (!res.headersSent) { res.writeHead(503); res.end("building…"); } else res.destroy(); });
  } catch (e) {
    res.writeHead(500); res.end(String(e && e.message || e));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`dev server  http://localhost:${port}/   (CMS: http://localhost:${port}/cms/)`);
  build();
});
