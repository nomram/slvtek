#!/usr/bin/env node
// Full-page screenshots through real Chrome (CDP over a debugging pipe) for visual QA.
//   node tools/shot.mjs --out shots --w 1440 --h 900 [--mobile] http://localhost:4173/ http://localhost:4173/om-oss
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = {}; const urls = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) { const k = argv[i].slice(2); opt[k] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; }
  else urls.push(argv[i]);
}
const out = path.resolve(opt.out || "shots");
const W = +opt.w || 1440, H = +opt.h || 900;
const wait = +opt.wait || 1500;
fs.mkdirSync(out, { recursive: true });
const prof = path.join(os.tmpdir(), "bk-shot-profile");
fs.rmSync(prof, { recursive: true, force: true });
fs.mkdirSync(prof, { recursive: true });
const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
const c = spawn(chrome, [`--user-data-dir=${prof}`, "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const to = c.stdio[3], from = c.stdio[4];
let buf = "", id = 0; const pend = new Map();
from.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\0")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } } });
const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pend.set(i, res); to.write(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0"); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(1200);
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: !!opt.mobile }, sessionId);
for (const url of urls) {
  await send("Page.navigate", { url }, sessionId);
  await sleep(wait);
  if (opt.eval) { await send("Runtime.evaluate", { expression: String(opt.eval) }, sessionId); await sleep(600); }
  // trigger lazy images
  await send("Runtime.evaluate", { expression: "(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60))}window.scrollTo(0,0)})()", awaitPromise: true }, sessionId);
  await sleep(500);
  const m = await send("Page.getLayoutMetrics", {}, sessionId);
  const h = Math.min(Math.ceil(m.result.cssContentSize.height), +opt.max || 6000);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: h, scale: 1 } }, sessionId);
  const name = (new URL(url).pathname.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "home") + (opt.mobile ? "_m" : "") + ".png";
  fs.writeFileSync(path.join(out, name), Buffer.from(shot.result.data, "base64"));
  console.log("saved", path.join(out, name), `${W}x${h}`);
}
await send("Browser.close");
