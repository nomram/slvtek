// Serving the site from a sub-path (GitHub project pages: https://<user>.github.io/<repo>/).
// The site is authored with root-absolute URLs ("/css/site.css", "/produkter/tei"); this module
// prefixes them with the base path. Pure functions, no Node APIs, so the CMS can use them too.
// With an empty base nothing is rewritten.

const isRootAbs = (u) => typeof u === "string" && u.startsWith("/") && !u.startsWith("//");

export function prefix(base, url) {
  if (!base || !isRootAbs(url)) return url;
  if (url === base || url.startsWith(base + "/") || url.startsWith(base + "?") || url.startsWith(base + "#")) return url;
  return base + url;
}

const mapSrcset = (base, v) => v.split(",").map((part) => {
  const t = part.trim();
  const sp = t.search(/\s/);
  const u = sp < 0 ? t : t.slice(0, sp);
  return prefix(base, u) + (sp < 0 ? "" : t.slice(sp));
}).join(", ");

export function rewriteHtml(html, base, { noindex = false } = {}) {
  if (!base) return html;
  let out = html;
  // plain URL attributes
  out = out.replace(/\b(href|src|poster|action|data-src)=(["'])(\/(?!\/)[^"']*)\2/g, (m, a, q, u) => `${a}=${q}${prefix(base, u)}${q}`);
  // srcset / imagesrcset lists
  out = out.replace(/\b(srcset|imagesrcset)=(["'])([^"']*)\2/g, (m, a, q, v) => `${a}=${q}${mapSrcset(base, v)}${q}`);
  // <meta http-equiv="refresh" content="0;url=/x">
  out = out.replace(/<meta\b[^>]*http-equiv=["']refresh["'][^>]*>/gi, (tag) => tag.replace(/(url=)(\/(?!\/)[^"'\s>]*)/i, (m, a, u) => a + prefix(base, u)));
  // inline style url(/…)
  out = out.replace(/url\(\s*(["']?)(\/(?!\/)[^)"']*)\1\s*\)/g, (m, q, u) => `url(${q}${prefix(base, u)}${q})`);
  // the JSON config block the site script reads (search index, privacy page …)
  out = out.replace(/(<script type="application\/json" id="bk-config">)([\s\S]*?)(<\/script>)/, (m, a, json, c) =>
    a + json.replace(/":"(\/(?!\/)[^"]*)"/g, (mm, u) => `":"${prefix(base, u)}"`) + c);
  if (noindex) out = out.replace(/(<meta name="robots" content=")[^"]*(")/i, "$1noindex,nofollow$2");
  return out;
}

export function rewriteCss(css, base) {
  if (!base) return css;
  return css.replace(/url\(\s*(["']?)(\/(?!\/)[^)"']*)\1\s*\)/g, (m, q, u) => `url(${q}${prefix(base, u)}${q})`);
}

// JSON files whose string values are site paths (search index, web manifest)
export function rewriteJsonPaths(text, base) {
  if (!base) return text;
  const walk = (v) => {
    if (typeof v === "string") return isRootAbs(v) ? prefix(base, v) : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.stringify(walk(JSON.parse(text)));
}

// "/btkwsite/" | "btkwsite" | "" -> "/btkwsite" | ""
export const normalizeBase = (b) => {
  const s = String(b || "").trim().replace(/^\/+|\/+$/g, "");
  if (!s) return "";
  if (!/^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(s)) {
    throw new Error(`SITE_BASE "${b}" is not a valid URL path (expected something like /my-repo). ` +
      `On Windows Git Bash prefix the command with MSYS_NO_PATHCONV=1.`);
  }
  return "/" + s;
};
