#!/usr/bin/env node
// Prefix a finished build with a base path (GitHub project pages), after the checks have run.
//   node tools/apply-base.mjs [dist] [/repo]      (base also read from SITE_BASE; empty = no-op)
import path from "node:path";
import { applyBasePath } from "../src/lib/apply-base.mjs";

const dir = path.resolve(process.argv[2] || "dist");
const base = process.argv[3] ?? process.env.SITE_BASE ?? "";
const n = applyBasePath(dir, base);
console.log(base ? `base path ${base}: rewrote ${n} files in ${path.relative(process.cwd(), dir) || "."} (preview build, noindex)` : "no base path: nothing to do");
