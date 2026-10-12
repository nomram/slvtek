// Visual page editor (assembly): layout, top bar, wiring between model, canvas and panels, save.
import {
  state, $, $$, esc, clone, toast, setStatus, views, defLang, siteLangs, langLabel, titleOf, writeJson, pagePathToFile, savedMessage, debounce
} from "./core.js";
import { t } from "./lang.js";
import * as M from "./editor-model.js";
import * as C from "./editor-canvas.js";
import * as P from "./editor-panels.js";
import * as T from "./editor-translate.js";
import { pickImage, pickDoc, pickLink, uploadImage, uploadDoc } from "./pickers.js";
import * as ai from "./ai.js";
import { units } from "./translatable.mjs";

const app = $("#app");
const FIRST_FIELD = { text: "html", heading: "text", list: "items.0", cta: "title", button: "text", chips: "items.0" };
const draftKey = (p) => "bkcms.draft:" + p;
const basename = (s) => String(s || "").split("/").pop();

function currentDraft(path) {
  try { return JSON.parse(localStorage.getItem(draftKey(path)) || "null"); } catch { return null; }
}

// ---------- open ----------
export function openEditor(path, opts = {}) {
  const pg = state.pages.get(path);
  if (!pg && !opts.page) return toast(t("page_not_found"), "err");
  const page = clone(opts.page || pg.data);
  const src = M.srcLang(page);
  let restored = false;
  if (!opts.page) {
    const d = currentDraft(path);
    if (d && d.page && JSON.stringify(d.page) !== JSON.stringify(page) && confirm(t("restore_draft", { when: new Date(d.at).toLocaleString() }))) { Object.assign(page, d.page); restored = true; }
    else if (d) localStorage.removeItem(draftKey(path));
  }
  const lang = opts.lang && page.i18n[opts.lang] ? opts.lang : page.i18n[src] ? src : Object.keys(page.i18n)[0];
  state.views = "editor";
  state.ed = {
    page, file: opts.file || pg.file, isNew: !!opts.page, lang, sel: null, tab: opts.tab || "add", dirty: restored, addToParent: !!opts.addToParent,
    history: [], future: [], lastKey: null, lastAt: 0, device: "desktop",
    baseline: M.hashUnits(page.i18n[src] ? units(page, page.i18n[src]) : {})
  };
  document.body.classList.add("is-editor");
  buildShell();
  C.mount($("#ve-canvas"));
  renderAll();
  if (opts.toast) toast(opts.toast);
}

export function closeEditor() {
  document.body.classList.remove("is-editor");
  state.ed = null;
}

// ---------- shell ----------
function buildShell() {
  const ed = state.ed;
  app.innerHTML = `<div class="ve">
    <div class="ve__bar">
      <button class="btn ghost" id="ve-back">← ${esc(t("all_pages"))}</button>
      <div class="ve__title"><b id="ve-title"></b><span class="path" id="ve-path"></span></div>
      <div class="ve__langs" id="ve-langs" role="tablist"></div>
      <span class="ve__sp"></span>
      <div class="seg" id="ve-dev">
        <button data-dev="desktop" title="${esc(t("view_desktop"))}">${M.IC.desktop}</button>
        <button data-dev="tablet" title="${esc(t("view_tablet"))}">${M.IC.tablet}</button>
        <button data-dev="mobile" title="${esc(t("view_mobile"))}">${M.IC.mobile}</button>
      </div>
      <button class="iconbtn" id="ve-undo" title="${esc(t("undo"))} (Ctrl+Z)">${M.IC.undo}</button>
      <button class="iconbtn" id="ve-redo" title="${esc(t("redo"))} (Ctrl+Y)">${M.IC.redo}</button>
      ${!ed.isNew ? `<button class="btn danger" id="ve-del">${esc(t("delete_page"))}</button>` : ""}
      <span class="ve__state" id="ve-state"></span>
      <button class="btn primary" id="ve-save">${esc(ed.isNew ? t("create_page") : t("save"))}</button>
    </div>
    <div class="ve__body">
      <aside class="ve__side"><nav class="ve__tabs" id="ve-tabs"></nav><div class="ve__panel" id="ve-panel"></div></aside>
      <section class="ve__stage"><div class="ve__frame" id="ve-frame" data-device="desktop"><iframe id="ve-canvas" title="${esc(t("page_preview"))}"></iframe></div>
      <div class="ve__empty" id="ve-empty" hidden></div></section>
    </div></div>`;
  P.bindPanel($("#ve-panel"));
  $("#ve-tabs").onclick = (e) => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); };
  $("#ve-langs").onclick = (e) => { const b = e.target.closest("[data-l]"); if (b) switchLang(b.dataset.l); };
  $("#ve-dev").onclick = (e) => { const b = e.target.closest("[data-dev]"); if (b) { ed.device = b.dataset.dev; $("#ve-frame").dataset.device = ed.device; updateBar(); setTimeout(C.refreshOverlay, 80); } };
  $("#ve-undo").onclick = () => doUndo();
  $("#ve-redo").onclick = () => doRedo();
  $("#ve-save").onclick = () => save();
  $("#ve-back").onclick = () => { if (ed.dirty && !confirm(t("discard_changes"))) return; closeEditor(); views.pages(); };
  if ($("#ve-del")) $("#ve-del").onclick = () => deletePage();
  $("#ve-empty").onclick = (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tr) translateLang(b.dataset.tr, { all: true });
    if (b.dataset.empty) createEmpty(b.dataset.empty);
  };
}

