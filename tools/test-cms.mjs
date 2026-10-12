#!/usr/bin/env node
// End-to-end test of the visual CMS in real Chrome (CDP over a debugging pipe).
// Needs the dev server running (npm run dev) and Chrome installed.
//   node tools/test-cms.mjs [http://localhost:4173]
// Creates one throw-away page (/zz-editor-test), edits it, auto-translates it against a
// mock AI server, then deletes it again.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] || "http://localhost:4173";
const ROOT = path.resolve(import.meta.dirname, "..");
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "  ok " : "FAIL "} ${name}${!ok && extra ? "  -> " + extra : ""}`); };

// ---------- mock OpenAI-compatible server ----------
const calls = [];
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = (c, o) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== "Bearer test-key") return json(401, { error: { message: "bad key" } });
    if (req.url === "/v1/models") return json(200, { data: [{ id: "openai/gpt-oss-120b" }, { id: "qwen/qwen3-32b" }, { id: "whisper-large-v3" }] });
    const b = JSON.parse(body);
    calls.push(b);
    const sys = b.messages[0].content;
    const to = (sys.match(/to ([A-Za-zå() ]+?)\./) || [])[1] || "??";
    const user = JSON.parse(b.messages[b.messages.length - 1].content);
    if (user.strings) return json(200, { choices: [{ message: { content: JSON.stringify({ translations: user.strings.map((s) => `[${to}] ${s}`) }) } }] });
    return json(200, { choices: [{ message: { content: "{}" } }] });
  });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const MOCK = `http://127.0.0.1:${mock.address().port}/v1`;

// ---------- chrome ----------
const prof = path.join(os.tmpdir(), "bk-cms-test-" + Date.now());
fs.mkdirSync(prof, { recursive: true });
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
const c = spawn(chrome, [`--user-data-dir=${prof}`, "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const to = c.stdio[3], from = c.stdio[4];
let buf = "", id = 0; const pend = new Map(); const errors = [];
const NUL = String.fromCharCode(0);
from.on("data", (d) => {
  buf += d.toString("utf8"); let i;
  while ((i = buf.indexOf(NUL)) >= 0) {
    const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    else if (m.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 300));
    else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((a) => a.value || a.description).join(" ").slice(0, 300));
  }
});
const send = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pend.set(i, r); to.write(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }) + NUL); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.result && r.result.exceptionDetails) return { __error: JSON.stringify(r.result.exceptionDetails).slice(0, 500) };
  return r.result && r.result.result && r.result.result.value;
};
const H = `
  window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = fn(); if (v) return v; } catch (e) {} await __sleep(80); } return null; };
  window.__ed = () => window.__bkcms.state.ed;
  window.__doc = () => document.getElementById("ve-canvas").contentDocument;
  window.__blocks = () => { const e = __ed(); return e.page.i18n[e.lang].blocks; };
  window.confirm = () => true;
`;

