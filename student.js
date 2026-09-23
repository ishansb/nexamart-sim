/* NexaMart Choice Simulation — student app (vanilla JS, no build step). */
(function () {
  "use strict";
  const CFG = window.NEXAMART_CONFIG;
  const NX = window.NX;
  const Q = new URLSearchParams(location.search);
  const TEST = Q.get("test") === "1";
  const SPEED = TEST ? Math.max(1, Math.min(60, parseFloat(Q.get("speed") || "1") || 1)) : 1;
  const CLASS_CODE = (Q.get("c") || CFG.CLASS_CODE || "DEFAULT").replace(/[^A-Za-z0-9_\-]/g, "").slice(0, 40) || "DEFAULT";
  const STORE_KEY = "nexamart_v1:" + CLASS_CODE;
  const API = (CFG.API_URL || "").trim();
  const PER_ALT = CFG.SECONDS_PER_ALTERNATIVE || 10;

  const CAT = {
    chocolate: { label: "Chocolate", title: "Choose a chocolate bar", noun: "chocolate bar",
      context: "You feel like buying a chocolate bar for yourself." },
    running_shoes: { label: "Running shoes", title: "Choose a pair of running shoes", noun: "pair of running shoes",
      context: "You are buying running shoes for regular jogging.",
      attrs: ["Price", "Cushioning", "Weight", "Durability", "Rating", "Other"] },
    smartphones: { label: "Smartphone", title: "Choose a smartphone", noun: "smartphone",
      context: "Your phone needs replacing, and you are buying a new one.",
      attrs: ["Price", "Camera", "Battery", "Processor", "Storage"].concat(CFG.SHOW_PHONE_RATING ? ["Rating"] : []).concat(["Other"]) }
  };
  const LIKERT = [
    ["difficulty", "How difficult was this decision?", "Very easy", "Very difficult"],
    ["confidence", "How confident are you that you made a good choice?", "Not at all confident", "Extremely confident"],
    ["satisfaction", "How satisfied are you with the choice you made?", "Not at all satisfied", "Extremely satisfied"],
    ["reconsideration", "How likely are you to reconsider your choice if you had another opportunity?", "Very unlikely", "Very likely"],
    ["choice_deferral", "At any point, did you feel like postponing or avoiding the decision?", "Not at all", "Very strongly"]
  ];

  let PRODUCTS = {}, BYCAT = {}, IMAGES = {}, IMG_HASH = "", state = null;
  const app = document.getElementById("app");
  const modal = document.getElementById("modal");
  const stepsEl = document.getElementById("steps");

  /* ---------------- storage ---------------- */
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked: keep running */ } }
  function load() { try { const s = localStorage.getItem(STORE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach((_, i) => b[i] = Math.random() * 256 | 0);
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function deviceClass() { const w = Math.min(window.innerWidth, screen.width || window.innerWidth); return w < 600 ? "phone" : (w < 1024 ? "tablet" : "laptop"); }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function inr(n) { return "₹" + Number(n).toLocaleString("en-IN"); }

  /* ---------------- network ---------------- */
  async function post(payload, timeoutMs) {
    if (!API) throw new Error("no_api");
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs || 12000);
    try {
      const r = await fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), redirect: "follow", signal: ctl.signal });
      const j = await r.json();
      return j;
    } finally { clearTimeout(t); }
  }
  let flushing = false;
  async function flush() {
    if (flushing || !API || !state) return; flushing = true;
    try {
      for (const item of state.queue) {
        if (item.sent) continue;
        try {
          const res = item.kind === "row" ? await post({ action: "submit", row: item.row }) : await post({ action: "complete", session_id: state.session_id, hardest_decision: item.hardest, completed_at: item.completed_at });
          if (res && res.ok) { item.sent = true; item.sent_at = new Date().toISOString(); save(); }
          else if (res && res.error === "unknown_session" && item.kind === "complete") { /* rows not yet stored; retry later */ }
        } catch (e) { break; }
      }
    } finally { flushing = false; if (state && state.screen === "end") renderEnd(); }
  }
  setInterval(flush, 10000);
  window.addEventListener("online", flush);

  async function getAssignment() {
    const mode = CFG.ASSIGNMENT_MODE === "independent" ? "independent" : "balanced_deck";
    if (API) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await post({ action: "assign", session_id: state.session_id, class_code: CLASS_CODE, assignment_mode: mode,
            device_class: deviceClass(), app_version: CFG.APP_VERSION, test_mode: TEST }, 10000);
          if (res && res.ok) return { participant_number: res.participant_number, cell_index: res.cell_index, product_order: res.product_order,
            sizes: res.sizes, assignment_mode: res.assignment_mode || mode, source: "server" };
          if (res && res.error === "closed") return { closed: true };
        } catch (e) { /* retry */ }
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt) + Math.random() * 500));
      }
    }
    // Fallback: random balanced cell on the device (flagged as client-assigned).
    const r = new Uint32Array(2); crypto.getRandomValues(r);
    const a = NX.assignmentFor(r[0] % 36, "client-" + r[1], CLASS_CODE, mode);
    return { participant_number: "", cell_index: a.cell_index, product_order: a.product_order, sizes: a.sizes, assignment_mode: mode, source: "client" };
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    if (TEST && Q.get("reset") === "1") { try { localStorage.removeItem(STORE_KEY); } catch (e) { } history.replaceState(null, "", location.pathname + "?" + [...Q].filter(([k]) => k !== "reset").map(([k, v]) => k + "=" + encodeURIComponent(v)).join("&")); }
    try {
      const [p, im] = await Promise.all([fetch("products.json", { cache: "no-cache" }).then(r => r.json()), fetch("approved_images.json", { cache: "no-cache" }).then(r => r.json())]);
      IMG_HASH = im.images_manifest_hash; IMAGES = im.images;
      for (const [cat, block] of Object.entries(p.categories)) {
        BYCAT[cat] = block;
        block.products.forEach(pr => {
          if (!IMAGES[pr.product_id]) throw new Error("Image for " + pr.product_id + " is not approved");
          PRODUCTS[pr.product_id] = pr;
        });
      }
    } catch (e) {
      app.innerHTML = `<div class="panel"><h1>Something went wrong</h1><p>The exercise could not load. Please tell your instructor.</p><p class="small">${esc(e.message)}</p></div>`;
      return;
    }
    state = load();
    if (!state || state.v !== 1) {
      state = { v: 1, session_id: uuid(), class_code: CLASS_CODE, test_mode: TEST, created_at: new Date().toISOString(),
        assignment: null, screen: "welcome", round: 0, rounds: [], queue: [], hardest: null };
      save();
    }
    if (TEST) renderTestBar(); else if (CFG.PREVIEW) renderPreviewBar();
    route();
    flush();
  }

  function route() {
    closeModal();
    const s = state.screen;
    stepsEl.textContent = state.assignment && ["ready", "decision", "reflect"].includes(s) ? `Decision ${state.round + 1} of 3` : "";
    if (s === "welcome") return renderWelcome();
    if (s === "instructions") return renderInstructions();
    if (s === "ready") return renderReady();
    if (s === "decision") return renderDecision();
    if (s === "reflect") return renderReflect();
    if (s === "final") return renderFinal();
    if (s === "end") return renderEnd();
    if (s === "closed") return renderClosed();
  }
  function go(screen) { state.screen = screen; save(); route(); window.scrollTo(0, 0); app.focus({ preventScroll: true }); }

  /* ---------------- screens ---------------- */
  function renderWelcome() {
    app.innerHTML = `<section class="panel">
      <div class="eyebrow">Shopping exercise</div>
      <h1>Welcome to NexaMart</h1>
      <p class="lead">NexaMart is a large online store for young urban shoppers in India. Over the past year it has added many more products to several categories.</p>
      <p>Today you will shop on NexaMart as yourself. There are no right or wrong answers.</p>
      <p class="small">About 10 minutes. No login, and your answers are anonymous.</p>
      <div class="actions"><button class="btn block" id="start">Start</button></div>
    </section>`;
    document.getElementById("start").onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = "Setting up…";
      if (!state.assignment) {
        const a = await getAssignment();
        if (a.closed) { go("closed"); return; }
        state.assignment = a;
        state.rounds = a.product_order.map(cat => {
          const size = a.sizes[cat];
          const ids = BYCAT[cat]["set_" + size];
          return { category: cat, set_size: size, card_order: NX.shuffled(ids, state.session_id + "|" + cat),
            preferred_attribute: "", started_wall: null, status: "pending", selected: null, provisional: null,
            deferred: false, timed_out: false, decision_ms: null, first_sel_ms: null, sel_changes: 0,
            viewed: [], expanded: [], expand_ms: 0, refresh_count: 0, hidden_ms: 0, responses: null };
        });
        save();
      }
      go("instructions");
    };
  }
  function renderClosed() {
    app.innerHTML = `<section class="panel"><h1>This exercise is closed</h1><p>Your instructor has stopped accepting new responses.</p></section>`;
  }
  function renderInstructions() {
    app.innerHTML = `<section class="panel">
      <h1>How it works</h1>
      <p class="lead">You will make three shopping decisions. Each decision has a limited amount of time. Choose the product you would genuinely prefer.</p>
      <ul>
        <li>Tap a picture to see a product larger.</li>
        <li>Tap <b>Choose</b> on the product you want, then <b>Confirm choice</b>.</li>
        <li>A timer at the top shows how much time is left.</li>
        <li>After each decision, answer a few quick questions.</li>
      </ul>
      <p class="small">Please stay on this page and do not open it on a second device.</p>
      <div class="actions"><button class="btn block" id="go">I'm ready</button></div>
    </section>`;
    document.getElementById("go").onclick = () => go("ready");
  }

  function renderReady() {
    const r = state.rounds[state.round]; const c = CAT[r.category];
    const askAttr = CFG.ASK_PREFERRED_ATTRIBUTE && c.attrs;
    app.innerHTML = `<section class="panel">
      <div class="eyebrow">Decision ${state.round + 1} of 3</div>
      <h1>${esc(c.label)}</h1>
      <p class="lead">${esc(c.context)}</p>
      ${askAttr ? `<div class="q"><div class="qt">Which factor matters most to you in this decision?</div>
        <div class="opts" role="group" aria-label="Most important factor">${c.attrs.map(a => `<button class="opt" data-attr="${a}" aria-pressed="${r.preferred_attribute === a}">${a}</button>`).join("")}</div>
        <p class="small">Optional.</p></div>` : ""}
      <p>The timer starts as soon as the products appear.</p>
      <div class="actions"><button class="btn block" id="go" disabled>Loading products…</button></div>
    </section>`;
    app.querySelectorAll("[data-attr]").forEach(b => b.onclick = () => {
      r.preferred_attribute = r.preferred_attribute === b.dataset.attr ? "" : b.dataset.attr; save();
      app.querySelectorAll("[data-attr]").forEach(x => x.setAttribute("aria-pressed", x.dataset.attr === r.preferred_attribute));
    });
    const btn = document.getElementById("go");
    preload(r.card_order).then(() => { btn.disabled = false; btn.textContent = "Show me the products"; });
    btn.onclick = () => go("decision");
  }
  function preload(ids) {
    return Promise.all(ids.map(id => new Promise(res => { const i = new Image(); i.onload = i.onerror = res; i.src = IMAGES[id].src; }))).then(() => new Promise(r => setTimeout(r, 50)));
  }

  /* ---------------- decision ---------------- */
  let T = null; // live timer context
  function dots(n) { return `<span class="dots" aria-hidden="true">${"●".repeat(n)}<s>${"●".repeat(5 - n)}</s></span>`; }
  function attrsHTML(p) {
    if (p.category === "running_shoes") return `<dl class="attrs">
      <dt>Cushioning</dt><dd>${dots(p.cushioning_level)}${esc(p.cushioning)}</dd>
      <dt>Weight</dt><dd>${p.weight_g} g</dd>
      <dt>Durability</dt><dd>~${p.durability_km} km</dd>
      <dt>Rating</dt><dd><span class="st">★</span> ${p.rating.toFixed(1)}</dd></dl>`;
    if (p.category === "smartphones") return `<dl class="attrs">
      <dt>Camera</dt><dd>${esc(p.camera)}</dd>
      <dt>Battery</dt><dd>${p.battery_mah.toLocaleString("en-IN")} mAh</dd>
      <dt>Processor</dt><dd>${dots(p.processor_tier)}${esc(p.processor)}</dd>
      <dt>Storage</dt><dd>${p.storage_gb} GB</dd>
      ${CFG.SHOW_PHONE_RATING ? `<dt>Rating</dt><dd><span class="st">★</span> ${p.rating.toFixed(1)}</dd>` : ""}</dl>`;
    return "";
  }
  function cardHTML(p, sel) {
    const choc = p.category === "chocolate";
    return `<article class="card${sel ? " sel" : ""}" data-id="${p.product_id}">
      <button class="imgbtn" data-open="${p.product_id}" aria-label="View ${esc(p.brand + " " + p.name)} larger"><img src="${IMAGES[p.product_id].src}" alt="" width="400" height="300"></button>
      <div class="info">
        ${choc ? `<div class="brandname">${esc(p.brand)}</div><div class="pname">${esc(p.name)}</div>`
               : `<div class="pname">${esc(p.brand)} ${esc(p.name)}</div>`}
        <div class="price">${inr(p.price_inr)}</div>
        ${choc ? `<div class="rating"><span class="st">★</span> ${p.rating.toFixed(1)}</div><div class="desc">${esc(p.descriptor)}</div>` : attrsHTML(p)}
        <div class="choose"><button class="btn" data-pick="${p.product_id}" aria-pressed="${sel}">${sel ? "Chosen ✓" : "Choose"}</button></div>
      </div></article>`;
  }

  function renderDecision() {
    const r = state.rounds[state.round]; const c = CAT[r.category];
    if (r.status === "done") { go("reflect"); return; }
    const assigned = r.set_size * PER_ALT;
    app.innerHTML = `<div class="dhead"><div class="dhead-row">
        <div><h1>${esc(c.title)}</h1><div class="sub">${r.set_size} options</div></div>
        <div class="clock" id="clock" role="timer" aria-live="off">--:--</div></div>
        <div class="tbar" id="tbar"><i id="tfill"></i></div>
        <div class="sr" id="sr" aria-live="assertive" style="position:absolute;left:-9999px"></div></div>
      <div class="grid ${r.category === "chocolate" ? "choc" : "specs"}" id="grid">${r.card_order.map(id => cardHTML(PRODUCTS[id], r.selected === id)).join("")}</div>
      <div class="dock"><div class="dock-in">
        <div class="pick" id="pick">${pickText(r)}</div>
        <button class="btn" id="confirm" ${r.selected ? "" : "disabled"}>Confirm choice</button>
        ${CFG.BEHAVIOURAL_DEFERRAL ? `<div class="defer" id="defer"><button class="linkbtn" id="deferbtn">I wouldn't buy any of these right now</button></div>` : ""}
      </div></div>`;

    // timer context
    const resumed = r.started_wall !== null;
    if (!resumed) { r.started_wall = Date.now(); r.status = "running"; }
    else { r.refresh_count++; }
    save();
    T = { r, assigned, offset: resumed ? Math.max(0, Date.now() - r.started_wall) : 0, perf0: performance.now(),
      hiddenAt: document.hidden ? performance.now() : null, seen: new Map(), openId: null, openAt: 0, done: false, lastTick: -1, warned: {} };
    if (T.offset >= assigned * 1000 / SPEED) { timeout(); return; }

    const grid = document.getElementById("grid");
    grid.addEventListener("click", ev => {
      const open = ev.target.closest("[data-open]"); const pick = ev.target.closest("[data-pick]");
      if (open) openDetail(open.dataset.open);
      else if (pick) select(pick.dataset.pick);
    });
    document.getElementById("confirm").onclick = confirmChoice;
    if (CFG.BEHAVIOURAL_DEFERRAL) document.getElementById("deferbtn").onclick = askDefer;
    observeViews();
    requestAnimationFrame(() => { tick(); T.iv = setInterval(tick, 200); });
  }
  function pickText(r) { return r.selected ? `Your choice<b>${esc(PRODUCTS[r.selected].brand + " " + PRODUCTS[r.selected].name)}</b>` : `Your choice<b>Nothing chosen yet</b>`; }
  function elapsedMs() { return (T.offset + (performance.now() - T.perf0)) * SPEED; }
  function tick() {
    if (!T || T.done) return;
    const total = T.assigned * 1000; const el = elapsedMs(); const rem = Math.max(0, total - el);
    const secs = Math.ceil(rem / 1000);
    const clock = document.getElementById("clock"), bar = document.getElementById("tbar"), fill = document.getElementById("tfill");
    if (clock && secs !== T.lastTick) {
      clock.textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
      const cls = secs <= 10 ? "danger" : (rem <= total / 3 ? "warn" : "");
      clock.className = "clock " + cls; bar.className = "tbar " + cls;
      const sr = document.getElementById("sr");
      if (secs === 10 && !T.warned[10]) { T.warned[10] = 1; sr.textContent = "10 seconds left"; }
      if (CFG.TICK_SOUND && secs <= 5 && secs > 0) beep();
      T.lastTick = secs;
    }
    if (fill) fill.style.transform = `scaleX(${rem / total})`;
    if (rem <= 0) timeout();
  }
  let actx = null;
  function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.value = 0.03; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.05); } catch (e) { } }
  document.addEventListener("visibilitychange", () => {
    if (!T || T.done) return;
    if (document.hidden) T.hiddenAt = performance.now();
    else if (T.hiddenAt !== null) { T.r.hidden_ms += Math.round(performance.now() - T.hiddenAt); T.hiddenAt = null; save(); tick(); }
  });

  function observeViews() {
    if (!("IntersectionObserver" in window)) return;
    const ctx = T, r = T.r;
    ctx.io = new IntersectionObserver(entries => {
      if (ctx.done) return;
      entries.forEach(en => {
        const id = en.target.dataset.id;
        if (en.isIntersecting) {
          if (!ctx.seen.has(id)) ctx.seen.set(id, setTimeout(() => { if (!ctx.done && !r.viewed.includes(id)) { r.viewed.push(id); save(); } }, 500));
        } else if (ctx.seen.has(id)) { clearTimeout(ctx.seen.get(id)); ctx.seen.delete(id); }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll(".card").forEach(c => ctx.io.observe(c));
  }

  function select(id) {
    if (!T || T.done) return;
    const r = T.r;
    if (r.selected === id) return;
    if (r.selected === null && r.first_sel_ms === null) r.first_sel_ms = Math.round(elapsedMs());
    else r.sel_changes++;
    r.selected = id; save();
    document.querySelectorAll(".card").forEach(c => {
      const on = c.dataset.id === id; c.classList.toggle("sel", on);
      const b = c.querySelector("[data-pick]"); b.setAttribute("aria-pressed", on); b.textContent = on ? "Chosen ✓" : "Choose";
    });
    document.getElementById("pick").innerHTML = pickText(r);
    document.getElementById("confirm").disabled = false;
  }

  function openDetail(id) {
    if (!T || T.done) return;
    const p = PRODUCTS[id]; const r = T.r;
    if (!r.expanded.includes(id)) r.expanded.push(id);
    T.openId = id; T.openAt = performance.now(); save();
    const choc = p.category === "chocolate";
    modal.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(p.brand + " " + p.name)}">
      <button class="close" id="mclose" aria-label="Close">×</button>
      <div class="imgwrap"><img src="${IMAGES[id].src}" alt="${esc(p.brand + " " + p.name)}"></div>
      <div class="info" style="padding:10px 2px 0">
        ${choc ? `<div class="brandname">${esc(p.brand)}</div><div class="pname" style="font-size:20px">${esc(p.name)}</div>` : `<div class="pname" style="font-size:20px">${esc(p.brand)} ${esc(p.name)}</div>`}
        <div class="price">${inr(p.price_inr)}</div>
        ${choc ? `<div class="rating"><span class="st">★</span> ${p.rating.toFixed(1)}</div><div class="desc">${esc(p.descriptor)}</div>` : attrsHTML(p)}
        <div class="actions"><button class="btn block" id="mpick">${r.selected === id ? "Chosen ✓" : "Choose this"}</button></div>
      </div></div>`;
    modal.hidden = false;
    document.getElementById("mclose").onclick = closeModal;
    document.getElementById("mpick").onclick = () => { select(id); closeModal(); };
    modal.onclick = ev => { if (ev.target === modal) closeModal(); };
    document.getElementById("mclose").focus();
  }
  function closeModal() {
    if (T && T.openId) { T.r.expand_ms += Math.round((performance.now() - T.openAt) * SPEED); T.openId = null; save(); }
    modal.hidden = true; modal.innerHTML = "";
  }
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

  function askDefer() {
    const d = document.getElementById("defer");
    d.innerHTML = `<span>Skip buying a ${esc(CAT[T.r.category].noun)} for now?</span>
      <button class="btn ghost" id="dyes" style="min-height:38px">Yes, skip</button>
      <button class="linkbtn" id="dno">Keep shopping</button>`;
    document.getElementById("dyes").onclick = () => finishDecision("deferred");
    document.getElementById("dno").onclick = () => { d.innerHTML = `<button class="linkbtn" id="deferbtn">I wouldn't buy any of these right now</button>`; document.getElementById("deferbtn").onclick = askDefer; };
  }
  function confirmChoice() { if (T && T.r.selected) finishDecision("chosen"); }
  function timeout() { finishDecision("timeout"); }

  function finishDecision(kind) {
    if (!T || T.done) return;
    T.done = true; clearInterval(T.iv);
    const r = T.r; const total = T.assigned * 1000;
    closeModal();
    if (T.io) T.io.disconnect();
    T.seen.forEach(t => clearTimeout(t)); T.seen.clear();
    if (T.hiddenAt !== null) { r.hidden_ms += Math.round(performance.now() - T.hiddenAt); T.hiddenAt = null; }
    r.decision_ms = kind === "timeout" ? total : Math.min(total, Math.round(elapsedMs()));
    if (kind === "timeout") { r.timed_out = true; r.provisional = r.selected; r.selected = null; }
    if (kind === "deferred") { r.deferred = true; r.provisional = r.selected; r.selected = null; }
    r.status = "done"; save();
    T = null;
    if (kind === "timeout") {
      document.body.classList.add("locked");
      const o = document.createElement("div"); o.className = "timeup"; o.innerHTML = `<div role="alert">Time is up</div>`;
      document.body.appendChild(o);
      setTimeout(() => { o.remove(); document.body.classList.remove("locked"); go("reflect"); }, 1500);
    } else go("reflect");
  }

  /* ---------------- reflection ---------------- */
  function renderReflect() {
    const r = state.rounds[state.round]; const c = CAT[r.category];
    if (r.responses) { advanceAfterReflect(); return; }
    const resp = r._draft || { strategies: [] };
    let recap;
    if (r.timed_out) recap = r.provisional ? `Time ran out. You were leaning towards <b>${esc(PRODUCTS[r.provisional].brand + " " + PRODUCTS[r.provisional].name)}</b>. Answer about that product.` : `Time ran out before you chose. Answer about how the decision went.`;
    else if (r.deferred) recap = `You chose not to buy any of these for now. Answer about how the decision went.`;
    else recap = `You chose <b>${esc(PRODUCTS[r.selected].brand + " " + PRODUCTS[r.selected].name)}</b>.`;
    app.innerHTML = `<section class="panel">
      <div class="eyebrow">Decision ${state.round + 1} of 3 · ${esc(c.label)}</div>
      <h2>A few quick questions</h2>
      <div class="recap">${recap}</div>
      ${LIKERT.map(([k, q, lo, hi]) => `<div class="q"><div class="qt" id="q-${k}">${q}</div>
        <div class="likert" role="group" aria-labelledby="q-${k}">${[1, 2, 3, 4, 5, 6, 7].map(v => `<button data-k="${k}" data-v="${v}" aria-pressed="${resp[k] === v}" aria-label="${v}${v === 1 ? " " + lo : v === 7 ? " " + hi : ""}">${v}</button>`).join("")}</div>
        <div class="anchors"><span>1 = ${lo}</span><span>7 = ${hi}</span></div></div>`).join("")}
      <div class="q"><div class="qt" id="q-alt">Approximately how many alternatives did you seriously consider before choosing?</div>
        <div class="chips" role="group" aria-labelledby="q-alt">${NX.ALT_BANDS.map(([l]) => `<button class="opt" data-alt="${l}" aria-pressed="${resp.alternatives_considered === l}">${l}</button>`).join("")}</div></div>
      ${CFG.STRATEGY_ITEM ? `<div class="q"><div class="qt" id="q-str">Which of these did you do? Tick all that apply.</div>
        <div class="chips" role="group" aria-labelledby="q-str">${NX.STRATEGIES.map(([k, l]) => `<button class="opt" data-str="${k}" aria-pressed="${resp.strategies.includes(k)}">${l}</button>`).join("")}</div></div>` : ""}
      <div class="actions"><button class="btn block" id="next" disabled>Continue</button></div>
      <p class="small" id="need" style="text-align:center"></p>
    </section>`;
    const need = () => {
      const missing = LIKERT.filter(([k]) => !resp[k]).length + (resp.alternatives_considered ? 0 : 1);
      document.getElementById("next").disabled = missing > 0;
      document.getElementById("need").textContent = missing ? `${missing} question${missing > 1 ? "s" : ""} left` : "";
    };
    app.querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
      resp[b.dataset.k] = +b.dataset.v; r._draft = resp; save();
      app.querySelectorAll(`[data-k="${b.dataset.k}"]`).forEach(x => x.setAttribute("aria-pressed", x === b)); need();
    });
    app.querySelectorAll("[data-alt]").forEach(b => b.onclick = () => {
      resp.alternatives_considered = b.dataset.alt; r._draft = resp; save();
      app.querySelectorAll("[data-alt]").forEach(x => x.setAttribute("aria-pressed", x === b)); need();
    });
    app.querySelectorAll("[data-str]").forEach(b => b.onclick = () => {
      const k = b.dataset.str; const i = resp.strategies.indexOf(k);
      if (i >= 0) resp.strategies.splice(i, 1); else resp.strategies.push(k);
      r._draft = resp; save(); b.setAttribute("aria-pressed", resp.strategies.includes(k));
    });
    need();
    document.getElementById("next").onclick = () => {
      r.responses = resp; delete r._draft;
      state.queue.push({ kind: "row", row: buildRow(state.round), sent: false });
      save(); flush(); advanceAfterReflect();
    };
  }
  function advanceAfterReflect() {
    if (state.round < 2) { state.round++; go("ready"); } else go("final");
  }

  function buildRow(i) {
    const r = state.rounds[i]; const a = state.assignment; const resp = r.responses;
    const band = NX.ALT_BANDS.find(b => b[0] === resp.alternatives_considered);
    return {
      session_id: state.session_id, class_code: CLASS_CODE, participant_number: a.participant_number,
      client_timestamp: new Date().toISOString(), product_order: a.product_order.join("|"), round_index: i + 1,
      assignment_source: a.source, assignment_mode: a.assignment_mode,
      product_category: r.category, involvement_level: NX.INVOLVEMENT[r.category], choice_set_size: r.set_size,
      assigned_time_seconds: r.set_size * PER_ALT, card_order: r.card_order.join("|"),
      selected_product_id: r.selected || "", provisional_product_id: r.provisional || "", deferred_choice: !!r.deferred, timed_out: !!r.timed_out,
      actual_decision_time_ms: r.decision_ms, time_to_first_selection_ms: r.first_sel_ms === null ? "" : r.first_sel_ms,
      selection_changes: r.sel_changes, products_viewed: r.viewed.length, products_expanded: r.expanded.length, expand_time_ms: r.expand_ms,
      refresh_count: r.refresh_count, tab_hidden_ms: r.hidden_ms, preferred_attribute: r.preferred_attribute || "",
      difficulty: resp.difficulty, confidence: resp.confidence, satisfaction: resp.satisfaction, reconsideration: resp.reconsideration,
      choice_deferral: resp.choice_deferral, alternatives_considered: resp.alternatives_considered, alternatives_considered_mid: band ? band[1] : "",
      strategies: (resp.strategies || []).join(";"), app_version: CFG.APP_VERSION, images_manifest_hash: IMG_HASH,
      device_class: deviceClass(), test_mode: !!state.test_mode
    };
  }

  /* ---------------- final + end ---------------- */
  function renderFinal() {
    app.innerHTML = `<section class="panel">
      <div class="eyebrow">Last question</div>
      <h2>Which of the three decisions felt hardest?</h2>
      <div class="opts" role="group" aria-label="Hardest decision">${state.rounds.map(r => `<button class="opt" data-h="${r.category}" aria-pressed="${state.hardest === r.category}">${CAT[r.category].label}</button>`).join("")}</div>
      <div class="actions"><button class="btn block" id="fin" ${state.hardest ? "" : "disabled"}>Finish</button></div>
    </section>`;
    app.querySelectorAll("[data-h]").forEach(b => b.onclick = () => {
      state.hardest = b.dataset.h; save();
      app.querySelectorAll("[data-h]").forEach(x => x.setAttribute("aria-pressed", x === b));
      document.getElementById("fin").disabled = false;
    });
    document.getElementById("fin").onclick = () => {
      if (!state.queue.some(q => q.kind === "complete")) state.queue.push({ kind: "complete", hardest: state.hardest, completed_at: new Date().toISOString(), sent: false });
      save(); go("end"); flush();
    };
  }
  function renderEnd() {
    if (state.screen !== "end") return;
    const rows = state.queue.filter(q => q.kind === "row"); const sent = rows.filter(q => q.sent).length;
    const allSent = state.queue.every(q => q.sent);
    let status;
    if (!API) status = `<div class="status wait">Demo mode: no results server is set up, so responses stayed on this device.</div>`;
    else if (allSent) status = `<div class="status ok">All ${rows.length} responses received.</div>`;
    else status = `<div class="status wait">${sent} of ${rows.length} responses received. The rest are saved on this device and are being sent. Keep this page open.</div>
      <div class="actions"><button class="btn ghost block" id="retry">Send again now</button></div>`;
    app.innerHTML = `<section class="panel">
      <h1>Thank you</h1>
      <p class="lead">Your instructor will now discuss the results with the class.</p>
      ${status}
    </section>`;
    const rb = document.getElementById("retry"); if (rb) rb.onclick = () => { rb.disabled = true; rb.textContent = "Sending…"; flush(); };
    stepsEl.textContent = "";
  }

  function renderPreviewBar() {
    const b = document.createElement("div"); b.className = "testbar";
    b.innerHTML = `Preview · nothing is sent <button id="tb-reset">restart</button>`;
    document.body.appendChild(b);
    document.getElementById("tb-reset").onclick = () => { try { localStorage.removeItem(STORE_KEY); } catch (e) { } location.reload(); };
  }
  /* ---------------- test helpers (only with ?test=1) ---------------- */
  function renderTestBar() {
    const b = document.createElement("div"); b.className = "testbar";
    b.innerHTML = `TEST · ${esc(CLASS_CODE)} · speed ×${SPEED} <button id="tb-reset">new session</button>`;
    document.body.appendChild(b);
    document.getElementById("tb-reset").onclick = () => { try { localStorage.removeItem(STORE_KEY); } catch (e) { } location.reload(); };
    window.__nx = { get state() { return state; }, flush };
  }

  boot();
})();