function updateBar() {
  const ed = state.ed; if (!ed) return;
  const tr = M.curT();
  $("#ve-title").textContent = (tr && (tr.h1 || tr.title)) || ed.page.path;
  $("#ve-path").textContent = ed.page.path;
  $("#ve-state").textContent = ed.dirty ? t("unsaved") : ed.isNew ? "" : t("saved_state");
  $("#ve-state").className = "ve__state" + (ed.dirty ? " dirty" : "");
  $("#ve-undo").disabled = !ed.history.length;
  $("#ve-redo").disabled = !ed.future.length;
  $$("#ve-dev [data-dev]").forEach((b) => b.classList.toggle("is-on", b.dataset.dev === ed.device));
  $("#ve-langs").innerHTML = siteLangs().map((l) => {
    const st = M.langStatus(ed.page, l, ed.baseline);
    const cls = st.key + (st.stale ? " stale" : "");
    return `<button role="tab" data-l="${esc(l)}" class="${l === ed.lang ? "is-on" : ""} ${esc(cls)}" title="${esc(langLabel(l))} – ${esc(t("st_" + st.key))}${st.stale ? " – " + esc(t("st_stale", { n: st.stale })) : ""}">` +
      `<img src="/assets/flags/${esc(l)}.svg" alt="" width="20" height="14"><span>${esc(l.toUpperCase())}</span><i class="dot"></i></button>`;
  }).join("");
}

function renderPanelNow() {
  P.renderTabs($("#ve-tabs"));
  P.renderPanel($("#ve-panel"));
  P.updateSeoCounters();
}

function renderStage() {
  const ed = state.ed;
  const tr = M.curT();
  const empty = $("#ve-empty");
  if (tr) { empty.hidden = true; $("#ve-frame").hidden = false; C.render({ keepScroll: false }); return; }
  $("#ve-frame").hidden = true;
  empty.hidden = false;
  const ready = T.aiReady();
  empty.innerHTML = `<div class="ve__emptyc"><h2>${esc(t("no_version_title", { lang: langLabel(ed.lang) }))}</h2>
    <p class="muted">${esc(t("no_version_text", { src: langLabel(M.srcLang(ed.page)) }))}</p>
    <p><button class="btn primary" data-tr="${esc(ed.lang)}" ${ready ? "" : "disabled"}>${M.IC.sparkle}<span>${esc(t("translate_ai"))}</span></button>
    <button class="btn ghost" data-empty="${esc(ed.lang)}">${esc(t("create_empty"))}</button></p>
    ${ready ? "" : `<p class="muted">${esc(t("ai_not_configured"))}</p>`}</div>`;
}

function renderAll() {
  updateBar();
  renderPanelNow();
  renderStage();
}

// ---------- model hook ----------
const saveDraft = debounce(() => {
  const ed = state.ed; if (!ed || !ed.dirty) return;
  try { localStorage.setItem(draftKey(ed.page.path), JSON.stringify({ at: Date.now(), page: ed.page })); } catch { /* quota */ }
}, 1500);