try {
  // seed the AI config + load the CMS
  // (wait for the page itself, not a fixed time: on a busy machine the first load can take seconds)
  const pageReady = async (ms = 45000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const ok = await ev(`location.pathname === "/cms/" && document.readyState === "complete" && !!document.getElementById("app")`);
      if (ok === true) return true;
      await sleep(250);
    }
    return false;
  };
  await send("Page.navigate", { url: BASE + "/cms/" }, sessionId);
  await pageReady();
  await ev(`localStorage.setItem("bkcms.ai", JSON.stringify({baseUrl:"${MOCK}", key:"test-key", model:"openai/gpt-oss-120b", effort:"high"})); localStorage.setItem("bkcms.ui","sv");`);
  await send("Page.navigate", { url: BASE + "/cms/" }, sessionId);
  await sleep(300);
  await pageReady();
  await ev(H);
  const loaded = await ev(`(async () => !!(await __until(() => document.querySelectorAll("table.list tbody tr").length > 5, 20000)))()`);
  check("pages list loads", loaded, loaded ? "" : JSON.stringify({ page: await ev(`location.href + " | " + document.readyState + " | " + (document.getElementById("app") ? document.getElementById("app").innerText.slice(0, 200) : "no #app")`), errors: errors.slice(0, 3) }));
  check("UI is Swedish by default", (await ev(`document.querySelector("h1").textContent`)) === "Sidor");

  // ----- existing page: tagging, selection, inline edit, toolbar, undo -----
  await ev(`window.__bkcms.state.ed = null; document.querySelector('tr[data-edit="/productos/tei/martillos-perforadores/te760"]').click(); 1`);
  const ready = await ev(`(async () => !!(await __until(() => __doc() && __doc().getElementById("bk-ov") && __doc().querySelectorAll("[data-bk-i]").length > 0, 20000)))()`);
  check("editor opens with tagged blocks", ready, ready ? "" : JSON.stringify(await ev(`({ href: location.href, frame: !!document.querySelector("iframe"), ed: !!(window.__bkcms.state.ed), blocks: document.querySelector("iframe") && document.querySelector("iframe").contentDocument ? document.querySelector("iframe").contentDocument.querySelectorAll("[data-bk-i]").length : -1, ov: !!(document.querySelector("iframe") && document.querySelector("iframe").contentDocument && document.querySelector("iframe").contentDocument.getElementById("bk-ov")) })`)));
  const tagged = await ev(`(() => { const idx = new Set([...__doc().querySelectorAll("[data-bk-i]")].map((e) => e.dataset.bkI)); return { tagged: idx.size, model: __blocks().length }; })()`);
  check("every block is tagged in the canvas", tagged.tagged === tagged.model, JSON.stringify(tagged));
  check("fields are editable", (await ev(`__doc().querySelectorAll("[contenteditable]").length`)) > 3);
  check("overlay present", (await ev(`!!__doc().getElementById("bk-ov")`)));

  // click selects + switches to the block tab
  await ev(`__doc().querySelector("[data-bk-i='0']").click(); 1`);
  await sleep(300);
  check("click selects block and opens inspector", (await ev(`__ed().sel === 0 && __ed().tab === "block"`)));

  // inline typing -> model (first block that has an inline-editable text field)
  const bi = await ev(`(() => { const d = __doc(); const el = d.querySelector("[data-bk-i] [data-bk-field][data-bk-kind=inline], [data-bk-i][data-bk-field][data-bk-kind=inline]"); return el ? +el.closest("[data-bk-i]").dataset.bkI : -1; })()`);
  check("page has an inline-editable block", bi >= 0, String(bi));
  const before = await ev(`JSON.stringify(__blocks()[${bi}])`);
  const typed = await ev(`(async () => {
    const d = __doc(), w = d.defaultView;
    const el = d.querySelector("[data-bk-i='${bi}'][data-bk-field], [data-bk-i='${bi}'] [data-bk-field]");
    if (!el) return { err: "no field in block ${bi}" };
    el.focus();
    const r = d.createRange(); r.selectNodeContents(el); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.execCommand("insertText", false, "Hej från testet");
    await __sleep(200);
    return { field: el.dataset.bkField, block: __blocks()[${bi}] };
  })()`);
  check("typing on the page updates the model", !!typed && JSON.stringify(typed.block || null).includes("Hej från testet"), JSON.stringify(typed));
  check("editor marks page dirty", (await ev(`__ed().dirty`)));
  await ev(`document.getElementById("ve-undo").click(); 1`);
  await sleep(500);
  check("undo restores the block", (await ev(`JSON.stringify(__blocks()[${bi}])`)) === before);
  await ev(`document.getElementById("ve-redo").click(); 1`);
  await sleep(500);
  check("redo re-applies", String(await ev(`JSON.stringify(__blocks()[${bi}])`)).includes("Hej från testet"));
  await ev(`document.getElementById("ve-undo").click(); 1`);
  await sleep(500);

  // block toolbar: move down
  const order0 = await ev(`JSON.stringify(__blocks())`);
  await ev(`(async () => { for (let k = 0; k < 8; k++) { __doc().querySelector("[data-bk-i='0']").click(); if (await __until(() => __ed().sel === 0 && __doc().querySelector("#bk-ov .bk-tb button[data-a='down']"), 1500)) return 1; } return 0; })()`);
  await ev(`__doc().querySelector("#bk-ov .bk-tb button[data-a='down']").click(); 1`);
  await sleep(500);
  const order1 = await ev(`JSON.stringify(__blocks())`);
  const dbg = await ev(`JSON.stringify({ sel: __ed().sel, tb: !!__doc().querySelector("#bk-ov .bk-tb"), btn: !!__doc().querySelector("#bk-ov .bk-tb button[data-a=down]"), n: __blocks().length, types: __blocks().slice(0, 4).map((b) => b.type) })`);
  check("toolbar ↓ reorders blocks", order0 !== order1, dbg);
  await ev(`document.getElementById("ve-undo").click(); 1`);
  await sleep(500);
  check("undo after move", (await ev(`JSON.stringify(__blocks())`)) === order0);

  // palette -> drop into canvas (synthetic drag events)
  const n0 = await ev(`__blocks().length`);
  const dropped = await ev(`(async () => {
    // the canvas reloads after every undo/redo: wait until the new document has its editing layer
    await __until(() => { const x = __doc(); return x && x.readyState === "complete" && x.getElementById("bk-ov"); }, 15000);
    await __sleep(300);
    const d = __doc(), w = d.defaultView;
    const dt = new w.DataTransfer();
    dt.setData("application/x-bk-new", "heading");
    const y = 200;
    d.dispatchEvent(new w.DragEvent("dragover", { dataTransfer: dt, clientX: 300, clientY: y, bubbles: true, cancelable: true }));
    d.dispatchEvent(new w.DragEvent("drop", { dataTransfer: dt, clientX: 300, clientY: y, bubbles: true, cancelable: true }));
    await __sleep(600);
    return __blocks().length;
  })()`);
  check("dropping a palette block inserts it", dropped === n0 + 1, `${n0} -> ${dropped}`);
  check("new heading is selected", (await ev(`__blocks()[__ed().sel] && __blocks()[__ed().sel].type`)) === "heading");
  await ev(`document.getElementById("ve-undo").click(); 1`);
  await sleep(400);

  // page tab: SEO counters
  await ev(`document.querySelector('[data-tab="page"]').click(); 1`);
  await sleep(200);
  check("page tab shows SEO fields", (await ev(`!!document.querySelector('[data-lf="description"]')`)));

  await ev(`(() => { const L = __bkcms.state.site.languages; L.sv = { label: "Svenska", htmlLang: "sv", locale: "sv_SE", published: true }; L.no = { label: "Norsk", htmlLang: "nb", locale: "nb_NO", published: true }; })()`);
  // language tab lists all languages
  await ev(`document.querySelector('[data-tab="lang"]').click(); 1`);
  await sleep(200);
  check("language tab lists languages", (await ev(`document.querySelectorAll(".lang-row").length`)) === 4);

  // leave without saving
  await ev(`__ed().dirty = false; document.getElementById("ve-back").click(); 1`);
  await sleep(400);

  // ----- text inside a two-column section is editable in place (About page) -----
  await ev(`document.querySelector('tr[data-edit="/sobre-nosotros"]').click(); 1`);
  await ev(`(async () => !!(await __until(() => __doc() && __doc().getElementById("bk-ov") && __doc().querySelector("[data-bk-field^='left.']"), 20000)))()`);
  const nest = await ev(`(async () => {
    const d = __doc(), w = d.defaultView;
    const el = d.querySelector("[data-bk-i][data-bk-field^='left.'][data-bk-kind=plain], [data-bk-i] [data-bk-field^='left.'][data-bk-kind=plain]");
    if (!el) return { err: "no nested plain field" };
    const bi = +el.closest("[data-bk-i]").dataset.bkI, field = el.dataset.bkField;
    el.focus(); const r = d.createRange(); r.selectNodeContents(el); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.execCommand("insertText", false, "Nästlad rubrik");
    await __sleep(300);
    const b = __blocks()[bi]; const [side, j, k] = field.split(".");
    return { bi, field, value: b[side][+j][k], type: b.type };
  })()`);
  check("text inside columns is editable in place", !!nest && nest.type === "columns" && nest.value === "Nästlad rubrik", JSON.stringify(nest));
  await ev(`__ed().dirty = false; document.getElementById("ve-back").click(); 1`);
  await sleep(500);

  // ----- wizard: new page, edit, auto-translate, save, delete -----
  await ev(`document.getElementById("new").click(); 1`);
  await sleep(300);
  await ev(`document.querySelector('input[name="kind"][value="page"]').click(); 1`);
  await sleep(100);
  await ev(`(() => { const i = document.getElementById("np-title"); i.value = "ZZ Editor Test"; i.dispatchEvent(new Event("input", {bubbles:true})); document.getElementById("np-parent").value = "/"; document.getElementById("np-parent").dispatchEvent(new Event("change", {bubbles:true})); })()`);
  await sleep(150);
  check("wizard derives the address from the title", (await ev(`document.getElementById("np-url").textContent`)).includes("/zz-editor-test"));
  await ev(`document.getElementById("np-go").click(); 1`);
  await sleep(800);
  check("new page opens in the editor as a draft", (await ev(`__ed() && __ed().isNew && __ed().page.published === false`)));
  // type into the starter paragraph
  const typed2 = await ev(`(async () => {
    await __until(() => __doc() && __doc().querySelector("[data-bk-field='html']"), 8000);
    const want = "Det här är en testsida om betongpumpar.";
    for (let k = 0; k < 8; k++) {
      const d = __doc(), w = d.defaultView;
      const el = d.querySelector("[data-bk-field='html']");
      if (el) {
        el.focus();
        const r = d.createRange(); r.selectNodeContents(el); const sel = w.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        d.execCommand("insertText", false, want);
        await __sleep(300);
        if (__blocks()[0] && __blocks()[0].html === want) break;
      }
      await __sleep(400);
    }
    return __blocks()[0].html;
  })()`);
  check("typing into a fresh page works", typed2 === "Det här är en testsida om betongpumpar.", typed2);
  // Enter splits into a second paragraph
  const split = await ev(`(async () => {
    const d = __doc(), w = d.defaultView;
    const el = d.querySelector("[data-bk-field='html']");
    el.focus();
    const r = d.createRange(); r.setStart(el.firstChild, 8); r.collapse(true); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
    el.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await __sleep(700);
    return __blocks().map((b) => b.html);
  })()`);
  check("Enter splits the paragraph in two", Array.isArray(split) && split.length === 2 && split[0] === "Det här" && split[1] === "är en testsida om betongpumpar.", JSON.stringify(split));

  // per-language visibility: "show in language" checkboxes on the page tab
  await ev(`document.querySelector('[data-tab="page"]').click(); 1`);
  await sleep(250);
  check("page tab offers one visibility checkbox per extra language", (await ev(`document.querySelectorAll('[data-hide-lang]').length`)) === 3);
  await ev(`document.querySelector('[data-hide-lang="sv"]').click(); 1`);
  await sleep(250);
  check("unticking a language writes hideIn on the page", JSON.stringify(await ev(`__ed().page.hideIn || null`)) === '["sv"]');
  await ev(`document.querySelector('[data-hide-lang="sv"]').click(); 1`);
  await sleep(250);
  check("ticking it again clears hideIn", (await ev(`__ed().page.hideIn === undefined`)));
  await ev(`document.querySelector('[data-hide-lang="sv"]').click(); 1`);
  await sleep(250);

  // configure auto-translate in memory (not saved to site.json) and save
  await ev(`(() => { const s = __bkcms.state; s.site.ai = { autoTranslate: true, targets: ["en", "no"], noindexUntilReviewed: true }; s.ai.baseUrl = "${MOCK}"; s.ai.key = "test-key"; s.ai.model = "openai/gpt-oss-120b"; s.ai.proxy = "/__cms/ai"; })()`);
  await ev(`document.getElementById("ve-save").click(); 1`);
  const saved = await ev(`(async () => !!(await __until(() => !__ed().isNew && !__ed().dirty, 30000)))()`);
  check("save with automatic translation completes", saved);
  const file = path.join(ROOT, "content/pages/zz-editor-test.json");
  check("page file written", fs.existsSync(file));
  if (fs.existsSync(file)) {
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    check("Swedish original saved untouched", j.i18n.es.blocks[0].html === "Det här");
    check("English translation created", j.i18n.en && /^\[English\] /.test(j.i18n.en.blocks[1].html), j.i18n.en && j.i18n.en.blocks[1].html);
    check("Norwegian translation created", j.i18n.no && /^\[Norwegian/.test(j.i18n.no.title), j.i18n.no && j.i18n.no.title);
    check("Swedish not created (not a target)", !j.i18n.sv);
    check("translation metadata recorded", j.i18nMeta && j.i18nMeta.en && j.i18nMeta.en.mode === "auto" && j.i18nMeta.en.srcUnits);
    check("machine translations hidden from search engines", j.i18n.en.noindex === true && !j.i18n.es.noindex);
    check("draft stays a draft", j.published === false);
    check("hidden language is saved with the page", Array.isArray(j.hideIn) && j.hideIn.length === 1 && j.hideIn[0] === "sv", JSON.stringify(j.hideIn));
  }
  check("AI was called with high reasoning", calls.some((b) => b.reasoning_effort === "high"));
  check("AI calls went through the dev proxy (key never in repo)", !fs.readFileSync(file, "utf8").includes("test-key"));

  // hand-editing English must protect it from the next automatic run
  await ev(`document.querySelector('.ve__langs [data-l="en"]').click(); 1`);
  await ev(`(async () => !!(await __until(() => { const x = __doc(); return x && x.getElementById("bk-ov") && x.documentElement.lang === "en"; }, 20000)))()`);
  await ev(`(async () => {
    const d = __doc(), w = d.defaultView;
    const el = d.querySelector("[data-bk-field='html']");
    el.focus();
    const r = d.createRange(); r.selectNodeContents(el); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.execCommand("insertText", false, "Handwritten English");
    await __sleep(300);
  })()`);
  check("hand edit marks the language manual", (await ev(`__ed().page.i18nMeta.en.mode`)) === "manual");
  await ev(`document.querySelector('.ve__langs [data-l="es"]').click(); 1`);
  await ev(`(async () => !!(await __until(() => { const x = __doc(); return x && x.getElementById("bk-ov") && x.documentElement.lang === "es"; }, 20000)))()`);
  await ev(`(async () => {
    const d = __doc(), w = d.defaultView;
    const el = d.querySelector("[data-bk-field='html']");
    el.focus();
    const r = d.createRange(); r.selectNodeContents(el); const s = w.getSelection(); s.removeAllRanges(); s.addRange(r);
    d.execCommand("insertText", false, "Ny svensk text");
    await __sleep(300);
  })()`);
  const callsBefore = calls.length;
  await ev(`document.getElementById("ve-save").click(); 1`);
  await ev(`(async () => !!(await __until(() => !__ed().dirty, 30000)))()`);
  const j2 = JSON.parse(fs.readFileSync(file, "utf8"));
  check("manual English was not overwritten", /Handwritten English/.test(JSON.stringify(j2.i18n.en)), JSON.stringify(j2.i18n.en.blocks));
  check("Norwegian (auto) was updated for the changed text", /Ny svensk text/.test(JSON.stringify(j2.i18n.no.blocks)));
  check("only the changed string was sent to the AI", (() => {
    const sent = calls.slice(callsBefore).flatMap((b) => JSON.parse(b.messages[b.messages.length - 1].content).strings || []);
    return sent.length >= 1 && sent.length <= 2 && sent.some((s) => s.includes("Ny svensk text"));
  })());

  // translation review round trip: export -> (another LLM corrects) -> import
  await ev(`document.querySelector('[data-view="review"]').click(); 1`);
  await sleep(500);
  check("review view opens", (await ev(`!!document.getElementById("rv-make")`)));
  const exported = await ev(`(() => { const f = __bkcms.review.buildFiles("en", { scope: "all", includeUi: true, chunk: 0 })[0]; return JSON.stringify(f); })()`);
  const ex = JSON.parse(exported);
  const mine = ex.units.filter((u) => u.id.startsWith("/zz-editor-test|"));
  check("export has instructions, glossary and the page's units", ex.format === "solvitek-translation-review/1" && /Never change "id"/.test(ex.instructions) && Array.isArray(ex.keepUntranslated) && mine.length >= 2, JSON.stringify({ n: mine.length }));
  check("export carries fixed UI texts", ex.ui && Object.keys(ex.ui).length > 20);
  // the "other LLM" corrects one string and breaks the tags of another
  const fixed = JSON.parse(exported);
  // only this test page goes back: the import marks every page in the file as reviewed
  fixed.units = fixed.units.filter((u) => u.id.startsWith("/zz-editor-test|"));
  delete fixed.ui;
  const tgt = fixed.units.find((u) => u.id.startsWith("/zz-editor-test|"));
  tgt.target = "Checked by the second reviewer.";
  const second = fixed.units.filter((u) => u.id.startsWith("/zz-editor-test|"))[1];
  const origSecond = second.target;
  second.target = "<a href=\"https://example.com\">Injected link</a> " + origSecond;
  await ev(`(() => { document.getElementById("rv-paste").value = ${JSON.stringify(JSON.stringify(fixed))}; document.getElementById("rv-read").click(); })()`);
  await sleep(600);
  check("import shows the changes before saving", (await ev(`document.querySelectorAll("#rv-result input[data-i]").length`)) >= 2);
  check("a change that breaks HTML tags is flagged and unticked", (await ev(`document.querySelectorAll("#rv-result tr.is-warn input[data-i]:not(:checked)").length`)) >= 1);
  const stillBefore = JSON.parse(fs.readFileSync(file, "utf8"));
  check("nothing is written before applying", !/Checked by the second reviewer/.test(JSON.stringify(stillBefore.i18n.en)));
  await ev(`document.getElementById("rv-apply").click(); 1`);
  await sleep(1500);
  const after = JSON.parse(fs.readFileSync(file, "utf8"));
  check("approved change is saved to the page", /Checked by the second reviewer/.test(JSON.stringify(after.i18n.en)));
  check("flagged change was not applied", !/Injected link/.test(JSON.stringify(after.i18n.en)));
  check("page is marked as reviewed", after.i18nMeta && after.i18nMeta.en && after.i18nMeta.en.mode === "reviewed" && !after.i18n.en.noindex);
  // back to the editor so the cleanup below can delete the page
  await ev(`document.querySelector('[data-view="pages"]').click(); 1`);
  await sleep(500);
  await ev(`document.querySelector('tr[data-edit="/zz-editor-test"]').click(); 1`);
  await sleep(1500);

  // cleanup: delete the test page through the UI
  await ev(`document.getElementById("ve-del").click(); 1`);
  await sleep(1500);
  check("test page deleted", !fs.existsSync(file));
  check("no JavaScript errors in the console", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("test run completed without crashing", false, String(e && e.stack || e));
} finally {
  try { fs.rmSync(path.join(ROOT, "content/pages/zz-editor-test.json"), { force: true }); } catch { /* ignore */ }
  await send("Browser.close").catch(() => {});
  mock.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (errors.length) console.log("console errors:\n" + errors.slice(0, 5).join("\n"));
process.exit(failed.length ? 1 : 0);
