// Visual editor canvas: the real page, rendered by the shared renderer in an iframe, with an
// editing layer on top (inline text editing, block toolbar, drag & drop, insert handles).
import { renderDocument } from "./render.mjs";
import { state, $, esc, defLang, SITE_ROOT } from "./core.js";
import { rewriteHtml } from "./basepath.mjs";
import { isHidden, visibleAncestor } from "./visibility.mjs";
import { t } from "./lang.js";
import {
  IC, curT, curBlocks, mutate, setField, moveBlock, deleteBlock, duplicateBlock, sanitizeInline, plainText, ytId, paletteId, hooks as modelHooks
} from "./editor-model.js";

// callbacks provided by editor.js
export const canvasHooks = {
  onSelect() {}, onInsertMenu() {}, onFiles() {}, onNewBlock() {}, onLink: async () => null, onUndo() {}, onRedo() {}, onSave() {}
};

let frame = null, doc = null, win = null, ov = null;
let hoverEl = null, selEl = null, tbEl = null, fmtEl = null, dropEl = null, plusEl = null, endEl = null;
let pendingFocus = null;
let hoverIdx = null;

// ---------- html for the iframe ----------
function buildCtx(lang) {
  const site = state.site, def = defLang();
  const pages = new Map();
  for (const [p, x] of state.pages) pages.set(p, x.data);
  pages.set(state.ed.page.path, state.ed.page);
  const urlStyle = site.urlStyle || "file";
  const urlFor = (p, l) => {
    const prefix = l === def ? "" : "/" + l;
    if (p === "/") return prefix ? prefix + "/" : "/";
    const u = prefix + p.split("/").map((s) => (s ? encodeURIComponent(s) : s)).join("/");
    return urlStyle === "directory" ? u + "/" : u;
  };
  const kids = (p) => [...pages.keys()].filter((k) => k !== "/" && (k.split("/").slice(0, -1).join("/") || "/") === p)
    .sort((a, b) => (pages.get(a).order ?? 999) - (pages.get(b).order ?? 999) || a.localeCompare(b));
  const mf = state.manifest || { images: {}, docs: {} };
  const labels = {};
  for (const id of ["image", "video", "carousel", "modules", "cards", "table", "datasheet", "chips", "cta", "html", "list"]) labels[id] = t("empty_" + id);
  return {
    site: { ...site, languages: Object.fromEntries(Object.entries(site.languages).map(([c, l]) => [c, { ...l, published: true }])) },
    lang, defaultLang: def, ui: { ...(state.ui[def] || {}), ...(state.ui[lang] || {}) }, pages,
    url: (p, l = lang) => urlFor(p, l), abs: (u) => site.origin + u,
    tr: (p, l) => { const pg = pages.get(p); return pg && pg.i18n ? pg.i18n[l] || null : null; },
    hidden: (p, l = lang) => isHidden(pages, p, l, def),
    visibleAncestor: (p, l = lang) => visibleAncestor(pages, p, l, def),
    children: kids,
    image: (src) => (state.pending.has(src) ? null : mf.images[src] || null),
    fileSize: (h) => (mf.docs[h] && mf.docs[h].size) || null,
    docInfo: (h) => mf.docs[h] || null,
    edit: true, editLabels: labels
  };
}

