// Per-language visibility. A page can carry `hideIn: ["es", "no"]`: it (and everything below it)
// does not exist in those languages: no page, no menu entry, no card, no sitemap line.
// The default language can never be hidden. Pure functions: shared by the build, the preview and the CMS.

// pages: Map<path, page object>
export function isHidden(pages, path, lang, defaultLang) {
  if (!lang || lang === defaultLang) return false;
  let p = path;
  for (let guard = 0; guard < 12 && p; guard++) {
    const pg = pages.get(p);
    if (pg && Array.isArray(pg.hideIn) && pg.hideIn.includes(lang)) return true;
    const i = p.lastIndexOf("/");
    if (i <= 0) break;
    p = p.slice(0, i);
  }
  return false;
}

// Languages in which this page is hidden because of ITS OWN setting (not inherited)
export const ownHiddenLangs = (page) => (Array.isArray(page && page.hideIn) ? page.hideIn : []);

// Nearest ancestor that is visible in `lang` ("/" at worst)
export function visibleAncestor(pages, path, lang, defaultLang) {
  let p = path;
  for (let guard = 0; guard < 12; guard++) {
    const i = p.lastIndexOf("/");
    p = i <= 0 ? "/" : p.slice(0, i);
    if (!isHidden(pages, p, lang, defaultLang)) return p;
    if (p === "/") return "/";
  }
  return "/";
}
