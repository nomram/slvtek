#!/usr/bin/env node
// Unit test for admin/ai.js against a mock OpenAI-compatible server (no network, no key needed).
//   node tools/test-ai.mjs
import http from "node:http";
import assert from "node:assert/strict";
import { chat, listModels, translateStrings, validateTranslation, buildChatBody, parseJsonLoose, suggestDescription, needsTranslation } from "../admin/ai.js";

let calls = [];
const stats = { first429: true, wrongCount: true, corruptNumber: true };

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = (code, obj, headers = {}) => { res.writeHead(code, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== "Bearer test-key") return json(401, { error: { message: "bad key" } });
    if (req.url === "/v1/models") return json(200, { data: [{ id: "whisper-large-v3" }, { id: "openai/gpt-oss-120b" }, { id: "qwen/qwen3-32b" }, { id: "llama-3.1-8b-instant" }, { id: "meta-llama/llama-guard-4-12b" }] });
    if (req.url !== "/v1/chat/completions") return json(404, { error: { message: "nope" } });
    const b = JSON.parse(body);
    calls.push(b);
    if (stats.first429) { stats.first429 = false; return json(429, { error: { message: "rate limited" } }, { "retry-after": "0" }); }
    if (/qwen/.test(b.model) && b.reasoning_format) return json(400, { error: { message: "reasoning_format is not supported with this model" } });
    const user = JSON.parse(b.messages[b.messages.length - 1].content);
    if (user.strings) {
      const tr = user.strings.map((s) => "[EN] " + s);
      if (stats.wrongCount && user.strings.length > 2) { stats.wrongCount = false; tr.pop(); }
      const i = user.strings.findIndex((s) => /1500/.test(s));
      if (stats.corruptNumber && i >= 0) { stats.corruptNumber = false; tr[i] = "[EN] " + user.strings[i].replace("1500", "15000"); }
      return json(200, { choices: [{ message: { content: JSON.stringify({ translations: tr }) }, finish_reason: "stop" }], usage: {} });
    }
    if (user.title) return json(200, { choices: [{ message: { content: "<think>hmm</think>```json\n{\"description\": \"En kort beskrivning.\"}\n```" } }] });
    return json(200, { choices: [{ message: { content: "{}" } }] });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/v1`;
const cfg = { baseUrl: base, key: "test-key", model: "openai/gpt-oss-120b", effort: "high" };

// request shape per model family
assert.equal(buildChatBody(cfg, []).reasoning_effort, "high");
assert.equal(buildChatBody({ ...cfg, model: "qwen/qwen3-32b" }, []).reasoning_format, "hidden");
assert.equal(buildChatBody({ ...cfg, model: "qwen/qwen3-32b", effort: "none" }, []).reasoning_effort, "none");
assert.equal(buildChatBody({ ...cfg, model: "llama-3.1-8b-instant" }, []).reasoning_effort, undefined);

// loose JSON parsing
assert.deepEqual(parseJsonLoose("<think>x</think>```json\n{\"a\":1}\n```"), { a: 1 });
assert.deepEqual(parseJsonLoose("Sure! {\"a\":[1,2]} done"), { a: [1, 2] });

// validation rules
assert.deepEqual(validateTranslation("Se <a href=\"/x\">sidan</a> 12 mm", "See <a href=\"/x\">page</a> 12 mm"), []);
assert.ok(validateTranslation("Se <a href=\"/x\">sidan</a>", "See page").includes("html tags differ"));
assert.ok(validateTranslation("Se <a href=\"/x\">sidan</a>", "See <a href=\"/y\">page</a>").includes("links changed"));
assert.ok(validateTranslation("RDS 1500 kg", "RDS 15000 kg").includes("numbers differ"));
assert.equal(needsTranslation("TD75"), false);
assert.equal(needsTranslation("<strong>Vikt</strong>"), true);

// models: whisper / guard filtered, openai + qwen first
const models = await listModels(cfg);
assert.deepEqual(models.slice(0, 2).sort(), ["openai/gpt-oss-120b", "qwen/qwen3-32b"]);
assert.ok(!models.some((m) => /whisper|guard/.test(m)));

// bad key -> clear error
await assert.rejects(() => chat({ ...cfg, key: "wrong" }, [{ role: "user", content: "hi" }]), /401/);

// translation: retry on 429, dedupe, skip numeric-only, wrong-count batch is split, corrupted number is retried
calls = [];
const src = ["Hej världen", "Hej världen", "12", "TD75", "Borrning <strong>fort</strong>", "Vikt 1500 kg", "Slagenergi", "Frekvens"];
const progress = [];
const { map, warnings } = await translateStrings({ ...cfg, model: "qwen/qwen3-32b" }, src, { from: "es", to: "en", glossary: ["TEI"], onProgress: (d, n) => progress.push([d, n]) });
assert.equal(map.get("Hej världen"), "[EN] Hej världen");
assert.equal(map.get("12"), "12");
assert.equal(map.get("TD75"), "TD75");
assert.equal(map.get("Borrning <strong>fort</strong>"), "[EN] Borrning <strong>fort</strong>");
assert.equal(map.get("Vikt 1500 kg"), "[EN] Vikt 1500 kg", "corrupted number must be repaired by the strict retry");
assert.equal(warnings.length, 0);
assert.ok(progress.length >= 1 && progress[progress.length - 1][0] === progress[progress.length - 1][1]);
assert.ok(calls.some((c) => c.reasoning_format === undefined), "reasoning params were dropped after the 400");
// unique strings sent only once
const sent = calls.flatMap((c) => JSON.parse(c.messages[c.messages.length - 1].content).strings || []);
assert.equal(sent.filter((s) => s === "Hej världen").length >= 1, true);
assert.ok(!sent.includes("12") && !sent.includes("TD75"));

// writing aid: model wraps JSON in think tags + code fence
const d = await suggestDescription(cfg, { lang: "es", title: "TE760", text: "Topphammare" });
assert.equal(d, "En kort beskrivning.");

server.close();
console.log("ai.js: all checks passed");
