// Visual editor sidebar: add-blocks palette, structure list, block inspector, page & SEO, languages.
import { state, $, $$, esc, clone, defLang, siteLangs, langLabel, titleOf, toast, setPath, getPath } from "./core.js";
import { t } from "./lang.js";
import { isHidden } from "./visibility.mjs";
import {
  IC, BLOCK_TYPES, BLOCK_GROUPS, paletteId, newBlock, curT, curBlocks, mutate, setField, moveBlock, deleteBlock, duplicateBlock,
  srcLang, metaOf, langStatus, plainText, autoDescription, ytId, humanizeFilename, insertBlock, hooks as modelHooks
} from "./editor-model.js";
import { pickImage, pickDoc, pickLink, thumbUrl } from "./pickers.js";
import * as ai from "./ai.js";
import { aiReady } from "./editor-translate.js";

// editor.js provides these
export const panelHooks = {
  insertNew() {}, selectBlock() {}, setTab() {}, setLang() {}, translate() {}, createEmpty() {}, markReviewed() {}, openSettings() {},
  rerender() {}, describeWithAi() {}, altWithAi() {}
};

const groupsToText = (groups) => (groups || []).map((g) => "## " + (g.title || "") + "\n" + (g.rows || []).map((r) => [r.label, r.metric || "", r.us || ""].join(" | ")).join("\n")).join("\n\n");
function textToGroups(txt) {
  const groups = [];
  let cur = null;
  for (const raw of String(txt).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("##")) { cur = { title: line.replace(/^#+\s*/, ""), rows: [] }; groups.push(cur); continue; }
    if (!cur) { cur = { title: "", rows: [] }; groups.push(cur); }
    const [label, metric, us] = line.split("|").map((x) => x.trim());
    cur.rows.push({ label: label || "", ...(metric ? { metric } : {}), ...(us ? { us } : {}) });
  }
  return groups;
}

const TEMPLATES = ["page", "brand", "product", "listing"];

function snippet(b) {
  switch (b.type) {
    case "text": return plainText(b.html).slice(0, 60) || t("empty");
    case "heading": return b.text || t("empty");
    case "list": return (b.items || []).filter(Boolean).slice(0, 3).join(" · ") || t("empty");
    case "image": return b.alt || (b.src || "").split("/").pop() || t("empty");
    case "button": return b.text || (b.href || "").split("/").pop() || t("empty");
    case "cards": return t("n_cards", { n: (b.items || []).length });
    case "carousel": return t("n_images", { n: (b.items || []).length });
    case "modules": return t("n_cards", { n: (b.items || []).length });
    case "video": return b.title || b.id || t("empty");
    case "table": return t("n_rows", { n: (b.rows || []).length });
    case "datasheet": return b.title || t("block_datasheet");
    case "chips": return (b.items || []).filter(Boolean).slice(0, 4).join(", ") || t("empty");
    case "cta": return b.title || t("empty");
    case "columns": return plainText((((b.left || [])[0]) || {}).html || (((b.left || [])[0]) || {}).text || "") || t("block_columns");
    default: return "";
  }
}

// ---------- tabs ----------
export function renderTabs(el) {
  const ed = state.ed;
  const tabs = [["add", IC.plus, t("tab_add")], ["structure", IC.layers, t("tab_structure")], ["block", IC.settings, t("tab_block")], ["page", IC.page, t("tab_page")], ["lang", IC.globe, t("tab_lang")]];
  el.innerHTML = tabs.map(([id, ic, label]) => `<button data-tab="${id}" class="${ed.tab === id ? "is-on" : ""}" title="${esc(label)}">${ic}<span>${esc(label)}</span></button>`).join("");
}

export function renderPanel(el) {
  const ed = state.ed;
  const fn = { add: panelAdd, structure: panelStructure, block: panelBlock, page: panelPage, lang: panelLang }[ed.tab] || panelAdd;
  const scroll = el.scrollTop;
  el.innerHTML = fn();
  el.scrollTop = scroll;
}

// ---------- add ----------
function panelAdd() {
  const tiles = (g) => BLOCK_TYPES.filter((b) => b.group === g).map((b) =>
    `<button class="tile" draggable="true" data-new="${b.id}">${IC[b.id]}<span class="tile__t"><b>${esc(t("block_" + b.id))}</b><span>${esc(t("block_" + b.id + "_d"))}</span></span></button>`).join("");
  return `<p class="muted pn__hint">${esc(t("add_hint"))}</p>` +
    BLOCK_GROUPS.map((g) => `<h3 class="pn__h">${esc(t("group_" + g))}</h3><div class="tiles">${tiles(g)}</div>`).join("");
}

// ---------- structure ----------
function panelStructure() {
  const list = curBlocks();
  if (!list.length) return `<p class="muted pn__hint">${esc(t("page_empty"))}</p>`;
  return `<p class="muted pn__hint">${esc(t("structure_hint"))}</p><ol class="outline">` + list.map((b, i) => {
    const id = paletteId(b);
    return `<li draggable="true" data-i="${i}" class="${state.ed.sel === i ? "is-on" : ""}"><button class="outline__main" data-select="${i}">${IC[id] || ""}<span><b>${esc(t("block_" + id))}</b><em>${esc(snippet(b))}</em></span></button>` +
      `<span class="outline__acts"><button data-oup="${i}" title="${esc(t("move_up"))}">${IC.up}</button><button data-odown="${i}" title="${esc(t("move_down"))}">${IC.down}</button><button data-odel="${i}" title="${esc(t("delete"))}">${IC.trash}</button></span></li>`;
  }).join("") + `</ol>`;
}

// ---------- block inspector ----------
const F = (label, html, hint = "") => `<div class="fld"><label>${esc(label)}</label>${html}${hint ? `<p class="muted fld__h">${esc(hint)}</p>` : ""}</div>`;
const inp = (path, value, extra = "") => `<input type="text" data-bf="${esc(path)}" value="${esc(value ?? "")}" ${extra}>`;

function panelBlock() {
  const ed = state.ed;
  const i = ed.sel;
  const b = i != null ? curBlocks()[i] : null;
  if (!b) return `<p class="muted pn__hint">${esc(t("select_block_hint"))}</p>`;
  const id = paletteId(b);
  let body = "";
  switch (id) {
    case "text":
      body = `<p class="muted">${esc(t("text_hint"))}</p>
        <div class="btnrow"><button class="btn sm ghost" data-act="to-heading">${esc(t("make_heading"))}</button><button class="btn sm ghost" data-act="to-list">${esc(t("make_list"))}</button></div>`;
      break;
    case "heading":
      body = F(t("heading_size"), `<select data-bf="level" data-t="int">${[[2, t("size_large")], [3, t("size_medium")], [4, t("size_small")]].map(([v, l]) => `<option value="${v}" ${b.level === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`, t("heading_hint")) +
        F(t("text"), inp("text", b.text));
      break;
    case "list":
      body = F(t("one_per_line"), `<textarea data-bf="items" data-t="lines" rows="7">${esc((b.items || []).join("\n"))}</textarea>`) +
        `<label class="chk"><input type="checkbox" data-bf="ordered" data-t="bool" ${b.ordered ? "checked" : ""}> ${esc(t("numbered"))}</label>`;
      break;
    case "image":
      body = `<div class="imgprev">${b.src ? `<img src="${esc(thumbUrl((b.src || "").replace("/assets/img/", "")))}" alt="">` : `<div class="imgprev__none">${IC.image}</div>`}</div>
        <div class="btnrow"><button class="btn sm primary" data-act="pick-image">${esc(b.src ? t("change_image") : t("choose_image"))}</button></div>` +
        F(t("alt_text"), inp("alt", b.alt, `placeholder="${esc(t("alt_placeholder"))}"`) + `<div class="btnrow"><button class="btn sm ghost" data-act="alt-suggest">${IC.sparkle}<span>${esc(t("suggest_alt"))}</span></button></div>`, t("alt_hint")) +
        F(t("caption"), inp("caption", b.caption)) +
        F(t("image_link"), `<div class="row nowrap"><input type="text" data-bf="href" value="${esc(b.href || "")}" placeholder="${esc(t("no_link"))}"><button class="btn sm ghost" data-act="pick-link" data-target="href">${esc(t("choose"))}</button></div>`);
      break;
    case "download":
      body = F(t("doc_title"), inp("text", b.text, `placeholder="${esc(t("doc_title_ph"))}"`)) +
        F(t("pdf_file"), `<div class="row nowrap"><input type="text" data-bf="href" value="${esc(b.href || "")}" readonly><button class="btn sm primary" data-act="pick-doc">${esc(t("choose_pdf"))}</button></div>`, t("doc_hint"));
      break;
    case "button":
      body = F(t("button_text"), inp("text", b.text)) +
        F(t("link_to"), `<div class="row nowrap"><input type="text" data-bf="href" value="${esc(b.href || "")}" placeholder="/contacto"><button class="btn sm ghost" data-act="pick-link" data-target="href">${esc(t("choose"))}</button></div>`);
      break;
    case "modules": {
      const items = b.items || [];
      body = F(t("modules_layout"), `<select data-bf="layout"><option value="cards" ${b.layout !== "compact" ? "selected" : ""}>${esc(t("modules_cards"))}</option><option value="compact" ${b.layout === "compact" ? "selected" : ""}>${esc(t("modules_compact"))}</option><option value="tiles" ${b.layout === "tiles" ? "selected" : ""}>${esc(t("modules_tiles"))}</option></select>`) +
        items.map((it, ci) => `<div class="sub"><div class="row nowrap">${it.image ? `<img class="thumb" src="${esc(thumbUrl(it.image.replace("/assets/img/", "")))}" alt="">` : ""}<button class="btn sm ghost" data-act="mod-image" data-ci="${ci}">${esc(it.image ? t("change_image") : t("choose_image"))}</button>${ci > 0 ? `<button class="btn sm ghost" data-act="mod-up" data-ci="${ci}" title="${esc(t("move_up"))}">${IC.up}</button>` : ""}<button class="btn sm danger" data-act="mod-rm" data-ci="${ci}" title="${esc(t("delete"))}">${IC.trash}</button></div>
          ${F(t("card_title"), inp(`items.${ci}.title`, it.title))}
          ${F(t("card_text"), `<textarea data-bf="items.${ci}.text" rows="2">${esc(it.text || "")}</textarea>`)}
          ${F(t("modules_bullets"), `<textarea data-bf="items.${ci}.bullets" data-t="lines" rows="4">${esc((it.bullets || []).join("\n"))}</textarea>`, t("modules_bullets_hint"))}
          ${F(t("link_to"), `<div class="row nowrap"><input type="text" data-bf="items.${ci}.href" value="${esc(it.href || "")}" placeholder="${esc(t("no_link"))}"><button class="btn sm ghost" data-act="mod-link" data-ci="${ci}">${esc(t("choose"))}</button></div>`)}
        </div>`).join("") +
        `<div class="btnrow"><button class="btn sm primary" data-act="mod-add">${IC.plus}<span>${esc(t("modules_add"))}</span></button></div>`;
      break;
    }
    case "carousel": {
      const items = b.items || [];
      body = items.map((it, ci) => `<div class="sub"><div class="row nowrap">${it.src ? `<img class="thumb" src="${esc(thumbUrl(it.src.replace("/assets/img/", "")))}" alt="">` : ""}<button class="btn sm ghost" data-act="car-image" data-ci="${ci}">${esc(t("change_image"))}</button>${ci > 0 ? `<button class="btn sm ghost" data-act="car-up" data-ci="${ci}" title="${esc(t("move_up"))}">${IC.up}</button>` : ""}<button class="btn sm danger" data-act="car-rm" data-ci="${ci}" title="${esc(t("delete"))}">${IC.trash}</button></div>
        ${F(t("alt_text"), inp(`items.${ci}.alt`, it.alt))}</div>`).join("") +
        `<div class="btnrow"><button class="btn sm primary" data-act="car-add">${IC.plus}<span>${esc(t("carousel_add"))}</span></button></div>` +
        `<label class="chk"><input type="checkbox" data-bf="autoplay" data-t="bool" ${b.autoplay ? "checked" : ""}> ${esc(t("carousel_autoplay"))}</label>` +
        (b.autoplay ? F(t("carousel_interval"), `<input type="number" data-bf="interval" data-t="int" min="2" max="20" value="${esc(b.interval || 5)}">`) : "");
      break;
    }
    case "cards": {
      const items = b.items || [];
      const pageOpts = (sel) => [...state.pages.keys()].sort().map((p) => `<option value="${esc(p)}" ${p === sel ? "selected" : ""}>${esc(titleOf(p, state.ed.lang))} — ${esc(p)}</option>`).join("");
      body = items.map((it, ci) => `<div class="sub"><div class="row nowrap"><select data-bf="items.${ci}.href">${pageOpts(it.href)}</select><button class="btn sm danger" data-act="card-rm" data-ci="${ci}" title="${esc(t("delete"))}">${IC.trash}</button></div>
        ${F(t("card_title"), inp(`items.${ci}.title`, it.title, `placeholder="${esc(t("card_title_ph"))}"`))}
        ${F(t("card_text"), `<textarea data-bf="items.${ci}.text" rows="2">${esc(it.text || "")}</textarea>`)}
        <div class="row nowrap">${it.image ? `<img class="thumb" src="${esc(thumbUrl(it.image.replace("/assets/img/", "")))}" alt="">` : ""}<button class="btn sm ghost" data-act="card-image" data-ci="${ci}">${esc(it.image ? t("change_image") : t("choose_image"))}</button>${it.image ? `<button class="btn sm ghost" data-act="card-image-rm" data-ci="${ci}">${esc(t("remove"))}</button>` : ""}</div></div>`).join("") +
        `<div class="btnrow"><button class="btn sm" data-act="card-add">${IC.plus}<span>${esc(t("add_page_card"))}</span></button><button class="btn sm primary" data-act="card-fill">${IC.sparkle}<span>${esc(t("add_all_children"))}</span></button></div>`;
      break;
    }
    case "video":
      body = F(t("youtube_link"), `<input type="text" data-bf="id" data-t="yt" value="${esc(b.id || "")}" placeholder="https://www.youtube.com/watch?v=…">`, t("video_hint")) + F(t("video_title"), inp("title", b.title));
      break;
    case "table":
      body = `<label class="chk"><input type="checkbox" data-bf="header" data-t="bool" ${b.header !== false ? "checked" : ""}> ${esc(t("first_row_header"))}</label>` +
        F(t("table_caption"), inp("caption", b.caption)) +
        F(t("table_groups"), `<textarea data-bf="groups" data-t="tablegroups" rows="3" class="mono">${esc((b.groups || []).map((g) => `${g.text} | ${g.span}`).join("\n"))}</textarea>`, t("table_groups_hint")) +
        F(t("table_rows"), `<textarea data-bf="rows" data-t="table" rows="9">${esc((b.rows || []).map((r) => r.join("\t")).join("\n"))}</textarea>`, t("table_hint"));
      break;
    case "datasheet":
      body = F(t("heading"), inp("title", b.title)) + F(t("product_type"), inp("tagline", b.tagline)) +
        F(t("intro_text"), `<textarea data-bf="intro" data-t="paras" rows="5">${esc((b.intro || []).join("\n\n"))}</textarea>`, t("paras_hint")) +
        F(t("spec_tables"), `<textarea data-bf="groups" data-t="groups" rows="12" class="mono">${esc(groupsToText(b.groups))}</textarea>`, t("spec_hint")) +
        F(t("footnote"), inp("note", b.note));
      break;
    case "chips":
      body = F(t("heading"), inp("title", b.title)) + F(t("one_per_line"), `<textarea data-bf="items" data-t="lines" rows="7">${esc((b.items || []).join("\n"))}</textarea>`);
      break;
    case "cta":
      body = F(t("heading"), inp("title", b.title)) + F(t("supporting_text"), inp("text", b.text)) + F(t("button_text"), inp("button", b.button)) +
        F(t("link_to"), `<div class="row nowrap"><input type="text" data-bf="href" value="${esc(b.href || "")}"><button class="btn sm ghost" data-act="pick-link" data-target="href">${esc(t("choose"))}</button></div>`);
      break;
    case "columns": {
      const ratios = ["60-40", "40-60", "50-50", "between"];
      const nested = (side) => (b[side] || []).map((nb, j) => {
        const p = `${side}.${j}`;
        let ctl = "";
        if (nb.type === "image") {
          ctl = `<div class="row nowrap">${nb.src ? `<img class="thumb" src="${esc(thumbUrl((nb.src || "").replace("/assets/img/", "")))}" alt="">` : ""}<button class="btn sm ghost" data-act="nested-image" data-path="${p}">${esc(nb.src ? t("change_image") : t("choose_image"))}</button></div>` +
            F(t("alt_text"), inp(`${p}.alt`, nb.alt));
        } else if (nb.type === "button") {
          ctl = F(t("button_text"), inp(`${p}.text`, nb.text)) + F(t("link_to"), inp(`${p}.href`, nb.href));
        } else ctl = `<p class="muted">${esc(t("edit_on_page"))}</p>`;
        return `<div class="sub"><div class="row nowrap"><b>${esc(t("block_" + paletteId(nb)))}</b><button class="btn sm danger" data-act="nested-rm" data-path="${p}" title="${esc(t("delete"))}">${IC.trash}</button></div>${ctl}</div>`;
      }).join("");
      const add = (side) => `<div class="btnrow">${["text", "heading", "image", "button"].map((ty) => `<button class="btn sm ghost" data-act="nested-add" data-side="${side}" data-type="${ty}">+ ${esc(t("block_" + ty))}</button>`).join("")}</div>`;
      body = F(t("columns_ratio"), `<select data-bf="ratio">${ratios.map((r) => `<option value="${r}" ${(b.ratio || "60-40") === r ? "selected" : ""}>${esc(t("ratio_" + r.replace("-", "_")))}</option>`).join("")}</select>`) +
        `<h3 class="pn__h">${esc(t("left_col"))}</h3>${nested("left")}${add("left")}<h3 class="pn__h">${esc(t("right_col"))}</h3>${nested("right")}${add("right")}`;
      break;
    }
    case "quote":
      body = `<p class="muted">${esc(t("quote_hint"))}</p><div class="btnrow"><button class="btn sm ghost" data-act="open-settings">${esc(t("open_settings"))}</button></div>`;
      break;
    case "social":
      body = `<p class="muted">${esc(t("social_hint"))}</p><div class="btnrow"><button class="btn sm ghost" data-act="open-settings">${esc(t("open_settings"))}</button></div>`;
      break;
    case "contact":
      body = `<p class="muted">${esc(t("contact_hint"))}</p><div class="btnrow"><button class="btn sm ghost" data-act="open-settings">${esc(t("open_settings"))}</button></div>`;
      break;
    default:
      body = `<p class="warn">${esc(t("html_warn"))}</p>` + F("HTML", `<textarea data-bf="html" rows="10" class="mono">${esc(b.html || "")}</textarea>`);
  }
  return `<div class="pn__title">${IC[id] || ""}<b>${esc(t("block_" + id))}</b></div>${body}
    <div class="btnrow pn__foot"><button class="btn sm ghost" data-act="dup">${IC.copy}<span>${esc(t("duplicate"))}</span></button><button class="btn sm danger" data-act="del">${IC.trash}<span>${esc(t("delete"))}</span></button></div>`;
}

// ---------- page & SEO ----------
function panelPage() {
  const ed = state.ed, p = ed.page, lang = ed.lang, tr = curT();
  if (!tr) return `<p class="muted pn__hint">${esc(t("no_version_yet"))}</p>`;
  const isDef = lang === defLang();
  const title = tr.seoTitle || `${tr.h1 || tr.title} | ${state.site.name}`;
  const url = `${state.site.origin}${lang === defLang() ? "" : "/" + lang}${p.path === "/" ? "/" : p.path}`;
  const desc = tr.description || "";
  const auto = autoDescription(tr);
  const lf = (key, label, extra = "", hint = "") => F(label, `<input type="text" data-lf="${key}" value="${esc(tr[key] || "")}" ${extra}>`, hint);
  return `<h3 class="pn__h">${esc(t("page_content"))}</h3>` +
    lf("title", t("page_title"), "", t("page_title_hint")) + lf("h1", t("page_h1"), "", t("page_h1_hint")) +
    lf("navTitle", t("nav_title"), "", t("nav_title_hint")) + lf("lead", t("lead"), "", t("lead_hint")) +
    (isDef ? `<h3 class="pn__h">${esc(t("appearance"))}</h3>` +
      F(t("hero_image"), `<div class="row nowrap">${p.hero && p.hero.image ? `<img class="thumb" src="${esc(thumbUrl(p.hero.image.replace("/assets/img/", "")))}" alt="">` : ""}<button class="btn sm ghost" data-act="pick-hero">${esc(p.hero && p.hero.image ? t("change_image") : t("choose_image"))}</button>${p.hero && p.hero.image ? `<button class="btn sm ghost" data-act="hero-rm">${esc(t("remove"))}</button>` : ""}</div>`, t("hero_hint")) +
      F(t("page_type"), `<select data-rf="template">${TEMPLATES.map((x) => `<option value="${x}" ${(p.template || "page") === x ? "selected" : ""}>${esc(t("tpl_" + x))}</option>`).concat(p.template && !TEMPLATES.includes(p.template) ? [`<option selected>${esc(p.template)}</option>`] : []).join("")}</select>`, t("page_type_hint")) +
      F(t("status"), `<select data-rf="published" data-t="boolstr"><option value="true" ${p.published !== false ? "selected" : ""}>${esc(t("published"))}</option><option value="false" ${p.published === false ? "selected" : ""}>${esc(t("draft"))}</option></select>`, t("status_hint")) +
      (ed.isNew ? `<label class="chk"><input type="checkbox" id="add-parent" ${ed.addToParent ? "checked" : ""}> ${esc(t("add_to_parent"))}</label>` : "") : "") +
    visibilitySection(p) +
    `<h3 class="pn__h">${esc(t("search_engines"))}</h3>` +
    F(`${t("seo_title")}`, `<input type="text" data-lf="seoTitle" value="${esc(tr.seoTitle || "")}" placeholder="${esc(title)}"><span class="count" id="c-title"></span>`, t("seo_title_hint")) +
    F(t("meta_desc"), `<textarea data-lf="description" rows="3" placeholder="${esc(auto)}">${esc(desc)}</textarea><span class="count" id="c-desc"></span>
      <div class="btnrow"><button class="btn sm ghost" data-act="desc-auto">${esc(t("use_suggestion"))}</button><button class="btn sm ghost" data-act="desc-ai">${IC.sparkle}<span>${esc(t("write_with_ai"))}</span></button></div>`, t("meta_desc_hint")) +
    `<div class="serp"><div class="serp__url" id="serp-url">${esc(url)}</div><div class="serp__title" id="serp-title">${esc(title)}</div><div class="serp__desc" id="serp-desc">${esc(desc || auto || t("no_description"))}</div></div>` +
    `<label class="chk"><input type="checkbox" data-lf="noindex" data-t="bool" ${tr.noindex ? "checked" : ""}> ${esc(t("noindex"))}</label>` +
    `<h3 class="pn__h">${esc(t("address"))}</h3><p class="path">${esc(p.path)}</p><p class="muted">${esc(ed.isNew ? t("url_new_hint") : t("url_locked_hint"))}</p>` +
    (isDef ? `<details class="adv"><summary>${esc(t("advanced"))}</summary>${F(t("sort_order"), `<input type="number" data-rf="order" data-t="int" value="${esc(p.order ?? 100)}">`, t("sort_order_hint"))}</details>` : "");
}

// Which languages show this page (and everything below it). The default language always does.
function visibilitySection(p) {
  const def = defLang();
  const langs = siteLangs().filter((l) => l !== def);
  if (!langs.length) return "";
  const pages = new Map();
  for (const [path, x] of state.pages) pages.set(path, x.data);
  const parent = p.path.split("/").slice(0, -1).join("/") || "/";
  return `<h3 class="pn__h">${esc(t("vis_title"))}</h3><p class="muted">${esc(t("vis_hint"))}</p>` +
    `<div class="vis-row">` + langs.map((l) => {
      const inherited = p.path !== "/" && isHidden(pages, parent, l, def);
      const own = (p.hideIn || []).includes(l);
      return `<label class="chk"><input type="checkbox" data-hide-lang="${esc(l)}" ${own || inherited ? "" : "checked"} ${inherited ? "disabled" : ""}> ${esc(langLabel(l))}${inherited ? ` <span class="muted">(${esc(t("vis_inherited"))})</span>` : ""}</label>`;
    }).join("") + `</div>`;
}

// ---------- languages ----------
function panelLang() {
  const ed = state.ed, p = ed.page, src = srcLang(p);
  const ready = aiReady();
  const rows = siteLangs().map((l) => {
    const st = langStatus(p, l, ed.baseline);
    const meta = metaOf(p, l);
    let status = "", acts = "";
    const flag = `<img class="flag" src="/assets/flags/${esc(l)}.svg" alt="" width="22" height="15">`;
    const open = `<button class="btn sm ghost" data-lang-open="${esc(l)}">${esc(t("open"))}</button>`;
    switch (st.key) {
      case "source": status = `<span class="chip ok">${esc(t("st_source"))}</span>`; acts = l === ed.lang ? "" : open; break;
      case "missing":
        status = `<span class="chip off">${esc(t("st_missing"))}</span>`;
        acts = `<button class="btn sm primary" data-tr="${esc(l)}" data-all="1" ${ready ? "" : "disabled"}>${IC.sparkle}<span>${esc(t("translate_ai"))}</span></button><button class="btn sm ghost" data-empty="${esc(l)}">${esc(t("create_empty"))}</button>`;
        break;
      default: {
        const label = { auto: t("st_auto"), manual: t("st_manual"), reviewed: t("st_reviewed"), legacy: t("st_legacy") }[st.key] || st.key;
        status = `<span class="chip ${st.key === "reviewed" ? "ok" : st.key === "manual" ? "info" : "warn"}">${esc(label)}</span>` + (st.stale ? `<span class="chip stale">${esc(t("st_stale", { n: st.stale }))}</span>` : "") +
          (p.i18n[l] && p.i18n[l].noindex ? `<span class="chip">${esc(t("st_noindex"))}</span>` : "");
        acts = open +
          `<button class="btn sm primary" data-tr="${esc(l)}" ${ready ? "" : "disabled"} ${st.key === "manual" || !st.stale ? 'data-all="1"' : ""}>${IC.sparkle}<span>${esc(st.key === "manual" ? t("retranslate_overwrite") : st.stale ? t("update_changes") : t("retranslate"))}</span></button>` +
          (st.key === "auto" || st.key === "legacy" ? `<button class="btn sm ghost" data-review="${esc(l)}">${IC.check}<span>${esc(t("mark_reviewed"))}</span></button>` : "");
      }
    }
    void meta;
    return `<li class="lang-row ${l === ed.lang ? "is-on" : ""}"><div class="lang-row__h">${flag}<b>${esc(langLabel(l))}</b>${status}</div><div class="btnrow">${acts}</div></li>`;
  }).join("");
  const pol = (state.site.ai || {});
  return `<p class="muted pn__hint">${esc(t("lang_intro", { src: langLabel(src) }))}</p>
    ${ready ? "" : `<div class="notice">${esc(t("ai_not_configured"))} <button class="btn sm" data-act="open-settings">${esc(t("open_settings"))}</button></div>`}
    <ul class="lang-list">${rows}</ul>
    <h3 class="pn__h">${esc(t("auto_translate"))}</h3>
    <label class="chk"><input type="checkbox" data-rf="autoTranslate" data-t="boolnot" ${p.autoTranslate === false ? "" : "checked"}> ${esc(t("auto_translate_page"))}</label>
    <p class="muted">${esc(pol.autoTranslate ? t("auto_site_on") : t("auto_site_off"))}</p>
    <p class="muted">${esc(t("manual_protect_hint"))}</p>`;
}

// ---------- event wiring (delegation on the panel container) ----------
function parseValue(el) {
  let v = el.type === "checkbox" ? el.checked : el.value;
  switch (el.dataset.t) {
    case "int": v = parseInt(v, 10) || 0; break;
    case "bool": v = !!el.checked; break;
    case "boolnot": v = !!el.checked; break;
    case "boolstr": v = v === "true"; break;
    case "lines": v = String(v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean); break;
    case "yt": v = ytId(v); break;
    case "tablegroups": v = String(v).split(/\r?\n/).filter((l) => l.trim()).map((l) => { const [txt, n] = l.split("|"); return { text: (txt || "").trim(), span: parseInt(n, 10) || 1 }; }); break;
    case "paras": v = String(v).split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean); break;
    case "groups": v = textToGroups(v); break;
    case "table": {
      const rows = String(v).split(/\r?\n/).map((r) => r.split(/\t|;/).map((c) => c.trim())).filter((r) => r.some(Boolean));
      const w = Math.max(1, ...rows.map((r) => r.length));
      v = rows.map((r) => Array.from({ length: w }, (_, i) => r[i] || ""));
      break;
    }
    default:
  }
  return v;
}

export function bindPanel(el) {
  el.addEventListener("input", (e) => {
    const x = e.target;
    const ed = state.ed;
    if (x.dataset.bf !== undefined && ed.sel != null) {
      const v = parseValue(x);
      setField(ed.sel, x.dataset.bf, v === "" && /\.(title|image)$/.test(x.dataset.bf) ? undefined : v, { coalesce: `p:${ed.sel}:${x.dataset.bf}`, noPanel: true });
    } else if (x.dataset.lf !== undefined) {
      const v = parseValue(x);
      mutate(() => { if (v === "" || v === false) delete curT()[x.dataset.lf]; else curT()[x.dataset.lf] = v; }, { coalesce: "lf:" + x.dataset.lf, noPanel: true });
    } else if (x.dataset.rf !== undefined) {
      const key = x.dataset.rf;
      let v = parseValue(x);
      if (x.dataset.t === "boolnot") v = v ? undefined : false;
      mutate((pg) => { if (v === undefined) delete pg[key]; else pg[key] = v; }, { scope: "page", coalesce: "rf:" + key, noPanel: true });
    } else if (x.dataset.hideLang !== undefined) {
      const l = x.dataset.hideLang, show = x.checked;
      mutate((pg) => { const s = new Set(pg.hideIn || []); if (show) s.delete(l); else s.add(l); if (s.size) pg.hideIn = [...s]; else delete pg.hideIn; }, { scope: "page", noPanel: true });
    } else if (x.id === "add-parent") ed.addToParent = x.checked;
  });
  el.addEventListener("change", (e) => {
    const x = e.target;
    if (x.tagName === "SELECT" || x.type === "checkbox") x.dispatchEvent(new Event("input", { bubbles: true }));
    if (x.id === "add-parent") state.ed.addToParent = x.checked;
  });
  el.addEventListener("dragstart", (e) => {
    const tile = e.target.closest && e.target.closest("[data-new]");
    if (tile) { e.dataTransfer.setData("application/x-bk-new", tile.dataset.new); e.dataTransfer.effectAllowed = "copy"; return; }
    const li = e.target.closest && e.target.closest(".outline li");
    if (li) { e.dataTransfer.setData("application/x-bk-block", li.dataset.i); e.dataTransfer.effectAllowed = "move"; }
  });
  el.addEventListener("dragover", (e) => { if (e.target.closest && e.target.closest(".outline li") && [...e.dataTransfer.types].includes("application/x-bk-block")) e.preventDefault(); });
  el.addEventListener("drop", (e) => {
    const li = e.target.closest && e.target.closest(".outline li");
    if (!li || ![...e.dataTransfer.types].includes("application/x-bk-block")) return;
    e.preventDefault();
    const from = +e.dataTransfer.getData("application/x-bk-block");
    const r = li.getBoundingClientRect();
    const to = +li.dataset.i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    moveBlock(from, to);
  });
  el.addEventListener("click", async (e) => {
    const ed = state.ed;
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.new) return panelHooks.insertNew(b.dataset.new);
    if (b.dataset.select !== undefined) return panelHooks.selectBlock(+b.dataset.select, { open: true, scroll: true });
    if (b.dataset.oup !== undefined) { const i = +b.dataset.oup; if (i > 0) moveBlock(i, i - 1); return; }
    if (b.dataset.odown !== undefined) { const i = +b.dataset.odown; if (i < curBlocks().length - 1) moveBlock(i, i + 2); return; }
    if (b.dataset.odel !== undefined) { deleteBlock(+b.dataset.odel); return; }
    if (b.dataset.langOpen) return panelHooks.setLang(b.dataset.langOpen);
    if (b.dataset.tr) return panelHooks.translate(b.dataset.tr, { all: b.dataset.all === "1" });
    if (b.dataset.empty) return panelHooks.createEmpty(b.dataset.empty);
    if (b.dataset.review) return panelHooks.markReviewed(b.dataset.review);
    const act = b.dataset.act;
    if (!act) return;
    const i = ed.sel, blk = i != null ? curBlocks()[i] : null;
    switch (act) {
      case "dup": return duplicateBlock(i);
      case "del": return deleteBlock(i);
      case "open-settings": return panelHooks.openSettings();
      case "to-heading": mutate(() => { curBlocks()[i] = { type: "heading", level: 2, text: plainText(blk.html) }; }); return panelHooks.rerender();
      case "to-list": mutate(() => { curBlocks()[i] = { type: "list", ordered: false, items: String(blk.html || "").split(/<br\s*\/?>/i).map((s) => s.trim()).filter(Boolean) }; }); return panelHooks.rerender();
      case "pick-image": { const src = await pickImage(); if (src) { setField(i, "src", src); if (!blk.alt) setField(i, "alt", humanizeFilename(src.split("/").pop()) ); panelHooks.rerender(); } return; }
      case "pick-doc": { const href = await pickDoc(); if (href) { setField(i, "href", href); if (!blk.text) setField(i, "text", humanizeFilename(href.split("/").pop())); panelHooks.rerender(); } return; }
      case "pick-link": {
        const cur = blk[b.dataset.target] || "";
        const v = await pickLink({ current: cur, allowRemove: true });
        if (v != null) { setField(i, b.dataset.target, v || undefined); panelHooks.rerender(); }
        return;
      }
      case "nested-image": { const src = await pickImage(); if (src) { setField(i, `${b.dataset.path}.src`, src); panelHooks.rerender(); } return; }
      case "nested-rm": { const [side, j] = b.dataset.path.split("."); mutate(() => { blk[side].splice(+j, 1); }); return panelHooks.rerender(); }
      case "nested-add": { const side = b.dataset.side; mutate(() => { (blk[side] = blk[side] || []).push(newBlock(b.dataset.type, ed.lang)); }); return panelHooks.rerender(); }
      case "mod-add": mutate(() => { (blk.items = blk.items || []).push({ title: "", text: "", bullets: [] }); }); return panelHooks.rerender();
      case "mod-rm": mutate(() => { blk.items.splice(+b.dataset.ci, 1); }); return panelHooks.rerender();
      case "mod-up": { const ci = +b.dataset.ci; if (ci > 0) mutate(() => { const x = blk.items.splice(ci, 1)[0]; blk.items.splice(ci - 1, 0, x); }); return panelHooks.rerender(); }
      case "mod-image": { const src = await pickImage(); if (src) { setField(i, `items.${b.dataset.ci}.image`, src); panelHooks.rerender(); } return; }
      case "mod-link": {
        const path = `items.${b.dataset.ci}.href`;
        const v = await pickLink({ current: getPath(blk, path) || "", allowRemove: true });
        if (v != null) { setField(i, path, v || undefined); panelHooks.rerender(); }
        return;
      }
      case "car-add": { const src = await pickImage(); if (src) { mutate(() => { (blk.items = blk.items || []).push({ src, alt: humanizeFilename(src.split("/").pop()) }); }); panelHooks.rerender(); } return; }
      case "car-image": { const src = await pickImage(); if (src) { setField(i, `items.${b.dataset.ci}.src`, src); panelHooks.rerender(); } return; }
      case "car-rm": mutate(() => { blk.items.splice(+b.dataset.ci, 1); }); return panelHooks.rerender();
      case "car-up": { const ci = +b.dataset.ci; if (ci > 0) mutate(() => { const x = blk.items.splice(ci, 1)[0]; blk.items.splice(ci - 1, 0, x); }); return panelHooks.rerender(); }
      case "card-add": mutate(() => { blk.items.push({ href: [...state.pages.keys()].sort()[0] }); }); return panelHooks.rerender();
      case "card-rm": mutate(() => { blk.items.splice(+b.dataset.ci, 1); }); return panelHooks.rerender();
      case "card-image": { const src = await pickImage(); if (src) { setField(i, `items.${b.dataset.ci}.image`, src); panelHooks.rerender(); } return; }
      case "card-image-rm": mutate(() => { delete blk.items[+b.dataset.ci].image; }); return panelHooks.rerender();
      case "card-fill": {
        const here = ed.page.path;
        const have = new Set((blk.items || []).map((x) => x.href));
        const kids = [...state.pages.keys()].filter((k) => k !== "/" && (k.split("/").slice(0, -1).join("/") || "/") === here && !have.has(k))
          .sort((a, c) => (state.pages.get(a).data.order ?? 999) - (state.pages.get(c).data.order ?? 999));
        if (!kids.length) return toast(t("no_children"), "err");
        mutate(() => { for (const k of kids) { const h = state.pages.get(k).data.hero; blk.items.push({ href: k, ...(h && h.image ? { image: h.image } : {}) }); } });
        toast(t("n_added", { n: kids.length }));
        return panelHooks.rerender();
      }
      case "pick-hero": { const src = await pickImage(); if (src) { mutate((pg) => { pg.hero = { image: src }; }, { scope: "page" }); panelHooks.rerender(); } return; }
      case "hero-rm": mutate((pg) => { delete pg.hero; }, { scope: "page" }); return panelHooks.rerender();
      case "desc-auto": { const d = autoDescription(curT()); if (d) { mutate(() => { curT().description = d; }); panelHooks.rerender(); } return; }
      case "desc-ai": return panelHooks.describeWithAi();
      case "alt-suggest": return panelHooks.altWithAi(i);
      default:
    }
  });
}

export function updateSeoCounters() {
  const ed = state.ed; if (!ed) return;
  const tr = curT(); if (!tr) return;
  const title = tr.seoTitle || `${tr.h1 || tr.title} | ${state.site.name}`;
  const desc = tr.description || "";
  const ct = $("#c-title"), cd = $("#c-desc");
  if (ct) { ct.textContent = `${(tr.seoTitle || "").length || t("auto")} / 60`; ct.className = "count" + ((tr.seoTitle || "").length > 62 ? " warn" : ""); }
  if (cd) { cd.textContent = `${desc.length} / 155`; cd.className = "count" + (desc.length > 165 || (desc.length && desc.length < 70) ? " warn" : ""); }
  const st = $("#serp-title"), sd = $("#serp-desc");
  if (st) st.textContent = title;
  if (sd) sd.textContent = desc || autoDescription(tr) || t("no_description");
}

export { ai, modelHooks, clone, getPath, setPath, insertBlock };
