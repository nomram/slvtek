// Translation review round-trip: export the translations as JSON for a second opinion from another
// LLM (or a human translator), then import the checked file back. Nothing is written until the
// changes have been looked at and applied.
import { state, $, esc, toast, setStatus, siteLangs, defLang, langLabel, titleOf, writeJson, savedMessage } from "./core.js";
import { t } from "./lang.js";
import { visit, units } from "./translatable.mjs";
import { srcLang, metaOf, hashUnits, langStatus } from "./editor-model.js";
import { glossary } from "./editor-translate.js";

const FORMAT = "solvitek-translation-review/1";
const LETTERS = /[A-Za-zÅÄÖåäöÉéÑñÆØæø]{3,}/;
// HTML tags of a string, order-independent: a translation may move <strong>, but not drop <a href>
const tagsOf = (s) => (String(s).match(/<\/?[a-z][^>]*>/gi) || []).map((x) => x.replace(/\s+/g, " ").toLowerCase()).sort().join("");
const plain = (s) => String(s).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const clip = (s, n = 160) => (plain(s).length > n ? plain(s).slice(0, n - 1) + "…" : plain(s));

const INSTRUCTIONS = (src, dst) =>
  `You are a professional translator and proofreader for the website of a Swedish distributor of construction equipment ` +
  `(concrete pumps, rock drills, slope stabilisation, shotcrete, building materials). For every entry in "units" and "ui" ` +
  `check that "target" is an accurate, natural and correctly spelled ${dst} translation of the ${src} "source", and correct "target" where it is not. ` +
  `Rules: 1) Never change "id" or "source". 2) Keep HTML tags exactly as they are (<a href="...">, <strong>, <em>, <br>); ` +
  `translate only the text between them. 3) Do not translate brand, product or model names (see "keepUntranslated"). ` +
  `4) Keep numbers, units and measurements exact. 5) Use a professional, concise tone suited to B2B customers. ` +
  `6) Return the complete JSON in exactly the same structure and nothing else (no commentary, no code fences). ` +
  `If something in the source looks wrong, leave "target" as your best translation and add a short "note" to that entry.`;

// ---------- export ----------
function collectUnits(lang, scope) {
  const rows = [];
  const pages = [...state.pages.values()].map((x) => x.data).sort((a, b) => a.path.localeCompare(b.path, "es"));
  const def = defLang();
  for (const page of pages) {
    const src = srcLang(page);
    const S = page.i18n && page.i18n[src], T = page.i18n && page.i18n[lang];
    if (!S || !T || src === lang) continue;
    if (scope === "unchecked" && langStatus(page, lang, null).key === "reviewed") continue;
    const su = units(page, S), tu = units(page, T);
    for (const [id, source] of Object.entries(su)) {
      if (!LETTERS.test(source)) continue;
      rows.push({ id: `${page.path}|${id}`, page: titleOf(page.path), ...(src !== def ? { sourceLanguage: src } : {}), source, target: tu[id] ?? "" });
    }
  }
  return rows;
}

function uiUnits(lang) {
  const def = defLang();
  const S = state.ui[def] || {}, T = state.ui[lang] || {};
  return Object.fromEntries(Object.entries(S).filter(([, v]) => LETTERS.test(v)).map(([k, v]) => [k, { source: v, target: T[k] ?? "" }]));
}