const EDIT_CSS = `
html{scroll-behavior:auto!important}
.callbar{display:none!important}
.site-header{position:static!important}
[data-bk-field],[data-bk-page]{outline:none;cursor:text;min-width:2ch;border-radius:2px;transition:box-shadow .12s}
[data-bk-field]:hover,[data-bk-page]:hover{box-shadow:0 0 0 2px rgba(243,125,3,.4)}
[data-bk-field]:focus,[data-bk-page]:focus{box-shadow:0 0 0 2px #f37d03;background:rgba(243,125,3,.06)}
[data-bk-field]:empty::before{content:attr(data-bk-ph);opacity:.4}
.bk-empty{border:2px dashed #c9c3bb;margin:1rem 0;padding:1.4rem;text-align:center;color:#6b645e;font:600 14px/1.3 system-ui,sans-serif;background:rgba(255,255,255,.75);border-radius:8px}
#bk-ov{position:absolute;left:0;top:0;width:100%;height:0;z-index:2147483000;font:600 12px/1 system-ui,sans-serif;pointer-events:none}
#bk-ov [hidden]{display:none!important}
#bk-ov .bk-box{position:absolute;pointer-events:none;border-radius:4px}
#bk-ov .bk-hover{outline:2px dashed rgba(243,125,3,.7);outline-offset:2px}
#bk-ov .bk-sel{outline:2px solid #f37d03;outline-offset:2px;background:rgba(243,125,3,.04)}
#bk-ov .bk-tb{position:absolute;display:flex;gap:2px;align-items:center;background:#231f20;color:#fff;border-radius:6px;padding:3px;pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,.3);white-space:nowrap}
#bk-ov .bk-tb button,#bk-ov .bk-fmt button{background:none;border:0;color:inherit;width:28px;height:26px;display:grid;place-items:center;border-radius:4px;cursor:pointer;padding:0}
#bk-ov .bk-tb button:hover,#bk-ov .bk-fmt button:hover{background:rgba(255,255,255,.18)}
#bk-ov .bk-tb .bk-h{cursor:grab}
#bk-ov .bk-tb .bk-l{padding:0 .5rem 0 .25rem;font-size:12px;opacity:.9}
#bk-ov .bk-tb svg,#bk-ov .bk-fmt svg{width:16px;height:16px}
#bk-ov .bk-fmt{position:absolute;display:flex;gap:2px;background:#231f20;color:#fff;border-radius:6px;padding:3px;pointer-events:auto;box-shadow:0 4px 14px rgba(0,0,0,.3)}
#bk-ov .bk-drop{position:absolute;height:4px;background:#f37d03;border-radius:2px;pointer-events:none;box-shadow:0 0 0 3px rgba(243,125,3,.25)}
#bk-ov .bk-plus{position:absolute;pointer-events:auto;height:0;border-top:2px solid rgba(243,125,3,.55)}
#bk-ov .bk-plus button{position:absolute;left:50%;top:-13px;margin-left:-13px;width:26px;height:26px;border-radius:50%;border:0;background:#f37d03;color:#231f20;display:grid;place-items:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);padding:0}
#bk-ov .bk-plus svg{width:16px;height:16px}
#bk-ov .bk-end{position:absolute;left:0;width:100%;display:flex;justify-content:center;pointer-events:none}
#bk-ov .bk-end button{pointer-events:auto;background:#fff;border:2px dashed #c9c3bb;color:#4d4640;border-radius:8px;padding:.7rem 1.2rem;font:600 14px system-ui,sans-serif;cursor:pointer;display:flex;gap:.5rem;align-items:center}
#bk-ov .bk-end button:hover{border-color:#f37d03;color:#231f20}
`;

export function canvasHtml() {
  const ed = state.ed;
  const tr = ed.page.i18n && ed.page.i18n[ed.lang];
  if (!tr) return "<!doctype html><p style='font:16px system-ui;padding:2rem'>–</p>";
  const ctx = buildCtx(ed.lang);
  let html = renderDocument(ctx, ed.page, tr);
  // use the stylesheet copy that ships with the CMS, so the canvas keeps working while the site rebuilds
  const css = new URL("site.css", import.meta.url).href;
  html = html.replace("<head>", `<head><base href="${SITE_ROOT}/" target="_blank">`)
    .replace(/href="\/css\/site\.css[^"]*"/, `href="${css}"`)
    .replace("</head>", `<style id="bk-edit-css">${EDIT_CSS}</style></head>`)
    .replace(/<script[\s\S]*?<\/script>/g, "");
  if (SITE_ROOT) html = rewriteHtml(html, SITE_ROOT);
  for (const [name, url] of state.pending) html = html.split(name).join(url);
  return html;
}

