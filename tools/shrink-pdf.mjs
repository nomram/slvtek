// Re-encode the big lossless images of a PDF as JPEG (and cap their size) so the file fits on GitHub.
import fs from "node:fs";
import sharp from "sharp";
import * as mupdf from "mupdf";

const [inFile, outFile, qArg, maxArg, limitArg] = process.argv.slice(2);
const QUALITY = +qArg || 72, MAXPX = +maxArg || 1800, LIMIT = +limitArg || Infinity;
const buf = fs.readFileSync(inFile);
const doc = mupdf.PDFDocument.openDocument(buf, "application/pdf");
const n = doc.countObjects();
let done = 0, skipped = 0, before = 0, after = 0, failed = 0;
const t0 = Date.now();
for (let i = 1; i < n && done < LIMIT; i++) {
  let ref, o;
  try { ref = doc.newIndirect(i, 0); o = ref.resolve(); } catch { continue; }
  let st = null;
  try { const s = o.get("Subtype"); st = s && !s.isNull() ? s.asName() : null; } catch { /* not a dict */ }
  if (st !== "Image") continue;
  try {
    const w = o.get("Width").asNumber(), h = o.get("Height").asNumber();
    const filt = String(o.get("Filter"));
    const bpc = o.get("BitsPerComponent");
    const isMask = o.get("ImageMask") && !o.get("ImageMask").isNull() && o.get("ImageMask").asBoolean();
    const cs = String(o.get("ColorSpace"));
    if (isMask || !/FlateDecode|DCTDecode/.test(filt) || (bpc && !bpc.isNull() && bpc.asNumber() !== 8) || /Indexed/.test(cs)) { skipped++; continue; }
    const raw = ref.readRawStream().asUint8Array();
    if (raw.length < 15000) { skipped++; continue; } // tiny images are not worth touching
    const image = doc.loadImage(ref);
    const pix = image.toPixmap();
    const comps = pix.getNumberOfComponents();
    const samples = Buffer.from(pix.getPixels());
    const ch = pix.getAlpha() ? comps + 1 : comps;
    if (!(comps === 1 || comps === 3)) { skipped++; continue; }
    let s = sharp(samples, { raw: { width: pix.getWidth(), height: pix.getHeight(), channels: ch } });
    if (pix.getAlpha()) s = s.removeAlpha();
    if (Math.max(pix.getWidth(), pix.getHeight()) > MAXPX) s = s.resize({ width: pix.getWidth() >= pix.getHeight() ? MAXPX : undefined, height: pix.getHeight() > pix.getWidth() ? MAXPX : undefined, fit: "inside" });
    const out = await s.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (out.data.length >= raw.length * 0.9) { skipped++; continue; }
    ref.writeRawStream(out.data);
    ref.put("Filter", doc.newName("DCTDecode"));
    ref.delete("DecodeParms");
    ref.put("ColorSpace", doc.newName(comps === 1 ? "DeviceGray" : "DeviceRGB"));
    ref.put("BitsPerComponent", doc.newInteger(8));
    ref.put("Width", doc.newInteger(out.info.width));
    ref.put("Height", doc.newInteger(out.info.height));
    ref.delete("Decode");
    before += raw.length; after += out.data.length; done++;
  } catch (e) { failed++; if (failed < 4) console.log("image", i, "failed:", e.message); }
}
console.log(`images recompressed: ${done}, skipped: ${skipped}, failed: ${failed}, ${Math.round(before / 1e6)} MB -> ${Math.round(after / 1e6)} MB in ${Math.round((Date.now() - t0) / 1000)}s`);
const saved = doc.saveToBuffer(process.env.SAVE_OPTS || "compress").asUint8Array();
fs.writeFileSync(outFile, saved);
console.log("written", outFile, Math.round(saved.length / 1e6), "MB");