function buildFiles(lang, { scope, includeUi, chunk }) {
  const def = defLang();
  const rows = collectUnits(lang, scope);
  const ui = includeUi ? uiUnits(lang) : null;
  const size = chunk > 0 ? chunk : rows.length || 1;
  const parts = [];
  for (let i = 0; i < Math.max(1, rows.length); i += size) parts.push(rows.slice(i, i + size));
  if (!rows.length && !ui) return [];
  return parts.map((units_, i) => ({
    format: FORMAT,
    createdAt: new Date().toISOString(),
    site: state.site.name || "",
    sourceLanguage: def, sourceLanguageName: langLabel(def),
    targetLanguage: lang, targetLanguageName: langLabel(lang),
    part: i + 1, parts: parts.length,
    instructions: INSTRUCTIONS(langLabel(def), langLabel(lang)),
    keepUntranslated: glossary(),
    ...(ui && i === 0 ? { ui } : {}),
    units: units_
  }));
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- import ----------
function parseFiles(texts) {
  const files = [];
  const problems = [];
  texts.forEach((txt, i) => {
    let j;
    try { j = JSON.parse(txt); } catch { problems.push(t("rv_bad_json", { n: i + 1 })); return; }
    if (!j || j.format !== FORMAT || !Array.isArray(j.units)) { problems.push(t("rv_bad_format", { n: i + 1 })); return; }
    if (!siteLangs().includes(j.targetLanguage) || j.targetLanguage === defLang()) { problems.push(t("rv_bad_lang", { n: i + 1, l: String(j.targetLanguage) })); return; }
    files.push(j);
  });
  return { files, problems };
}

// Compare the returned file with what is in the CMS now
function diff(files) {
  const changes = [];
  const stats = { same: 0, empty: 0, unknown: 0, files: files.length };
  const touched = new Map(); // "lang|path" -> true (pages the reviewer looked at)
  for (const f of files) {
    const lang = f.targetLanguage;
    for (const u of f.units) {
      if (!u || typeof u.id !== "string" || typeof u.target !== "string") { stats.unknown++; continue; }
      const cut = u.id.indexOf("|");
      const path = u.id.slice(0, cut), uid = u.id.slice(cut + 1);
      const entry = state.pages.get(path);
      const page = entry && entry.data;
      const T = page && page.i18n && page.i18n[lang];
      if (!T) { stats.unknown++; continue; }
      const S = page.i18n[srcLang(page)];
      const tu = units(page, T), su = units(page, S);
      if (!(uid in tu)) { stats.unknown++; continue; }
      touched.set(`${lang}|${path}`, true);
      const next = u.target.trim();
      if (!next) { stats.empty++; continue; }
      if (next === String(tu[uid]).trim()) { stats.same++; continue; }
      const warn = [];
      if (tagsOf(next) !== tagsOf(su[uid] ?? tu[uid])) warn.push(t("rv_warn_tags"));
      if (typeof u.source === "string" && su[uid] !== undefined && u.source.trim() !== String(su[uid]).trim()) warn.push(t("rv_warn_source"));
      changes.push({ kind: "page", lang, path, uid, old: tu[uid], next, source: su[uid] ?? "", warn, note: u.note || "" });
    }
    if (f.ui && typeof f.ui === "object") {
      const cur = state.ui[lang] || {};
      for (const [k, u] of Object.entries(f.ui)) {
        const next = u && typeof u.target === "string" ? u.target.trim() : "";
        if (!next) { stats.empty++; continue; }
        if (!(k in (state.ui[defLang()] || {}))) { stats.unknown++; continue; }
        if (next === String(cur[k] ?? "").trim()) { stats.same++; continue; }
        changes.push({ kind: "ui", lang, key: k, old: cur[k] ?? "", next, source: (state.ui[defLang()] || {})[k] || "", warn: tagsOf(next) !== tagsOf((state.ui[defLang()] || {})[k] || "") ? [t("rv_warn_tags")] : [], note: u.note || "" });
      }
    }
  }
  return { changes, stats, touched };
}

async function apply(changes, touched, markReviewed) {
  const byPage = new Map();
  const uiByLang = new Map();
  for (const c of changes) {
    if (c.kind === "ui") { (uiByLang.get(c.lang) || uiByLang.set(c.lang, {}).get(c.lang))[c.key] = c.next; continue; }
    const k = `${c.lang}|${c.path}`;
    if (!byPage.has(k)) byPage.set(k, { lang: c.lang, path: c.path, map: new Map() });
    byPage.get(k).map.set(c.uid, c.next);
  }
  // pages the reviewer covered but did not change are marked as well
  if (markReviewed) for (const k of touched.keys()) if (!byPage.has(k)) { const [lang, path] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)]; byPage.set(k, { lang, path, map: new Map() }); }
  const now = new Date().toISOString();
  let n = 0;
  for (const { lang, path, map } of byPage.values()) {
    const entry = state.pages.get(path);
    const page = entry.data;
    const T = page.i18n[lang], src = srcLang(page);
    const P = path + "|";
    if (map.size) visit(page, T, (fullId, v, set) => { const id = fullId.slice(P.length); if (map.has(id)) set(map.get(id)); });
    page.i18nMeta = page.i18nMeta || {};
    const prev = metaOf(page, lang) || { from: src };
    const srcUnits = hashUnits(units(page, page.i18n[src]));
    if (markReviewed) {
      page.i18nMeta[lang] = { ...prev, mode: "reviewed", from: src, at: prev.at || now, reviewedAt: now, reviewedBy: "external-review", srcUnits };
      delete T.noindex;
    } else if (map.size) {
      page.i18nMeta[lang] = { ...prev, mode: "manual", from: src, at: now, srcUnits };
    }
    await writeJson(entry.file, page, `CMS: reviewed ${lang} translation of ${path}`);
    n++;
    setStatus(t("rv_saving", { n, total: byPage.size }));
  }
  for (const [lang, patch] of uiByLang) {
    state.ui[lang] = { ...(state.ui[lang] || {}), ...patch };
    await writeJson(`content/ui/${lang}.json`, state.ui[lang], `CMS: reviewed ${lang} UI texts`);
  }
  return { pages: byPage.size, ui: [...uiByLang.values()].reduce((a, o) => a + Object.keys(o).length, 0) };
}

