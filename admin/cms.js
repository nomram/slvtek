// Hidden CMS: pages list, settings (incl. AI), UI texts, help, connect, boot.
// The visual page editor lives in editor.js.
import {
  state, $, $$, esc, toast, setStatus, views, slug, getPath, setPath, debounce, siteLangs, defLang, langLabel, titleOf,
  GitHubBackend, detectBackend, loadAll, writeJson, savedMessage
} from "./core.js";
import { t, setUiLang, uiLang, UI_LANGS } from "./lang.js";
import { openEditor, closeEditor, newPageDraft } from "./editor.js";
import * as ai from "./ai.js";
import { langStatus, srcLang } from "./editor-model.js";
import { isHidden } from "./visibility.mjs";
import { viewReview } from "./review.js";

const app = $("#app");

function navUI(on) {
  const nav = $("#nav");
  nav.hidden = !on;
  nav.querySelectorAll("button").forEach((b) => { b.textContent = t("nav_" + b.dataset.view); b.classList.toggle("is-on", b.dataset.view === state.view); });
  const sel = $("#ui-lang");
  if (sel) sel.value = uiLang();
}

// ---------- connect (GitHub mode) ----------
function viewConnect(msg) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem("bkcms.gh") || "{}"); } catch { return {}; } })();
  navUI(false);
  app.innerHTML = `<div class="wrap"><div class="card"><h1>${esc(t("connect_title"))}</h1>
  <p class="muted">${t("connect_text")}</p>
  ${msg ? `<p style="color:var(--bad)">${esc(msg)}</p>` : ""}
  <div class="row"><div><label>${esc(t("gh_owner"))}</label><input id="gh-owner" type="text" value="${esc(saved.owner || (state.site && state.site.github && state.site.github.owner) || "")}"></div>
  <div><label>${esc(t("gh_repo"))}</label><input id="gh-repo" type="text" value="${esc(saved.repo || "")}"></div>
  <div><label>${esc(t("gh_branch"))}</label><input id="gh-branch" type="text" value="${esc(saved.branch || "main")}"></div></div>
  <label>${esc(t("gh_token"))}</label><input id="gh-token" type="password" value="${esc(saved.token || "")}" autocomplete="off">
  <p><button class="btn primary" id="gh-connect">${esc(t("connect"))}</button></p></div></div>`;
  $("#gh-connect").onclick = async () => {
    const cfg = { owner: $("#gh-owner").value.trim(), repo: $("#gh-repo").value.trim(), branch: $("#gh-branch").value.trim() || "main", token: $("#gh-token").value.trim() };
    if (!cfg.owner || !cfg.repo || !cfg.token) return toast(t("connect_fill"), "err");
    try {
      const be = new GitHubBackend(cfg);
      await be.api("GET", "");
      localStorage.setItem("bkcms.gh", JSON.stringify(cfg));
      state.backend = be;
      await start();
    } catch (e) { toast(t("connect_failed") + ": " + e.message, "err", 7000); }
  };
}

// ---------- pages ----------
function langChips(page) {
  return siteLangs().map((l) => {
    const st = langStatus(page, l, null);
    const cls = { source: "ok", missing: "off", auto: "warn", manual: "info", reviewed: "ok", legacy: "" }[st.key] || "";
    const tr = page.i18n && page.i18n[l];
    const hid = Array.isArray(page.hideIn) && page.hideIn.includes(l);
    return `<span class="chip ${hid ? "off hid" : cls} ${tr && tr.published === false ? "draft" : ""}" title="${esc(langLabel(l))}: ${esc(hid ? t("vis_hidden") : t("st_" + st.key))}">${esc(l.toUpperCase())}</span>`;
  }).join("");
}

