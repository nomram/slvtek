// AI translation orchestration for the visual editor.
// Rules: the source language is never touched; languages edited by hand ("manual") or
// marked "reviewed" are skipped by automatic runs; only changed strings are re-translated.
import { state, esc, clone, defLang, siteLangs, langLabel, toast, $ } from "./core.js";
import { t } from "./lang.js";
import * as ai from "./ai.js";
import { visit, units, hash } from "./translatable.mjs";
import { srcLang, metaOf, hashUnits, langStatus, plainText } from "./editor-model.js";

export const aiReady = () => ai.isConfigured(state.ai);

export function policy() {
  const a = (state.site && state.site.ai) || {};
  return { auto: !!a.autoTranslate, targets: Array.isArray(a.targets) && a.targets.length ? a.targets : null, noindex: a.noindexUntilReviewed !== false };
}

// product / brand / model names the model must never translate
export function glossary(page) {
  const out = new Set(["Solvitek"]);
  for (const [p, x] of state.pages) {
    if (!p.startsWith("/productos/")) continue;
    const tr = x.data.i18n && (x.data.i18n[defLang()] || Object.values(x.data.i18n)[0]);
    const name = tr && (tr.h1 || tr.title);
    if (name && name.length <= 28) out.add(name);
  }
  return [...out].slice(0, 150);
}

// Languages an automatic run may touch for this page, with the reason
export function autoPlan(page, baseline) {
  const src = srcLang(page);
  const pol = policy();
  const wanted = new Set((pol.targets || siteLangs()).filter((l) => l !== src));
  if (src !== defLang()) wanted.add(defLang());
  const plan = [];
  for (const l of wanted) {
    const st = langStatus(page, l, baseline);
    if (st.key === "missing") plan.push({ lang: l, all: true });
    else if ((st.key === "auto" || st.key === "legacy") && st.stale > 0) plan.push({ lang: l, all: false });
  }
  return plan;
}

// Translate one language. Mutates page.i18n[l] and page.i18nMeta[l]. Returns stats.
export async function translateLanguage(page, l, { all = false, baseline = {}, signal, onProgress } = {}) {
  const src = srcLang(page);
  const S = page.i18n[src];
  if (!S) throw new Error("No source text in " + src);
  const prev = page.i18n[l];
  const meta = metaOf(page, l);
  const srcUnits = units(page, S);
  const base = (meta && meta.srcUnits) || baseline;
  const prevUnits = prev ? units(page, prev) : {};
  const keep = {};
  const need = [];
  for (const [id, text] of Object.entries(srcUnits)) {
    if (prev && !all && base[id] === hash(text) && prevUnits[id] !== undefined) keep[id] = prevUnits[id];
    else need.push(id);
  }
  const strings = need.map((id) => srcUnits[id]);
  const title = S.h1 || S.title || page.path;
  const { map, warnings } = strings.length
    ? await ai.translateStrings(state.ai, strings, {
      from: src, to: l, glossary: glossary(page), signal, onProgress,
      context: `Web page "${title}" (${page.path}).`
    })
    : { map: new Map(), warnings: [] };
  const next = clone(S);
  const P = page.path + "|";
  visit(page, next, (fullId, value, set) => {
    const id = fullId.slice(P.length);
    if (id in keep) set(keep[id]);
    else set(map.get(value) ?? value);
  });
  next.published = S.published === false ? false : true;
  if (S.noindex || policy().noindex) next.noindex = true; else delete next.noindex;
  page.i18n[l] = next;
  page.i18nMeta = page.i18nMeta || {};
  page.i18nMeta[l] = { mode: "auto", from: src, at: new Date().toISOString(), srcUnits: hashUnits(srcUnits) };
  return { translated: need.length, kept: Object.keys(keep).length, warnings };
}

// Run several languages with a progress dialog. plan: [{lang, all}]
export async function translateWithProgress(page, plan, { baseline = {}, title } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = "progress";
  dlg.innerHTML = `<h2>${esc(title || t("translating"))}</h2>
    <ul class="pg__list">${plan.map((p) => `<li data-l="${esc(p.lang)}"><span class="pg__name">${esc(langLabel(p.lang))}</span><span class="pg__state">${esc(t("waiting"))}</span><progress value="0" max="1"></progress></li>`).join("")}</ul>
    <p class="muted">${esc(t("translate_wait"))}</p><p><button class="btn ghost" id="pg-cancel">${esc(t("cancel"))}</button></p>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const ctl = new AbortController();
  $("#pg-cancel", dlg).onclick = () => ctl.abort();
  const result = { ok: [], failed: [], warnings: 0, cancelled: false };
  const row = (l) => dlg.querySelector(`[data-l="${l}"]`);
  try {
    for (const p of plan) {
      const r = row(p.lang);
      r.querySelector(".pg__state").textContent = t("translating");
      try {
        const out = await translateLanguage(page, p.lang, {
          all: p.all, baseline, signal: ctl.signal,
          onProgress: (d, n) => { const pr = r.querySelector("progress"); pr.max = n || 1; pr.value = d; }
        });
        r.querySelector(".pg__state").textContent = out.translated ? t("done_n", { n: out.translated }) : t("up_to_date");
        r.querySelector("progress").value = r.querySelector("progress").max;
        result.ok.push(p.lang); result.warnings += out.warnings.length;
      } catch (e) {
        if (e && e.name === "AbortError") { result.cancelled = true; r.querySelector(".pg__state").textContent = t("cancelled"); break; }
        r.querySelector(".pg__state").textContent = t("failed") + ": " + (e.message || e);
        result.failed.push({ lang: p.lang, error: e.message || String(e) });
      }
    }
  } finally {
    await new Promise((res) => setTimeout(res, result.failed.length ? 1800 : 500));
    dlg.close(); dlg.remove();
  }
  return result;
}

// Words-to-pay estimate shown before a big run (rough, for the "are you sure" hint)
export function wordCount(page) {
  const S = page.i18n[srcLang(page)];
  return Object.values(units(page, S)).reduce((n, s) => n + plainText(s).split(" ").filter(Boolean).length, 0);
}

export function reportResult(res) {
  if (res.cancelled) return toast(t("translate_cancelled"), "err");
  if (res.failed.length) return toast(t("translate_failed", { error: res.failed[0].error }), "err", 9000);
  if (res.warnings) return toast(t("translate_warnings", { n: res.warnings }), "ok", 7000);
  if (res.ok.length) toast(t("translate_done"));
}