M.hooks.changed = (opts = {}) => {
  const ed = state.ed; if (!ed) return;
  updateBar();
  saveDraft();
  if (opts.render === false) {
    C.refreshOverlay();
    if (!$("#ve-panel").contains(document.activeElement)) { renderPanelNow(); } else P.updateSeoCounters();
    return;
  }
  C.render({ keepScroll: true });
  if (!opts.noPanel) renderPanelNow(); else P.updateSeoCounters();
};
M.hooks.notice = (what) => { if (what === "manual") toast(t("manual_edit_notice")); };

// ---------- actions ----------
function setTab(tab) {
  state.ed.tab = tab;
  renderPanelNow();
}
function switchLang(l) {
  const ed = state.ed;
  ed.lang = l; ed.sel = null;
  renderAll();
}
function doUndo() { if (M.undo()) toast(t("undone"), "ok", 1200); }
function doRedo() { if (M.redo()) toast(t("redone"), "ok", 1200); }

async function insertNew(id, index) {
  const ed = state.ed;
  if (!M.curT()) return;
  const at = index ?? (ed.sel != null ? ed.sel + 1 : M.curBlocks().length);
  let init;
  if (id === "image") {
    const src = await pickImage();
    if (!src) return;
    init = { src, alt: M.humanizeFilename(basename(src)) };
  } else if (id === "download") {
    const href = await pickDoc();
    if (!href) return;
    init = { href, text: M.humanizeFilename(basename(href)) };
  } else if (id === "cards") {
    const here = ed.page.path;
    const kids = [...state.pages.keys()].filter((k) => k !== "/" && (k.split("/").slice(0, -1).join("/") || "/") === here)
      .sort((a, b) => (state.pages.get(a).data.order ?? 999) - (state.pages.get(b).data.order ?? 999));
    init = { items: kids.map((k) => { const h = state.pages.get(k).data.hero; return { href: k, ...(h && h.image ? { image: h.image } : {}) }; }) };
    if (kids.length) toast(t("n_added", { n: kids.length }));
  }
  const i = M.insertBlock(id, at, init);
  const f = FIRST_FIELD[id];
  if (f) C.focusField(i, f, "start");
  ed.tab = "block";
  renderPanelNow();
}

async function handleFiles(files, index) {
  let at = index;
  for (const f of files) {
    try {
      if (f.type.startsWith("image/")) {
        setStatus(t("uploading"));
        const src = await uploadImage(f);
        M.insertBlock("image", at++, { src, alt: M.humanizeFilename(f.name) });
        toast(t("image_uploaded"));
      } else if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        const href = await uploadDoc(f);
        M.insertBlock("download", at++, { href, text: M.humanizeFilename(f.name) });
        toast(t("pdf_uploaded"));
      } else toast(t("unsupported_file", { name: f.name }), "err");
    } catch (e) { toast(t("upload_failed") + ": " + e.message, "err", 7000); }
  }
  setStatus(state.backend.label);
}

function openInsertMenu(index, anchor) {
  $$(".insmenu").forEach((m) => m.remove());
  const frame = $("#ve-canvas").getBoundingClientRect();
  const x = anchor.inFrame ? frame.left + anchor.x : anchor.x;
  const y = anchor.inFrame ? frame.top + anchor.y : anchor.y;
  const menu = document.createElement("div");
  menu.className = "insmenu";
  menu.innerHTML = `<div class="insmenu__h">${esc(t("insert_here"))}</div><div class="insmenu__g">${M.BLOCK_TYPES.map((b) =>
    `<button data-id="${b.id}">${M.IC[b.id]}<span>${esc(t("block_" + b.id))}</span></button>`).join("")}</div>`;
  document.body.appendChild(menu);
  const w = 360;
  menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + "px";
  const h = menu.offsetHeight;
  menu.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y + 18)) + "px";
  const close = () => { menu.remove(); document.removeEventListener("mousedown", away, true); document.removeEventListener("keydown", esc2, true); };
  const away = (e) => { if (!menu.contains(e.target)) close(); };
  const esc2 = (e) => { if (e.key === "Escape") close(); };
  setTimeout(() => { document.addEventListener("mousedown", away, true); document.addEventListener("keydown", esc2, true); }, 0);
  menu.onclick = (e) => { const b = e.target.closest("[data-id]"); if (b) { close(); insertNew(b.dataset.id, index); } };
}