function viewPages() {
  state.view = "pages"; navUI(true); state.ed = null;
  const q = (state.filter || "").toLowerCase();
  const rows = [...state.pages.values()].map((x) => x.data)
    .filter((p) => !q || p.path.toLowerCase().includes(q) || titleOf(p.path).toLowerCase().includes(q))
    .sort((a, b) => a.path.localeCompare(b.path, "es"));
  app.innerHTML = `<div class="wrap"><div class="pages-head"><h1>${esc(t("pages"))}</h1><button class="btn primary" id="new">${esc(t("new_page"))}</button></div>
  <div class="toolbar"><input type="search" id="q" placeholder="${esc(t("search_pages"))}" value="${esc(state.filter || "")}">
  <span class="muted">${esc(t("n_pages", { n: rows.length }))} · ${esc(state.backend.label)}</span></div>
  ${visMatrix()}
  <table class="list"><thead><tr><th>${esc(t("col_title"))}</th><th>${esc(t("col_url"))}</th><th>${esc(t("col_languages"))}</th><th>${esc(t("col_status"))}</th><th></th></tr></thead><tbody>
  ${rows.map((p) => {
    const depth = p.path === "/" ? 0 : p.path.split("/").length - 2;
    return `<tr data-edit="${esc(p.path)}"><td style="padding-left:${0.7 + depth * 1.1}rem">${depth ? "<span class='muted'>└ </span>" : ""}<b>${esc(titleOf(p.path))}</b></td><td class="path">${esc(p.path)}</td>
    <td>${langChips(p)}</td>
    <td>${p.published === false ? `<span class="chip draft">${esc(t("draft"))}</span>` : `<span class="chip ok">${esc(t("published"))}</span>`}</td>
    <td><button class="btn sm" data-edit-btn="${esc(p.path)}">${esc(t("edit"))}</button></td></tr>`;
  }).join("")}
  </tbody></table></div>`;
  $("#q").oninput = debounce((e) => { state.filter = e.target.value; viewPages(); const q2 = $("#q"); q2.focus(); q2.setSelectionRange(99, 99); }, 200);
  $("#new").onclick = newPageDialog;
  wireVis();
  app.querySelectorAll("tr[data-edit]").forEach((r) => (r.onclick = () => openEditor(r.dataset.edit)));
}

