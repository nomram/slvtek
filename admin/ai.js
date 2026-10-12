// AI helpers for the CMS: translation + small writing aids.
// Talks to any OpenAI-compatible chat endpoint (default: Groq). No DOM access at import time,
// so it can be unit-tested in Node with a mock server (see tools/test-ai.mjs).
//
// The API key is stored only in this browser's localStorage and is never written to the repo.

export const AI_DEFAULTS = {
  baseUrl: "https://api.groq.com/openai/v1",
  model: "openai/gpt-oss-120b",
  effort: "high", // gpt-oss: low | medium | high   (Qwen: none | default)
  key: ""
};

// Fallback list used until "Fetch models" has been run (names change over time; the live list wins).
export const MODEL_PRESETS = [
  { id: "openai/gpt-oss-120b", label: "OpenAI gpt-oss-120b" },
  { id: "openai/gpt-oss-20b", label: "OpenAI gpt-oss-20b (faster)" },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B (slower, thinking mode)" }
];

export const LANG_NAMES = {
  sv: "Swedish", en: "English", es: "Spanish", no: "Norwegian (Bokmål)", nb: "Norwegian (Bokmål)", da: "Danish", fi: "Finnish",
  de: "German", fr: "French", it: "Italian", nl: "Dutch", pl: "Polish", pt: "Portuguese", et: "Estonian", lv: "Latvian", lt: "Lithuanian"
};
export const langName = (code) => LANG_NAMES[code] || code;

const KEY = "bkcms.ai";
export function loadAiConfig(storage) {
  try {
    const s = storage || globalThis.localStorage;
    return { ...AI_DEFAULTS, ...(JSON.parse(s.getItem(KEY) || "{}")) };
  } catch { return { ...AI_DEFAULTS }; }
}
export function saveAiConfig(cfg, storage) {
  const s = storage || globalThis.localStorage;
  s.setItem(KEY, JSON.stringify({ baseUrl: cfg.baseUrl, model: cfg.model, effort: cfg.effort, key: cfg.key }));
}
export const isConfigured = (cfg) => !!(cfg && cfg.key && cfg.model && cfg.baseUrl);

