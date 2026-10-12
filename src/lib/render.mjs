// Pure rendering functions: no Node APIs, so the exact same code runs in the
// static build and in the CMS live preview (browser).
//
// ctx = {
//   site, lang, defaultLang, ui,                       // settings + UI dictionary for ctx.lang
//   pages: Map<path, page>,                            // every page object
//   url(path, lang?) -> site-relative href              // honours language prefix + urlStyle
//   abs(href) -> absolute URL
//   tr(path, lang?) -> translation object | null
//   children(path) -> [paths] sorted
//   image(src) -> { w, h, name, ext, widths:[…] } | null
//   fileSize(href) -> bytes | null
//   docInfo(href) -> { pages, thumb } | null
// }

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stripTags = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const fmtSize = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " MB" : Math.max(1, Math.round(n / 1e3)) + " kB");
export const telHref = (v) => {
  const d = String(v).replace(/[^\d+]/g, "");
  return "tel:" + (d.startsWith("+") ? d : d.startsWith("0") ? "+46" + d.slice(1) : d);
};
// ---------- edit mode (CMS visual editor only; the build never sets ctx.edit) ----------
// Every rendered block gets data-bk-i / data-bk-type on its top-level element(s) and
// every editable text gets data-bk-field, so the editor can map clicks back to the content model.
// ctx._fp is the field-path prefix while rendering blocks nested inside a "columns" block ("left.2.")
const editFld = (ctx, name, kind = "plain", ph = "") =>
  ctx.edit ? ` data-bk-field="${esc((ctx._fp || "") + name)}" data-bk-kind="${kind}"${ph ? ` data-bk-ph="${esc(ph)}"` : ""}` : "";

// Blocks with the contents of "columns" blocks spliced in (search index, description, share image)
export function flatBlocks(blocks) {
  return (blocks || []).flatMap((b) => (b && b.type === "columns" ? flatBlocks([...(b.left || []), ...(b.right || [])]) : [b]));
}
const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "link", "source", "area", "base", "col", "embed", "param", "track", "wbr"]);
function tagTop(html, attrs) {
  let depth = 0, out = "", last = 0, m;
  const re = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g;
  while ((m = re.exec(html))) {
    const [full, close, name, rest, selfc] = m;
    if (close) { depth = Math.max(0, depth - 1); continue; }
    if (depth === 0) { out += html.slice(last, m.index) + `<${name}${attrs}${rest}${selfc}>`; last = m.index + full.length; }
    if (!VOID_TAGS.has(name.toLowerCase()) && selfc !== "/") depth++;
  }
  return out + html.slice(last);
}
function blockIsEmpty(b) {
  switch (b.type) {
    case "image": return !b.src;
    case "cards": return !(b.items || []).length;
    case "video": return !b.id;
    case "table": return !(b.rows || []).some((r) => r.some(Boolean));
    case "datasheet": return !((b.groups || []).length || (b.intro || []).some(Boolean));
    case "chips": case "list": return !(b.items || []).some(Boolean);
    case "cta": return !b.title;
    case "carousel": return !(b.items || []).some((x) => x && x.src);
    case "modules": return !(b.items || []).length;
    case "html": return !(b.html || "").trim();
    case "columns": return !((b.left || []).length || (b.right || []).length);
    case "heading": case "text": return false;
    default: return false;
  }
}

const ICON = {
  chevron: '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  pdf: '<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true"><path d="M2 2h20l8 8v28H2z" fill="#fff" stroke="#c9c3bb" stroke-width="1.5"/><path d="M22 2v8h8" fill="#f4f2ef" stroke="#c9c3bb" stroke-width="1.5"/><rect x="2" y="20" width="22" height="11" rx="1.5" fill="#d93025"/><text x="13" y="28.5" text-anchor="middle" font-family="Arial,sans-serif" font-size="8" font-weight="700" fill="#fff">PDF</text></svg>',
  eye: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12m0 0l-5-5m5 5l5-5M4 20h16"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  external: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-6-6l6 6-6 6"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>'
};

// ---------- languages ----------
export const htmlLang = (ctx, code) => (ctx.site.languages && ctx.site.languages[code] && ctx.site.languages[code].htmlLang) || code;
export const flagSrc = (code) => `/assets/flags/${code}.svg`;