// ---------- translation ----------
async function translateLang(l, { all = false } = {}) {
  const ed = state.ed, p = ed.page;
  if (!T.aiReady()) return toast(t("ai_not_configured"), "err");
  const st = M.langStatus(p, l, ed.baseline);
  if (st.key === "manual" && !confirm(t("confirm_overwrite_manual", { lang: langLabel(l) }))) return;
  if (all && p.i18n[l] && st.key !== "manual" && st.key !== "missing" && !st.stale && !confirm(t("confirm_retranslate", { lang: langLabel(l) }))) return;
  M.mutate(() => {}, { scope: "page", render: false });
  const res = await T.translateWithProgress(p, [{ lang: l, all: all || !p.i18n[l] }], { baseline: ed.baseline });
  T.reportResult(res);
  ed.dirty = true;
  if (!ed.lang || !p.i18n[ed.lang]) ed.lang = l;
  renderAll();
}

function createEmpty(l) {
  const ed = state.ed, p = ed.page, src = p.i18n[M.srcLang(p)];
  M.mutate((pg) => {
    pg.i18n[l] = { ...clone(src), published: true };
    pg.i18nMeta = pg.i18nMeta || {};
    pg.i18nMeta[l] = { mode: "manual", from: M.srcLang(pg), at: new Date().toISOString() };
  }, { scope: "page", render: false });
  ed.lang = l;
  renderAll();
  toast(t("copy_created"));
}

function markReviewed(l) {
  M.mutate((pg) => {
    pg.i18nMeta = pg.i18nMeta || {};
    const m = (pg.i18nMeta[l] = pg.i18nMeta[l] || { from: M.srcLang(pg), at: new Date().toISOString() });
    m.mode = "reviewed"; m.reviewedAt = new Date().toISOString();
    if (pg.i18n[l]) delete pg.i18n[l].noindex;
  }, { scope: "page", render: false });
  renderAll();
  toast(t("marked_reviewed"));
}

async function describeWithAi() {
  if (!T.aiReady()) return toast(t("ai_not_configured"), "err");
  const ed = state.ed, tr = M.curT();
  const text = (tr.blocks || []).map((b) => M.plainText(b.html || b.text || (b.items || []).map((i) => (typeof i === "string" ? i : i.text || "")).join(" "))).join(" ");
  try {
    setStatus(t("ai_working"));
    const d = await ai.suggestDescription(state.ai, { lang: ed.lang, title: tr.h1 || tr.title, text });
    if (d) { M.mutate(() => { tr.description = d; }, { render: false }); renderPanelNow(); toast(t("suggestion_applied")); }
  } catch (e) { toast(t("ai_failed") + ": " + e.message, "err", 8000); }
  setStatus(state.backend.label);
}
async function altWithAi(i) {
  if (!T.aiReady()) return toast(t("ai_not_configured"), "err");
  const ed = state.ed, tr = M.curT(), b = tr.blocks[i];
  const near = tr.blocks.slice(Math.max(0, i - 2), i + 3).map((x) => M.plainText(x.html || x.text || "")).join(" ");
  try {
    setStatus(t("ai_working"));
    const alt = await ai.suggestAlt(state.ai, { lang: ed.lang, filename: basename(b.src), pageTitle: tr.h1 || tr.title, context: near });
    if (alt) { M.setField(i, "alt", alt, { noPanel: false }); renderPanelNow(); }
  } catch (e) { toast(t("ai_failed") + ": " + e.message, "err", 8000); }
  setStatus(state.backend.label);
}

// ---------- wiring ----------
C.canvasHooks.onSelect = (i, o = {}) => {
  const ed = state.ed;
  const changed = ed.sel !== i;
  ed.sel = i;
  if (i != null && (o.open || (o.source === "canvas" && ed.tab !== "page"))) ed.tab = "block";
  if (changed || o.open) renderPanelNow();
  C.selectBlock(i, { scroll: !!o.scroll });
  if (o.image && i != null) { const b = M.curBlocks()[i]; if (b && b.type === "image") ed.tab = "block"; }
};
C.canvasHooks.onInsertMenu = openInsertMenu;
C.canvasHooks.onFiles = handleFiles;
C.canvasHooks.onNewBlock = (id, idx) => insertNew(id, idx);
C.canvasHooks.onLink = (current) => pickLink({ current, allowRemove: true });
C.canvasHooks.onUndo = doUndo;
C.canvasHooks.onRedo = doRedo;
C.canvasHooks.onSave = () => save();