// ---------- geometry ----------
function blockIndices() {
  const set = new Set();
  doc.querySelectorAll("[data-bk-i]").forEach((el) => set.add(+el.dataset.bkI));
  return [...set].sort((a, b) => a - b);
}
function rectOf(i) {
  let l = Infinity, tp = Infinity, r = -Infinity, b = -Infinity;
  doc.querySelectorAll(`[data-bk-i="${i}"]`).forEach((el) => {
    const q = el.getBoundingClientRect();
    if (!q.width && !q.height) return;
    l = Math.min(l, q.left); tp = Math.min(tp, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
  });
  if (l === Infinity) return null;
  return { left: l + win.scrollX, top: tp + win.scrollY, width: r - l, height: b - tp };
}
function place(el, rect, pad = 0) {
  el.style.left = rect.left - pad + "px"; el.style.top = rect.top - pad + "px";
  el.style.width = rect.width + pad * 2 + "px"; el.style.height = rect.height + pad * 2 + "px";
}

// ---------- overlay ----------
function makeOverlay() {
  ov = doc.createElement("div");
  ov.id = "bk-ov";
  hoverEl = doc.createElement("div"); hoverEl.className = "bk-box bk-hover"; hoverEl.hidden = true;
  selEl = doc.createElement("div"); selEl.className = "bk-box bk-sel"; selEl.hidden = true;
  tbEl = doc.createElement("div"); tbEl.className = "bk-tb"; tbEl.hidden = true;
  fmtEl = doc.createElement("div"); fmtEl.className = "bk-fmt"; fmtEl.hidden = true;
  dropEl = doc.createElement("div"); dropEl.className = "bk-drop"; dropEl.hidden = true;
  plusEl = doc.createElement("div"); plusEl.className = "bk-plus"; plusEl.hidden = true;
  plusEl.innerHTML = `<button type="button" title="${esc(t("insert_here"))}">${IC.plus}</button>`;
  endEl = doc.createElement("div"); endEl.className = "bk-end";
  endEl.innerHTML = `<button type="button">${IC.plus}<span>${esc(t("add_content"))}</span></button>`;
  fmtEl.innerHTML = `<button data-c="bold" title="${esc(t("bold"))}">${IC.bold}</button><button data-c="italic" title="${esc(t("italic"))}">${IC.italic}</button><button data-c="link" title="${esc(t("link"))}">${IC.link}</button><button data-c="unlink" title="${esc(t("unlink"))}">${IC.unlink}</button>`;
  for (const e of [hoverEl, selEl, tbEl, fmtEl, dropEl, plusEl, endEl]) ov.appendChild(e);
  doc.body.appendChild(ov);

  // block toolbar actions
  tbEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-a]"); if (!b) return;
    const i = state.ed.sel; if (i == null) return;
    const a = b.dataset.a;
    if (a === "up" && i > 0) moveBlock(i, i - 1);
    else if (a === "down" && i < curBlocks().length - 1) moveBlock(i, i + 2);
    else if (a === "dup") duplicateBlock(i);
    else if (a === "del") { if (curBlocks()[i] && blockIsFilled(curBlocks()[i]) && !confirm(t("confirm_delete_block"))) return; deleteBlock(i); }
    else if (a === "cfg") canvasHooks.onSelect(i, { open: true });
  });
  tbEl.addEventListener("dragstart", (e) => {
    const i = state.ed.sel; if (i == null) return;
    e.dataTransfer.setData("application/x-bk-block", String(i));
    e.dataTransfer.effectAllowed = "move";
  });
  tbEl.addEventListener("dragend", hideDrop);
  plusEl.querySelector("button").addEventListener("click", () => {
    const r = plusEl.getBoundingClientRect();
    canvasHooks.onInsertMenu(+plusEl.dataset.index, { x: r.left + r.width / 2, y: r.top, inFrame: true });
  });
  endEl.querySelector("button").addEventListener("click", () => {
    const r = endEl.querySelector("button").getBoundingClientRect();
    canvasHooks.onInsertMenu(curBlocks().length, { x: r.left + r.width / 2, y: r.top, inFrame: true });
  });
  fmtEl.addEventListener("mousedown", (e) => e.preventDefault()); // keep the text selection
  fmtEl.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-c]"); if (!b) return;
    const c = b.dataset.c;
    if (c === "bold" || c === "italic") { doc.execCommand(c); return; }
    if (c === "unlink") { doc.execCommand("unlink"); return; }
    if (c === "link") {
      const sel = win.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0).cloneRange();
      const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      const existing = anchor && anchor.closest && anchor.closest("a");
      const href = await canvasHooks.onLink(existing ? existing.getAttribute("href") : "");
      if (href == null) return;
      sel.removeAllRanges(); sel.addRange(range);
      if (href === "") doc.execCommand("unlink"); else doc.execCommand("createLink", false, href);
      hideFmt();
    }
  });
}

function blockIsFilled(b) {
  if (b.type === "text") return !!plainText(b.html);
  if (b.type === "heading") return !!b.text;
  return true;
}

