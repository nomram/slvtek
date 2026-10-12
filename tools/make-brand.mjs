#!/usr/bin/env node
// Brand files for the site, derived from the masters in brand-src/ (logo/, favicon/).
//   node tools/make-brand.mjs
// Writes static/assets/brand/{logo.svg, logo-white.svg, emblem.webp, logo.png, og-default.png} and the favicon set in static/.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const L = path.join(ROOT, "brand-src/logo"), F = path.join(ROOT, "brand-src/favicon");
const B = path.join(ROOT, "static/assets/brand"), S = path.join(ROOT, "static");
fs.mkdirSync(B, { recursive: true });

// wordmark (vector): the navy letters turn white for dark backgrounds, the teal and orange parts stay
const wm = fs.readFileSync(path.join(L, "solvitek-wordmark.svg"), "utf8");
fs.writeFileSync(path.join(B, "logo.svg"), wm);
if (!wm.includes('fill="#293a51"')) throw new Error("navy fill not found in wordmark");
fs.writeFileSync(path.join(B, "logo-white.svg"), wm.replace('fill="#293a51"', 'fill="#ffffff"'));

// the S emblem (3D ribbon) as a light raster
await sharp(path.join(L, "solvitek-emblem.png")).resize({ width: 520 }).webp({ quality: 88, alphaQuality: 95 }).toFile(path.join(B, "emblem.webp"));
// stacked logo for structured data
await sharp(path.join(L, "solvitek-logo.png")).resize({ width: 800 }).png({ compressionLevel: 9 }).toFile(path.join(B, "logo.png"));
// default social image: stacked logo on the light surface colour
const stacked = await sharp(path.join(L, "solvitek-logo.png")).resize({ height: 470 }).png().toBuffer();
await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#f1f4f8" } }).composite([{ input: stacked, gravity: "center" }]).png({ compressionLevel: 9 }).toFile(path.join(B, "og-default.png"));

// favicons, as delivered
for (const f of ["favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "favicon-48x48.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png"]) fs.copyFileSync(path.join(F, f), path.join(S, f));
console.log("brand assets written");