P.panelHooks.insertNew = (id) => insertNew(id);
P.panelHooks.selectBlock = (i, o) => C.canvasHooks.onSelect(i, o);
P.panelHooks.setTab = setTab;
P.panelHooks.setLang = switchLang;
P.panelHooks.translate = translateLang;
P.panelHooks.createEmpty = createEmpty;
P.panelHooks.markReviewed = markReviewed;
P.panelHooks.openSettings = () => { if (state.ed.dirty && !confirm(t("discard_changes"))) return; closeEditor(); views.settings(); };
P.panelHooks.rerender = renderPanelNow;
P.panelHooks.describeWithAi = describeWithAi;
P.panelHooks.altWithAi = altWithAi;

document.addEventListener("keydown", (e) => {
  if (!state.ed || !document.body.classList.contains("is-editor")) return;
  const mod = e.ctrlKey || e.metaKey;
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select";
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  else if (!typing && mod && e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
  else if (!typing && mod && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); doRedo(); }
});

// ---------- save ----------
export async function save() {
  const ed = state.ed; if (!ed) return;
  const p = ed.page;
  const src = M.srcLang(p);
  const defTr = p.i18n[defLang()] || p.i18n[src];
  if (!defTr || !(defTr.title || defTr.h1)) return toast(t("need_title"), "err");
  const btn = $("#ve-save");
  btn.disabled = true;
  try {
    pruneEmpty(p);
    // 1) automatic translation of what changed (never touches manual/reviewed languages)
    if (T.policy().auto && T.aiReady() && p.autoTranslate !== false) {
      const plan = T.autoPlan(p, ed.baseline);
      if (plan.length) {
        const res = await T.translateWithProgress(p, plan, { baseline: ed.baseline });
        T.reportResult(res);
        if (res.cancelled) { btn.disabled = false; return; }
      }
    }
    // 2) remember what the untranslated-but-existing languages were based on
    const cur = units(p, p.i18n[src] || {});
    for (const l of Object.keys(p.i18n)) {
      if (l === src) continue;
      p.i18nMeta = p.i18nMeta || {};
      if (!p.i18nMeta[l]) p.i18nMeta[l] = { mode: "legacy", from: src, at: new Date().toISOString(), srcUnits: ed.baseline };
    }
    p.updated = new Date().toISOString().slice(0, 10);
    const cleaned = JSON.parse(JSON.stringify(p, (k, v) => (v === "" || v === null ? undefined : v)));
    if (ed.isNew && state.pages.has(p.path)) { btn.disabled = false; return toast(t("url_exists"), "err"); }
    setStatus(t("saving"));
    await writeJson(ed.file, cleaned, `CMS: ${ed.isNew ? "create" : "update"} ${p.path}`);
    if (ed.isNew && ed.addToParent && p.path !== "/") {
      const parent = p.path.split("/").slice(0, -1).join("/") || "/";
      const pp = state.pages.get(parent);
      if (pp) {
        const pt = pp.data.i18n[defLang()] || Object.values(pp.data.i18n)[0];
        let cb = [...(pt.blocks || [])].reverse().find((b) => b.type === "cards");
        if (!cb) { cb = { type: "cards", items: [] }; (pt.blocks = pt.blocks || []).push(cb); }
        if (!cb.items.some((i) => i.href === p.path)) cb.items.push({ href: p.path, ...(cleaned.hero && cleaned.hero.image ? { image: cleaned.hero.image } : {}) });
        await writeJson(pp.file, pp.data, `CMS: list ${p.path} on ${parent}`);
      }
    }
    state.pages.set(p.path, { file: ed.file, data: cleaned });
    if (!state.files.some((f) => f.path === ed.file)) state.files.push({ path: ed.file, size: 0 });
    try { localStorage.removeItem(draftKey(p.path)); } catch { /* ignore */ }
    ed.isNew = false; ed.dirty = false; ed.page = clone(cleaned);
    ed.baseline = M.hashUnits(units(ed.page, ed.page.i18n[src] || {}));
    setStatus(t("saved_state") + " ✓");
    toast(savedMessage(t));
    updateBar();
    renderPanelNow();
    if (!$("#ve-del") && !ed.isNew) buildShellKeepCanvas(); else C.render({ keepScroll: true });
  } catch (err) {
    toast(t("save_failed") + ": " + err.message, "err", 9000);
    setStatus(t("save_failed"));
  }
  btn.disabled = false;
}