export function refreshOverlay() {
  if (!doc || !ov) return;
  const ed = state.ed;
  // selection box + toolbar
  if (ed.sel != null && rectOf(ed.sel)) {
    const r = rectOf(ed.sel);
    place(selEl, r, 3); selEl.hidden = false;
    const b = curBlocks()[ed.sel];
    const id = b ? paletteId(b) : "";
    tbEl.innerHTML = `<button class="bk-h" draggable="true" title="${esc(t("drag_to_move"))}">${IC.drag}</button><span class="bk-l">${esc(t("block_" + id))}</span>` +
      `<button data-a="up" title="${esc(t("move_up"))}">${IC.up}</button><button data-a="down" title="${esc(t("move_down"))}">${IC.down}</button>` +
      `<button data-a="dup" title="${esc(t("duplicate"))}">${IC.copy}</button><button data-a="del" title="${esc(t("delete"))}">${IC.trash}</button>`;
    tbEl.hidden = false;
    const top = r.top - 36;
    tbEl.style.top = (top < 4 ? r.top + 6 : top) + "px";
    tbEl.style.left = Math.max(4, r.left) + "px";
  } else { selEl.hidden = true; tbEl.hidden = true; }
  // hover box
  if (hoverIdx != null && hoverIdx !== ed.sel && rectOf(hoverIdx)) { place(hoverEl, rectOf(hoverIdx), 3); hoverEl.hidden = false; } else hoverEl.hidden = true;
  // "add content" button after the last block
  const idxs = blockIndices();
  const last = idxs.length ? rectOf(idxs[idxs.length - 1]) : null;
  const main = doc.getElementById("main");
  const mainBottom = main ? main.getBoundingClientRect().bottom + win.scrollY : 0;
  const y = Math.max(last ? last.top + last.height : 0, 0);
  endEl.style.top = (y ? Math.min(y + 12, Math.max(mainBottom - 70, y + 12)) : 0) + "px";
  endEl.hidden = false;
  const btn = endEl.querySelector("span");
  if (btn) btn.textContent = curBlocks().length ? t("add_content") : t("add_first");
}

function hideDrop() { if (dropEl) dropEl.hidden = true; }
function hideFmt() { if (fmtEl) fmtEl.hidden = true; }

function dropIndexAt(pageY) {
  const idxs = blockIndices();
  const rows = idxs.map((i) => ({ i, r: rectOf(i) })).filter((x) => x.r).sort((a, b) => a.r.top - b.r.top);
  for (const x of rows) if (x.r.top + x.r.height / 2 > pageY) return x.i;
  return curBlocks().length;
}
function showDropAt(index) {
  const rows = blockIndices();
  let top;
  if (index >= curBlocks().length || !rectOf(index)) {
    const lastI = rows[rows.length - 1];
    const r = lastI != null ? rectOf(lastI) : null;
    top = r ? r.top + r.height + 6 : 40;
  } else top = rectOf(index).top - 8;
  const main = doc.getElementById("main");
  const mr = main ? main.getBoundingClientRect() : { left: 20, width: doc.documentElement.clientWidth - 40 };
  dropEl.style.top = top + "px"; dropEl.style.left = Math.max(10, mr.left + 16) + "px"; dropEl.style.width = Math.max(120, Math.min(mr.width, doc.documentElement.clientWidth) - 32) + "px";
  dropEl.hidden = false;
}

// ---------- selection / focus ----------
export function selectBlock(i, { scroll = false } = {}) {
  state.ed.sel = i;
  refreshOverlay();
  if (scroll && i != null) { const r = rectOf(i); if (r) win.scrollTo({ top: Math.max(0, r.top - 120), behavior: "smooth" }); }
}

// Focus is applied after the next canvas render (the element may not exist yet).
export function focusField(i, field, caret = "end") {
  pendingFocus = { i, field, caret };
}
function applyPendingFocus() {
  if (!pendingFocus || !doc) return;
  const { i, field, caret } = pendingFocus;
  const el = doc.querySelector(`[data-bk-i="${i}"][data-bk-field="${field}"]`) || doc.querySelector(`[data-bk-i="${i}"] [data-bk-field="${field}"]`);
  if (!el) return;
  pendingFocus = null;
  el.focus();
  const r = doc.createRange();
  r.selectNodeContents(el);
  r.collapse(caret === "start");
  const s = win.getSelection(); s.removeAllRanges(); s.addRange(r);
  const rr = el.getBoundingClientRect();
  if (rr.top < 80 || rr.bottom > win.innerHeight - 40) win.scrollTo({ top: Math.max(0, rr.top + win.scrollY - 160) });
}