// Overview: which languages show which brands / groups (hideIn on the page; children follow their parent)
function visMatrix() {
  const def = defLang();
  const langs = siteLangs().filter((l) => l !== def);
  if (!langs.length) return "";
  const pages = new Map();
  for (const [p, x] of state.pages) pages.set(p, x.data);
  const hasKids = (p) => [...pages.keys()].some((k) => k !== p && k.startsWith(p + "/"));
  const rows = [...pages.keys()].filter((p) => p.startsWith("/productos/") && (p.split("/").length <= 3 || hasKids(p)))
    .sort((a, b) => a.localeCompare(b, "es"));
  if (!rows.length) return "";
  const body = rows.map((p) => {
    const depth = p.split("/").length - 3;
    const parent = p.split("/").slice(0, -1).join("/") || "/";
    return `<tr><td style="padding-left:${0.5 + depth * 1.1}rem">${depth ? "<span class='muted'>└ </span>" : ""}<b>${esc(titleOf(p))}</b></td>` +
      langs.map((l) => {
        const inh = isHidden(pages, parent, l, def);
        const own = (pages.get(p).hideIn || []).includes(l);
        return `<td class="vis-cell"><input type="checkbox" data-vis="${esc(p)}" data-lang="${esc(l)}" aria-label="${esc(titleOf(p))} – ${esc(langLabel(l))}" ${own || inh ? "" : "checked"} ${inh ? "disabled" : ""}></td>`;
      }).join("") + "</tr>";
  }).join("");
  return `<details class="card vis" ${state.visOpen ? "open" : ""}><summary><b>${esc(t("vis_title"))}</b> <span class="muted">— ${esc(t("vis_summary"))}</span></summary>
    <p class="muted">${esc(t("vis_intro"))}</p>
    <table class="list vis-table"><thead><tr><th>${esc(t("col_title"))}</th>${langs.map((l) => `<th class="vis-cell">${esc(l.toUpperCase())}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></details>`;
}
function wireVis() {
  const det = app.querySelector("details.vis");
  if (det) det.addEventListener("toggle", () => { state.visOpen = det.open; });
  app.querySelectorAll("input[data-vis]").forEach((cb) => (cb.onchange = async () => {
    const path = cb.dataset.vis, lang = cb.dataset.lang;
    const e = state.pages.get(path);
    if (!e) return;
    const set = new Set(e.data.hideIn || []);
    if (cb.checked) set.delete(lang); else set.add(lang);
    if (set.size) e.data.hideIn = [...set]; else delete e.data.hideIn;
    try { await writeJson(e.file, e.data, `CMS: visibility ${path}`); toast(savedMessage(t)); viewPages(); }
    catch (err) { toast(err.message, "err", 7000); }
  }));
}

function newPageDialog() {
  const dlg = document.createElement("dialog");
  const def = defLang();
  const all = [...state.pages.keys()].sort();
  const underProducts = all.filter((p) => p === "/productos" || p.startsWith("/productos/"));
  const opt = (p, sel) => `<option value="${esc(p)}" ${p === sel ? "selected" : ""}>${esc(titleOf(p))} — ${esc(p)}</option>`;
  dlg.innerHTML = `<h2>${esc(t("new_page"))}</h2>
  <p class="muted">${esc(t("np_intro"))}</p>
  <div class="kinds">
    <label class="kind"><input type="radio" name="kind" value="product" checked><b>${esc(t("np_product"))}</b><span>${esc(t("np_product_d"))}</span></label>
    <label class="kind"><input type="radio" name="kind" value="brand"><b>${esc(t("np_brand"))}</b><span>${esc(t("np_brand_d"))}</span></label>
    <label class="kind"><input type="radio" name="kind" value="page"><b>${esc(t("np_info"))}</b><span>${esc(t("np_info_d"))}</span></label>
  </div>
  <label>${esc(t("np_title"))}</label><input type="text" id="np-title" placeholder="${esc(t("np_title_ph"))}">
  <label>${esc(t("np_parent"))}</label><select id="np-parent"></select>
  <label>${esc(t("np_lang"))}</label><select id="np-lang">${siteLangs().map((l) => `<option value="${esc(l)}" ${l === def ? "selected" : ""}>${esc(langLabel(l))}</option>`).join("")}</select>
  <p class="muted" id="np-url"></p>
  <details class="adv"><summary>${esc(t("advanced"))}</summary><label>${esc(t("np_slug"))}</label><input type="text" id="np-slug"></details>
  <p class="muted">${esc(t("np_draft_note"))}</p>
  <p><button class="btn primary" id="np-go">${esc(t("np_create"))}</button> <button class="btn ghost" id="np-x">${esc(t("cancel"))}</button></p>`;
  document.body.appendChild(dlg);
  dlg.showModal();
  const kind = () => dlg.querySelector('input[name="kind"]:checked').value;
  const fillParents = () => {
    const k = kind();
    const list = k === "page" ? all : k === "brand" ? ["/productos"].filter((p) => state.pages.has(p)) : underProducts.filter((p) => p !== "/productos");
    const sel = k === "page" ? "/" : k === "brand" ? "/productos" : list[0];
    $("#np-parent", dlg).innerHTML = (list.length ? list : all).map((p) => opt(p, sel)).join("");
    upd();
  };
  const upd = () => {
    const par = $("#np-parent", dlg).value;
    const s = $("#np-slug", dlg);
    if (!s.dataset.touched) s.value = slug($("#np-title", dlg).value);
    $("#np-url", dlg).textContent = t("np_url") + " " + (par === "/" ? "" : par) + "/" + (s.value || "…");
  };
  dlg.querySelectorAll('input[name="kind"]').forEach((r) => (r.onchange = fillParents));
  $("#np-title", dlg).oninput = upd;
  $("#np-slug", dlg).oninput = (e) => { e.target.dataset.touched = "1"; upd(); };
  $("#np-parent", dlg).onchange = upd;
  fillParents();
  $("#np-title", dlg).focus();
  $("#np-x", dlg).onclick = () => { dlg.close(); dlg.remove(); };
  $("#np-go", dlg).onclick = () => {
    const parent = $("#np-parent", dlg).value, title = $("#np-title", dlg).value.trim(), sl = slug($("#np-slug", dlg).value);
    if (!title || !sl) return toast(t("np_need_title"), "err");
    if (state.pages.has((parent === "/" ? "" : parent) + "/" + sl)) return toast(t("url_exists"), "err");
    const d = newPageDraft({ parent, title, slugPart: sl, kind: kind(), lang: $("#np-lang", dlg).value, sourceLang: $("#np-lang", dlg).value });
    const addToParent = kind() !== "page" || parent !== "/";
    dlg.close(); dlg.remove();
    openEditor(d.path, { page: d.page, file: d.file, addToParent, tab: "add", toast: t("np_created_toast") });
  };
}

// ---------- settings ----------
const EFFORTS = ["high", "medium", "low"];
function viewSettings() {
  state.view = "settings"; navUI(true); state.ed = null;
  const s = state.site, c = s.contact || {}, a = s.analytics || {}, th = s.theme || {}, aiS = s.ai || {};
  const cfg = state.ai;
  const models = state.aiModels && state.aiModels.length ? state.aiModels : ai.MODEL_PRESETS.map((m) => m.id);
  if (!models.includes(cfg.model)) models.unshift(cfg.model);
  const langs = siteLangs();
  const targets = Array.isArray(aiS.targets) && aiS.targets.length ? aiS.targets : langs.filter((l) => l !== defLang());
  app.innerHTML = `<div class="wrap"><h1>${esc(t("settings"))}</h1>
  <div class="card"><h2>${esc(t("set_company"))}</h2><div class="row">
    <div><label>${esc(t("set_name"))}</label><input type="text" data-s="name" value="${esc(s.name)}"></div>
    <div><label>${esc(t("set_legal"))}</label><input type="text" data-s="legalName" value="${esc(s.legalName || "")}"></div>
    <div><label>${esc(t("set_org"))}</label><input type="text" data-s="orgNumber" value="${esc(s.orgNumber || "")}"></div></div>
    <label>${esc(t("set_tagline"))}</label><input type="text" data-s="tagline" value="${esc(s.tagline || "")}">
    <label>${esc(t("set_origin"))}</label><input type="url" data-s="origin" value="${esc(s.origin)}"></div>
  <div class="card"><h2>${esc(t("set_contact"))}</h2><div class="row"><div><label>${esc(t("set_email"))}</label><input type="email" data-s="contact.email" value="${esc(c.email || "")}"></div>
    <div><label>${esc(t("set_address"))}</label><input type="text" data-s="contact.address" value="${esc(c.address || "")}"></div></div>
    <div class="row"><div><label>${esc(t("set_person"))}</label><input type="text" data-s="contact.person.name" value="${esc((c.person || {}).name || "")}"></div>
    <div><label>${esc(t("set_opens"))}</label><input type="text" data-s="contact.hours.opens" value="${esc((c.hours || {}).opens || "")}" placeholder="07:00"></div>
    <div><label>${esc(t("set_closes"))}</label><input type="text" data-s="contact.hours.closes" value="${esc((c.hours || {}).closes || "")}" placeholder="17:00"></div></div>
    <label>${esc(t("set_phones"))}</label>
    <textarea data-s="contact.phones" data-t="phones" rows="3">${esc((c.phones || []).map((p) => `${p.label}: ${p.value}`).join("\n"))}</textarea>
    <label>${esc(t("set_social"))}</label>
    <textarea data-s="social" data-t="social" rows="3">${esc((s.social || []).map((x) => `${x.name}: ${x.url}`).join("\n"))}</textarea></div>

  <div class="card"><h2>${esc(t("set_quote"))}</h2><p class="muted">${esc(t("set_quote_hint"))}</p>
    <label>${esc(t("set_quote_endpoint"))}</label><input type="url" data-s="quoteForm.endpoint" value="${esc((s.quoteForm || {}).endpoint || "")}" placeholder="https://…">
    <label>${esc(t("set_quote_key"))}</label><input type="text" data-s="quoteForm.apiKey" value="${esc((s.quoteForm || {}).apiKey || "")}" autocomplete="off">
    <label class="chk"><input type="checkbox" data-s="sectionBarLogos" data-t="bool" ${s.sectionBarLogos === true ? "checked" : ""}> ${esc(t("set_bar_logos"))}</label></div>

  <div class="card"><h2>${IC_SPARK} ${esc(t("ai_title"))}</h2>
    <p class="muted">${t("ai_intro")}</p>
    <div class="row">
      <div><label>${esc(t("ai_provider"))}</label><select id="ai-provider"><option value="groq" ${cfg.baseUrl === ai.AI_DEFAULTS.baseUrl ? "selected" : ""}>Groq (api.groq.com)</option><option value="custom" ${cfg.baseUrl !== ai.AI_DEFAULTS.baseUrl ? "selected" : ""}>${esc(t("ai_custom"))}</option></select></div>
      <div id="ai-base-wrap" ${cfg.baseUrl === ai.AI_DEFAULTS.baseUrl ? "hidden" : ""}><label>${esc(t("ai_base"))}</label><input type="text" id="ai-base" value="${esc(cfg.baseUrl)}"></div>
    </div>
    <label>${esc(t("ai_key"))}</label>
    <div class="row nowrap"><input type="password" id="ai-key" value="${esc(cfg.key)}" autocomplete="off" placeholder="gsk_…"><button class="btn ghost" id="ai-show" style="flex:0 0 auto">${esc(t("show"))}</button></div>
    <p class="muted">${esc(t("ai_key_hint"))}</p>
    <div class="row">
      <div><label>${esc(t("ai_model"))}</label><select id="ai-model">${models.map((m) => `<option ${m === cfg.model ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></div>
      <div style="flex:0 0 auto"><button class="btn ghost" id="ai-models">${esc(t("ai_fetch_models"))}</button></div>
      <div><label>${esc(t("ai_effort"))}</label><select id="ai-effort">${EFFORTS.map((e) => `<option value="${e}" ${cfg.effort === e ? "selected" : ""}>${esc(t("effort_" + e))}</option>`).join("")}</select></div>
    </div>
    <p class="muted">${esc(t("ai_effort_hint"))}</p>
    <p><button class="btn" id="ai-test">${esc(t("ai_test"))}</button> <span id="ai-test-out" class="muted"></span></p>
    <hr>
    <label class="chk"><input type="checkbox" data-s="ai.autoTranslate" data-t="bool" ${aiS.autoTranslate ? "checked" : ""}> <b>${esc(t("ai_auto"))}</b></label>
    <p class="muted">${esc(t("ai_auto_hint"))}</p>
    <label>${esc(t("ai_targets"))}</label>
    <div class="chkrow">${langs.filter((l) => l !== defLang()).map((l) => `<label class="chk"><input type="checkbox" data-target="${esc(l)}" ${targets.includes(l) ? "checked" : ""}> ${esc(langLabel(l))}</label>`).join("")}</div>
    <label class="chk"><input type="checkbox" data-s="ai.noindexUntilReviewed" data-t="bool" ${aiS.noindexUntilReviewed === false ? "" : "checked"}> ${esc(t("ai_noindex"))}</label>
    <p class="muted">${esc(t("ai_noindex_hint"))}</p>
  </div>

  <div class="card"><h2>${esc(t("set_analytics"))}</h2>
    <p class="muted">${esc(t("set_analytics_hint"))}</p>
    <label class="chk"><input type="checkbox" data-s="analytics.enabled" data-t="bool" ${a.enabled ? "checked" : ""}> ${esc(t("set_analytics_on"))}</label>
    <label>${esc(t("set_ga_id"))}</label><input type="text" data-s="analytics.measurementId" value="${esc(a.measurementId || "")}" placeholder="G-XXXXXXXXXX"></div>
  <div class="card"><h2>${esc(t("set_languages"))}</h2>
    ${Object.entries(s.languages || {}).map(([code, l]) => `<label class="chk"><input type="checkbox" data-s="languages.${code}.published" data-t="bool" ${l.published ? "checked" : ""}> ${esc(l.label)} (${code}) — ${esc(t("published"))}${code === defLang() ? " (" + esc(t("default_language")) + ")" : ""}</label>`).join("")}
    <p class="muted">${esc(t("set_languages_hint"))}</p></div>
  <div class="card"><h2>${esc(t("set_colours"))}</h2><div class="row">
    ${[["primary", t("col_accent")], ["dark", t("col_dark")], ["surface", t("col_surface")], ["text", t("col_text")]].map(([k, l]) => `<div><label>${esc(l)}</label><input type="color" data-s="theme.${k}" value="${esc(th[k] || "#000000")}"></div>`).join("")}</div></div>
  <div class="card"><h2>${esc(t("set_menu"))}</h2><label>${esc(t("set_menu_hint"))}</label>
    <textarea data-s="nav" data-t="lines" rows="4">${esc((s.nav || []).join("\n"))}</textarea></div>
  <div class="card"><h2>GitHub</h2><div class="row"><div><label>${esc(t("gh_owner"))}</label><input type="text" data-s="github.owner" value="${esc((s.github && s.github.owner) || "")}"></div>
    <div><label>${esc(t("gh_repo"))}</label><input type="text" data-s="github.repo" value="${esc((s.github && s.github.repo) || "")}"></div>
    <div><label>${esc(t("gh_branch"))}</label><input type="text" data-s="github.branch" value="${esc((s.github && s.github.branch) || "main")}"></div></div></div>
  <p><button class="btn primary" id="save-site">${esc(t("save_settings"))}</button></p></div>`;

  // --- AI card (key/model are browser-local; the rest is saved with the site settings) ---
  const saveAi = () => ai.saveAiConfig(state.ai);
  $("#ai-provider").onchange = (e) => {
    const custom = e.target.value === "custom";
    $("#ai-base-wrap").hidden = !custom;
    state.ai.baseUrl = custom ? ($("#ai-base").value || "https://api.openai.com/v1") : ai.AI_DEFAULTS.baseUrl;
    if (custom && !$("#ai-base").value) $("#ai-base").value = state.ai.baseUrl;
    saveAi();
  };
  $("#ai-base").oninput = (e) => { state.ai.baseUrl = e.target.value.trim(); saveAi(); };
  $("#ai-key").oninput = (e) => { state.ai.key = e.target.value.trim(); saveAi(); };
  $("#ai-show").onclick = () => { const k = $("#ai-key"); k.type = k.type === "password" ? "text" : "password"; $("#ai-show").textContent = k.type === "password" ? t("show") : t("hide"); };
  $("#ai-model").onchange = (e) => { state.ai.model = e.target.value; saveAi(); };
  $("#ai-effort").onchange = (e) => { state.ai.effort = e.target.value; saveAi(); };
  $("#ai-models").onclick = async () => {
    try {
      state.aiModels = await ai.listModels(state.ai);
      toast(t("ai_models_loaded", { n: state.aiModels.length }));
      viewSettings();
    } catch (e) { toast(t("ai_failed") + ": " + e.message, "err", 7000); }
  };
  $("#ai-test").onclick = async () => {
    const out = $("#ai-test-out");
    out.textContent = t("ai_working");
    try {
      const { map } = await ai.translateStrings(state.ai, ["Maquinaria y soluciones para la construcción"], { from: "es", to: "en" });
      out.textContent = "✓ " + [...map.values()][0];
      out.style.color = "var(--ok)";
    } catch (e) { out.textContent = "✗ " + e.message; out.style.color = "var(--bad)"; }
  };
  $$("[data-target]").forEach((cb) => (cb.onchange = () => {
    const chosen = $$("[data-target]").filter((x) => x.checked).map((x) => x.dataset.target);
    setPath(state.site, "ai.targets", chosen);
    setStatus(t("unsaved"));
  }));
  $("#save-site").onclick = async () => {
    try {
      await writeJson("content/site.json", state.site, "CMS: update site settings");
      toast(savedMessage(t)); setStatus(t("saved_state") + " ✓");
    } catch (e) { toast(t("save_failed") + ": " + e.message, "err", 8000); }
  };
}
const IC_SPARK = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>';

app.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.dataset || !el.dataset.s) return;
  let v = el.type === "checkbox" ? el.checked : el.value;
  if (el.dataset.t === "lines") v = String(v).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (el.dataset.t === "phones") v = String(v).split(/\r?\n/).map((l) => l.split(/:(.*)/s)).filter((a) => a[1]).map((a) => ({ label: a[0].trim(), value: a[1].trim() }));
  if (el.dataset.t === "social") v = String(v).split(/\r?\n/).map((l) => l.split(/:(.*)/s)).filter((a) => a[1]).map((a) => ({ name: a[0].trim(), url: a[1].trim() }));
  setPath(state.site, el.dataset.s, v);
  setStatus(t("unsaved"));
});

// ---------- UI texts (site dictionary) ----------
function viewTranslations() {
  state.view = "translations"; navUI(true); state.ed = null;
  const langs = siteLangs();
  const keys = [...new Set(langs.flatMap((l) => Object.keys(state.ui[l] || {})))];
  app.innerHTML = `<div class="wrap"><h1>${esc(t("nav_translations"))}</h1>
  <p class="muted">${esc(t("ui_texts_hint"))}</p>
  <table class="list tr-table"><thead><tr><th>${esc(t("key"))}</th>${langs.map((l) => `<th>${esc(l.toUpperCase())}</th>`).join("")}</tr></thead><tbody>
  ${keys.map((k) => `<tr><td class="path">${esc(k)}</td>${langs.map((l) => { const v = (state.ui[l] || {})[k]; return `<td><input type="text" data-ui="${l}.${esc(k)}" value="${esc(v || "")}" ${v ? "" : 'style="border-color:var(--bad)"'}></td>`; }).join("")}</tr>`).join("")}
  </tbody></table><p><button class="btn primary" id="save-ui">${esc(t("save"))}</button></p></div>`;
  app.querySelectorAll("[data-ui]").forEach((i) => (i.oninput = () => {
    const [l, ...rest] = i.dataset.ui.split("."); const k = rest.join(".");
    (state.ui[l] = state.ui[l] || {})[k] = i.value; setStatus(t("unsaved"));
  }));
  $("#save-ui").onclick = async () => {
    try { for (const l of langs) await writeJson(`content/ui/${l}.json`, state.ui[l] || {}, `CMS: update ${l} UI texts`); toast(savedMessage(t)); setStatus(t("saved_state") + " ✓"); }
    catch (e) { toast(t("save_failed") + ": " + e.message, "err", 8000); }
  };
}

function viewHelp() {
  state.view = "help"; navUI(true); state.ed = null;
  const card = (h, p) => `<div class="card"><h2>${esc(t(h))}</h2>${t(p)}</div>`;
  app.innerHTML = `<div class="wrap"><h1>${esc(t("nav_help"))}</h1>
    ${card("help_edit_h", "help_edit")}${card("help_add_h", "help_add")}${card("help_lang_h", "help_lang")}${card("help_ai_h", "help_ai")}${card("help_seo_h", "help_seo")}</div>`;
}

// ---------- boot ----------
views.pages = viewPages;
views.settings = viewSettings;
views.translations = viewTranslations;
views.review = () => viewReview(app, navUI);
views.help = viewHelp;

$("#nav").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (state.ed && state.ed.dirty && !confirm(t("discard_changes"))) return;
  if (state.ed) closeEditor();
  views[b.dataset.view]();
});
const langSel = $("#ui-lang");
if (langSel) {
  langSel.innerHTML = UI_LANGS.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join("");
  langSel.value = uiLang();
  langSel.onchange = () => {
    setUiLang(langSel.value);
    document.documentElement.lang = langSel.value;
    if (state.ed) { toast(t("lang_reload"), "ok"); return; }
    (views[state.view] || viewPages)();
  };
}
window.addEventListener("beforeunload", (e) => { if (state.ed && state.ed.dirty) { e.preventDefault(); e.returnValue = ""; } });

async function start() {
  if (!state.backend) state.backend = await detectBackend();
  if (!state.backend) return viewConnect();
  state.ai.proxy = state.backend.mode === "local" ? "/__cms/ai" : undefined;
  setStatus(t("loading"));
  try {
    await loadAll();
  } catch (e) {
    if (state.backend.mode === "github") { localStorage.removeItem("bkcms.gh"); state.backend = null; return viewConnect(t("load_failed") + ": " + e.message); }
    app.innerHTML = `<div class="wrap"><div class="card"><p style="color:var(--bad)">${esc(t("load_failed"))}: ${esc(e.message)}</p></div></div>`;
    return;
  }
  setStatus(state.backend.label);
  const deep = new URLSearchParams(location.search).get("edit");
  if (deep && state.pages.has(deep)) { openEditor(deep); return; }
  viewPages();
}
start();