// Drop blocks that were added but never filled in, so the public page has no holes.
function pruneEmpty(page) {
  const empty = (b) => {
    switch (b.type) {
      case "text": return !M.plainText(b.html);
      case "heading": return !String(b.text || "").trim();
      case "image": return !b.src;
      case "video": return !b.id;
      case "button": return b.kind === "download" ? !b.href : !b.text && !b.href;
      case "cards": return !(b.items || []).length;
      case "list": case "chips": return !(b.items || []).some((x) => String(x).trim());
      case "table": return !(b.rows || []).some((r) => r.some((c) => String(c).trim()));
      case "cta": return !b.title;
      case "columns": return !((b.left || []).length || (b.right || []).length);
      case "html": return !(b.html || "").trim();
      default: return false;
    }
  };
  for (const tr of Object.values(page.i18n || {})) {
    if (!tr.blocks) continue;
    const kept = tr.blocks.filter((b) => !empty(b));
    if (kept.length !== tr.blocks.length) tr.blocks = kept;
  }
  if (state.ed) state.ed.sel = null;
}

function buildShellKeepCanvas() {
  // after the first save of a new page the "delete" button should appear; simplest is to rebuild the bar
  const ed = state.ed;
  const sel = ed.sel, tab = ed.tab, lang = ed.lang, device = ed.device;
  buildShell();
  C.mount($("#ve-canvas"));
  ed.sel = sel; ed.tab = tab; ed.lang = lang; ed.device = device;
  $("#ve-frame").dataset.device = device;
  renderAll();
}

async function deletePage() {
  const ed = state.ed, p = ed.page;
  const refs = [...state.pages.values()].filter((x) => x.data.path !== p.path && JSON.stringify(x.data).includes(`"href":"${p.path}"`));
  if (!confirm(t("confirm_delete_page", { path: p.path, n: refs.length }))) return;
  try {
    for (const r of refs) {
      let changed = false;
      for (const tr of Object.values(r.data.i18n || {})) for (const b of tr.blocks || []) if (b.type === "cards") {
        const n = b.items.length; b.items = b.items.filter((i) => i.href !== p.path); if (b.items.length !== n) changed = true;
      }
      if (changed) await writeJson(r.file, r.data, `CMS: unlist ${p.path} from ${r.data.path}`);
    }
    await state.backend.remove(ed.file);
    state.pages.delete(p.path);
    toast(t("page_deleted") + " " + savedMessage(t));
    closeEditor();
    views.pages();
  } catch (err) { toast(t("delete_failed") + ": " + err.message, "err", 8000); }
}

// Create a draft page object for the "new page" wizard
export function newPageDraft({ parent, title, slugPart, kind, lang, sourceLang }) {
  const path = (parent === "/" ? "" : parent) + "/" + slugPart;
  const L = sourceLang || lang || defLang();
  const par = state.pages.get(parent);
  const hero = par && par.data.hero && par.data.hero.image ? { image: par.data.hero.image } : undefined;
  const siblings = [...state.pages.keys()].filter((k) => (k.split("/").slice(0, -1).join("/") || "/") === parent);
  const order = siblings.reduce((m, k) => Math.max(m, state.pages.get(k).data.order ?? 0), 0) + 10;
  const starter = {
    product: [{ type: "text", html: "" }, { type: "image", src: "", alt: "" }, { type: "heading", level: 2, text: "" }, { type: "text", html: "" }],
    brand: [{ type: "text", html: "" }, { type: "cards", items: [] }],
    page: [{ type: "text", html: "" }]
  }[kind] || [{ type: "text", html: "" }];
  const page = {
    path, template: kind === "brand" ? "brand" : kind === "product" ? "product" : "page", order, published: false, ...(hero ? { hero } : {}),
    ...(L !== defLang() ? { sourceLang: L } : {}),
    i18n: { [L]: { title, h1: title, description: "", blocks: starter } }
  };
  return { path, page, file: pagePathToFile(path) };
}