// ---------- field sync ----------
function readField(el) {
  return el.dataset.bkKind === "inline" ? sanitizeInline(el.innerHTML) : el.textContent.replace(/[\r\n]+/g, " ");
}
function syncField(el) {
  const val = readField(el);
  if (el.dataset.bkPage) {
    const key = el.dataset.bkPage;
    mutate(() => { curT()[key] = val; }, { coalesce: "pf:" + key, render: false });
    return;
  }
  const blk = el.closest("[data-bk-i]");
  if (!blk) return;
  const i = +blk.dataset.bkI, field = el.dataset.bkField;
  setField(i, field, val, { coalesce: `f:${i}:${field}`, render: false });
}

function fieldCtx(el) {
  const blk = el.closest("[data-bk-i]");
  if (!blk) return null;
  const i = +blk.dataset.bkI;
  return { i, field: el.dataset.bkField, block: curBlocks()[i] };
}

function splitAtCaret(el) {
  const sel = win.getSelection();
  if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  r.deleteContents();
  const tail = doc.createRange();
  tail.selectNodeContents(el);
  tail.setStart(r.endContainer, r.endOffset);
  const holder = doc.createElement("div");
  holder.appendChild(tail.extractContents());
  return { head: sanitizeInline(el.innerHTML), tail: sanitizeInline(holder.innerHTML) };
}
const caretAtStart = (el) => {
  const sel = win.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = doc.createRange(); r.selectNodeContents(el); r.setEnd(sel.anchorNode, sel.anchorOffset);
  return r.toString().length === 0;
};

function onKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); canvasHooks.onUndo(); return; }
  if (mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); canvasHooks.onRedo(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); canvasHooks.onSave(); return; }
  const el = e.target.closest && e.target.closest("[data-bk-field],[data-bk-page]");
  if (!el) return;
  if (mod && e.key.toLowerCase() === "k" && el.dataset.bkKind === "inline") { e.preventDefault(); fmtEl.querySelector('[data-c="link"]').click(); return; }
  if (e.key === "Escape") { el.blur(); return; }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    const c = fieldCtx(el);
    if (el.dataset.bkKind !== "inline" || !c) { e.preventDefault(); el.blur(); return; }
    e.preventDefault();
    const parts = splitAtCaret(el);
    if (!parts) return;
    if (c.block.type === "text" && c.field === "html") {
      mutate(() => { c.block.html = parts.head; curBlocks().splice(c.i + 1, 0, { type: "text", html: parts.tail }); }, { render: false });
      state.ed.sel = c.i + 1;
      pendingFocus = { i: c.i + 1, field: "html", caret: "start" };
      modelHooks.changed({ full: true });
    } else if (c.block.type === "list" && /^items\.\d+$/.test(c.field)) {
      const j = +c.field.split(".")[1];
      mutate(() => { c.block.items[j] = parts.head; c.block.items.splice(j + 1, 0, parts.tail); }, { render: false });
      pendingFocus = { i: c.i, field: `items.${j + 1}`, caret: "start" };
      modelHooks.changed({ full: true });
    } else {
      syncField(el);
    }
    return;
  }
  if (e.key === "Backspace" && el.dataset.bkKind === "inline" && caretAtStart(el)) {
    const c = fieldCtx(el);
    if (!c) return;
    if (c.block.type === "list" && /^items\.\d+$/.test(c.field)) {
      const j = +c.field.split(".")[1];
      if (j > 0 && !plainText(el.innerHTML)) {
        e.preventDefault();
        mutate(() => { c.block.items.splice(j, 1); }, { render: false });
        pendingFocus = { i: c.i, field: `items.${j - 1}`, caret: "end" };
        modelHooks.changed({ full: true });
      }
    } else if (c.block.type === "text" && !plainText(el.innerHTML) && curBlocks().length > 1) {
      e.preventDefault();
      deleteBlock(c.i);
      const prev = c.i - 1;
      const pb = curBlocks()[prev];
      if (pb && pb.type === "text") pendingFocus = { i: prev, field: "html", caret: "end" };
      modelHooks.changed({ full: true });
    }
  }
}

