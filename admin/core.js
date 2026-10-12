// Shared state, utilities and storage backends for the CMS.
// Backends: LocalBackend (dev server writes files) or GitHubBackend (commits via the REST API).
import { esc } from "./render.mjs";
import { loadAiConfig } from "./ai.js";

export { esc };
// "" on a domain root, "/repo" when the site is served from a sub-path (GitHub project pages)
export const SITE_ROOT = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const state = {
  backend: null, site: null, ui: {}, pages: new Map(), files: [], manifest: { images: {}, docs: {} },
  pending: new Map(), // "/assets/img/x.webp" -> blob URL for images uploaded in this session
  ai: loadAiConfig(),
  ed: null
};
// view registry (filled by cms.js) so the editor can navigate without importing it
export const views = {};
// read-only handle for debugging and the end-to-end test (tools/test-cms.mjs)
if (typeof window !== "undefined") window.__bkcms = { state };

// ---------- utils ----------
const translit = (s) => String(s).normalize("NFKD").replace(/ß/g, "ss").replace(/[̀-ͯ]/g, "").replace(/[øØ]/g, "o").replace(/[æÆ]/g, "ae");
export const slug = (s) => translit(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const pagePathToFile = (p) => "content/pages/" + (p === "/" ? "index" : p.slice(1).split("/").map(slug).join("/")) + ".json";
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");
export const debounce = (fn, ms) => { let t; const f = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; f.flush = () => { clearTimeout(t); }; return f; };
export function toast(msg, kind = "ok", ms = 4200) {
  const el = $("#toast");
  el.textContent = msg; el.className = "toast " + kind; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (el.hidden = true), ms);
}
export function bytesToB64(bytes) {
  let s = ""; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
const textToB64 = (t) => bytesToB64(new TextEncoder().encode(t));
export const getPath = (o, p) => String(p).split(".").reduce((a, k) => (a == null ? a : a[k]), o);
export function setPath(o, p, v) {
  const ks = String(p).split(".");
  let c = o;
  for (let i = 0; i < ks.length - 1; i++) { if (c[ks[i]] == null) c[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; c = c[ks[i]]; }
  c[ks[ks.length - 1]] = v;
}
export function setStatus(s) { const el = $("#status"); if (el) el.textContent = s; }

// ---------- backends ----------
export class LocalBackend {
  constructor() { this.label = "Lokala filer (dev-server)"; this.mode = "local"; }
  async tree() { return (await (await fetch("/__cms/tree")).json()).files; }
  async read(path) {
    const r = await fetch("/__cms/file?path=" + encodeURIComponent(path));
    if (!r.ok) throw new Error("read failed: " + path);
    return (await r.json()).content;
  }
  async write(path, content, { base64 = false } = {}) {
    const r = await fetch("/__cms/file", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, content, encoding: base64 ? "base64" : "utf8" }) });
    if (!r.ok) throw new Error("write failed: " + (await r.text()));
  }
  async remove(path) { await fetch("/__cms/file?path=" + encodeURIComponent(path), { method: "DELETE" }); }
}

export class GitHubBackend {
  constructor(cfg) { this.cfg = cfg; this.sha = new Map(); this.mode = "github"; this.label = `GitHub ${cfg.owner}/${cfg.repo}@${cfg.branch}`; }
  async api(method, url, body, accept) {
    const r = await fetch("https://api.github.com/repos/" + this.cfg.owner + "/" + this.cfg.repo + url, {
      method,
      headers: { Authorization: "Bearer " + this.cfg.token, Accept: accept || "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!r.ok) {
      let m = r.status + " " + r.statusText;
      try { m += ": " + (await r.json()).message; } catch { /* ignore */ }
      const e = new Error(m); e.status = r.status; throw e;
    }
    return accept && accept.includes("raw") ? r.text() : r.json();
  }
  async tree() {
    const j = await this.api("GET", `/git/trees/${encodeURIComponent(this.cfg.branch)}?recursive=1`);
    const out = [];
    for (const t of j.tree) if (t.type === "blob" && /^(content\/|assets-src\/(img|docs)\/)/.test(t.path)) { this.sha.set(t.path, t.sha); out.push({ path: t.path, size: t.size }); }
    return out;
  }
  async read(path) { return this.api("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`, null, "application/vnd.github.raw+json"); }
  async write(path, content, { base64 = false, message } = {}) {
    const body = { message: message || "CMS: update " + path, content: base64 ? content : textToB64(content), branch: this.cfg.branch };
    if (this.sha.has(path)) body.sha = this.sha.get(path);
    let r;
    try { r = await this.api("PUT", `/contents/${enc(path)}`, body); }
    catch (e) {
      if (e.status === 422 || e.status === 409) {
        const cur = await this.api("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`).catch(() => null);
        if (cur && cur.sha) { body.sha = cur.sha; r = await this.api("PUT", `/contents/${enc(path)}`, body); } else throw e;
      } else throw e;
    }
    this.sha.set(path, r.content.sha);
  }
  async remove(path) {
    let sha = this.sha.get(path);
    if (!sha) sha = (await this.api("GET", `/contents/${enc(path)}?ref=${encodeURIComponent(this.cfg.branch)}`)).sha;
    await this.api("DELETE", `/contents/${enc(path)}`, { message: "CMS: delete " + path, sha, branch: this.cfg.branch });
    this.sha.delete(path);
  }
}

export async function detectBackend() {
  try {
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      const r = await fetch("/__cms/ping");
      if (r.ok) return new LocalBackend();
    }
  } catch { /* not the dev server */ }
  try {
    const saved = JSON.parse(localStorage.getItem("bkcms.gh") || "null");
    if (saved && saved.token) return new GitHubBackend(saved);
  } catch { /* ignore */ }
  return null;
}

// ---------- data loading ----------
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
export async function loadAll() {
  const be = state.backend;
  state.files = await be.tree();
  state.site = JSON.parse(await be.read("content/site.json"));
  state.ui = {};
  for (const f of state.files.filter((f) => /^content\/ui\/[a-z]+\.json$/.test(f.path))) state.ui[f.path.match(/ui\/([a-z]+)\.json/)[1]] = JSON.parse(await be.read(f.path));
  const pageFiles = state.files.filter((f) => /^content\/pages\/.*\.json$/.test(f.path));
  state.pages = new Map();
  await pool(pageFiles, 8, async (f) => {
    const data = JSON.parse(await be.read(f.path));
    state.pages.set(data.path, { file: f.path, data });
  });
  try {
    const r = await fetch(new URL("manifest.json", import.meta.url), { cache: "no-store", signal: AbortSignal.timeout(8000) }); // optional: never block start-up
    if (r.ok) state.manifest = await r.json();
  } catch { /* preview falls back to plain <img> tags */ }
}

export const siteLangs = () => Object.keys((state.site && state.site.languages) || { sv: {} });
export const defLang = () => (state.site && state.site.defaultLang) || "es";
export const langLabel = (l) => (state.site.languages[l] && state.site.languages[l].label) || l;
export function titleOf(p, lang = defLang()) {
  const pg = state.pages.get(p);
  const tr = pg && pg.data.i18n && (pg.data.i18n[lang] || pg.data.i18n[defLang()]);
  return tr ? tr.h1 || tr.title : p;
}

export async function writeJson(path, obj, message) {
  await state.backend.write(path, JSON.stringify(obj, null, 2) + "\n", { message });
}
export const savedMessage = (t) => (state.backend.mode === "github" ? t("saved_github") : t("saved_local"));
