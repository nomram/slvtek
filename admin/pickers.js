// Image / document / link pickers (promise-based modal dialogs) and file uploads.
import { state, $, esc, slug, toast, bytesToB64, setStatus, titleOf, defLang, SITE_ROOT } from "./core.js";
import { t } from "./lang.js";

const imageFiles = () => state.files.filter((f) => f.path.startsWith("assets-src/img/")).map((f) => f.path.replace("assets-src/img/", ""));
const docFiles = () => state.files.filter((f) => f.path.startsWith("assets-src/docs/")).map((f) => f.path.replace("assets-src/docs/", ""));

function uniqueName(base, ext, existing) {
  let n = base, i = 2;
  while (existing.includes(n + "." + ext)) n = `${base}-${i++}`;
  return n + "." + ext;
}

async function toWebp(file, maxW = 1920) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxW / bmp.width);
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = new OffscreenCanvas(w, h);
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  const blob = await c.convertToBlob({ type: "image/webp", quality: 0.84 });
  return { blob, w, h };
}

// -> "/assets/img/<name>"
export async function uploadImage(file) {
  const files = imageFiles();
  const base = slug(file.name.replace(/\.[^.]+$/, "")) || "bild";
  let name, content;
  if (/svg|gif/.test(file.type)) {
    const ext = file.type.includes("svg") ? "svg" : "gif";
    name = uniqueName(base, ext, files);
    content = bytesToB64(new Uint8Array(await file.arrayBuffer()));
  } else {
    const { blob } = await toWebp(file);
    name = uniqueName(base, "webp", files);
    content = bytesToB64(new Uint8Array(await blob.arrayBuffer()));
    state.pending.set("/assets/img/" + name, URL.createObjectURL(blob));
  }
  setStatus(t("uploading"));
  await state.backend.write("assets-src/img/" + name, content, { base64: true, message: "CMS: add image " + name });
  state.files.push({ path: "assets-src/img/" + name, size: 0 });
  return "/assets/img/" + name;
}

// -> "/assets/docs/<name>"
export async function uploadDoc(file) {
  if (file.size > 25e6) throw new Error(t("pdf_too_big"));
  const files = docFiles();
  const name = uniqueName(slug(file.name.replace(/\.[^.]+$/, "")) || "dokument", "pdf", files);
  setStatus(t("uploading"));
  await state.backend.write("assets-src/docs/" + name, bytesToB64(new Uint8Array(await file.arrayBuffer())), { base64: true, message: "CMS: add document " + name });
  state.files.push({ path: "assets-src/docs/" + name, size: file.size });
  return "/assets/docs/" + name;
}

function modal(html, { wide = false } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = wide ? "wide" : "";
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  dlg.showModal();
  return dlg;
}

export function thumbUrl(file) {
  const src = "/assets/img/" + file;
  if (state.pending.has(src)) return state.pending.get(src);
  const info = state.manifest.images && state.manifest.images[src];
  if (info && info.widths && info.widths.length) {
    const w = info.widths.find((x) => x >= 300) || info.widths[info.widths.length - 1];
    return `${SITE_ROOT}/assets/img/${info.name}-${w}.webp`;
  }
  return SITE_ROOT + src;
}

export function pickImage({ title } = {}) {
  return new Promise((resolve) => {
    const files = imageFiles().sort((a, b) => a.localeCompare(b, "es"));
    const dlg = modal(`<h2>${esc(title || t("pick_image"))}</h2>
      <div class="pk__bar"><label class="btn primary pk__up">${esc(t("upload_image"))}<input type="file" id="up" accept="image/*" hidden></label>
      <input type="search" id="q" placeholder="${esc(t("search_images"))}"></div>
      <p class="muted pk__hint">${esc(t("upload_image_hint"))}</p>
      <div class="picker" id="grid">${files.map((f) => `<button data-f="${esc(f)}" title="${esc(f)}"><img loading="lazy" src="${esc(thumbUrl(f))}" alt=""><span>${esc(f)}</span></button>`).join("")}</div>
      <p><button class="btn ghost" id="close">${esc(t("cancel"))}</button></p>`, { wide: true });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener("cancel", () => done(null));
    $("#close", dlg).onclick = () => done(null);
    $("#q", dlg).oninput = (e) => { const q = e.target.value.toLowerCase(); dlg.querySelectorAll("[data-f]").forEach((b) => (b.hidden = !!q && !b.dataset.f.toLowerCase().includes(q))); };
    dlg.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => done("/assets/img/" + b.dataset.f)));
    $("#up", dlg).onchange = async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      try {
        const src = await uploadImage(file);
        toast(t("image_uploaded"));
        done(src);
      } catch (err) { toast(t("upload_failed") + ": " + err.message, "err", 7000); }
    };
  });
}