function onPaste(e) {
  const el = e.target.closest && e.target.closest("[data-bk-field],[data-bk-page]");
  const cd = e.clipboardData;
  if (cd && cd.files && cd.files.length) {
    e.preventDefault();
    const c = el ? fieldCtx(el) : null;
    canvasHooks.onFiles([...cd.files], c ? c.i + 1 : curBlocks().length);
    return;
  }
  if (!el) return;
  e.preventDefault();
  const text = (cd.getData("text/plain") || "").replace(/\r/g, "");
  const c = fieldCtx(el);
  const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const insert = (s) => doc.execCommand("insertText", false, s);
  if (el.dataset.bkKind !== "inline" || !c) { insert(lines.join(" ")); return; }
  // YouTube link pasted into an empty paragraph -> video block
  if (c.block.type === "text" && lines.length === 1 && /(youtu\.be\/|youtube\.com\/(watch|embed|shorts))/.test(lines[0]) && !plainText(el.innerHTML)) {
    mutate(() => { curBlocks()[c.i] = { type: "video", provider: "youtube", id: ytId(lines[0]), title: "" }; }, { render: false });
    modelHooks.changed({ full: true });
    return;
  }
  // spreadsheet selection (tab separated) -> table block
  if (lines.length > 1 && lines.filter((l) => l.includes("\t")).length >= 2) {
    const rows = lines.map((l) => l.split("\t").map((x) => x.trim()));
    const w = Math.max(...rows.map((r) => r.length));
    mutate(() => { curBlocks().splice(c.i + 1, 0, { type: "table", header: true, rows: rows.map((r) => Array.from({ length: w }, (_, k) => r[k] || "")) }); }, { render: false });
    state.ed.sel = c.i + 1;
    modelHooks.changed({ full: true });
    return;
  }
  if (lines.length <= 1) { insert(lines[0] || ""); return; }
  if (c.block.type === "list" && /^items\.\d+$/.test(c.field)) {
    const j = +c.field.split(".")[1];
    mutate(() => { c.block.items.splice(j + 1, 0, ...lines.slice(1)); }, { render: false });
    insert(lines[0]);
    modelHooks.changed({ full: true });
    return;
  }
  if (c.block.type === "text") {
    if (lines.every((l) => /^[-•*–]\s+/.test(l))) {
      mutate(() => { curBlocks().splice(c.i + 1, 0, { type: "list", ordered: false, items: lines.map((l) => l.replace(/^[-•*–]\s+/, "")) }); }, { render: false });
      state.ed.sel = c.i + 1;
    } else {
      insert(lines[0]);
      syncField(el);
      mutate(() => { curBlocks().splice(c.i + 1, 0, ...lines.slice(1).map((l) => ({ type: "text", html: sanitizeInline(l.replace(/&/g, "&amp;").replace(/</g, "&lt;")) }))); }, { render: false });
    }
    modelHooks.changed({ full: true });
    return;
  }
  insert(lines.join(" "));
}

function updateFmt() {
  const sel = win.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) { hideFmt(); return; }
  const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
  const el = node && node.closest && node.closest('[data-bk-kind="inline"]');
  if (!el || !el.contains(doc.activeElement) && doc.activeElement !== el) { hideFmt(); return; }
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r.width || !r.height) { hideFmt(); return; }
  fmtEl.hidden = false;
  fmtEl.style.left = Math.max(4, r.left + win.scrollX + r.width / 2 - 62) + "px";
  fmtEl.style.top = Math.max(4, r.top + win.scrollY - 40) + "px";
}

function onMove(e) {
  const blk = e.target.closest && e.target.closest("[data-bk-i]");
  const idx = blk ? +blk.dataset.bkI : null;
  if (idx !== hoverIdx) { hoverIdx = idx; refreshOverlay(); }
  // "+" handle near block boundaries
  const y = e.clientY + win.scrollY;
  const rows = blockIndices().map((i) => ({ i, r: rectOf(i) })).filter((x) => x.r).sort((a, b) => a.r.top - b.r.top);
  let found = null;
  for (const x of rows) if (Math.abs(y - x.r.top) < 9) { found = { index: x.i, y: x.r.top - 8, r: x.r }; break; }
  if (found && e.clientX > 12) {
    plusEl.dataset.index = String(found.index);
    plusEl.style.top = found.y + "px";
    const main = doc.getElementById("main");
    const mr = main ? main.getBoundingClientRect() : { left: 20, width: doc.documentElement.clientWidth - 40 };
    plusEl.style.left = Math.max(10, mr.left + 16) + "px"; plusEl.style.width = Math.max(120, mr.width - 32) + "px";
    plusEl.hidden = false;
  } else if (!plusEl.matches(":hover")) plusEl.hidden = true;
}