export class AiError extends Error {
  constructor(message, status, detail) { super(message); this.status = status; this.detail = detail; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const family = (model) => (/gpt-oss/i.test(model) ? "gpt-oss" : /qwen/i.test(model) ? "qwen" : "other");

export function buildChatBody(cfg, messages, o = {}) {
  const body = { model: cfg.model, messages, temperature: o.temperature ?? 0.2, max_completion_tokens: o.maxTokens ?? 16000 };
  if (o.json !== false) body.response_format = { type: "json_object" };
  const fam = family(cfg.model);
  const effort = cfg.effort || "high";
  if (fam === "gpt-oss") {
    body.reasoning_effort = ["low", "medium", "high"].includes(effort) ? effort : "high";
  } else if (fam === "qwen") {
    body.reasoning_effort = effort === "none" || effort === "low" ? "none" : "default";
    if (body.reasoning_effort === "default") body.reasoning_format = "hidden";
  }
  return body;
}

const stripThink = (s) => String(s || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

export function parseJsonLoose(text) {
  let s = stripThink(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(s); } catch { /* try to find the outermost object/array */ }
  const a = s.search(/[{[]/);
  if (a < 0) throw new AiError("The model did not return JSON", 0, text);
  const open = s[a], close = open === "{" ? "}" : "]";
  const b = s.lastIndexOf(close);
  if (b <= a) throw new AiError("The model returned incomplete JSON", 0, text);
  return JSON.parse(s.slice(a, b + 1));
}

// One HTTP call to the provider. In the local dev server the request goes through
// /__cms/ai (cfg.proxy) so browser CORS rules can never get in the way.
async function http(cfg, method, url, bodyObj, o = {}) {
  const f = o.fetchImpl || globalThis.fetch.bind(globalThis);
  if (cfg.proxy && !o.fetchImpl) {
    return f(cfg.proxy, {
      method: "POST", headers: { "content-type": "application/json" }, signal: o.signal,
      body: JSON.stringify({ method, url, authorization: "Bearer " + cfg.key, body: bodyObj })
    });
  }
  return f(url, {
    method, signal: o.signal,
    headers: { authorization: "Bearer " + cfg.key, ...(bodyObj ? { "content-type": "application/json" } : {}) },
    body: bodyObj ? JSON.stringify(bodyObj) : undefined
  });
}

// One chat completion. Retries on 429/5xx, and drops optional parameters the model rejects.
export async function chat(cfg, messages, o = {}) {
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
  const body = buildChatBody(cfg, messages, o);
  let lastErr;
  for (let attempt = 0; attempt < 5; attempt++) {
    let r;
    try {
      r = await http(cfg, "POST", url, body, o);
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      lastErr = new AiError("Network error: " + (e && e.message || e), 0);
      await sleep(600 * (attempt + 1));
      continue;
    }
    if (r.ok) {
      const j = await r.json();
      const msg = j && j.choices && j.choices[0] && j.choices[0].message;
      if (!msg || typeof msg.content !== "string") throw new AiError("Empty response from the model", r.status, j);
      return { text: stripThink(msg.content), usage: j.usage || null, finish: j.choices[0].finish_reason };
    }
    const detail = await r.text().catch(() => "");
    if (r.status === 429 || r.status >= 500) {
      const wait = Math.min(30, parseFloat(r.headers && r.headers.get && r.headers.get("retry-after")) || 2 * (attempt + 1));
      lastErr = new AiError(`Provider busy (${r.status})`, r.status, detail);
      await sleep(wait * 1000);
      continue;
    }
    if (r.status === 400) {
      if (body.reasoning_effort || body.reasoning_format) { delete body.reasoning_effort; delete body.reasoning_format; continue; }
      if (body.response_format) { delete body.response_format; continue; }
    }
    let msg = `${r.status}`;
    try { msg += ": " + (JSON.parse(detail).error.message || detail); } catch { msg += ": " + detail.slice(0, 200); }
    throw new AiError(msg, r.status, detail);
  }
  throw lastErr || new AiError("The AI request failed", 0);
}

export async function listModels(cfg, o = {}) {
  const r = await http(cfg, "GET", cfg.baseUrl.replace(/\/+$/, "") + "/models", null, o);
  if (!r.ok) throw new AiError("Could not list models: " + r.status, r.status, await r.text().catch(() => ""));
  const j = await r.json();
  return (j.data || []).map((m) => m.id)
    .filter((id) => !/whisper|tts|guard|embed|orpheus|playai|moderation|distil/i.test(id))
    .sort((a, b) => Number(/openai|qwen/i.test(b)) - Number(/openai|qwen/i.test(a)) || a.localeCompare(b));
}

// ---------- translation ----------
const stripTags = (h) => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
// strings that contain no real words (numbers, units, codes) are left untouched and never sent
export const needsTranslation = (s) => /[A-Za-zÅÄÖåäöÉéÜüÆæØø]{3,}/.test(stripTags(s));

export function systemPrompt({ from, to, glossary = [], context = "" }) {
  return [
    `You are a professional technical translator for a Swedish supplier of construction equipment (concrete, shotcrete, rock drilling, slope stabilisation, concrete pumps, surface protection).`,
    `Translate from ${langName(from)} to ${langName(to)}.`,
    `Rules:`,
    `1. Return ONLY JSON: {"translations": [ ... ]} with exactly as many strings as the input, in the same order.`,
    `2. Keep HTML tags and attributes exactly as they are (<a href="…">, <strong>, <em>, <br>). Translate only the visible text. Never change href values.`,
    `3. Never translate or alter brand, product and model names, article codes, numbers, units (mm, kg, bar, lpm, Nm), URLs, e-mail addresses or phone numbers.`,
    `4. Use correct industry terminology in the target language and keep it consistent across all strings.`,
    `5. Keep the meaning, tone (concise, professional B2B) and length close to the original. Do not add, remove or explain anything.`,
    `6. Short strings are UI labels (menu items, table row headings, buttons): translate them as labels, with the same capitalisation style.`,
    `7. If a string is only a name, code or number, return it unchanged.`,
    glossary.length ? `Names that must stay exactly as written: ${glossary.slice(0, 150).join(", ")}.` : "",
    context ? `Context: ${context}` : ""
  ].filter(Boolean).join("\n");
}

const tagSeq = (s) => (String(s).match(/<\/?(a|strong|em|b|i|br)\b[^>]*>/gi) || []).map((t) => t.replace(/\s+/g, " ").toLowerCase());
const hrefs = (s) => (String(s).match(/href="[^"]*"/gi) || []);
const nums = (s) => (stripTags(s).match(/\d+(?:[.,]\d+)?/g) || []);

// Returns a list of problems (empty = fine)
export function validateTranslation(src, tgt) {
  const out = [];
  if (typeof tgt !== "string" || !tgt.trim()) return ["empty"];
  if (tagSeq(src).length !== tagSeq(tgt).length) out.push("html tags differ");
  if (hrefs(src).join("|") !== hrefs(tgt).join("|")) out.push("links changed");
  const a = nums(src).slice().sort().join(","), b = nums(tgt).slice().sort().join(",");
  if (a !== b) out.push("numbers differ");
  return out;
}

async function translateBatch(cfg, items, o) {
  const messages = [
    { role: "system", content: systemPrompt(o) + (o.strict ? "\nIMPORTANT: previous attempt changed tags or numbers. Copy every tag, link and number exactly." : "") },
    { role: "user", content: JSON.stringify({ strings: items }) }
  ];
  const { text } = await chat(cfg, messages, { fetchImpl: o.fetchImpl, signal: o.signal });
  const j = parseJsonLoose(text);
  const arr = Array.isArray(j) ? j : j.translations || j.strings || Object.values(j)[0];
  if (!Array.isArray(arr) || arr.length !== items.length) throw new AiError(`Expected ${items.length} translations, got ${Array.isArray(arr) ? arr.length : "none"}`, 0, text);
  return arr.map((x) => (typeof x === "string" ? x : String(x ?? "")));
}

// strings: string[] -> Map(source -> translation). Untranslatable strings map to themselves.
// Returns { map, warnings: [{source, target, problems}] }
export async function translateStrings(cfg, strings, o = {}) {
  const { from, to, onProgress } = o;
  const map = new Map();
  const warnings = [];
  const todo = [];
  for (const s of new Set(strings)) {
    if (!s || !needsTranslation(s)) map.set(s, s); else todo.push(s);
  }
  const batches = [];
  let cur = [], chars = 0;
  for (const s of todo) {
    if (cur.length && (cur.length >= (o.maxItems || 60) || chars + s.length > (o.maxChars || 5000))) { batches.push(cur); cur = []; chars = 0; }
    cur.push(s); chars += s.length;
  }
  if (cur.length) batches.push(cur);
  let done = 0;
  for (const batch of batches) {
    let res;
    try { res = await translateBatch(cfg, batch, { ...o, from, to }); }
    catch (e) {
      if (e && e.name === "AbortError") throw e;
      // retry as two halves once, then give up on this batch
      if (batch.length > 1) {
        const mid = Math.ceil(batch.length / 2);
        const a = await translateBatch(cfg, batch.slice(0, mid), { ...o, from, to });
        const b = await translateBatch(cfg, batch.slice(mid), { ...o, from, to });
        res = a.concat(b);
      } else throw e;
    }
    for (let i = 0; i < batch.length; i++) {
      let t = res[i];
      let problems = validateTranslation(batch[i], t);
      if (problems.length) {
        try {
          const again = (await translateBatch(cfg, [batch[i]], { ...o, from, to, strict: true }))[0];
          const p2 = validateTranslation(batch[i], again);
          if (p2.length < problems.length || !p2.length) { t = again; problems = p2; }
        } catch (e) { if (e && e.name === "AbortError") throw e; }
      }
      if (problems.length) warnings.push({ source: batch[i], target: t, problems });
      map.set(batch[i], problems.includes("empty") ? batch[i] : t.trim());
    }
    done += batch.length;
    if (onProgress) onProgress(done, todo.length);
  }
  return { map, warnings };
}

// ---------- small writing aids ----------
export async function suggestDescription(cfg, { lang, title, text, maxLen = 155, fetchImpl }) {
  const messages = [
    { role: "system", content: `You write meta descriptions for a Swedish construction-equipment supplier's website. Language: ${langName(lang)}. Return JSON {"description": "..."}: one factual sentence or two, ${Math.max(90, maxLen - 35)}–${maxLen} characters, no quotes, no marketing fluff, mention the product/topic and what the reader can do or learn.` },
    { role: "user", content: JSON.stringify({ title, text: String(text || "").slice(0, 2500) }) }
  ];
  const { text: out } = await chat(cfg, messages, { fetchImpl });
  const j = parseJsonLoose(out);
  return String(j.description || "").trim();
}

export async function suggestAlt(cfg, { lang, filename, pageTitle, context, fetchImpl }) {
  const messages = [
    { role: "system", content: `You write concise image alt texts (max 110 characters) for a construction-equipment website, in ${langName(lang)}. You cannot see the image: base it on the file name, page title and nearby text, and do not invent details. Return JSON {"alt": "..."}.` },
    { role: "user", content: JSON.stringify({ filename, pageTitle, context: String(context || "").slice(0, 600) }) }
  ];
  const { text } = await chat(cfg, messages, { fetchImpl });
  return String(parseJsonLoose(text).alt || "").trim();
}
