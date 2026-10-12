/* Progressive enhancement. No frameworks, no third-party requests
   until the visitor asks for them (video click) or consents (analytics). */
(function () {
  "use strict";
  var cfg = {};
  try { cfg = JSON.parse(document.getElementById("bk-config").textContent) || {}; } catch (e) { /* defaults */ }
  var ui = cfg.ui || {};

  // ---------- quote request form ----------
  // Nothing leaves the page until the visitor presses send. Without an endpoint the visitor's own mail program is used.
  Array.prototype.forEach.call(document.querySelectorAll("[data-quote]"), function (box) {
    var form = box.querySelector("form");
    var status = box.querySelector(".qf__status");
    if (!form) return;
    // arrived from a product page: ?produkt=<name> pre-fills the message
    try {
      var m = /[?&]produkt=([^&#]*)/.exec(window.location.search);
      var ta = form.querySelector("textarea");
      if (m && ta && !ta.value) ta.value = box.getAttribute("data-about") + " " + decodeURIComponent(m[1].replace(/\+/g, " ")).slice(0, 120) + "\n\n";
    } catch (e) { /* ignore malformed encoding */ }
    function say(msg, bad) { status.textContent = msg; status.className = "qf__status" + (bad ? " is-bad" : " is-ok"); }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!form.checkValidity()) { form.reportValidity(); return; }
      var data = new FormData(form);
      if (data.get("website")) { say(box.getAttribute("data-ok")); form.reset(); return; } // honeypot: pretend success
      var endpoint = box.getAttribute("data-endpoint");
      var btn = form.querySelector("button[type=submit]");
      if (endpoint) {
        btn.disabled = true; say(box.getAttribute("data-sending"));
        var key = box.getAttribute("data-key");
        var opts = { method: "POST", body: data, headers: { Accept: "application/json" } };
        if (key) {
          // Supabase REST: JSON row into the quote_requests table; the public key may only insert (row-level security)
          var row = { message: String(data.get("message") || ""), consent: true, lang: document.documentElement.lang || "", page: location.pathname };
          ["name", "company", "email", "phone"].forEach(function (k) { row[k] = String(data.get(k) || ""); });
          opts = { method: "POST", body: JSON.stringify(row),
            headers: { "Content-Type": "application/json", apikey: key, Authorization: "Bearer " + key, Prefer: "return=minimal" } };
        }
        fetch(endpoint, opts)
          .then(function (r) { if (!r.ok) throw new Error(String(r.status)); say(box.getAttribute("data-ok")); form.reset(); })
          .catch(function () { say(box.getAttribute("data-err"), true); })
          .then(function () { btn.disabled = false; });
        return;
      }
      var to = box.getAttribute("data-mailto");
      var body = ["name", "company", "email", "phone"].map(function (k) { return data.get(k) ? k + ": " + data.get(k) : ""; })
        .filter(Boolean).join("\n") + "\n\n" + data.get("message");
      say(box.getAttribute("data-mail"));
      window.location.href = "mailto:" + to + "?subject=" + encodeURIComponent(box.getAttribute("data-subject")) + "&body=" + encodeURIComponent(body);
    });
  });

  // ---------- image carousels ----------
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  Array.prototype.forEach.call(document.querySelectorAll("[data-carousel]"), function (box) {
    var track = box.querySelector(".carousel__track");
    if (!track || track.children.length < 2) return;
    var count = track.children.length;
    var dots = box.querySelectorAll(".carousel__dot");
    var prev = box.querySelector(".carousel__btn--prev");
    var next = box.querySelector(".carousel__btn--next");
    var idx = 0, stopped = false, hovering = false, visible = false, raf = 0;
    function go(i, instant) {
      i = Math.max(0, Math.min(count - 1, i));
      track.scrollTo({ left: i * track.clientWidth, behavior: instant || reduceMotion ? "auto" : "smooth" });
    }
    function sync() {
      idx = Math.max(0, Math.min(count - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
      Array.prototype.forEach.call(dots, function (d, k) { if (k === idx) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
      if (prev) prev.disabled = idx === 0;
      if (next) next.disabled = idx === count - 1;
    }
    track.addEventListener("scroll", function () {
      if (raf) return;
      raf = window.requestAnimationFrame(function () { raf = 0; sync(); });
    }, { passive: true });
    if (prev) prev.addEventListener("click", function () { stopped = true; go(idx - 1); });
    if (next) next.addEventListener("click", function () { stopped = true; go(idx + 1); });
    Array.prototype.forEach.call(dots, function (d, k) { d.addEventListener("click", function () { stopped = true; go(k); }); });
    ["touchstart", "keydown", "wheel"].forEach(function (ev) { track.addEventListener(ev, function () { stopped = true; }, { passive: true }); });
    window.addEventListener("resize", function () { go(idx, true); });
    var ms = parseInt(box.getAttribute("data-autoplay"), 10);
    if (ms && !reduceMotion && "IntersectionObserver" in window) {
      new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }, { threshold: 0.5 }).observe(box);
      box.addEventListener("mouseenter", function () { hovering = true; });
      box.addEventListener("mouseleave", function () { hovering = false; });
      box.addEventListener("focusin", function () { stopped = true; });
      window.setInterval(function () {
        if (stopped || hovering || !visible || document.hidden) return;
        go(idx >= count - 1 ? 0 : idx + 1);
      }, Math.max(2000, ms));
    }
    sync();
  });

  // ---------- mobile navigation ----------
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); toggle.focus(); }
    });
  }

  // ---------- mega menu (hover works in CSS; this adds touch + keyboard) ----------
  document.querySelectorAll(".nav__toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var li = btn.closest(".nav__item");
      var open = li.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
  // ---------- products menu: hovering a brand shows its ranges and models in the panel below ----------
  document.querySelectorAll(".mega--logos").forEach(function (mega) {
    var tiles = [].slice.call(mega.querySelectorAll(".logorow__item[data-panel]"));
    var panels = [].slice.call(mega.querySelectorAll(".mega__panel"));
    if (!tiles.length || !panels.length) return;
    var timer = 0, lastType = "mouse";
    var pointerNav = false;
    document.addEventListener("pointerdown", function () { pointerNav = true; }, true);
    document.addEventListener("keydown", function () { pointerNav = false; }, true);
    var host = mega.querySelector(".mega__panels");
    var small = window.matchMedia ? window.matchMedia("(max-width: 980px)") : { matches: false };
    // small screens: every panel sits directly under its manufacturer (an accordion); wide screens: one shared panel below the row
    function place() {
      tiles.forEach(function (tile) {
        var p = document.getElementById(tile.getAttribute("data-panel"));
        var li = tile.closest("li");
        if (!p || !li) return;
        if (small.matches) { if (p.parentNode !== li) li.appendChild(p); }
        else if (host && p.parentNode !== host) host.appendChild(p);
      });
    }
    place();
    if (small.addEventListener) small.addEventListener("change", function () { reset(); place(); });
    else if (small.addListener) small.addListener(function () { reset(); place(); });
    function show(tile) {
      var id = tile.getAttribute("data-panel");
      tiles.forEach(function (t) { var on = t === tile; t.classList.toggle("is-on", on); t.setAttribute("aria-expanded", on ? "true" : "false"); });
      panels.forEach(function (p) { p.classList.toggle("is-on", p.id === id); });
      mega.classList.add("has-panel");
    }
    // back to the plain row of logos when the menu is left or closed
    function reset() {
      clearTimeout(timer);
      mega.classList.remove("has-panel");
      tiles.forEach(function (t) { t.classList.remove("is-on"); t.setAttribute("aria-expanded", "false"); });
      panels.forEach(function (p) { p.classList.remove("is-on"); });
    }
    // the small preview pictures load as soon as the menu is first touched, so they are ready when a brand is picked
    var warmed = false;
    function warm() {
      if (warmed) return;
      warmed = true;
      panels.forEach(function (p) { [].forEach.call(p.querySelectorAll("img"), function (im) { im.loading = "eager"; }); });
    }
    var item = mega.closest(".nav__item");
    if (item) {
      ["pointerenter", "focusin", "touchstart"].forEach(function (ev) { item.addEventListener(ev, warm, { once: true, passive: true }); });
      item.addEventListener("pointerleave", function (e) { if (e.pointerType !== "touch") reset(); });
      item.addEventListener("focusout", function (e) { if (!item.contains(e.relatedTarget)) reset(); });
      var tog = item.querySelector(".nav__toggle");
      if (tog) tog.addEventListener("click", reset);
    }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") reset(); });
    document.addEventListener("click", function (e) { if (!e.target.closest(".nav__item--mega")) reset(); });
    tiles.forEach(function (tile, i) {
      tile.addEventListener("pointerdown", function (e) { lastType = e.pointerType || "mouse"; });
      // a short delay so sweeping the pointer across the row does not flicker through every brand
      tile.addEventListener("pointerenter", function (e) {
        if (e.pointerType === "touch") return;
        clearTimeout(timer);
        timer = setTimeout(function () { show(tile); }, 90);
      });
      tile.addEventListener("pointerleave", function () { clearTimeout(timer); });
      // keyboard focus previews the brand; a pointer press already decides by itself (click toggles)
      tile.addEventListener("focus", function () { if (!pointerNav) show(tile); });
      tile.addEventListener("click", function (e) {
        if (small.matches) {
          // phone: a tap unfolds / folds the manufacturer; the "view full range" button inside goes to its page
          e.preventDefault();
          if (tile.classList.contains("is-on")) reset();
          else {
            show(tile);
            var p = document.getElementById(tile.getAttribute("data-panel"));
            setTimeout(function () { if (p && p.scrollIntoView) p.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 260);
          }
          return;
        }
        // wide screen with touch: the first tap previews the brand, the second one opens it
        if (lastType === "touch" && !tile.classList.contains("is-on")) { e.preventDefault(); show(tile); }
      });
      tile.addEventListener("keydown", function (e) {
        var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!d) return;
        var n = tiles[i + d];
        if (n) { e.preventDefault(); n.focus(); }
      });
    });
  });

  // ---------- logo rows follow the mouse sideways ----------
  // A row of logos that is wider than its box scrolls to match the pointer, so the rest of the
  // logos can be reached without a scrollbar. Touch keeps native swiping.
  document.querySelectorAll("[data-scrub]").forEach(function (row) {
    var target = null, raf = 0;
    function step() {
      raf = 0;
      if (target === null) return;
      var d = target - row.scrollLeft;
      if (Math.abs(d) < 1) { row.scrollLeft = target; return; }
      row.scrollLeft += d * 0.14;
      raf = requestAnimationFrame(step);
    }
    row.addEventListener("pointermove", function (e) {
      if (e.pointerType && e.pointerType !== "mouse") return;
      var max = row.scrollWidth - row.clientWidth;
      if (max <= 2) return;
      var r = row.getBoundingClientRect();
      var x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      // the outer 15 % on each side reach the ends, the middle maps smoothly
      var p = x < 0.15 ? 0 : x > 0.85 ? 1 : (x - 0.15) / 0.7;
      target = p * max;
      if (!raf) raf = requestAnimationFrame(step);
    });
    row.addEventListener("pointerleave", function () { target = null; });
  });

  // ---------- call bar (phones): slides in while the banner scrolls away, back out when you return to the top ----------
  (function () {
    var bar = document.querySelector("[data-callbar]");
    if (!bar) return;
    var link = bar.querySelector(".callbar__link"), glow = bar.querySelector(".callbar__glow");
    var heroEl = document.querySelector(".hero");
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var cur = 0, tgt = 0, gx = 0.5, gxT = 0.5, raf = 0;
    bar.classList.add("is-live");
    // the bar is fully in when most of the banner has gone; pages without a banner use a short distance
    function distance() { return Math.max(180, (heroEl ? heroEl.offsetHeight : 0) * 0.65); }
    function frame() {
      raf = 0;
      cur += (tgt - cur) * (reduce ? 1 : 0.16);
      if (Math.abs(tgt - cur) < 0.003) cur = tgt;
      gx += (gxT - gx) * 0.1;
      bar.style.transform = "translate3d(0," + ((1 - cur) * 110).toFixed(2) + "%,0)";
      var w = bar.clientWidth || 360;
      glow.style.transform = "translate3d(" + Math.round(gx * w * 1.0 - w * 0.31) + "px,0,0)";
      var shown = cur > 0.01;
      bar.classList.toggle("is-shown", shown);
      var usable = cur > 0.4;
      link.tabIndex = usable ? 0 : -1;
      bar.setAttribute("aria-hidden", usable ? "false" : "true");
      if (cur !== tgt || Math.abs(gxT - gx) > 0.004) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function onScroll() {
      var y = window.pageYOffset || document.documentElement.scrollTop || 0;
      tgt = Math.min(1, Math.max(0, y / distance()));
      // scrolling also moves the embers a little, so the colour is never static
      var h = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      gxT = 0.15 + 0.7 * Math.min(1, y / h);
      kick();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // the pointer / finger steers the glow
    window.addEventListener("pointermove", function (e) {
      gxT = Math.min(1, Math.max(0, e.clientX / Math.max(1, window.innerWidth)));
      kick();
    }, { passive: true });
    onScroll();
    frame();
  })();

  // ---------- banner: the picture follows the scroll for a while (slower than the page) ----------
  (function () {
    var hero = document.querySelector(".hero");
    var img = hero && hero.querySelector(".hero__img");
    if (!img || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    hero.classList.add("hero--parallax");
    var raf = 0, MAX = 90;
    function update() {
      raf = 0;
      if (window.scrollY > hero.offsetTop + hero.offsetHeight + 200) return;
      img.style.setProperty("--py", Math.min(MAX, Math.max(0, window.scrollY) * 0.4) + "px");
    }
    window.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    update();
  })();

  function closeMenus() {
    document.querySelectorAll(".nav__item.is-open").forEach(function (li) {
      li.classList.remove("is-open");
      var b = li.querySelector(".nav__toggle"); if (b) b.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll("details.lang[open]").forEach(function (d) { d.removeAttribute("open"); });
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".nav__item--mega") && !e.target.closest("details.lang")) closeMenus();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenus(); });

  // ---------- header shadow once scrolled ----------
  var hdr = document.querySelector("[data-header]");
  if (hdr) {
    var onScroll = function () { hdr.classList.toggle("is-scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---------- video facade: iframe only after the visitor clicks ----------
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest(".video__play");
    if (!btn) return;
    var fig = btn.closest(".video");
    var id = fig && fig.getAttribute("data-yt");
    if (!id) return;
    var start = parseInt(fig.getAttribute("data-start") || "0", 10);
    var src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1&rel=0&playsinline=1" + (start ? "&start=" + start : "");
    var f = document.createElement("iframe");
    f.src = src;
    f.title = fig.getAttribute("data-title") || "Video";
    f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    f.setAttribute("allowfullscreen", "");
    f.referrerPolicy = "strict-origin-when-cross-origin";
    fig.textContent = "";
    fig.classList.add("is-playing");
    fig.appendChild(f);
    // fallback if the embedded player cannot render in this browser: plain link to the video
    var alt = document.createElement("a");
    alt.className = "video__yt";
    alt.href = "https://www.youtube.com/watch?v=" + encodeURIComponent(id) + (start ? "&t=" + start + "s" : "");
    alt.target = "_blank";
    alt.rel = "noopener";
    alt.textContent = fig.getAttribute("data-watch") || "YouTube";
    fig.insertAdjacentElement("afterend", alt);
  });

  // ---------- site search (static index, loaded on demand) ----------
  var searchBtn = document.querySelector("[data-search-open]");
  var dlg, input, list, index;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function norm(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  function build() {
    dlg = document.createElement("dialog");
    dlg.className = "search";
    dlg.setAttribute("aria-label", ui.search || "Sök");
    dlg.innerHTML = '<div class="search__bar"><input class="search__input" type="search" autocomplete="off" placeholder="' + esc(ui.searchPlaceholder || "Sök…") +
      '" aria-label="' + esc(ui.search || "Sök") + '"><button class="search__close" type="button">' + esc(ui.searchClose || "Stäng") + '</button></div><ul class="search__results"></ul>';
    document.body.appendChild(dlg);
    input = dlg.querySelector(".search__input");
    list = dlg.querySelector(".search__results");
    dlg.querySelector(".search__close").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    input.addEventListener("input", run);
  }
  var state = "idle"; // idle | loading | ready | error
  function row(it) {
    var tags = (it.g || []).slice(0, 4).map(function (g) { return "<i>" + esc(g) + "</i>"; }).join("");
    return '<li><a href="' + esc(it.u) + '"><strong>' + esc(it.t) + "</strong><span>" + esc(it.x.slice(0, 110)) + "…</span>" + (tags ? '<em class="search__tags">' + tags + "</em>" : "") + "</a></li>";
  }
  function load() {
    if (state === "loading" || state === "ready") return;
    state = "loading";
    fetch(cfg.searchIndex || "/search-index.json")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { index = j; state = "ready"; run(); })
      .catch(function () { state = "error"; run(); });
  }
  function run() {
    var q = norm(input.value.trim());
    if (state === "error") { list.innerHTML = '<li class="search__empty">' + esc(ui.searchError || "Could not load the search. Check your connection and try again.") + "</li>"; return; }
    if (!index) { list.innerHTML = '<li class="search__empty">…</li>'; return; }
    if (q.length < 2) {
      // nothing typed yet: offer the main pages (brands and company pages) instead of an empty box
      var main = index.filter(function (it) { return it.d >= 1 && it.d <= 2; }).sort(function (x, y) { return y.d - x.d; }).slice(0, 14);
      list.innerHTML = main.length ? '<li class="search__hint">' + esc(ui.searchHint || "") + "</li>" + main.map(row).join("") : "";
      return;
    }
    var terms = q.split(/\s+/);
    var hits = [];
    index.forEach(function (it) {
      var title = norm(it.t), body = norm(it.x), tagz = norm((it.g || []).join(" | ")), other = it.o ? norm(it.o) : "";
      var score = 0;
      for (var i = 0; i < terms.length; i++) {
        var inT = title.indexOf(terms[i]) >= 0, inG = tagz.indexOf(terms[i]) >= 0, inB = body.indexOf(terms[i]) >= 0, inO = other.indexOf(terms[i]) >= 0;
        if (!inT && !inG && !inB && !inO) return;
        score += (inT ? 6 : 0) + (inG ? 4 : 0) + (inB ? 1 : 0) + (inO && !inT && !inG && !inB ? 2 : 0);
      }
      hits.push({ it: it, s: score });
    });
    hits.sort(function (a, b) { return b.s - a.s; });
    list.innerHTML = hits.length
      ? hits.slice(0, 12).map(function (h) { return row(h.it); }).join("")
      : '<li class="search__empty">' + esc(ui.searchNone || "No results.") + "</li>";
  }
  if (searchBtn) {
    searchBtn.addEventListener("click", function () {
      if (!dlg) build();
      if (state === "error") state = "idle";
      load();
      run();
      dlg.showModal();
      input.focus();
    });
  }

  // ---------- consent + analytics (off unless configured; nothing stored otherwise) ----------
  var a = cfg.analytics;
  if (!a || !a.id) return;
  var KEY = "bk_consent_v1";
  function read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function write(v) { try { localStorage.setItem(KEY, JSON.stringify({ analytics: v, ts: Date.now() })); } catch (e) { /* private mode */ } }
  function loadGA() {
    if (window.__bkGA) return;
    window.__bkGA = true;
    window["ga-disable-" + a.id] = false;
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "granted" });
    gtag("js", new Date());
    gtag("config", a.id, { anonymize_ip: true, allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(a.id);
    document.head.appendChild(s);
  }
  function revoke() {
    window["ga-disable-" + a.id] = true;
    document.cookie.split(";").forEach(function (c) {
      var n = c.split("=")[0].trim();
      if (/^_ga/.test(n) || n === "_gid") {
        document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
        document.cookie = n + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=." + location.hostname.replace(/^www\./, "");
      }
    });
  }
  var banner;
  function hide() { if (banner) { banner.remove(); banner = null; } }
  function show() {
    if (banner) return;
    banner = document.createElement("section");
    banner.className = "consent";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-labelledby", "consent-title");
    banner.innerHTML = '<h2 id="consent-title">' + esc(ui.title || "Cookies") + "</h2><p>" + esc(ui.text || "") +
      (cfg.privacy ? ' <a href="' + esc(cfg.privacy) + '">' + esc(ui.policy || "") + "</a>" : "") + '</p><div class="consent__actions">' +
      '<button type="button" class="btn" data-c="reject">' + esc(ui.reject || "Avvisa") + '</button>' +
      '<button type="button" class="btn" data-c="accept">' + esc(ui.accept || "Godkänn") + "</button></div>";
    banner.addEventListener("click", function (e) {
      var c = e.target.getAttribute && e.target.getAttribute("data-c");
      if (!c) return;
      if (c === "accept") { write(true); loadGA(); } else { write(false); revoke(); }
      hide();
    });
    document.body.appendChild(banner);
  }
  var saved = read();
  if (saved && saved.analytics === true) loadGA();
  else if (!saved) show();
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("[data-consent-open]")) show();
  });
})();