// ---------- links ----------
// Authored links are default-language paths ("/productos/marini"). In another
// language they point at that language's page when it exists, else fall back.
export function localizeHref(ctx, href) {
  if (!href || !href.startsWith("/") || href.startsWith("//") || href.startsWith("/assets/")) return href;
  let p = href, tail = "";
  const m = href.match(/^([^?#]*)([?#].*)?$/);
  if (m) { p = m[1]; tail = m[2] || ""; }
  try { p = decodeURIComponent(p); } catch { /* keep */ }
  p = p.replace(/\/+$/, "") || "/";
  if (ctx.hidden && ctx.hidden(p, ctx.lang) && ctx.visibleAncestor) return ctx.url(ctx.visibleAncestor(p, ctx.lang), ctx.lang) + tail;
  const lang = ctx.tr(p, ctx.lang) ? ctx.lang : ctx.defaultLang;
  return ctx.url(p, lang) + tail;
}
// Marker for outbound links: an arrow icon (CSS .ext::after) plus a hidden label for screen readers
const extLabel = (ctx) => `<span class="sr-only"> (${esc(ctx.ui.external_link || "extern länk")})</span>`;
export function localizeHtml(ctx, html) {
  return String(html || "").replace(/href="(\/[^"]*)"/g, (m, h) => `href="${esc(localizeHref(ctx, h.replace(/&amp;/g, "&")))}"`)
    .replace(/<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>([\s\S]*?)<\/a>/g, (m, pre, h, post, inner) => {
      if (isOwn(ctx, h)) return m;
      let attrs = `${pre}href="${h}"${post}`;
      if (!/\brel=/.test(attrs)) attrs += ' rel="noopener"';
      if (/<img\b/i.test(inner)) return `<a ${attrs.trim()}>${inner}</a>`; // image links get no icon
      attrs = /\bclass="/.test(attrs) ? attrs.replace(/\bclass="/, 'class="ext ') : attrs + ' class="ext"';
      return `<a ${attrs.trim()}>${inner}${extLabel(ctx)}</a>`;
    });
}
function isOwn(ctx, h) {
  try { return new URL(h).origin === new URL(ctx.site.origin).origin; } catch { return false; }
}

// ---------- images ----------
export function imgTag(ctx, src, alt, o = {}) {
  const info = ctx.image(src);
  const cls = o.cls ? ` class="${esc(o.cls)}"` : "";
  const loading = o.eager ? ` loading="eager" fetchpriority="high"` : ` loading="lazy" decoding="async"`;
  if (!info) return `<img src="${esc(src)}" alt="${esc(alt || "")}"${cls}${loading}>`;
  const dims = info.w && info.h ? ` width="${info.w}" height="${info.h}"` : "";
  if (info.ext === "svg" || info.ext === "gif" || !info.widths || !info.widths.length) {
    return `<img src="${esc(src)}" alt="${esc(alt || "")}"${dims}${cls}${loading}>`;
  }
  const srcset = info.widths.map((w) => `/assets/img/${info.name}-${w}.webp ${w}w`).join(", ");
  const i800 = info.widths.findIndex((w) => w >= 800);
  const fallback = `/assets/img/${info.name}-${info.widths[i800 >= 0 ? i800 : info.widths.length - 1]}.webp`;
  const sizes = o.sizes || "(min-width: 1200px) 1100px, 100vw";
  return `<img src="${fallback}" srcset="${srcset}" sizes="${esc(sizes)}" alt="${esc(alt || "")}"${dims}${cls}${loading}>`;
}

// ---------- helpers ----------
// A page is listed (menus, cards, strips, crumbs) when it is not hidden for this language and exists in it or in the default language.
const shown = (ctx, p) => !(ctx.hidden && ctx.hidden(p, ctx.lang)) && !!(ctx.tr(p, ctx.lang) || ctx.tr(p, ctx.defaultLang));
function titleOf(ctx, path) {
  const t = ctx.tr(path, ctx.lang) || ctx.tr(path, ctx.defaultLang);
  return t ? (t.h1 || t.title || path) : path;
}
const navTitleOf = (ctx, path) => {
  const t = ctx.tr(path, ctx.lang) || ctx.tr(path, ctx.defaultLang);
  return t ? (t.navTitle || t.title || t.h1 || path) : path;
};
const isUnder = (path, root) => path === root || path.startsWith(root + "/");
const ancestorsOf = (path) => {
  const out = [];
  const segs = path.split("/").filter(Boolean);
  let acc = "";
  for (let i = 0; i < segs.length - 1; i++) { acc += "/" + segs[i]; out.push(acc); }
  return out;
};

// ---------- blocks ----------
function renderCards(ctx, b) {
  const items = (b.items || []).map((it, idx) => [it, idx]).filter(([it]) => shown(ctx, it.href)).map(([it, idx]) => {
    const title = it.title || titleOf(ctx, it.href);
    const href = localizeHref(ctx, it.href);
    const img = it.image ? imgTag(ctx, it.image, it.alt || title, { cls: "card__img", sizes: "(min-width: 1000px) 280px, (min-width: 560px) 45vw, 100vw" }) : "";
    const text = it.text || ctx.edit ? `<p class="card__text"${editFld(ctx, `items.${idx}.text`)}>${esc(it.text || "")}</p>` : "";
    return `<li class="card"><a class="card__link" href="${esc(href)}">` +
      (img ? `<span class="card__media">${img}</span>` : "") +
      `<span class="card__body"><h${ctx._cardLevel || 3} class="card__title"${editFld(ctx, `items.${idx}.title`)}>${esc(title)}</h${ctx._cardLevel || 3}>${text}<span class="card__more">${esc(ctx.ui.read_more || "Läs mer")}${ICON.arrow}</span></span></a></li>`;
  }).join("");
  return `<ul class="cards">${items}</ul>`;
}

function renderVideo(ctx, b) {
  const title = b.title || ctx.ui.video_play || "Video";
  const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(b.id)}${b.start ? "&t=" + b.start + "s" : ""}`;
  const poster = ctx.ytThumb ? ctx.ytThumb(b.id) : null;
  return `<figure class="video${poster ? " video--poster" : ""}" data-yt="${esc(b.id)}"${b.start ? ` data-start="${esc(b.start)}"` : ""} data-title="${esc(title)}" data-watch="${esc(ctx.ui.video_watch || "Titta på YouTube")}">` +
    (poster ? `<img class="video__poster" src="${esc(poster)}" alt="" width="960" height="540" loading="lazy" decoding="async">` : "") +
    `<button class="video__play" type="button"><span class="video__icon" aria-hidden="true"></span>` +
    `<span class="video__label">${esc(ctx.ui.video_play || "Spela upp video")}</span>` +
    (b.title ? `<span class="video__title">${esc(b.title)}</span>` : "") +
    `<span class="video__note">${esc(ctx.ui.video_notice || "")}</span></button>` +
    `<noscript><a href="${esc(watch)}" rel="noopener">${esc(ctx.ui.video_watch || "Titta på YouTube")}</a></noscript></figure>`;
}

// Data table. rows[0] is the header row (unless header:false). Optional `groups` [{text, span}] adds a banded
// header row above it (column groups such as "Hollow bar drilling"); `caption` is the table's title.
function renderTable(ctx, b) {
  const rows = b.rows || [];
  if (!rows.length) return "";
  const head = b.header !== false ? rows[0] : null;
  const body = head ? rows.slice(1) : rows;
  const off = head ? 1 : 0;
  const groups = (Array.isArray(b.groups) ? b.groups : []).filter((g) => g && Number(g.span) > 0);
  const colGroup = [];
  groups.forEach((g, gi) => { for (let k = 0; k < Number(g.span); k++) colGroup.push(gi); });
  const tone = (i) => (colGroup[i] === undefined ? "" : ` class="g${colGroup[i] % 4}${colGroup[i - 1] !== colGroup[i] ? " gs" : ""}"`);
  const grp = groups.length
    ? `<tr class="tbl__groups">${groups.map((g, gi) => `<th scope="colgroup" colspan="${Number(g.span)}" class="g${gi % 4}${gi ? " gs" : ""}">${esc(g.text || "")}</th>`).join("")}</tr>`
    : "";
  const th = head || grp
    ? `<thead>${grp}${head ? `<tr class="tbl__cols">${head.map((c, x) => `<th scope="col"${tone(x)}${editFld(ctx, `rows.0.${x}`)}>${esc(c)}</th>`).join("")}</tr>` : ""}</thead>`
    : "";
  const tb = `<tbody>${body.map((r, y) => `<tr>${r.map((c, i) => (i === 0
    ? `<th scope="row"${editFld(ctx, `rows.${y + off}.${i}`)}>${esc(c)}</th>`
    : `<td${tone(i)}${editFld(ctx, `rows.${y + off}.${i}`)}>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody>`;
  // short numeric cells read better centred; text-heavy tables stay left-aligned
  const cells = body.flatMap((r) => r.slice(1));
  const avg = cells.length ? cells.reduce((n, c) => n + String(c).length, 0) / cells.length : 0;
  const centre = b.align === "center" || (b.align !== "left" && avg <= 16);
  const cls = ["table-wrap", groups.length ? "table-wrap--groups" : "", centre ? "table-wrap--center" : "", b.narrow ? "table-wrap--narrow" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" tabindex="0" role="region" aria-label="${esc(b.caption || ctx.ui.table_label || "Tabell")}"><table>${b.caption ? `<caption>${esc(b.caption)}</caption>` : ""}${th}${tb}</table></div>`;
}

// Technical data sheet: intro + one table per group (label | metric | imperial)
function renderDatasheet(ctx, b) {
  const groups = (b.groups || []).map((g, gi) => {
    const hasUs = g.rows.some((r) => r.us);
    const hasMetric = g.rows.some((r) => r.metric);
    const head = hasMetric || hasUs
      ? `<thead><tr><th scope="col"><span class="sr-only">${esc(ctx.ui.spec_property || "Egenskap")}</span></th>${hasMetric ? `<th scope="col">${esc(ctx.ui.spec_metric || "Metriskt")}</th>` : ""}${hasUs ? `<th scope="col">${esc(ctx.ui.spec_us || "Imperial")}</th>` : ""}</tr></thead>`
      : "";
    return `<div class="spec">${g.title ? `<h3 class="spec__title"${editFld(ctx, `groups.${gi}.title`)}>${esc(g.title)}</h3>` : ""}<table>${head}<tbody>${g.rows.map((r, ri) =>
      `<tr><th scope="row"${editFld(ctx, `groups.${gi}.rows.${ri}.label`)}>${esc(r.label)}</th>${hasMetric ? `<td${editFld(ctx, `groups.${gi}.rows.${ri}.${r.metric === undefined && r.value !== undefined ? "value" : "metric"}`)}>${esc(r.metric || r.value || "")}</td>` : ""}${hasUs ? `<td class="spec__us"${editFld(ctx, `groups.${gi}.rows.${ri}.us`)}>${esc(r.us || "")}</td>` : ""}</tr>`).join("")}</tbody></table></div>`;
  }).join("");
  const intro = (b.intro || []).map((p, j) => `<p${editFld(ctx, `intro.${j}`, "inline")}>${ctx.edit ? p : localizeHtml(ctx, p)}</p>`).join("");
  return `<section class="datasheet"><h2${editFld(ctx, "title")}>${esc(b.title || ctx.ui.technical_data || "Teknisk data")}</h2>` +
    (b.tagline ? `<p class="datasheet__tag"${editFld(ctx, "tagline")}>${esc(b.tagline)}</p>` : "") +
    (intro ? `<div class="datasheet__intro">${intro}</div>` : "") +
    (groups ? `<div class="spec-grid">${groups}</div>` : "") +
    (b.note ? `<p class="datasheet__note"${editFld(ctx, "note")}>${esc(b.note)}</p>` : "") + `</section>`;
}

function hoursText(ctx) {
  const h = (ctx.site.contact || {}).hours;
  if (!h || !h.opens || !h.closes) return "";
  return `${ctx.ui.hours_weekdays || "Måndag-fredag"} ${h.opens}-${h.closes}`;
}

function renderContact(ctx) {
  const c = ctx.site.contact || {};
  const parts = [];
  if (c.person && c.person.name) parts.push(`<li><span class="contact__label">${esc(ctx.ui.contact_person || "Kontaktperson")}</span><span>${esc(c.person.name)}</span></li>`);
  if (c.email) parts.push(`<li><span class="contact__label">${esc(ctx.ui.contact_email || "E-post")}</span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>`);
  for (const p of c.phones || []) parts.push(`<li><span class="contact__label">${esc(p.label || ctx.ui.contact_phone || "Telefon")}</span><a href="${esc(telHref(p.value))}">${esc(p.value)}</a></li>`);
  if (c.address) parts.push(`<li><span class="contact__label">${esc(ctx.ui.contact_address || "Adress")}</span><span>${esc(c.address)}</span></li>`);
  const hours = hoursText(ctx);
  if (hours) parts.push(`<li><span class="contact__label">${esc(ctx.ui.contact_hours || "Kontorstid")}</span><span>${esc(hours)}</span></li>`);
  const social = (ctx.site.social || []).map((s) => `<a class="social__link ext" href="${esc(s.url)}" rel="noopener me" target="_blank">${esc(s.name)}${extLabel(ctx)}</a>`).join("");
  return `<div class="contact"><ul class="contact__list">${parts.join("")}</ul>` +
    (social ? `<p class="contact__social">${social}</p>` : "") +
    `<p class="contact__org">${esc(ctx.site.legalName || ctx.site.name)}${ctx.site.orgNumber ? ` · ${esc(ctx.ui.org_no || "Org.nr")} ${esc(ctx.site.orgNumber)}` : ""}</p></div>`;
}

function renderChips(ctx, b) {
  return `<section class="chips">${b.title ? `<h2${editFld(ctx, "title")}>${esc(b.title)}</h2>` : ""}<ul class="chips__list">${(b.items || []).map((i, j) => `<li${editFld(ctx, `items.${j}`)}>${esc(i)}</li>`).join("")}</ul></section>`;
}

function renderCta(ctx, b) {
  const href = b.href ? localizeHref(ctx, b.href) : "";
  const label = ctx.edit ? `<span${editFld(ctx, "button")}>${esc(b.button || ctx.ui.contact_us || "Kontakta oss")}</span>` : esc(b.button || ctx.ui.contact_us || "Kontakta oss");
  return `<section class="cta"><div class="container cta__inner"><div class="cta__text"><h2${editFld(ctx, "title")}>${esc(b.title || "")}</h2>${b.text || ctx.edit ? `<p${editFld(ctx, "text")}>${esc(b.text || "")}</p>` : ""}</div>` +
    (href ? `<a class="btn btn--light" href="${esc(href)}">${label}${ICON.arrow}</a>` : "") + `</div></section>`;
}

// One document row: thumbnail, name, meta, View + Download
function renderDoc(ctx, b) {
  const external = b.external || /^https?:/.test(b.href || "");
  const info = !external && ctx.docInfo ? ctx.docInfo(b.href) : null;
  const size = !external && ctx.fileSize ? ctx.fileSize(b.href) : null;
  const meta = ["PDF"];
  if (info && info.pages) meta.push(`${info.pages} ${info.pages === 1 ? ctx.ui.page_one || "sida" : ctx.ui.page_many || "sidor"}`);
  if (size) meta.push(fmtSize(size));
  const view = external ? b.href : localizeHref(ctx, b.href);
  const dl = external && b.driveId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(b.driveId)}` : view;
  const thumb = info && info.thumb
    ? `<img src="${esc(info.thumb)}" alt="" loading="lazy" decoding="async" width="${info.thumbW || 120}" height="${info.thumbH || 160}">`
    : ICON.pdf;
  const dattr = ctx.edit && b.__i != null ? ` data-bk-i="${b.__i}" data-bk-type="button"` : "";
  return `<li class="doc"${dattr}><a class="doc__thumb" href="${esc(view)}" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">${thumb}</a>` +
    `<div class="doc__info"><span class="doc__name"${editFld(ctx, "text")}>${esc(b.text)}</span><span class="doc__meta">${esc(meta.join(" · "))}</span></div>` +
    `<div class="doc__actions"><a class="btn btn--sm" href="${esc(view)}" target="_blank" rel="noopener">${ICON.eye}<span>${esc(ctx.ui.doc_view || "Visa")}</span><span class="sr-only"> ${esc(b.text)}</span></a>` +
    `<a class="btn btn--sm btn--ghost" href="${esc(dl)}"${external ? ' rel="noopener"' : " download"}>${ICON.down}<span>${esc(ctx.ui.download || "Ladda ner")}</span><span class="sr-only"> ${esc(b.text)}</span></a></div></li>`;
}

// Two-column section: left / right hold ordinary blocks. ratio: "60-40" (default), "40-60", "50-50", "between".
function renderColumns(ctx, b) {
  const side = (key) => (b[key] || []).map((nb, j) => {
    const prev = ctx._fp;
    ctx._fp = `${prev || ""}${key}.${j}.`;
    try { return renderBlockInner(ctx, nb); } finally { ctx._fp = prev; }
  }).join("\n");
  const ratio = ["60-40", "40-60", "50-50", "between"].includes(b.ratio) ? b.ratio : "60-40";
  return `<div class="cols cols--${ratio}${b.valign === "center" ? " cols--center" : ""}"><div class="cols__a">${side("left")}</div><div class="cols__b">${side("right")}</div></div>`;
}

const SOCIAL_ICON = {
  facebook: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#fff" d="M13.5 21v-8h2.7l.5-3.2h-3.2V7.8c0-.9.4-1.6 1.7-1.6h1.6V3.4c-.3 0-1.3-.1-2.4-.1-2.5 0-4.1 1.5-4.1 4.2v2.3H7.6V13h2.7v8z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" stroke-width="1.9" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r=".7" fill="#fff"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="#fff" d="M5.2 9.4h3.1V19H5.2zM6.8 4.6a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6zM10.4 9.4h3v1.3c.5-.8 1.5-1.5 3-1.5 3.1 0 3.7 2 3.7 4.700V19H17v-4.600c0-1.100 0-2.500-1.500-2.500s-1.800 1.200-1.800 2.400V19h-3.300z"/></svg>'
};
// A row of small "module" cards side by side: picture, title, short text, bullet points, link and optional brochure.
// layout "cards": picture on top, up to three per row. layout "compact": picture left, text right, two per row.
function renderModules(ctx, b) {
  const items = (b.items || []).filter((it) => it && !(it.href && ctx.pages && ctx.pages.has(it.href) && !shown(ctx, it.href)));
  if (!items.length) return "";
  const layout = b.layout === "compact" ? "compact" : b.layout === "tiles" ? "tiles" : "cards";
  const cols = Math.max(1, Math.min(4, Number(b.columns) || (layout === "compact" ? 2 : Math.min(items.length, 3))));
  const lvl = ctx._cardLevel || 3;
  const more = esc(ctx.ui.read_more || "Läs mer");
  const li = items.map((it, i) => {
    const href = it.href ? (/^https?:/.test(it.href) ? it.href : localizeHref(ctx, it.href)) : "";
    const img = it.image ? imgTag(ctx, it.image, it.alt || it.title || "", { cls: "module__img", sizes: layout === "compact" ? "180px" : layout === "tiles" ? "(min-width: 900px) 560px, 100vw" : "(min-width: 900px) 330px, 90vw" }) : "";
    const media = img ? (href ? `<a class="module__media" href="${esc(href)}" tabindex="-1" aria-hidden="true">${img}</a>` : `<span class="module__media">${img}</span>`) : "";
    const title = it.title ? `<h${lvl} class="module__title"${editFld(ctx, `items.${i}.title`)}>${href ? `<a href="${esc(href)}">${esc(it.title)}</a>` : esc(it.title)}</h${lvl}>` : "";
    const text = it.text || ctx.edit ? `<p class="module__text"${editFld(ctx, `items.${i}.text`)}>${esc(it.text || "")}</p>` : "";
    const bullets = (it.bullets || []).length ? `<ul class="module__list">${it.bullets.map((x) => `<li>${ctx.edit ? esc(x) : localizeHtml(ctx, x)}</li>`).join("")}</ul>` : "";
    let doc = "";
    if (it.doc && it.doc.href) {
      const ext = /^https?:/.test(it.doc.href);
      const view = ext ? it.doc.href : localizeHref(ctx, it.doc.href);
      const dl = ext && it.doc.driveId ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(it.doc.driveId)}` : view;
      doc = `<span class="module__doc"><span class="module__doc-name">${esc(it.doc.text || ctx.ui.documents || "PDF")}</span>` +
        `<a class="btn btn--sm btn--ghost" href="${esc(view)}" target="_blank" rel="noopener">${ICON.eye}<span>${esc(ctx.ui.doc_view || "Visa")}</span></a>` +
        `<a class="btn btn--sm btn--ghost" href="${esc(dl)}"${ext ? ' rel="noopener"' : " download"}>${ICON.down}<span>${esc(ctx.ui.download || "Ladda ner")}</span></a></span>`;
    }
    const go = href && b.more !== false ? `<a class="btn btn--sm btn--solid" href="${esc(href)}">${more}${ICON.arrow}</a>` : "";
    return `<li class="module">${media}<div class="module__body">${title}${text}${bullets}${go || doc ? `<div class="module__actions">${go}${doc}</div>` : ""}</div></li>`;
  }).join("");
  return `<ul class="modules modules--${layout}" style="--cols:${cols}">${li}</ul>`;
}

// Image carousel. Native scroll-snap: swipe, trackpad and keyboard work without JavaScript; site.js adds arrows, dots
// and the optional autoplay (never with prefers-reduced-motion, stops as soon as the visitor touches it).
function renderCarousel(ctx, items, o = {}) {
  const slides = (items || []).filter((x) => x && x.src);
  if (!slides.length) return "";
  if (slides.length === 1) return renderBlockInner(ctx, { type: "image", ...slides[0] });
  const u = ctx.ui;
  const first = ctx.image(slides[0].src);
  const ratio = first && first.w && first.h ? Math.min(2, Math.max(1, first.w / first.h)) : 4 / 3;
  const secs = Math.max(2, Math.min(20, Number(o.interval) || 5));
  const auto = o.autoplay ? ` data-autoplay="${secs * 1000}"` : "";
  const li = slides.map((s, i) => {
    const img = imgTag(ctx, s.src, s.alt || "", { cls: "carousel__img", sizes: "(min-width: 900px) 760px, 100vw" });
    const inner = s.href ? `<a href="${esc(localizeHref(ctx, s.href))}"${/^https?:/.test(s.href) ? ' rel="noopener"' : ""}>${img}</a>` : img;
    const label = String(u.carousel_slide || "Bild {n} av {total}").replace("{n}", i + 1).replace("{total}", slides.length);
    return `<li class="carousel__slide" role="group" aria-roledescription="slide" aria-label="${esc(label)}">${inner}` +
      `${s.caption ? `<span class="carousel__cap">${esc(s.caption)}</span>` : ""}</li>`;
  }).join("");
  const dots = slides.map((_, i) => `<button type="button" class="carousel__dot" aria-label="${i + 1}"${i === 0 ? ' aria-current="true"' : ""}></button>`).join("");
  return `<section class="carousel" data-carousel${auto} style="--car-ar:${ratio.toFixed(3)}" aria-roledescription="carousel" aria-label="${esc(o.label || u.carousel_label || "Bildspel")}">` +
    `<ul class="carousel__track" tabindex="0">${li}</ul>` +
    `<button type="button" class="carousel__btn carousel__btn--prev" aria-label="${esc(u.carousel_prev || "Föregående")}">${ICON.prev}</button>` +
    `<button type="button" class="carousel__btn carousel__btn--next" aria-label="${esc(u.carousel_next || "Nästa")}">${ICON.next}</button>` +
    `<div class="carousel__dots">${dots}</div></section>`;
}

// Quote request form. Works without any third party: with no endpoint configured it opens the visitor's own
// e-mail program with the filled-in text. With site.quoteForm.endpoint set, site.js posts it there instead.
function renderQuote(ctx) {
  const u = ctx.ui, q = ctx.site.quoteForm || {}, c = ctx.site.contact || {};
  const T = (k, d) => esc(u[k] || d);
  const privacy = ctx.site.privacyPath && ctx.pages.has(ctx.site.privacyPath) ? ctx.url(ctx.site.privacyPath) : "";
  const f = (id, label, type, auto, req) =>
    `<p class="qf__f"><label for="q-${id}">${label}${req ? ` <span class="qf__req" aria-hidden="true">*</span>` : ""}</label>` +
    `<input id="q-${id}" name="${id}" type="${type}" autocomplete="${auto}"${req ? " required" : ""}></p>`;
  const extra = Object.entries(q.extra || {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  return `<section class="quote" id="offert" data-quote data-endpoint="${esc(q.endpoint || "")}" data-key="${esc(q.apiKey || "")}" data-mailto="${esc(c.email || "")}" ` +
    `data-subject="${T("quote_subject", "Offertförfrågan")}" data-about="${T("quote_about", "Gäller:")}" data-sending="${T("quote_sending", "Skickar…")}" data-ok="${T("quote_ok", "Tack! Vi återkommer så snart vi kan.")}" ` +
    `data-err="${T("quote_err", "Det gick inte att skicka. Ring oss eller skriv till oss direkt.")}" data-mail="${T("quote_mail", "Ditt e-postprogram öppnas med meddelandet ifyllt, tryck på Skicka där.")}">` +
    `<h2>${T("quote_title", "Begär offert")}</h2><p class="muted">${T("quote_intro", "Berätta kort vad du behöver, så återkommer vi.")}</p>` +
    `<form class="qf" method="post" action="${esc(q.endpoint || "#")}" novalidate>` +
    `<div class="qf__grid">${f("name", T("quote_name", "Namn"), "text", "name", true)}${f("company", T("quote_company", "Företag"), "text", "organization")}` +
    `${f("email", T("quote_email", "E-post"), "email", "email", true)}${f("phone", T("quote_phone", "Telefon"), "tel", "tel")}</div>` +
    `<p class="qf__f"><label for="q-message">${T("quote_message", "Vad behöver du hjälp med?")} <span class="qf__req" aria-hidden="true">*</span></label>` +
    `<textarea id="q-message" name="message" rows="5" required></textarea></p>` +
    `<p class="qf__trap" aria-hidden="true"><label>Website <input name="website" type="text" tabindex="-1" autocomplete="off"></label></p>` +
    `${extra}<input type="hidden" name="subject" value="${T("quote_subject", "Offertförfrågan")}">` +
    `<p class="qf__consent"><label><input type="checkbox" name="consent" required> <span>${T("quote_consent", "Jag godkänner att mina uppgifter används för att besvara min förfrågan.")}` +
    `${privacy ? ` <a href="${esc(privacy)}">${T("quote_privacy", "Läs mer i integritetspolicyn")}</a>` : ""}</span></label></p>` +
    `<p><button class="btn" type="submit">${T("quote_send", "Skicka förfrågan")}${ICON.arrow}</button></p>` +
    `<p class="qf__status" role="status" aria-live="polite"></p></form></section>`;
}

function renderSocial(ctx) {
  const items = (ctx.site.social || []).map((s) => {
    const key = String(s.name || "").toLowerCase();
    const icon = SOCIAL_ICON[key];
    return `<a class="social__icon social__icon--${esc(key)}" href="${esc(s.url)}" rel="noopener me" target="_blank" aria-label="${esc(s.name)}">${icon || esc(String(s.name || "").slice(0, 1))}</a>`;
  }).join("");
  return items ? `<p class="social">${items}</p>` : "";
}

export function renderBlock(ctx, b) {
  const html = renderBlockInner(ctx, b);
  if (!ctx.edit || b.__i == null) return html;
  if (b.type === "button" && b.kind === "download") return html; // renderDoc tags its own <li>
  const attrs = ` data-bk-i="${b.__i}" data-bk-type="${esc(b.type)}"`;
  if (!html.trim() || blockIsEmpty(b)) return `<div class="bk-empty"${attrs}>${esc((ctx.editLabels && ctx.editLabels[b.type]) || b.type)}</div>`;
  return tagTop(html, attrs);
}

function renderBlockInner(ctx, b) {
  switch (b.type) {
    case "heading": {
      const lvl = Math.min(4, Math.max(2, b.level || 2));
      return `<h${lvl}${editFld(ctx, "text", "plain", "Rubrik")}>${esc(b.text)}</h${lvl}>`;
    }
    case "text":
      return `<p${editFld(ctx, "html", "inline", "Skriv text här…")}>${ctx.edit ? b.html || "" : localizeHtml(ctx, b.html)}</p>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${(b.items || []).map((x, j) => `<li${editFld(ctx, `items.${j}`, "inline")}>${ctx.edit ? x : localizeHtml(ctx, x)}</li>`).join("")}</${tag}>`;
    }
    case "image": {
      const img = imgTag(ctx, b.src, b.alt || "", { sizes: "(min-width: 900px) 520px, 100vw" });
      const inner = b.href ? `<a href="${esc(localizeHref(ctx, b.href))}"${/^https?:/.test(b.href) ? ' rel="noopener"' : ""}>${img}</a>` : img;
      return `<figure class="figure${b.align === "right" ? " figure--right" : ""}"${b.maxWidth ? ` style="max-width:${Math.round(Number(b.maxWidth))}px"` : ""}>${inner}${b.caption ? `<figcaption${editFld(ctx, "caption")}>${esc(b.caption)}</figcaption>` : ""}</figure>`;
    }
    case "button": {
      const external = b.external || /^https?:/.test(b.href || "");
      if (b.kind === "download") return `<ul class="docs docs--single">${renderDoc(ctx, b)}</ul>`;
      const label = ctx.edit ? `<span${editFld(ctx, "text", "plain", "Knapptext")}>${esc(b.text)}</span>` : esc(b.text);
      return `<p class="btn-row"><a class="btn${b.full ? " btn--block" : ""}" href="${esc(external ? b.href : localizeHref(ctx, b.href))}"${external ? ' target="_blank" rel="noopener"' : ""}>${label}${external ? extLabel(ctx) : ""}${b.full ? "" : external ? ICON.external : ICON.arrow}</a></p>`;
    }
    case "cards": return renderCards(ctx, b);
    case "video": return renderVideo(ctx, b);
    case "table": return renderTable(ctx, b);
    case "datasheet": return renderDatasheet(ctx, b);
    case "contact": return renderContact(ctx);
    case "columns": return renderColumns(ctx, b);
    case "social": return renderSocial(ctx);
    case "quote": return renderQuote(ctx);
    case "carousel": return renderCarousel(ctx, b.items, b);
    case "modules": return renderModules(ctx, b);
    case "chips": return renderChips(ctx, b);
    case "cta": return renderCta(ctx, b);
    case "html": return b.html || "";
    default: return "";
  }
}

// Group the flow into: normal content (inside .container.prose) and full-bleed
// sections (document band, call-to-action) so they can break out of the column.
export function renderBlocks(ctx, blocks) {
  const out = [];
  let prose = [];
  let imgRun = [];
  const flushImgs = () => {
    if (!imgRun.length) return;
    // two or more pictures in a row become a carousel (the editor keeps them as separate, directly editable blocks)
    if (imgRun.length === 1) prose.push(renderBlock(ctx, imgRun[0]));
    else if (ctx.edit) prose.push(`<div class="gallery">${imgRun.map((x) => renderBlock(ctx, x)).join("")}</div>`);
    else prose.push(renderCarousel(ctx, imgRun));
    imgRun = [];
  };
  const flushProse = () => {
    flushImgs();
    if (prose.length) out.push(`<div class="container prose">${prose.join("\n")}</div>`);
    prose = [];
  };
  const list = blocks || [];
  let seenHeading = false; // card titles are h2 until the page has had a heading of its own, then h3 (no skipped levels)
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    ctx._cardLevel = seenHeading ? 3 : 2;
    if (b.type === "heading" || b.type === "datasheet" || (b.type === "button" && b.kind === "download")) seenHeading = true;
    if (b.type === "image") { imgRun.push(b); continue; }
    flushImgs();
    if (b.type === "button" && b.kind === "download") {
      const run = [];
      while (i < list.length && list[i].type === "button" && list[i].kind === "download") run.push(list[i++]);
      i--;
      flushProse();
      out.push(`<section class="docbar" aria-label="${esc(ctx.ui.documents || "Dokument")}"><div class="container"><h2 class="docbar__title">${esc(ctx.ui.documents || "Dokument")}</h2><ul class="docs">${run.map((d) => renderDoc(ctx, d)).join("")}</ul></div></section>`);
      continue;
    }
    if (!ctx.edit && b.type === "button" && b.kind !== "download") {
      const run = [];
      while (i < list.length && list[i].type === "button" && list[i].kind !== "download") run.push(list[i++]);
      i--;
      prose.push(run.length === 1 ? renderBlock(ctx, run[0]) : `<p class="btn-row btn-row--group">${run.map((x) => renderBlockInner(ctx, x).replace(/^<p class="btn-row">|<\/p>$/g, "")).join("")}</p>`);
      continue;
    }
    if (b.type === "cta" || b.type === "datasheet" && false) { flushProse(); out.push(renderBlock(ctx, b)); continue; }
    if (b.type === "columns" || b.type === "social" || b.type === "quote") { flushProse(); out.push(`<div class="container prose sect">${renderBlock(ctx, b)}</div>`); continue; }
    prose.push(renderBlock(ctx, b));
  }
  flushProse();
  return out.join("\n");
}

// ---------- chrome ----------
export function breadcrumbItems(ctx, path) {
  if (path === "/") return [];
  const segs = path.split("/").filter(Boolean);
  const items = [{ path: "/", name: ctx.ui.home || "Startsida" }];
  let acc = "";
  for (const s of segs) {
    acc += "/" + s;
    if (ctx.pages.has(acc) && shown(ctx, acc)) items.push({ path: acc, name: navTitleOf(ctx, acc) });
  }
  return items;
}

function renderBreadcrumbs(ctx, path) {
  const items = breadcrumbItems(ctx, path);
  if (items.length < 2) return "";
  const li = items.map((it, i) => {
    const last = i === items.length - 1;
    return last
      ? `<li aria-current="page"><span>${esc(it.name)}</span></li>`
      : `<li><a href="${esc(ctx.url(it.path))}">${esc(it.name)}</a></li>`;
  }).join("");
  return `<nav class="breadcrumbs" aria-label="${esc(ctx.ui.breadcrumbs || "Brödsmulor")}"><ol>${li}</ol></nav>`;
}

// Same page in another language; if it does not exist (or is hidden) there, the nearest page above it that does
function langLink(ctx, code, path) {
  let p = path;
  for (let guard = 0; guard < 12; guard++) {
    if (ctx.tr(p, code)) return ctx.url(p, code);
    const i = p.lastIndexOf("/");
    if (i <= 0) break;
    p = p.slice(0, i);
  }
  return ctx.url("/", code);
}

function renderLangSwitch(ctx, path) {
  const langs = Object.entries(ctx.site.languages || {}).filter(([code, l]) => l.published && (code === ctx.defaultLang || ctx.tr("/", code) || ctx.tr(path, code)));
  if (langs.length < 2) return "";
  const cur = ctx.lang;
  const label = (c) => (ctx.site.languages[c] && ctx.site.languages[c].label) || c;
  return `<details class="lang"><summary aria-label="${esc(ctx.ui.language || "Språk")}: ${esc(label(cur))}">` +
    `<img src="${flagSrc(cur)}" alt="" width="22" height="15"><span class="lang__code">${esc(cur.toUpperCase())}</span>${ICON.chevron}</summary>` +
    `<ul class="lang__list">${langs.map(([code]) =>
      `<li><a href="${esc(langLink(ctx, code, path))}" hreflang="${esc(htmlLang(ctx, code))}" lang="${esc(htmlLang(ctx, code))}"${code === cur ? ' aria-current="true"' : ""}>` +
      `<img src="${flagSrc(code)}" alt="" width="22" height="15"><span>${esc(label(code))}</span></a></li>`).join("")}</ul></details>`;
}

// brand logos come from a section's own listing cards (so the CMS keeps them in sync)
function brandLogoMap(ctx, root) {
  const rootT = ctx.tr(root, ctx.lang) || ctx.tr(root, ctx.defaultLang);
  const logos = new Map();
  for (const b of (rootT && rootT.blocks) || []) {
    if (b.type === "cards") for (const it of b.items) if (it.image && !logos.has(it.href)) logos.set(it.href, it.image);
  }
  return logos;
}

function renderLangRow(ctx, path) {
  const langs = Object.entries(ctx.site.languages || {}).filter(([code, l]) => l.published && (code === ctx.defaultLang || ctx.tr("/", code) || ctx.tr(path, code)));
  if (langs.length < 2) return "";
  const label = (c) => (ctx.site.languages[c] && ctx.site.languages[c].label) || c;
  return `<ul class="nav__langs" aria-label="${esc(ctx.ui.language || "Språk")}">` + langs.map(([code]) =>
    `<li><a href="${esc(langLink(ctx, code, path))}" hreflang="${esc(htmlLang(ctx, code))}" lang="${esc(htmlLang(ctx, code))}"${code === ctx.lang ? ' aria-current="true"' : ""}>` +
    `<img src="${flagSrc(code)}" alt="" width="22" height="15"><span>${esc(label(code))}</span></a></li>`).join("") + "</ul>";
}

function renderHeader(ctx, current) {
  const site = ctx.site;
  const navPaths = (site.nav && site.nav.length ? site.nav : []).filter((p) => ctx.pages.has(p) && shown(ctx, p));
  const items = navPaths.map((p) => {
    const kids = ctx.children(p).filter((c) => shown(ctx, c));
    const active = isUnder(current, p);
    const label = navTitleOf(ctx, p);
    const link = `<a href="${esc(ctx.url(p))}"${active && current === p ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
    if (!kids.length || !(site.megaMenu !== false)) return `<li class="nav__item${active ? " is-active" : ""}">${link}</li>`;
    // dropdown = the brand logos straight away (a row that follows the mouse sideways), no section label
    const logos = brandLogoMap(ctx, p);
    const tiles = kids.map((k) => {
      const src = (ctx.pages.get(k) && ctx.pages.get(k).logo) || logos.get(k);
      const name = navTitleOf(ctx, k);
      return `<li><a class="logorow__item" href="${esc(ctx.url(k))}">` +
        (src ? `<span class="logorow__img">${imgTag(ctx, src, name, { cls: "logorow__logo", sizes: "160px" })}</span>` : "") +
        `<span class="logorow__name">${esc(name)}</span></a></li>`;
    }).join("");
    return `<li class="nav__item nav__item--mega${active ? " is-active" : ""}">${link}` +
      `<button class="nav__toggle" type="button" aria-expanded="false" aria-label="${esc(ctx.ui.submenu || "Visa undermeny")}: ${esc(label)}">${ICON.chevron}</button>` +
      `<div class="mega mega--logos"><div class="container"><ul class="logorow" data-scrub>${tiles}</ul></div></div></li>`;
  }).join("");
  return `<header class="site-header" data-header><div class="container site-header__inner">` +
    `<a class="logo" href="${esc(ctx.url("/"))}" aria-label="${esc(site.name)}, ${esc(ctx.ui.home || "Startsida")}"><img src="/assets/brand/logo.svg" alt="${esc(site.name)}" width="237" height="25"></a>` +
    `<nav class="nav" id="site-nav" aria-label="${esc(ctx.ui.main_nav || "Huvudmeny")}"><ul class="nav__list">${items}</ul>${renderLangRow(ctx, current)}</nav>` +
    `<div class="header-tools"><button class="icon-btn" type="button" data-search-open aria-label="${esc(ctx.ui.search || "Sök")}">${ICON.search}</button>` +
    `${renderLangSwitch(ctx, current)}` +
    `<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav"><span class="nav-toggle__bars" aria-hidden="true"></span><span class="sr-only">${esc(ctx.ui.menu || "Meny")}</span></button></div>` +
    `</div></header>`;
}

// Section bar (the orange bar): while inside a section with a catalogue tree
// (default: /productos) show its direct children, and the active child's children below.
function renderSubnav(ctx, current) {
  const roots = ctx.site.sectionBars || ["/productos"];
  const root = roots.find((r) => isUnder(current, r) && ctx.pages.has(r));
  if (!root) return "";
  const avail = (p) => shown(ctx, p);
  const l1 = ctx.children(root).filter(avail);
  if (!l1.length) return "";
  const act1 = l1.find((p) => isUnder(current, p));
  const link = (p, cur, extra = "") => `<li><a class="subnav__link${cur ? " is-current" : ""}${extra}" href="${esc(ctx.url(p))}"${cur ? ' aria-current="true"' : ""}>${esc(navTitleOf(ctx, p))}</a></li>`;
  // brand logos come from the section's own listing cards (so the CMS keeps them in sync)
  const logos = brandLogoMap(ctx, root);
  const logoLink = (p, cur) => {
    const src = (ctx.pages.get(p) && ctx.pages.get(p).logo) || logos.get(p);
    const name = navTitleOf(ctx, p);
    if (!src) return link(p, cur);
    return `<li><a class="subnav__link subnav__link--logo${cur ? " is-current" : ""}" href="${esc(ctx.url(p))}"${cur ? ' aria-current="true"' : ""}>` +
      `${imgTag(ctx, src, name, { cls: "subnav__logo", sizes: "120px" })}</a></li>`;
  };
  // logos straight away (no "PRODUKTER" label); the row follows the mouse sideways (data-scrub)
  // The pinned logo strip duplicates the logo dropdown in the header; kept behind a switch (site.json: sectionBarLogos)
  const bar1 = ctx.site.sectionBarLogos !== true ? "" : `<nav class="subnav subnav--1" aria-label="${esc(navTitleOf(ctx, root))}"><div class="container"><ul data-scrub>` +
    l1.map((p) => logoLink(p, p === act1)).join("") + `</ul></div></nav>`;
  let bar2 = "";
  if (act1) {
    const l2 = ctx.children(act1).filter(avail);
    if (l2.length) {
      const act2 = l2.find((p) => isUnder(current, p));
      bar2 = `<nav class="subnav subnav--2" aria-label="${esc(navTitleOf(ctx, act1))}"><div class="container"><ul data-scrub>` +
        `<li class="subnav__root"><a class="subnav__link${current === act1 ? " is-current" : ""}" href="${esc(ctx.url(act1))}">${esc(navTitleOf(ctx, act1))}</a></li>` +
        l2.map((p) => link(p, p === act2)).join("") + `</ul></div></nav>`;
    }
  }
  return bar1 + bar2;
}

// Sticky "call us" bar for phones: visitors are often on a building site with one hand free
function renderCallBar(ctx) {
  const phones = (ctx.site.contact || {}).phones || [];
  const p = phones.find((x) => /^\s*(\+?46|0)\s*-?\s*7/.test(x.value || "")) || phones.find((x) => /mobil|mobile|móvil/i.test(x.label || "")) || phones[0];
  if (!p) return "";
  return `<div class="callbar"><a class="callbar__link" href="${esc(telHref(p.value))}">${ICON.phone}<span class="callbar__text">${esc(ctx.ui.call_us || "Ring oss")}</span><span class="callbar__num">${esc(p.value)}</span></a></div>`;
}

function renderFooter(ctx) {
  const s = ctx.site;
  const c = s.contact || {};
  const avail = (p) => shown(ctx, p);
  const brands = ctx.pages.has("/productos") ? ctx.children("/productos").filter(avail) : [];
  const company = (s.nav || []).filter((p) => p !== "/productos" && ctx.pages.has(p) && avail(p));
  const privacyPath = s.privacyPath && ctx.pages.has(s.privacyPath) && avail(s.privacyPath) ? s.privacyPath : null;
  const social = (s.social || []).map((x) => `<li><a class="ext" href="${esc(x.url)}" rel="noopener me" target="_blank">${esc(x.name)}${extLabel(ctx)}</a></li>`).join("");
  const analyticsOn = s.analytics && s.analytics.enabled && s.analytics.measurementId;
  const phones = (c.phones || []).map((p) => `<li>${ICON.phone}<span class="sr-only">${esc(p.label || "")}: </span><a href="${esc(telHref(p.value))}">${esc(p.value)}</a></li>`).join("");
  return `<footer class="site-footer"><div class="container site-footer__grid">` +
    `<div class="site-footer__about"><img class="site-footer__emblem" src="/assets/brand/emblem.webp" alt="" width="64" height="62" loading="lazy"><img class="site-footer__logo" src="/assets/brand/logo-white.svg" alt="${esc(s.name)}" width="205" height="21" loading="lazy">` +
    `<p>${esc(s.legalName || s.name)}</p>${s.orgNumber ? `<p class="muted">${esc(ctx.ui.org_no || "Org.nr")} ${esc(s.orgNumber)}</p>` : ""}${s.tagline ? `<p class="muted">${esc(ctx.site.tagline)}</p>` : ""}</div>` +
    (brands.length ? `<nav aria-label="${esc(navTitleOf(ctx, "/productos"))}"><h2 class="site-footer__h">${esc(navTitleOf(ctx, "/productos"))}</h2><ul class="site-footer__links site-footer__links--cols">${brands.map((b) => `<li><a href="${esc(ctx.url(b))}">${esc(navTitleOf(ctx, b))}</a></li>`).join("")}</ul></nav>` : "") +
    `<nav aria-label="${esc(ctx.ui.footer_nav || "Sidfot")}"><h2 class="site-footer__h">${esc(ctx.ui.company || "Företaget")}</h2><ul class="site-footer__links">${company.map((p) => `<li><a href="${esc(ctx.url(p))}">${esc(navTitleOf(ctx, p))}</a></li>`).join("")}` +
    `${privacyPath ? `<li><a href="${esc(ctx.url(privacyPath))}">${esc(navTitleOf(ctx, privacyPath))}</a></li>` : ""}` +
    `${analyticsOn ? `<li><button type="button" class="linklike" data-consent-open>${esc(ctx.ui.cookie_settings || "Cookie-inställningar")}</button></li>` : ""}</ul></nav>` +
    `<div><h2 class="site-footer__h">${esc(ctx.ui.contact_us || "Kontakt")}</h2><ul class="site-footer__contact">` +
    `${c.email ? `<li>${ICON.mail}<a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>` : ""}${phones}</ul>` +
    `${c.address ? `<p class="muted">${esc(c.address)}</p>` : ""}${hoursText(ctx) ? `<p class="muted">${esc(ctx.ui.contact_hours || "Kontorstid")}: ${esc(hoursText(ctx))}</p>` : ""}${social ? `<ul class="site-footer__links site-footer__social">${social}</ul>` : ""}</div>` +
    `</div><div class="site-footer__legal"><div class="container"><small>© ${new Date().getFullYear()} ${esc(s.legalName || s.name)}</small></div></div></footer>`;
}

// ---------- SEO ----------
export function seoTitle(ctx, page, t) {
  const s = ctx.site;
  if (t.seoTitle) return t.seoTitle;
  if (page.path === "/") return `${s.name} | ${t.tagline || s.tagline || t.h1}`;
  const base = t.h1 || t.title;
  const segs = page.path.split("/").filter(Boolean);
  let brand = "";
  if (segs.length >= 3) {
    const bp = "/" + segs.slice(0, 2).join("/");
    const bt = ctx.tr(bp, ctx.lang) || ctx.tr(bp, ctx.defaultLang);
    if (bt) brand = bt.h1 || bt.title;
  }
  const withBrand = brand && brand !== base ? `${base} | ${brand}` : base;
  const full = `${withBrand} | ${s.name}`;
  return full.length <= 62 ? full : `${base} | ${s.name}`;
}

// Keep meta descriptions at snippet length (search engines cut at ~155-160 chars)
const clip = (s, n = 160) => (s.length <= n + 6 ? s : s.slice(0, s.lastIndexOf(" ", n - 2)).replace(/[,.;:s-]+$/, "") + "…");
function pageDescription(ctx, page, t) {
  if (t.description && t.description.trim()) return clip(t.description.trim());
  const first = flatBlocks(t.blocks).find((b) => b.type === "text");
  const txt = first ? stripTags(first.html) : t.lead || "";
  if (txt.length > 50) return txt.length > 158 ? txt.slice(0, txt.lastIndexOf(" ", 155)) + "…" : txt;
  return `${t.h1 || t.title}: ${ctx.site.tagline || ctx.site.name}`;
}

function ogImage(ctx, page, t) {
  const cand = (page.hero && page.hero.image) || (flatBlocks(t.blocks).find((b) => b.type === "image") || {}).src
    || ((t.blocks || []).flatMap((b) => (b.type === "cards" ? b.items : [])).find((i) => i.image) || {}).image;
  if (cand) {
    const info = ctx.image(cand);
    if (info && info.widths && info.widths.length) {
      const w = info.widths.find((x) => x >= 1200) || info.widths[info.widths.length - 1];
      return ctx.abs(`/assets/img/${info.name}-${w}.webp`);
    }
    return ctx.abs(cand);
  }
  return ctx.abs("/assets/brand/og-default.png");
}

function jsonLd(ctx, page, t, canonical, crumbs) {
  const s = ctx.site;
  const org = {
    "@type": "Organization",
    "@id": ctx.abs("/") + "#org",
    name: s.legalName || s.name,
    alternateName: s.name,
    url: ctx.abs("/"),
    logo: ctx.abs("/assets/brand/logo.png"),
    ...(s.contact && s.contact.email ? { email: s.contact.email } : {}),
    ...(s.contact && s.contact.phones && s.contact.phones.length ? { telephone: s.contact.phones.map((p) => telHref(p.value).replace("tel:", "")) } : {}),
    ...(s.contact && s.contact.addressDetail ? { address: { "@type": "PostalAddress", streetAddress: s.contact.addressDetail.street, postalCode: s.contact.addressDetail.postalCode, addressLocality: s.contact.addressDetail.locality, addressRegion: s.contact.addressDetail.region, addressCountry: s.contact.addressDetail.country || "SE" } } : {}),
    ...(s.contact && s.contact.hours && s.contact.hours.opens && s.contact.phones && s.contact.phones.length ? { contactPoint: { "@type": "ContactPoint", contactType: "customer service", telephone: telHref(s.contact.phones[0].value).replace("tel:", ""), ...(s.contact.email ? { email: s.contact.email } : {}), areaServed: "ES", availableLanguage: ["es", "en"], hoursAvailable: { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: s.contact.hours.opens, closes: s.contact.hours.closes } } } : {}),
    ...(s.orgNumber ? { identifier: s.orgNumber } : {}),
    ...(s.social && s.social.length ? { sameAs: s.social.map((x) => x.url) } : {})
  };
  const graph = [org];
  if (page.path === "/") {
    graph.push({ "@type": "WebSite", "@id": ctx.abs("/") + "#website", url: ctx.abs("/"), name: s.name, inLanguage: htmlLang(ctx, ctx.lang), publisher: { "@id": org["@id"] } });
  }
  const type = page.template === "contact" ? "ContactPage" : "WebPage";
  graph.push({
    "@type": type, "@id": canonical + "#webpage", url: canonical, name: seoTitle(ctx, page, t),
    description: pageDescription(ctx, page, t), inLanguage: htmlLang(ctx, ctx.lang), isPartOf: { "@id": ctx.abs("/") + "#website" },
    ...(crumbs.length > 1 ? { breadcrumb: { "@id": canonical + "#breadcrumb" } } : {}),
    primaryImageOfPage: { "@type": "ImageObject", url: ogImage(ctx, page, t) }
  });
  if (crumbs.length > 1) {
    graph.push({
      "@type": "BreadcrumbList", "@id": canonical + "#breadcrumb",
      itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: ctx.abs(ctx.url(c.path)) }))
    });
  }
  if (page.template === "product") {
    const segs = page.path.split("/").filter(Boolean);
    const brandT = segs.length >= 2 ? (ctx.tr("/" + segs.slice(0, 2).join("/"), ctx.lang) || ctx.tr("/" + segs.slice(0, 2).join("/"), ctx.defaultLang)) : null;
    graph.push({
      "@type": "Product", "@id": canonical + "#product", name: t.h1 || t.title, description: pageDescription(ctx, page, t),
      url: canonical, image: ogImage(ctx, page, t),
      ...(brandT ? { brand: { "@type": "Brand", name: brandT.h1 || brandT.title } } : {}),
      mainEntityOfPage: { "@id": canonical + "#webpage" }
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}

// ---------- main entry ----------
// Product / brand pages: [logo | photo(s)] left, [intro text | spec list] right,
// the way the original page was laid out. The brand logo that links back to the
// brand moves into the breadcrumb row.
function composeBody(ctx, page, t) {
  const blocks = (t.blocks || []).map((b, i) => (ctx.edit ? { ...b, __i: i } : b));
  let crumbLogo = null;
  const anc = ancestorsOf(page.path);
  const li = blocks.findIndex((b) => b.type === "image" && b.href && anc.includes(b.href));
  if (li >= 0 && li <= 1) { crumbLogo = blocks.splice(li, 1)[0]; }
  let splitHtml = "";
  const template = page.template || "page";
  if (template === "brand" || template === "product") {
    let n = 0;
    while (n < blocks.length && ["image", "carousel", "text", "list", "heading"].includes(blocks[n].type)) n++;
    const lead = blocks.slice(0, n);
    const isMedia = (b) => (b.type === "image" && !b.inline) || b.type === "carousel";
    const media = lead.filter(isMedia);
    const text = lead.filter((b) => !isMedia(b));
    if (media.length && text.length) {
      blocks.splice(0, n);
      splitHtml = `<div class="container"><div class="split"><div class="split__media">${media.map((b) => renderBlock(ctx, b)).join("")}</div>` +
        `<div class="split__body prose">${text.map((b) => renderBlock(ctx, b)).join("\n")}</div></div></div>`;
    }
  }
  return { crumbLogo, splitHtml, rest: blocks };
}

// Closing "request a quote" band on product pages (not in the editor; skipped when the page has its own cta/quote block;
// switch off with site.productQuoteCta = false). The product name travels in ?produkt= and pre-fills the form.
function productQuoteCta(ctx, page, t, name) {
  if (ctx.edit || page.template !== "product" || ctx.site.productQuoteCta === false) return "";
  if (!ctx.pages.has("/contacto") || !shown(ctx, "/contacto")) return "";
  if (flatBlocks(t.blocks || []).some((b) => b.type === "cta" || b.type === "quote")) return "";
  const u = ctx.ui;
  if (t.title && t.title !== name && t.title.length <= 12) name = `${t.title}, ${name}`; // short model code + name, e.g. "ST-5, Silon"
  const href = localizeHref(ctx, "/contacto") + "?produkt=" + encodeURIComponent(name) + "#offert";
  const title = String(u.quote_cta_title || "Vill du ha offert på {name}?").replace("{name}", name);
  return `<section class="cta"><div class="container cta__inner"><div class="cta__text"><h2>${esc(title)}</h2><p>${esc(u.quote_cta_text || "Berätta kort vad du behöver, så återkommer vi med pris och leveranstid.")}</p></div>` +
    `<a class="btn btn--light" href="${esc(href)}">${esc(u.quote_title || "Begär offert")}${ICON.arrow}</a></div></section>`;
}

export function renderMain(ctx, page, t) {
  const { crumbLogo, splitHtml, rest } = composeBody(ctx, page, t);
  const crumbs = renderBreadcrumbs(ctx, page.path);
  const logo = crumbLogo
    ? `<a class="crumbs__logo" href="${esc(localizeHref(ctx, crumbLogo.href))}"${ctx.edit && crumbLogo.__i != null ? ` data-bk-i="${crumbLogo.__i}" data-bk-type="image"` : ""}>${imgTag(ctx, crumbLogo.src, crumbLogo.alt || "", { sizes: "120px" })}</a>`
    : "";
  const heroImg = page.hero && page.hero.image ? page.hero.image : null;
  const title = t.h1 || t.title;
  const isHome = page.path === "/";
  const anc = ancestorsOf(page.path).filter((p) => ctx.pages.has(p) && shown(ctx, p));
  const eyebrow = !isHome && anc.length ? `<p class="hero__eyebrow">${anc.slice(-2).map((p) => esc(navTitleOf(ctx, p))).join(" · ")}</p>` : "";
  const ctas = (t.ctas || []).map((c, i) => `<a class="btn${i ? " btn--ghost-light" : ""}" href="${esc(localizeHref(ctx, c.href))}">${esc(c.text)}${i ? "" : ICON.arrow}</a>`).join("");
  const pageFld = (k) => (ctx.edit ? ` data-bk-page="${k}" data-bk-kind="plain"` : "");
  const heroInner = `<div class="container hero__inner">${eyebrow}<h1 class="hero__title"${pageFld("h1")}>${esc(title)}</h1>${t.lead || (ctx.edit && heroImg) ? `<p class="hero__lead"${pageFld("lead")}>${esc(t.lead || "")}</p>` : ""}${ctas ? `<div class="hero__ctas">${ctas}</div>` : ""}</div>`;
  const hero = heroImg
    ? `<section class="hero${isHome ? " hero--home" : ""}">${imgTag(ctx, heroImg, "", { cls: "hero__img", eager: true, sizes: "100vw" })}<div class="hero__shade"></div>${heroInner}</section>`
    : `<section class="page-head${page.template === "about" ? " page-head--center" : ""}"><div class="container">${page.template === "about" ? "" : eyebrow}<h1${pageFld("h1")}>${esc(title)}</h1></div></section>`;
  const crumbRow = crumbs || logo ? `<div class="container crumbs${page.template === "about" && !heroImg ? " crumbs--center" : ""}">${crumbs}${logo}</div>` : "";
  return `${hero}${crumbRow}<div class="page-body page--${esc(page.template || "page")}">${splitHtml}${renderBlocks(ctx, rest)}${productQuoteCta(ctx, page, t, title)}</div>`;
}

export function renderDocument(ctx, page, t, opts = {}) {
  const s = ctx.site;
  const lang = ctx.lang;
  const canonical = ctx.abs(ctx.url(page.path, lang));
  const crumbs = breadcrumbItems(ctx, page.path);
  const title = seoTitle(ctx, page, t);
  const desc = pageDescription(ctx, page, t);
  const img = ogImage(ctx, page, t);
  const robots = page.published === false || t.noindex ? "noindex,nofollow" : "index,follow,max-image-preview:large,max-snippet:-1";
  const alts = Object.entries(s.languages || {}).filter(([code, l]) => l.published && ctx.tr(page.path, code));
  const alternates = alts.length > 1
    ? alts.map(([code]) => `<link rel="alternate" hreflang="${esc(htmlLang(ctx, code))}" href="${esc(ctx.abs(ctx.url(page.path, code)))}">`).join("\n") +
      `\n<link rel="alternate" hreflang="x-default" href="${esc(ctx.abs(ctx.url(page.path, ctx.defaultLang)))}">`
    : "";
  const theme = s.theme || {};
  const cssVars = `:root{--primary:${theme.primary || "#f4791f"};--dark:${theme.dark || "#293a51"};--surface:${theme.surface || "#f1f4f8"};--text:${theme.text || theme.dark || "#1f2d40"};--accent:${theme.accent || "#2f77a6"}}`;
  const analytics = s.analytics && s.analytics.enabled && s.analytics.measurementId
    ? { provider: s.analytics.provider || "ga4", id: s.analytics.measurementId }
    : null;
  const uiForJs = {
    title: ctx.ui.cookie_title, text: ctx.ui.cookie_text, accept: ctx.ui.cookie_accept, reject: ctx.ui.cookie_reject,
    policy: ctx.ui.cookie_policy_link, play: ctx.ui.video_play, loading: ctx.ui.video_loading,
    search: ctx.ui.search, searchPlaceholder: ctx.ui.search_placeholder, searchNone: ctx.ui.search_no_results, searchClose: ctx.ui.search_close
  };
  const privacyPath = s.privacyPath && ctx.pages.has(s.privacyPath) && (ctx.tr(s.privacyPath, lang) || ctx.tr(s.privacyPath, ctx.defaultLang)) ? ctx.url(s.privacyPath) : "";
  const cfg = JSON.stringify({ analytics, ui: uiForJs, privacy: privacyPath, searchIndex: ctx.searchIndexUrl ? ctx.searchIndexUrl : "/search-index.json" }).replace(/</g, "\\u003c");
  const ver = opts.assetVersion ? `?v=${opts.assetVersion}` : "";
  return `<!doctype html>
<html lang="${esc(htmlLang(ctx, lang))}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="${robots}">
${alternates}
<meta property="og:site_name" content="${esc(s.name)}">
<meta property="og:type" content="${page.path === "/" ? "website" : "article"}">
<meta property="og:locale" content="${esc((s.languages[lang] && s.languages[lang].locale) || lang)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${esc(theme.dark || "#293a51")}">
<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32">
<link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preload" href="/assets/fonts/montserrat-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/site.css${ver}">
<style>${cssVars}</style>
<script>document.documentElement.className="js"</script>
<script type="application/ld+json">${jsonLd(ctx, page, t, canonical, crumbs).replace(/</g, "\\u003c")}</script>
</head>
<body>
<a class="skip-link" href="#main">${esc(ctx.ui.skip || "Hoppa till innehåll")}</a>
${renderHeader(ctx, page.path)}
${renderSubnav(ctx, page.path)}
<main id="main">
${renderMain(ctx, page, t)}
</main>
${renderFooter(ctx)}
${renderCallBar(ctx)}
<script type="application/json" id="bk-config">${cfg}</script>
<script src="/js/site.js${ver}" defer></script>
</body>
</html>
`;
}

export function renderNotFound(ctx) {
  const t = { title: ctx.ui.not_found_title || "Sidan hittades inte", h1: ctx.ui.not_found_title || "Sidan hittades inte", blocks: [
    { type: "text", html: esc(ctx.ui.not_found_text || "Sidan du söker finns inte eller har flyttats.") },
    { type: "button", kind: "link", text: ctx.ui.back_home || "Till startsidan", href: "/" }
  ], noindex: true };
  const page = { path: "/404", template: "page", published: false, hero: null };
  return renderDocument(ctx, page, t);
}