export function pickDoc() {
  return new Promise((resolve) => {
    const files = docFiles().sort((a, b) => a.localeCompare(b, "es"));
    const dlg = modal(`<h2>${esc(t("pick_pdf"))}</h2>
      <div class="pk__bar"><label class="btn primary pk__up">${esc(t("upload_pdf"))}<input type="file" id="up" accept="application/pdf" hidden></label>
      <input type="search" id="q" placeholder="${esc(t("search_docs"))}"></div>
      <div class="pk__list" id="grid">${files.map((f) => `<button data-f="${esc(f)}">${esc(f)}</button>`).join("")}</div>
      <p><button class="btn ghost" id="close">${esc(t("cancel"))}</button></p>`);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener("cancel", () => done(null));
    $("#close", dlg).onclick = () => done(null);
    $("#q", dlg).oninput = (e) => { const q = e.target.value.toLowerCase(); dlg.querySelectorAll("[data-f]").forEach((b) => (b.hidden = !!q && !b.dataset.f.toLowerCase().includes(q))); };
    dlg.querySelectorAll("[data-f]").forEach((b) => (b.onclick = () => done("/assets/docs/" + b.dataset.f)));
    $("#up", dlg).onchange = async (ev) => {
      const file = ev.target.files[0]; if (!file) return;
      try { const href = await uploadDoc(file); toast(t("pdf_uploaded")); done(href); }
      catch (err) { toast(t("upload_failed") + ": " + err.message, "err", 7000); }
    };
  });
}

// Link picker: choose one of the site's pages, a PDF, or type an address.
// -> href string | "" (remove link) | null (cancelled)
export function pickLink({ current = "", allowRemove = false } = {}) {
  return new Promise((resolve) => {
    const def = defLang();
    const pages = [...state.pages.values()].map((x) => x.data)
      .sort((a, b) => a.path.localeCompare(b.path, "es"))
      .map((p) => ({ path: p.path, title: titleOf(p.path, def) }));
    const docs = docFiles().sort((a, b) => a.localeCompare(b, "es"));
    const dlg = modal(`<h2>${esc(t("link_to"))}</h2>
      <label>${esc(t("link_external"))}</label>
      <div class="row"><input type="text" id="ext" placeholder="https://… ${esc(t("or"))} mailto:… ${esc(t("or"))} tel:…" value="${/^(https?:|mailto:|tel:)/.test(current) ? esc(current) : ""}"><button class="btn primary" id="ext-go" style="flex:0 0 auto">${esc(t("use_link"))}</button></div>
      <label>${esc(t("link_page"))}</label>
      <input type="search" id="q" placeholder="${esc(t("search_pages"))}">
      <div class="pk__list" id="plist">${pages.map((p) => `<button data-h="${esc(p.path)}" class="${p.path === current ? "is-on" : ""}"><b>${esc(p.title)}</b><span class="muted">${esc(p.path)}</span></button>`).join("")}
      ${docs.map((d) => `<button data-h="/assets/docs/${esc(d)}" data-doc="1"><b>PDF</b><span class="muted">${esc(d)}</span></button>`).join("")}</div>
      <p>${allowRemove ? `<button class="btn danger" id="rm">${esc(t("remove_link"))}</button> ` : ""}<button class="btn ghost" id="close">${esc(t("cancel"))}</button></p>`);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener("cancel", () => done(null));
    $("#close", dlg).onclick = () => done(null);
    if ($("#rm", dlg)) $("#rm", dlg).onclick = () => done("");
    $("#ext-go", dlg).onclick = () => { const v = $("#ext", dlg).value.trim(); if (v) done(/^[a-z]+:/i.test(v) ? v : "https://" + v.replace(/^\/\//, "")); };
    $("#q", dlg).oninput = (e) => { const q = e.target.value.toLowerCase(); dlg.querySelectorAll("[data-h]").forEach((b) => (b.hidden = !!q && !b.textContent.toLowerCase().includes(q))); };
    dlg.querySelectorAll("[data-h]").forEach((b) => (b.onclick = () => done(b.dataset.h)));
    $("#q", dlg).focus();
  });
}