function onClick(e) {
  if (e.target.closest("#bk-ov")) return;
  const a = e.target.closest("a");
  if (a || e.target.closest("summary,button,label")) e.preventDefault();
  const blk = e.target.closest("[data-bk-i]");
  if (blk) {
    const i = +blk.dataset.bkI;
    const isImg = !!e.target.closest("img") && !e.target.closest("[data-bk-field]");
    canvasHooks.onSelect(i, { source: "canvas", image: isImg });
  } else if (!e.target.closest("[data-bk-page]")) {
    canvasHooks.onSelect(null, { source: "canvas" });
  }
}

function onDragOver(e) {
  const types = [...(e.dataTransfer ? e.dataTransfer.types : [])];
  if (!(types.includes("application/x-bk-block") || types.includes("application/x-bk-new") || types.includes("Files"))) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = types.includes("application/x-bk-block") ? "move" : "copy";
  showDropAt(dropIndexAt(e.clientY + win.scrollY));
}
function onDrop(e) {
  const dt = e.dataTransfer;
  if (!dt) return;
  const types = [...dt.types];
  const known = types.includes("application/x-bk-block") || types.includes("application/x-bk-new") || types.includes("Files");
  if (!known) return;
  e.preventDefault();
  const idx = dropIndexAt(e.clientY + win.scrollY);
  hideDrop();
  if (types.includes("application/x-bk-block")) { moveBlock(+dt.getData("application/x-bk-block"), idx); return; }
  if (types.includes("application/x-bk-new")) { canvasHooks.onNewBlock(dt.getData("application/x-bk-new"), idx); return; }
  if (dt.files && dt.files.length) canvasHooks.onFiles([...dt.files], idx);
}

// ---------- lifecycle ----------
export function mount(frameEl) { frame = frameEl; }

export function render({ keepScroll = true, focus = null } = {}) {
  if (!frame) return;
  const scroll = keepScroll && doc && doc.documentElement ? doc.documentElement.scrollTop : 0;
  if (focus) pendingFocus = focus;
  const html = canvasHtml();
  frame.onload = () => {
    doc = frame.contentDocument; win = frame.contentWindow;
    if (!doc || !doc.body) return;
    attach();
    if (scroll) win.scrollTo(0, scroll);
    applyPendingFocus();
    refreshOverlay();
  };
  frame.srcdoc = html;
}

function attach() {
  const probe = doc.createElement("div");
  probe.contentEditable = "plaintext-only";
  const plainOk = probe.contentEditable === "plaintext-only";
  doc.querySelectorAll("[data-bk-field],[data-bk-page]").forEach((el) => {
    el.setAttribute("contenteditable", el.dataset.bkKind === "plain" && plainOk ? "plaintext-only" : "true");
    el.setAttribute("spellcheck", "true");
    el.setAttribute("lang", doc.documentElement.lang || "sv");
  });
  doc.querySelectorAll("a,img").forEach((el) => el.setAttribute("draggable", "false"));
  makeOverlay();
  doc.addEventListener("mousemove", onMove);
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKeydown, true);
  doc.addEventListener("paste", onPaste, true);
  doc.addEventListener("input", (e) => { const el = e.target.closest && e.target.closest("[data-bk-field],[data-bk-page]"); if (el) { syncField(el); refreshOverlay(); } });
  doc.addEventListener("focusin", (e) => {
    const blk = e.target.closest && e.target.closest("[data-bk-i]");
    if (blk && state.ed.sel !== +blk.dataset.bkI) canvasHooks.onSelect(+blk.dataset.bkI, { source: "focus" });
  });
  doc.addEventListener("selectionchange", updateFmt);
  doc.addEventListener("dragover", onDragOver);
  doc.addEventListener("drop", onDrop);
  doc.addEventListener("dragleave", (e) => { if (!e.relatedTarget) hideDrop(); });
  win.addEventListener("resize", refreshOverlay);
  win.addEventListener("scroll", () => { hideFmt(); }, { passive: true });
  try { new win.ResizeObserver(() => refreshOverlay()).observe(doc.documentElement); } catch { /* old browsers */ }
  doc.querySelectorAll("img").forEach((im) => { if (!im.complete) im.addEventListener("load", refreshOverlay, { once: true }); });
}

export const frameDoc = () => doc;
export const frameWin = () => win;