// ---------- view ----------
export function viewReview(app, navUI) {
  state.view = "review"; navUI(true); state.ed = null;
  const def = defLang();
  const targets = siteLangs().filter((l) => l !== def);
  const overview = targets.map((l) => {
    const c = { auto: 0, manual: 0, reviewed: 0, legacy: 0, missing: 0 };
    for (const x of state.pages.values()) { const k = langStatus(x.data, l, null).key; if (k in c) c[k]++; }
    return `<tr><td><b>${esc(langLabel(l))}</b></td><td>${c.reviewed}</td><td>${c.manual}</td><td>${c.auto + c.legacy}</td><td>${c.missing}</td></tr>`;
  }).join("");
  app.innerHTML = `<div class="wrap"><h1>${esc(t("nav_review"))}</h1>
  <p class="muted">${esc(t("rv_intro"))}</p>
  <div class="card"><h2>${esc(t("rv_overview"))}</h2>
    <table class="list"><thead><tr><th>${esc(t("rv_lang"))}</th><th>${esc(t("st_reviewed"))}</th><th>${esc(t("st_manual"))}</th><th>${esc(t("rv_unchecked_machine"))}</th><th>${esc(t("st_missing"))}</th></tr></thead><tbody>${overview}</tbody></table></div>
  <div class="card"><h2>1. ${esc(t("rv_export"))}</h2>
    <p class="muted">${esc(t("rv_export_hint"))}</p>
    <div class="row">
      <div><label>${esc(t("rv_lang"))}</label><select id="rv-lang">${targets.map((l) => `<option value="${esc(l)}">${esc(langLabel(l))}</option>`).join("")}</select></div>
      <div><label>${esc(t("rv_scope"))}</label><select id="rv-scope"><option value="unchecked">${esc(t("rv_scope_unchecked"))}</option><option value="all">${esc(t("rv_scope_all"))}</option></select></div>
      <div><label>${esc(t("rv_chunk"))}</label><select id="rv-chunk"><option value="0">${esc(t("rv_chunk_all"))}</option><option value="80">80 ${esc(t("rv_units"))}</option><option value="150" selected>150 ${esc(t("rv_units"))}</option><option value="300">300 ${esc(t("rv_units"))}</option></select></div>
    </div>
    <label class="chk"><input type="checkbox" id="rv-ui" checked> ${esc(t("rv_include_ui"))}</label>
    <p><button class="btn primary" id="rv-make">${esc(t("rv_make"))}</button></p>
    <div id="rv-parts"></div>
  </div>
  <div class="card"><h2>2. ${esc(t("rv_import"))}</h2>
    <p class="muted">${esc(t("rv_import_hint"))}</p>
    <input type="file" id="rv-files" accept=".json,application/json" multiple>
    <label>${esc(t("rv_paste"))}</label><textarea id="rv-paste" rows="4" class="mono" placeholder='{ "format": "${FORMAT}", … }'></textarea>
    <p><button class="btn primary" id="rv-read">${esc(t("rv_read"))}</button></p>
    <div id="rv-result"></div>
  </div></div>`;

  // ----- export
  $("#rv-make").onclick = () => {
    const lang = $("#rv-lang").value;
    const files = buildFiles(lang, { scope: $("#rv-scope").value, includeUi: $("#rv-ui").checked, chunk: +$("#rv-chunk").value });
    const box = $("#rv-parts");
    if (!files.length) { box.innerHTML = `<p class="muted">${esc(t("rv_nothing"))}</p>`; return; }
    const stamp = new Date().toISOString().slice(0, 10);
    const total = files.reduce((n, f) => n + f.units.length, 0);
    box.innerHTML = `<p><b>${esc(t("rv_ready", { n: total, p: files.length }))}</b></p><ul class="rv-parts">` +
      files.map((f, i) => `<li><span>${esc(t("rv_part", { i: i + 1, p: files.length }))} · ${f.units.length} ${esc(t("rv_units"))}${f.ui ? " + " + Object.keys(f.ui).length + " " + esc(t("rv_ui_texts")) : ""}</span>
        <button class="btn sm" data-dl="${i}">${esc(t("rv_download"))}</button> <button class="btn sm ghost" data-cp="${i}">${esc(t("rv_copy"))}</button></li>`).join("") + `</ul>
      <p class="muted">${esc(t("rv_next_step"))}</p>`;
    box.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = () => {
      const i = +b.dataset.dl;
      download(`translation-review-${lang}-${stamp}-part${i + 1}of${files.length}.json`, files[i]);
    }));
    box.querySelectorAll("[data-cp]").forEach((b) => (b.onclick = async () => {
      try { await navigator.clipboard.writeText(JSON.stringify(files[+b.dataset.cp], null, 2)); toast(t("rv_copied")); }
      catch { toast(t("rv_copy_failed"), "err"); }
    }));
  };

  // ----- import
  $("#rv-read").onclick = async () => {
    const texts = [];
    for (const f of $("#rv-files").files) texts.push(await f.text());
    const pasted = $("#rv-paste").value.trim();
    if (pasted) texts.push(pasted);
    const out = $("#rv-result");
    if (!texts.length) { out.innerHTML = `<p class="muted">${esc(t("rv_no_input"))}</p>`; return; }
    const { files, problems } = parseFiles(texts);
    const probHtml = problems.map((p) => `<p class="rv-warn">${esc(p)}</p>`).join("");
    if (!files.length) { out.innerHTML = probHtml; return; }
    const { changes, stats, touched } = diff(files);
    const langs = [...new Set(files.map((f) => f.targetLanguage))].map(langLabel).join(", ");
    const rows = changes.map((c, i) => `<tr class="${c.warn.length ? "is-warn" : ""}">
      <td><input type="checkbox" data-i="${i}" ${c.warn.length ? "" : "checked"} aria-label="${esc(t("rv_apply_this"))}"></td>
      <td>${c.kind === "ui" ? `<span class="chip">${esc(t("nav_translations"))}</span> <span class="path">${esc(c.key)}</span>` : `<b>${esc(titleOf(c.path))}</b><br><span class="path">${esc(c.uid)}</span>`}<br><span class="muted">${esc(langLabel(c.lang))}</span></td>
      <td class="rv-old">${esc(clip(c.old))}</td><td class="rv-new">${esc(clip(c.next))}${c.note ? `<br><em class="muted">${esc(c.note)}</em>` : ""}${c.warn.map((w) => `<br><span class="rv-warn">${esc(w)}</span>`).join("")}</td></tr>`).join("");
    out.innerHTML = `${probHtml}<p><b>${esc(t("rv_summary", { c: changes.length, same: stats.same, empty: stats.empty, unknown: stats.unknown, l: langs }))}</b></p>` +
      (changes.length ? `<table class="list rv-table"><thead><tr><th></th><th>${esc(t("rv_where"))}</th><th>${esc(t("rv_before"))}</th><th>${esc(t("rv_after"))}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">${esc(t("rv_warn_hint"))}</p>
      <label class="chk"><input type="checkbox" id="rv-mark" checked> ${esc(t("rv_mark_reviewed", { n: touched.size }))}</label>
      <p><button class="btn primary" id="rv-apply">${esc(t("rv_apply"))}</button> <button class="btn ghost" id="rv-all">${esc(t("rv_select_all"))}</button> <button class="btn ghost" id="rv-none">${esc(t("rv_select_none"))}</button></p>` :
        `<p class="muted">${esc(t("rv_no_changes"))}</p>` + (stats.same || touched.size ? `<label class="chk"><input type="checkbox" id="rv-mark" checked> ${esc(t("rv_mark_reviewed", { n: touched.size }))}</label><p><button class="btn primary" id="rv-apply">${esc(t("rv_mark_only"))}</button></p>` : ""));
    const boxes = () => [...out.querySelectorAll("input[data-i]")];
    if ($("#rv-all")) $("#rv-all").onclick = () => boxes().forEach((b) => (b.checked = true));
    if ($("#rv-none")) $("#rv-none").onclick = () => boxes().forEach((b) => (b.checked = false));
    if ($("#rv-apply")) $("#rv-apply").onclick = async () => {
      const chosen = boxes().filter((b) => b.checked).map((b) => changes[+b.dataset.i]);
      const mark = $("#rv-mark").checked;
      if (!chosen.length && !mark) return toast(t("rv_nothing_selected"), "err");
      $("#rv-apply").disabled = true;
      try {
        const r = await apply(chosen, touched, mark);
        toast(`${t("rv_done", { p: r.pages, u: r.ui })} ${savedMessage(t)}`);
        setStatus(t("saved_state") + " ✓");
        viewReview(app, navUI);
      } catch (e) {
        $("#rv-apply").disabled = false;
        toast(t("save_failed") + ": " + e.message, "err", 8000);
      }
    };
  };
}

// read-only handles for the end-to-end test (tools/test-cms.mjs)
if (typeof window !== "undefined" && window.__bkcms) window.__bkcms.review = { buildFiles, diff };
