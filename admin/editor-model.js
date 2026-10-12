// Visual editor: content model helpers (blocks, history, translation status, sanitizing).
import { state, clone, defLang, siteLangs, setPath } from "./core.js";
import { units, hash } from "./translatable.mjs";

// ---------- icons (24x24, stroke) ----------
const svg = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const IC = {
  text: svg('<path d="M4 6h16M4 11h16M4 16h10"/>'),
  heading: svg('<path d="M6 5v14M18 5v14M6 12h12"/>'),
  list: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'),
  video: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>'),
  download: svg('<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/>'),
  button: svg('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>'),
  cards: svg('<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="14" width="8" height="6" rx="1.5"/><rect x="13" y="14" width="8" height="6" rx="1.5"/>'),
  cta: svg('<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 12h6m-2-2l2 2-2 2"/>'),
  chips: svg('<rect x="3" y="5" width="9" height="5" rx="2.5"/><rect x="14" y="5" width="7" height="5" rx="2.5"/><rect x="3" y="14" width="6" height="5" rx="2.5"/><rect x="11" y="14" width="10" height="5" rx="2.5"/>'),
  table: svg('<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 10h18M9 5v14"/>'),
  datasheet: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h7M9 19h4"/>'),
  columns: svg('<rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/>'),
  modules: svg('<rect x="3" y="5" width="5" height="14" rx="1"/><rect x="9.5" y="5" width="5" height="14" rx="1"/><rect x="16" y="5" width="5" height="14" rx="1"/>'),
  carousel: svg('<rect x="6" y="5" width="12" height="14" rx="2"/><path d="M2.5 9v6M21.5 9v6"/>'),
  quote: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>'),
  social: svg('<circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8.7 10.6l6.6-3.2M8.7 13.4l6.6 3.2"/>'),
  contact: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
  html: svg('<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>'),
  up: svg('<path d="M12 19V5m0 0l-5 5m5-5l5 5"/>'),
  down: svg('<path d="M12 5v14m0 0l-5-5m5 5l5-5"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  drag: svg('<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>'),
  desktop: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  tablet: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M11 18h2"/>'),
  mobile: svg('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>'),
  sparkle: svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8L21.5 18.5l-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z"/>'),
  bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: svg('<path d="M10 5h8M6 19h8M14 5L10 19"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  unlink: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  eye: svg('<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  page: svg('<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>')
};

// ---------- block catalogue ----------
export const BLOCK_TYPES = [
  { id: "text", group: "text" }, { id: "heading", group: "text" }, { id: "list", group: "text" },
  { id: "image", group: "media" }, { id: "video", group: "media" }, { id: "download", group: "media" },
  { id: "button", group: "layout" }, { id: "columns", group: "layout" }, { id: "cards", group: "layout" }, { id: "carousel", group: "media" }, { id: "modules", group: "layout" }, { id: "cta", group: "layout" }, { id: "chips", group: "layout" },
  { id: "table", group: "data" }, { id: "datasheet", group: "data" },
  { id: "quote", group: "other" }, { id: "social", group: "other" }, { id: "contact", group: "other" }, { id: "html", group: "other" }
];
export const BLOCK_GROUPS = ["text", "media", "layout", "data", "other"];
// the palette id of a stored block ("download" is a button with kind=download)
export const paletteId = (b) => (b.type === "button" && b.kind === "download" ? "download" : b.type);

// Language-specific starter copy (content language, not editor UI language)
const DEFAULT_COPY = {
  sv: { cta_title: "Vill du veta mer?", cta_text: "Kontakta oss så hjälper vi dig vidare.", cta_button: "Kontakta oss", tech: "Teknisk data", doc: "Produktblad" },
  en: { cta_title: "Want to know more?", cta_text: "Get in touch and we will help you further.", cta_button: "Contact us", tech: "Technical data", doc: "Product sheet" },
  es: { cta_title: "¿Quiere saber más?", cta_text: "Contáctenos y le ayudaremos.", cta_button: "Contáctenos", tech: "Datos técnicos", doc: "Ficha de producto" },
  no: { cta_title: "Vil du vite mer?", cta_text: "Ta kontakt, så hjelper vi deg videre.", cta_button: "Kontakt oss", tech: "Tekniske data", doc: "Produktblad" }
};
const copyFor = (lang) => DEFAULT_COPY[lang] || DEFAULT_COPY.en;

export function newBlock(id, lang) {
  const c = copyFor(lang);
  switch (id) {
    case "text": return { type: "text", html: "" };
    case "heading": return { type: "heading", level: 2, text: "" };
    case "list": return { type: "list", ordered: false, items: [""] };
    case "image": return { type: "image", src: "", alt: "" };
    case "video": return { type: "video", provider: "youtube", id: "", title: "" };
    case "download": return { type: "button", kind: "download", text: "", href: "" };
    case "button": return { type: "button", kind: "link", text: "", href: "" };
    case "cards": return { type: "cards", items: [] };
    case "cta": return { type: "cta", title: c.cta_title, text: c.cta_text, button: c.cta_button, href: "/contacto" };
    case "chips": return { type: "chips", title: "", items: [""] };
    case "table": return { type: "table", header: true, rows: [["", ""], ["", ""]] };
    case "datasheet": return { type: "datasheet", title: c.tech, tagline: "", intro: [], groups: [{ title: "", rows: [{ label: "", metric: "", us: "" }] }], note: "" };
    case "columns": return { type: "columns", ratio: "60-40", left: [{ type: "text", html: "" }], right: [{ type: "image", src: "", alt: "" }] };
    case "social": return { type: "social" };
    case "quote": return { type: "quote" };
    case "carousel": return { type: "carousel", items: [], autoplay: false };
    case "modules": return { type: "modules", layout: "cards", items: [{ title: "", text: "", bullets: [] }] };
    case "contact": return { type: "contact" };
    default: return { type: "html", html: "" };
  }
}

// ---------- accessors ----------
export const srcLang = (page) => page.sourceLang || defLang();
export const metaOf = (page, l) => (page.i18nMeta && page.i18nMeta[l]) || null;
export const curT = () => { const ed = state.ed; return ed.page.i18n && ed.page.i18n[ed.lang]; };
export function curBlocks() {
  const t = curT();
  if (!t) return [];
  if (!t.blocks) t.blocks = [];
  return t.blocks;
}
export const hashUnits = (u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [k, hash(v)]));

// ---------- translation status of one language ----------
// key: source | missing | auto | manual | reviewed | legacy ; stale = source text changed since it was translated
export function langStatus(page, l, baseline) {
  const src = srcLang(page);
  if (l === src) return { key: "source", stale: 0 };
  const tr = page.i18n && page.i18n[l];
  if (!tr) return { key: "missing", stale: 0 };
  const meta = metaOf(page, l);
  const cur = page.i18n[src] ? units(page, page.i18n[src]) : {};
  const base = (meta && meta.srcUnits) || baseline || {};
  let stale = 0;
  for (const [id, v] of Object.entries(cur)) if (base[id] !== hash(v) && /[A-Za-zÅÄÖåäö]{3,}/.test(v)) stale++;
  return { key: meta ? meta.mode || "auto" : "legacy", stale };
}

// ---------- history / mutation ----------
export const hooks = { changed() {} };

export function mutate(fn, opts = {}) {
  const ed = state.ed;
  const now = Date.now();
  const key = opts.coalesce;
  if (!(key && ed.lastKey === key && now - ed.lastAt < 1500)) {
    ed.history.push(JSON.stringify(ed.page));
    if (ed.history.length > 120) ed.history.shift();
    ed.future = [];
  }
  ed.lastKey = key || null; ed.lastAt = now;
  fn(ed.page);
  if (opts.scope !== "page") {
    const L = ed.lang, src = srcLang(ed.page);
    if (L !== src && ed.page.i18n && ed.page.i18n[L]) {
      const metas = (ed.page.i18nMeta = ed.page.i18nMeta || {});
      const m = (metas[L] = metas[L] || { mode: "manual", from: src, at: new Date().toISOString() });
      if (m.mode === "auto" || m.mode === "legacy") { m.mode = "manual"; hooks.notice && hooks.notice("manual"); }
    }
  }
  ed.dirty = true;
  hooks.changed(opts);
}

export function undo() {
  const ed = state.ed;
  if (!ed.history.length) return false;
  ed.future.push(JSON.stringify(ed.page));
  ed.page = JSON.parse(ed.history.pop());
  ed.dirty = true; ed.lastKey = null;
  hooks.changed({ full: true });
  return true;
}
export function redo() {
  const ed = state.ed;
  if (!ed.future.length) return false;
  ed.history.push(JSON.stringify(ed.page));
  ed.page = JSON.parse(ed.future.pop());
  ed.dirty = true; ed.lastKey = null;
  hooks.changed({ full: true });
  return true;
}

// ---------- block operations ----------
export function insertBlock(id, index, init) {
  const ed = state.ed;
  const b = { ...newBlock(id, ed.lang), ...(init || {}) };
  const at = Math.max(0, Math.min(index ?? curBlocks().length, curBlocks().length));
  mutate(() => { curBlocks().splice(at, 0, b); });
  ed.sel = at;
  hooks.changed({ full: true, selectOnly: true });
  return at;
}
export function moveBlock(from, toBefore) {
  const ed = state.ed;
  const list = curBlocks();
  if (from < 0 || from >= list.length) return;
  let to = toBefore;
  if (to > from) to -= 1;
  if (to === from || toBefore === from + 1 && to === from) return;
  mutate(() => { const [b] = list.splice(from, 1); list.splice(to, 0, b); });
  ed.sel = to;
}
export function deleteBlock(i) {
  const ed = state.ed;
  mutate(() => { curBlocks().splice(i, 1); });
  ed.sel = curBlocks().length ? Math.min(i, curBlocks().length - 1) : null;
}
export function duplicateBlock(i) {
  const ed = state.ed;
  mutate(() => { curBlocks().splice(i + 1, 0, clone(curBlocks()[i])); });
  ed.sel = i + 1;
}
export function setField(i, path, value, opts = {}) {
  mutate(() => { setPath(curBlocks()[i], path, value); }, opts);
}

// ---------- text helpers ----------
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

// Reduce whatever a contenteditable produced to the tiny HTML subset the site allows.
export function sanitizeInline(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const out = [];
  const walk = (node) => {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out.push(escText(n.nodeValue)); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === "br") { out.push("<br>"); continue; }
      if (tag === "a") {
        const href = n.getAttribute("href");
        if (href && !/^\s*javascript:/i.test(href)) { out.push(`<a href="${escAttr(href)}">`); walk(n); out.push("</a>"); } else walk(n);
        continue;
      }
      if (tag === "strong" || tag === "b") { out.push("<strong>"); walk(n); out.push("</strong>"); continue; }
      if (tag === "em" || tag === "i") { out.push("<em>"); walk(n); out.push("</em>"); continue; }
      if (tag === "div" || tag === "p") { if (out.length && !/<br>$/.test(out[out.length - 1])) out.push("<br>"); walk(n); continue; }
      walk(n);
    }
  };
  walk(tpl.content);
  return out.join("").replace(/ /g, " ").replace(/(<br>)+$/g, "").replace(/\s+/g, " ").trim();
}

export const plainText = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();

export function humanizeFilename(name) {
  return String(name || "").replace(/\.[a-z0-9]+$/i, "").replace(/-\d+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
}

// first sentence-ish chunk of the page text, for the automatic meta description
export function autoDescription(t, max = 155) {
  const first = (t.blocks || []).find((b) => b.type === "text" && plainText(b.html).length > 40);
  const txt = first ? plainText(first.html) : (t.lead || "");
  if (txt.length <= max) return txt;
  const cut = txt.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).replace(/[,.;:\s-]+$/, "") + "…";
}

export function ytId(v) {
  const m = String(v).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{6,})/);
  return m ? m[1] : String(v).trim();
}

export const siteLanguages = () => siteLangs();
