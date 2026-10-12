// Which strings of a page are translatable text. Shared by tools/i18n.mjs (CLI)
// and the CMS (AI translation), so both always agree on what a "unit" is.
//
// visit(page, t, cb): calls cb(id, value, set) for every translatable string of the
// language object `t`. `set(newValue)` writes the translation back into `t`.
// Ids are stable for the same structure: "<page path>|b3.groups.0.rows.2.label"
// (blocks nested in a "columns" block: "<page path>|b3.left.1.html").

function visitBlock(b, pre, P, cb) {
  const id = (f) => `${P}|${pre}.${f}`;
  if (!b || typeof b !== "object") return;
  if (b.type === "columns") {
    for (const side of ["left", "right"]) (b[side] || []).forEach((nb, j) => visitBlock(nb, `${pre}.${side}.${j}`, P, cb));
    return;
  }
  if (b.type === "heading") cb(id("text"), b.text, (v) => (b.text = v));
  if (b.type === "text") cb(id("html"), b.html, (v) => (b.html = v));
  if (b.type === "html") return;
  if (b.type === "list") (b.items || []).forEach((it, j) => cb(id(`items.${j}`), it, (v) => (b.items[j] = v)));
  if (b.type === "button") cb(id("text"), b.text, (v) => (b.text = v));
  if (b.type === "image") { if (b.alt) cb(id("alt"), b.alt, (v) => (b.alt = v)); if (b.caption) cb(id("caption"), b.caption, (v) => (b.caption = v)); }
  if (b.type === "video" && b.title) cb(id("title"), b.title, (v) => (b.title = v));
  if (b.type === "table") (b.rows || []).forEach((r, y) => r.forEach((c, x) => { if (c && /[A-Za-zÅÄÖåäö]{4,}/.test(c)) cb(id(`rows.${y}.${x}`), c, (v) => (b.rows[y][x] = v)); }));
  if (b.type === "chips") {
    if (b.title) cb(id("title"), b.title, (v) => (b.title = v));
    (b.items || []).forEach((it, j) => cb(id(`items.${j}`), it, (v) => (b.items[j] = v)));
  }
  if (b.type === "cta") {
    for (const k of ["title", "text", "button"]) if (b[k]) cb(id(k), b[k], (v) => (b[k] = v));
  }
  if (b.type === "datasheet") {
    for (const k of ["title", "tagline", "note"]) if (b[k]) cb(id(k), b[k], (v) => (b[k] = v));
    (b.intro || []).forEach((p, j) => cb(id(`intro.${j}`), p, (v) => (b.intro[j] = v)));
    (b.groups || []).forEach((g, gi) => {
      if (g.title) cb(id(`groups.${gi}.title`), g.title, (v) => (g.title = v));
      (g.rows || []).forEach((r, ri) => {
        cb(id(`groups.${gi}.rows.${ri}.label`), r.label, (v) => (r.label = v));
        for (const k of ["metric", "us"]) {
          if (r[k] && /\b(tum|eller|ange|fas|ton|beställning|alla|och)\b/i.test(r[k])) cb(id(`groups.${gi}.rows.${ri}.${k}`), r[k], (v) => (r[k] = v));
        }
      });
    });
  }
  if (b.type === "modules") (b.items || []).forEach((it, j) => {
    if (it.title && /[A-Za-zÅÄÖåäö]{3,}/.test(it.title)) cb(id(`items.${j}.title`), it.title, (v) => (it.title = v));
    for (const k of ["text", "alt"]) if (it[k]) cb(id(`items.${j}.${k}`), it[k], (v) => (it[k] = v));
    (it.bullets || []).forEach((x, n) => cb(id(`items.${j}.bullets.${n}`), x, (v) => (it.bullets[n] = v)));
    if (it.doc && it.doc.text) cb(id(`items.${j}.doc.text`), it.doc.text, (v) => (it.doc.text = v));
  });
  if (b.type === "carousel") (b.items || []).forEach((it, j) => {
    if (it.alt) cb(id(`items.${j}.alt`), it.alt, (v) => (it.alt = v));
    if (it.caption) cb(id(`items.${j}.caption`), it.caption, (v) => (it.caption = v));
  });
  if (b.type === "cards") (b.items || []).forEach((it, j) => {
    if (it.title) cb(id(`items.${j}.title`), it.title, (v) => (it.title = v));
    if (it.text) cb(id(`items.${j}.text`), it.text, (v) => (it.text = v));
    if (it.alt) cb(id(`items.${j}.alt`), it.alt, (v) => (it.alt = v));
  });
}

export function visit(page, t, cb) {
  const P = page.path;
  for (const k of ["title", "h1", "description", "seoTitle", "lead", "navTitle", "tagline"]) if (t[k]) cb(`${P}|${k}`, t[k], (v) => (t[k] = v));
  (t.ctas || []).forEach((c, j) => cb(`${P}|ctas.${j}.text`, c.text, (v) => (c.text = v)));
  (t.blocks || []).forEach((b, i) => visitBlock(b, `b${i}`, P, cb));
}

// Small, stable hash (djb2) used to detect "the source text changed since it was translated".
export function hash(str) {
  let h = 5381;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// Unit map for a language object: { "b3.html": "<text>", "title": "…" } (page path stripped).
export function units(page, t) {
  const out = {};
  const P = page.path + "|";
  visit(page, t, (id, value) => { out[id.slice(P.length)] = value; });
  return out;
}
