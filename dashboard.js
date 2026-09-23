/* NexaMart Choice Simulation — instructor dashboard (vanilla JS + inline SVG charts). */
(function () {
  "use strict";
  const CFG = window.NEXAMART_CONFIG, NX = window.NX;
  const $ = id => document.getElementById(id);
  const CAT_LABEL = { chocolate: "Chocolate", running_shoes: "Running shoes", smartphones: "Smartphones" };
  const INV_LABEL = { low: "Low", medium: "Medium", high: "High" };
  const SIZE_COLOR = { 3: "var(--s3)", 9: "var(--s9)", 18: "var(--s18)" };
  const NUM = ["participant_number", "round_index", "choice_set_size", "assigned_time_seconds", "actual_decision_time_ms", "time_to_first_selection_ms",
    "selection_changes", "products_viewed", "products_expanded", "expand_time_ms", "refresh_count", "tab_hidden_ms", "difficulty", "confidence",
    "satisfaction", "reconsideration", "choice_deferral", "alternatives_considered_mid"];
  const BOOL = ["deferred_choice", "timed_out", "test_mode"];

  const S = {
    source: "none", api: "", key: "", classCode: "", timer: null, lastUpdate: null,
    decisions: [], sessions: [], products: null,
    f: { cat: "all", size: "all", inv: "all", timeouts: true, defer: true },
    step: 0, revealed: new Set(), metric6: "difficulty"
  };
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  /* ---------------- data normalisation ---------------- */
  function norm(r) {
    const o = Object.assign({}, r);
    NUM.forEach(k => { const v = o[k]; o[k] = (v === "" || v === null || v === undefined) ? null : Number(v); if (Number.isNaN(o[k])) o[k] = null; });
    BOOL.forEach(k => { o[k] = o[k] === true || String(o[k]).toUpperCase() === "TRUE"; });
    o.strategies = o.strategies ? String(o.strategies).split(";").filter(Boolean) : [];
    return o;
  }
  function normSession(s) {
    const o = Object.assign({}, s);
    ["size_chocolate", "size_running_shoes", "size_smartphones", "participant_number", "decisions_sent"].forEach(k => { o[k] = o[k] === "" || o[k] == null ? null : Number(o[k]); });
    return o;
  }

  /* ---------------- sources ---------------- */
  async function fetchJSON(url) {
    const r = await fetch(url, { redirect: "follow", cache: "no-store" });
    return r.json();
  }
  async function refreshLive() {
    const u = `${S.api}?action=results&key=${encodeURIComponent(S.key)}&class_code=${encodeURIComponent(S.classCode)}`;
    try {
      const j = await fetchJSON(u);
      if (!j.ok) { setSource(`<span style="color:var(--bad)">Server refused: ${esc(j.error)}</span>`); if (j.error === "bad_key") stopLive(); return; }
      S.decisions = j.decisions.map(norm); S.sessions = j.sessions.map(normSession); S.lastUpdate = new Date();
      setSource(`<span class="live">Live</span> · class ${esc(S.classCode)} · updated ${S.lastUpdate.toLocaleTimeString()}`);
      render();
    } catch (e) {
      setSource(`<span style="color:var(--bad)">Cannot reach the results server (${esc(e.message)}). Retrying every 10 s.</span>`);
    }
  }
  function stopLive() { if (S.timer) clearInterval(S.timer); S.timer = null; }
  async function connect() {
    S.api = $("inApi").value.trim(); S.key = $("inKey").value.trim(); S.classCode = $("inClass").value.trim().replace(/[^A-Za-z0-9_\-]/g, "");
    if (!S.api || !S.key || !S.classCode) { msg("Fill in all three fields.", true); return; }
    lsSet("nxd_api", S.api); lsSet("nxd_key", S.key); lsSet("nxd_class", S.classCode);
    stopLive(); S.source = "live"; msg("Connecting…");
    try {
      const c = await fetchJSON(`${S.api}?action=classes&key=${encodeURIComponent(S.key)}`);
      if (!c.ok) { msg(c.error === "bad_key" ? "The instructor key is not correct." : "Server error: " + c.error, true); return; }
      $("classList").innerHTML = c.classes.map(x => `<option value="${esc(x.class_code)}">${esc(x.class_code)} · ${x.sessions} started</option>`).join("");
    } catch (e) { msg("Cannot reach that URL. Check it ends in /exec and the Web App is deployed for Anyone.", true); return; }
    msg("");
    await refreshLive();
    S.timer = setInterval(refreshLive, 10000);
    $("setup").hidden = true;
  }
  function msg(t, bad) { const m = $("setupMsg"); m.textContent = t; m.className = "hint" + (bad ? " bad" : ""); }
  function setSource(html) { $("source").innerHTML = html; }

  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    const head = rows.shift() || [];
    return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h.trim(), r[i]])));
  }
  function loadCSV(file) {
    const rd = new FileReader();
    rd.onload = () => {
      const recs = parseCSV(String(rd.result));
      if (!recs.length || !("choice_set_size" in recs[0])) { msg("That file does not look like the decisions tab export.", true); return; }
      stopLive(); S.source = "csv"; S.decisions = recs.map(norm);
      // rebuild minimal sessions from rows
      const bySid = {};
      S.decisions.forEach(r => { const s = bySid[r.session_id] || (bySid[r.session_id] = { session_id: r.session_id, assignment_source: r.assignment_source, completed_at: "", hardest_decision: "" }); s["size_" + r.product_category] = r.choice_set_size; });
      S.sessions = Object.values(bySid);
      setSource(`CSV file · ${esc(file.name)} · ${S.decisions.length} rows`); $("setup").hidden = true; render();
    };
    rd.readAsText(file);
  }

  /* Simulated class for rehearsal. Clearly labelled; the effects are invented for practice only. */
  function simulate() {
    stopLive(); S.source = "sim";
    const rnd = NX.mulberry32(20260923);
    const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const clamp7 = x => Math.max(1, Math.min(7, Math.round(x)));
    const base = { chocolate: 2.2, running_shoes: 3.2, smartphones: 3.9 };
    const slope = { chocolate: [0, .3, .6], running_shoes: [0, .6, 1.2], smartphones: [0, .8, 1.7] };
    const use = { chocolate: [.5, .35, .25], running_shoes: [.7, .6, .5], smartphones: [.8, .75, .7] };
    const dec = [], ses = [];
    for (let n = 0; n < 45; n++) {
      const a = NX.assignmentFor(n, "sim", "SIM", "balanced_deck"); const sid = "sim-" + String(n + 1).padStart(3, "0");
      let hardest = null, hv = -1;
      a.product_order.forEach((cat, i) => {
        const size = a.sizes[cat], si = NX.SIZES.indexOf(size), allowed = size * 10;
        const d = clamp7(base[cat] + slope[cat][si] + gauss() * 1.1);
        const timed = rnd() < (cat === "smartphones" ? [.05, .1, .2][si] : cat === "running_shoes" ? [.03, .06, .1][si] : [0, .02, .03][si]);
        const deferred = !timed && rnd() < (cat === "smartphones" ? [.03, .08, .15][si] : [.02, .04, .06][si]);
        const t = timed ? allowed * 1000 : Math.round(allowed * 1000 * Math.min(.98, Math.max(.1, use[cat][si] + gauss() * .15)));
        const ids = S.products.categories[cat]["set_" + size];
        const pick = ids[Math.floor(rnd() * ids.length)];
        const strat = NX.STRATEGIES.map(s => s[0]).filter(k => rnd() < ({ compared: [.6, .35, .2], eliminated: [.2, .45, .6], one_feature: [.2, .3, .4], price: [.3, .35, .45], ratings: [.3, .4, .55], first_good: [.15, .25, .35], brand_look: [.25, .25, .3] }[k][si]));
        const alt = [["1", 1], ["2–3", 2.5], ["4–6", 5], ["7–10", 8.5], ["More than 10", 12]][Math.min(4, Math.max(0, Math.round(si * 1.1 + (rnd() * 2 - .5))))];
        if (d + rnd() > hv) { hv = d + rnd(); hardest = cat; }
        dec.push(norm({
          row_key: sid + "_" + (i + 1), session_id: sid, class_code: "SIMULATED", participant_number: n + 1, product_order: a.product_order.join("|"), round_index: i + 1,
          assignment_source: "server", product_category: cat, involvement_level: NX.INVOLVEMENT[cat], choice_set_size: size, assigned_time_seconds: allowed,
          selected_product_id: timed || deferred ? "" : pick, provisional_product_id: timed ? pick : "", deferred_choice: deferred, timed_out: timed,
          actual_decision_time_ms: t, products_viewed: Math.min(size, Math.round(size * (.9 - si * .2) + rnd() * 2)), products_expanded: Math.round(rnd() * Math.min(size, 5)),
          difficulty: d, confidence: clamp7(6 - (d - 2) * .55 + gauss()), satisfaction: clamp7(6 - (d - 2) * .4 + gauss()), reconsideration: clamp7(2 + (d - 2) * .5 + gauss()),
          choice_deferral: clamp7(1.5 + (d - 2) * .6 + gauss() * 1.2), alternatives_considered: alt[0], alternatives_considered_mid: alt[1], strategies: strat.join(";"), preferred_attribute: ""
        }));
      });
      ses.push(normSession({ session_id: sid, class_code: "SIMULATED", participant_number: n + 1, assignment_source: "server", product_order: a.product_order.join("|"),
        size_chocolate: a.sizes.chocolate, size_running_shoes: a.sizes.running_shoes, size_smartphones: a.sizes.smartphones, completed_at: "x", hardest_decision: hardest }));
    }
    S.decisions = dec; S.sessions = ses;
    setSource(`<span class="sim">SIMULATED CLASS</span> · invented data for rehearsal, not real results`);
    $("setup").hidden = true; render();
  }

  /* ---------------- filtering + stats ---------------- */
  function filtered(opts) {
    opts = opts || {};
    return S.decisions.filter(r => {
      if (!opts.ignoreCat && S.f.cat !== "all" && r.product_category !== S.f.cat) return false;
      if (!opts.ignoreSize && S.f.size !== "all" && r.choice_set_size !== +S.f.size) return false;
      if (!opts.ignoreCat && S.f.inv !== "all" && r.involvement_level !== S.f.inv) return false;
      if (!S.f.timeouts && r.timed_out) return false;
      if (!S.f.defer && r.deferred_choice) return false;
      return true;
    });
  }
  const T95 = [0, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  function tcrit(df) { return df <= 30 ? T95[df] : df <= 60 ? 2.0 : df <= 120 ? 1.98 : 1.96; }
  function meanCI(vals) {
    vals = vals.filter(v => v !== null && v !== undefined && !Number.isNaN(v)); const n = vals.length;
    if (!n) return { n: 0 };
    const m = vals.reduce((a, b) => a + b, 0) / n;
    if (n < 2) return { n, mean: m };
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)); const h = tcrit(n - 1) * sd / Math.sqrt(n);
    return { n, mean: m, lo: m - h, hi: m + h, pts: vals };
  }
  function propCI(k, n) {
    if (!n) return { n: 0 };
    const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return { n, k, mean: p * 100, lo: Math.max(0, (c - h) * 100), hi: Math.min(100, (c + h) * 100) };
  }
  function sizesShown() { return S.f.size === "all" ? NX.SIZES : [+S.f.size]; }

  /* ---------------- SVG charts ---------------- */
  function vBars(groups, o) {
    const W = o.W || 760, H = o.H || 380, m = { l: 56, r: 18, t: 30, b: o.bottom || 62 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b, y = v => m.t + (1 - (v - o.yMin) / (o.yMax - o.yMin)) * ph;
    const band = pw / groups.length; let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "")}">`;
    o.ticks.forEach(t => { s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text class="axis" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="12">${o.fmt ? o.fmt(t) : t}</text>`; });
    if (o.yTitle) s += `<text class="axis" x="14" y="${m.t + ph / 2}" font-size="12" text-anchor="middle" transform="rotate(-90 14 ${m.t + ph / 2})">${esc(o.yTitle)}</text>`;
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(o.yMin)}" y2="${y(o.yMin)}" stroke="var(--ink2)"/>`;
    groups.forEach((g, gi) => {
      const cx = m.l + band * gi + band / 2; const nb = g.bars.length; const bw = Math.min(o.barW || 64, band * 0.5 / Math.max(1, nb * 0.7));
      const gap = 6, total = nb * bw + (nb - 1) * gap + (g.bars.some(b => b.pts) ? 22 : 0); let x0 = cx - total / 2;
      g.bars.forEach(b => {
        const bx = x0;
        if (b.n) {
          const top = y(Math.max(o.yMin, b.mean)), base = y(o.yMin), r = Math.min(4, bw / 2, base - top);
          s += `<g><title>${esc(b.title || "")}</title><path d="M${bx},${base} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + bw - r} Q${bx + bw},${top} ${bx + bw},${top + r} V${base} Z" fill="${b.color}"/>`;
          if (b.lo !== undefined && b.n > 1) {
            const xm = bx + bw / 2; s += `<line x1="${xm}" x2="${xm}" y1="${y(Math.min(o.yMax, b.hi))}" y2="${y(Math.max(o.yMin, b.lo))}" stroke="var(--ink)" stroke-width="1.6"/>` +
              `<line x1="${xm - 7}" x2="${xm + 7}" y1="${y(Math.min(o.yMax, b.hi))}" y2="${y(Math.min(o.yMax, b.hi))}" stroke="var(--ink)" stroke-width="1.6"/>` +
              `<line x1="${xm - 7}" x2="${xm + 7}" y1="${y(Math.max(o.yMin, b.lo))}" y2="${y(Math.max(o.yMin, b.lo))}" stroke="var(--ink)" stroke-width="1.6"/>`;
          }
          const ly = y(Math.min(o.yMax, b.lo !== undefined && b.n > 1 ? b.hi : b.mean)) - 8;
          s += `<text class="val" x="${bx + bw / 2}" y="${Math.max(12, ly)}" text-anchor="middle" font-size="${o.valSize || 14}">${o.vfmt ? o.vfmt(b.mean) : b.mean.toFixed(1)}</text></g>`;
          if (b.ref !== undefined) s += `<line x1="${bx - 8}" x2="${bx + bw + 8}" y1="${y(b.ref)}" y2="${y(b.ref)}" stroke="var(--ink)" stroke-dasharray="4 3" stroke-width="1.4"/><text x="${bx - 12}" y="${y(b.ref) + 4}" text-anchor="end" font-size="11" class="axis">${esc(b.refLabel || "")}</text>`;
          if (b.pts) {
            const px = bx + bw + 8; const jit = NX.mulberry32(gi * 97 + 11);
            b.pts.forEach(v => { s += `<circle cx="${px + jit() * 12}" cy="${y(v) + (jit() - .5) * 4}" r="2.6" fill="var(--ink)" fill-opacity=".28"/>`; });
          }
        } else s += `<text x="${bx + bw / 2}" y="${y(o.yMin) - 8}" text-anchor="middle" font-size="12" class="axis">no data</text>`;
        x0 += bw + gap;
      });
      s += `<text x="${cx}" y="${H - m.b + 22}" text-anchor="middle" font-size="14" font-weight="700" fill="var(--ink)">${esc(g.label)}</text>`;
      if (g.sub) s += `<text class="axis" x="${cx}" y="${H - m.b + 40}" text-anchor="middle" font-size="12">${esc(g.sub)}</text>`;
    });
    return s + "</svg>";
  }
  function hBars(rows, o) {
    const W = o.W || 760, rowH = o.rowH || 44, lw = o.labelW || 250, m = { t: 10, r: 60, b: 26 };
    const nb = rows[0] ? rows[0].bars.length : 1, bh = Math.min(12, (rowH - 10) / nb);
    const H = m.t + rows.length * rowH + m.b, pw = W - lw - m.r, x = v => lw + v / o.xMax * pw;
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria || "")}">`;
    o.ticks.forEach(t => { s += `<line x1="${x(t)}" x2="${x(t)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--grid)"/><text class="axis" x="${x(t)}" y="${H - 8}" text-anchor="middle" font-size="12">${o.fmt(t)}</text>`; });
    if (o.ref !== undefined) { }
    rows.forEach((r, ri) => {
      const y0 = m.t + ri * rowH + (rowH - (nb * bh + (nb - 1) * 3)) / 2;
      s += `<text x="${lw - 10}" y="${m.t + ri * rowH + rowH / 2 + 5}" text-anchor="end" font-size="13" fill="var(--ink)">${esc(r.label)}</text>`;
      r.bars.forEach((b, bi) => {
        const yy = y0 + bi * (bh + 3);
        if (!b.n) { s += `<text x="${lw + 4}" y="${yy + bh - 2}" font-size="11" class="axis">no data</text>`; return; }
        const w = Math.max(1, x(b.value) - lw), rr = Math.min(4, bh / 2, w / 2);
        s += `<g><title>${esc(b.title || "")}</title><path d="M${lw},${yy} H${lw + w - rr} Q${lw + w},${yy} ${lw + w},${yy + rr} V${yy + bh - rr} Q${lw + w},${yy + bh} ${lw + w - rr},${yy + bh} H${lw} Z" fill="${b.color}"/>` +
          `<text x="${lw + w + 6}" y="${yy + bh - 1}" font-size="12" class="val">${o.vfmt(b.value)}</text>`;
        if (b.ref !== undefined) s += `<line x1="${x(b.ref)}" x2="${x(b.ref)}" y1="${yy - 1}" y2="${yy + bh + 1}" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="2 2"/>`;
        s += `</g>`;
      });
    });
    return s + "</svg>";
  }
  function sizeLegend() { return `<div class="legend">${NX.SIZES.filter(z => sizesShown().includes(z)).map(z => `<span><i style="background:${SIZE_COLOR[z]}"></i>${z} options</span>`).join("")}</div>`; }
  const SIZE_NOTE = `Bars show means; whiskers show 95% confidence intervals; dots show individual answers. Descriptive classroom data: differences may reflect chance. No significance tests were run.`;

  /* ---------------- steps ---------------- */
  function likertStep(key, label) {
    return (el, rows) => {
      const groups = sizesShown().map(z => { const c = meanCI(rows.filter(r => r.choice_set_size === z).map(r => r[key]));
        return { label: `${z} options`, sub: `n = ${c.n}`, bars: [Object.assign({ color: SIZE_COLOR[z], title: c.n ? `${z} options: mean ${c.mean.toFixed(2)}${c.lo !== undefined ? ` (95% CI ${c.lo.toFixed(2)}–${c.hi.toFixed(2)})` : ""}, n = ${c.n}` : "" }, c)] }; });
      el.innerHTML = `<div class="chartwrap">${vBars(groups, { yMin: 1, yMax: 7, ticks: [1, 2, 3, 4, 5, 6, 7], yTitle: label + " (1–7)", aria: label + " by number of options" })}</div><p class="note">${SIZE_NOTE}</p>`;
    };
  }
  const METRICS6 = {
    difficulty: ["Difficulty (1–7)", r => r.difficulty, [1, 7], [1, 2, 3, 4, 5, 6, 7]],
    confidence: ["Confidence (1–7)", r => r.confidence, [1, 7], [1, 2, 3, 4, 5, 6, 7]],
    satisfaction: ["Satisfaction (1–7)", r => r.satisfaction, [1, 7], [1, 2, 3, 4, 5, 6, 7]],
    reconsideration: ["Reconsideration (1–7)", r => r.reconsideration, [1, 7], [1, 2, 3, 4, 5, 6, 7]],
    choice_deferral: ["Urge to postpone (1–7)", r => r.choice_deferral, [1, 7], [1, 2, 3, 4, 5, 6, 7]],
    time_used: ["Share of allowed time used (%)", r => r.actual_decision_time_ms / (r.assigned_time_seconds * 10), [0, 100], [0, 25, 50, 75, 100]],
    alternatives: ["Alternatives seriously considered (approx.)", r => r.alternatives_considered_mid, [0, 12], [0, 3, 6, 9, 12]]
  };
  const STEPS = [
    { title: "Decision difficulty", prompt: "Which number of options do you think made the decision <b>hardest</b>?", render: likertStep("difficulty", "Difficulty") },
    { title: "Confidence", prompt: "Did more options make you <b>more</b> sure of your choice, or <b>less</b>?", render: likertStep("confidence", "Confidence") },
    { title: "Satisfaction", prompt: "Should more choice mean a <b>better-liked</b> choice?", render: likertStep("satisfaction", "Satisfaction") },
    { title: "Reconsideration", prompt: "Who would <b>change their mind</b> if they could choose again?", render: likertStep("reconsideration", "Reconsideration") },
    { title: "Deferral", prompt: "Who felt like <b>walking away</b> without buying?", render: (el, rows) => {
        const anyBeh = S.decisions.some(r => r.deferred_choice) || CFG.BEHAVIOURAL_DEFERRAL;
        const groups = sizesShown().map(z => { const rs = rows.filter(r => r.choice_set_size === z);
          const felt = propCI(rs.filter(r => r.choice_deferral >= 5).length, rs.filter(r => r.choice_deferral != null).length);
          const beh = propCI(rs.filter(r => r.deferred_choice).length, rs.length);
          const bars = [Object.assign({ color: "var(--c1)", title: felt.n ? `Felt the urge (5–7): ${felt.mean.toFixed(0)}% of ${felt.n}` : "" }, felt)];
          if (anyBeh) bars.push(Object.assign({ color: "var(--c2)", title: beh.n ? `Actually skipped: ${beh.mean.toFixed(0)}% (${beh.k} of ${beh.n})` : "" }, beh));
          return { label: `${z} options`, sub: `n = ${rs.length}`, bars }; });
        el.innerHTML = `<div class="legend"><span><i style="background:var(--c1)"></i>Felt the urge to postpone (5–7 on the scale)</span>${anyBeh ? `<span><i style="background:var(--c2)"></i>Actually chose "I wouldn't buy any of these"</span>` : ""}</div>
          <div class="chartwrap">${vBars(groups, { yMin: 0, yMax: 100, ticks: [0, 25, 50, 75, 100], fmt: t => t + "%", vfmt: v => v.toFixed(0) + "%", yTitle: "Share of decisions (%)", barW: 48, aria: "Deferral by number of options" })}</div>
          <p class="note">Whiskers are 95% Wilson intervals for a proportion. The toggle "include skipped decisions" must be on to count actual skips.</p>`;
      } },
    { title: "Decision time", prompt: "You had <b>10 seconds per option</b>. Did you use it?", render: (el, rows) => {
        const groups = sizesShown().map(z => { const rs = rows.filter(r => r.choice_set_size === z); const c = meanCI(rs.map(r => r.actual_decision_time_ms / 1000));
          const to = rs.filter(r => r.timed_out).length;
          return { label: `${z} options`, sub: `n = ${c.n} · ${rs.length ? Math.round(to / rs.length * 100) : 0}% timed out`,
            bars: [Object.assign({ color: SIZE_COLOR[z], ref: z * 10, refLabel: `allowed ${z * 10} s`, title: c.n ? `${z} options: mean ${c.mean.toFixed(0)} s of ${z * 10} s allowed, n = ${c.n}` : "" }, c)] }; });
        const used = sizesShown().map(z => { const rs = rows.filter(r => r.choice_set_size === z); const c = meanCI(rs.map(r => r.actual_decision_time_ms / (r.assigned_time_seconds * 10)));
          return c.n ? `${z} options: ${c.mean.toFixed(0)}% of the allowed time` : ""; }).filter(Boolean).join(" · ");
        el.innerHTML = `<div class="chartwrap">${vBars(groups, { yMin: 0, yMax: 190, ticks: [0, 30, 60, 90, 120, 150, 180], fmt: t => t + " s", vfmt: v => v.toFixed(0) + " s", yTitle: "Actual decision time (seconds)", aria: "Decision time by number of options" })}</div>
          <p class="note">Dashed marks show the time allowed. Average share of allowed time used: ${used || "—"}. Timed-out decisions count as the full allowed time.</p>`;
      } },
    { title: "Category × set size", prompt: "Did <b>18 chocolates</b> feel like <b>18 smartphones</b>?", render: (el) => {
        const [lab, fn, dom, ticks] = METRICS6[S.metric6];
        const rowsAll = filtered({ ignoreCat: true });
        const panels = NX.CATS.map(cat => { const groups = sizesShown().map(z => { const c = meanCI(rowsAll.filter(r => r.product_category === cat && r.choice_set_size === z).map(fn));
          return { label: `${z}`, sub: `n = ${c.n}`, bars: [Object.assign({ color: SIZE_COLOR[z], title: c.n ? `${CAT_LABEL[cat]}, ${z} options: ${c.mean.toFixed(2)}, n = ${c.n}` : "" }, c)] }; });
          return `<div><h3>${CAT_LABEL[cat]} <span style="font-weight:500;color:var(--muted)">· ${INV_LABEL[NX.INVOLVEMENT[cat]]} involvement</span></h3>${vBars(groups, { W: 380, H: 320, yMin: dom[0], yMax: dom[1], ticks, yTitle: lab, barW: 40, valSize: 13, bottom: 56, vfmt: v => S.metric6 === "time_used" ? v.toFixed(0) + "%" : v.toFixed(1), fmt: t => S.metric6 === "time_used" ? t + "%" : t, aria: lab + " for " + CAT_LABEL[cat] })}</div>`; }).join("");
        el.innerHTML = `<div class="seg metricpick" role="group" aria-label="Outcome shown">${Object.entries(METRICS6).map(([k, v]) => `<button type="button" data-m="${k}" aria-pressed="${k === S.metric6}">${v[0].replace(/ \(.*\)/, "")}</button>`).join("")}</div>
          <div class="multi">${panels}</div>${sizeLegend()}<p class="note">The category filter is ignored here so the three categories sit side by side on the same scale. Each student saw each category once, at one set size. ${SIZE_NOTE}</p>`;
        el.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { S.metric6 = b.dataset.m; renderStep(); });
      } },
    { title: "Hardest decision", prompt: "Each of you met 3, 9 and 18 options once. Which one did you call <b>hardest</b>?", render: (el) => {
        const done = S.sessions.filter(s => s.hardest_decision && s["size_" + s.hardest_decision]);
        const cnt = { 3: 0, 9: 0, 18: 0 }; done.forEach(s => { cnt[s["size_" + s.hardest_decision]]++; });
        const byCat = NX.CATS.map(c => `${CAT_LABEL[c]} ${done.length ? Math.round(done.filter(s => s.hardest_decision === c).length / done.length * 100) : 0}%`).join(" · ");
        const rows = NX.SIZES.map(z => { const p = propCI(cnt[z], done.length); return { label: `The decision with ${z} options`, bars: [{ color: SIZE_COLOR[z], value: p.mean || 0, n: p.n, ref: 100 / 3, title: `${cnt[z]} of ${done.length} students` }] }; });
        el.innerHTML = `<div class="chartwrap">${hBars(rows, { xMax: 100, ticks: [0, 25, 50, 75, 100], fmt: t => t + "%", vfmt: v => v.toFixed(0) + "%", aria: "Which decision students called hardest", rowH: 56 })}</div>
          <p class="note">Share of the ${done.length} students who finished and whose three set sizes are known (balanced assignment). The dotted mark shows 33%, what you would expect if set size made no difference. By category: ${byCat}. Filters do not apply to this chart.</p>`;
      } },
    { title: "Shortcuts used", prompt: "What <b>shortcuts</b> did you use as the options piled up?", render: (el, rows) => {
        const rs = NX.STRATEGIES.map(([k, l]) => ({ label: l, bars: sizesShown().map(z => { const g = rows.filter(r => r.choice_set_size === z); const p = propCI(g.filter(r => r.strategies.includes(k)).length, g.length);
          return { color: SIZE_COLOR[z], value: p.mean || 0, n: p.n, title: `${l}, ${z} options: ${p.n ? p.mean.toFixed(0) : 0}% of ${p.n}` }; }) }));
        el.innerHTML = `${sizeLegend()}<div class="chartwrap">${hBars(rs, { xMax: 100, ticks: [0, 25, 50, 75, 100], fmt: t => t + "%", vfmt: v => v.toFixed(0) + "%", aria: "Strategies used by number of options", rowH: 48 })}</div>
          <p class="note">Share of decisions in which students ticked each strategy (they could tick several).</p>`;
      } },
    { title: "Same products, more company", prompt: "The three products in the 3-option set also appeared among the 18. <b>Did they win as often</b> when surrounded by more?", render: (el) => {
        const rowsAll = filtered({ ignoreCat: true });
        const cats = S.f.cat === "all" ? NX.CATS : [S.f.cat];
        el.innerHTML = cats.map(cat => { const core = S.products.categories[cat].set_3;
          const rs = core.map(id => { const p = S.products.categories[cat].products.find(x => x.product_id === id);
            return { label: `${p.brand} ${p.name}`, bars: sizesShown().map(z => { const g = rowsAll.filter(r => r.product_category === cat && r.choice_set_size === z && r.selected_product_id);
              const k = g.filter(r => r.selected_product_id === id).length; return { color: SIZE_COLOR[z], value: g.length ? k / g.length * 100 : 0, n: g.length, ref: 100 / z, title: `${z} options: ${k} of ${g.length} choosers` }; }) }; });
          return `<h3 style="margin:10px 0 0">${CAT_LABEL[cat]}</h3>${hBars(rs, { xMax: 100, ticks: [0, 25, 50, 75, 100], fmt: t => t + "%", vfmt: v => v.toFixed(0) + "%", aria: "Choice share of core products " + CAT_LABEL[cat], rowH: 50 })}`; }).join("") +
          `${sizeLegend()}<p class="note">Share of students who chose a product (timed-out and skipped decisions excluded). Dotted marks show the equal-share benchmark: 33% of 3, 11% of 9, 6% of 18.</p>`;
      } },
    { title: "Full results table", prompt: "All outcomes by category and set size.", render: (el) => {
        const rowsAll = filtered({ ignoreCat: true, ignoreSize: true }); const f = (c, d) => c.n ? c.mean.toFixed(d) : "—";
        const line = (label, cat, z, cls) => { const rs = rowsAll.filter(r => (!cat || r.product_category === cat) && (!z || r.choice_set_size === z));
          const felt = propCI(rs.filter(r => r.choice_deferral >= 5).length, rs.length), sk = propCI(rs.filter(r => r.deferred_choice).length, rs.length), to = propCI(rs.filter(r => r.timed_out).length, rs.length);
          return `<tr class="${cls || ""}"><td>${label}</td><td>${z ? z : "All"}</td><td>${rs.length}</td><td>${f(meanCI(rs.map(r => r.difficulty)), 2)}</td><td>${f(meanCI(rs.map(r => r.confidence)), 2)}</td><td>${f(meanCI(rs.map(r => r.satisfaction)), 2)}</td><td>${f(meanCI(rs.map(r => r.reconsideration)), 2)}</td><td>${felt.n ? felt.mean.toFixed(0) + "%" : "—"}</td><td>${sk.n ? sk.mean.toFixed(0) + "%" : "—"}</td><td>${f(meanCI(rs.map(r => r.actual_decision_time_ms / 1000)), 0)}</td><td>${f(meanCI(rs.map(r => r.alternatives_considered_mid)), 1)}</td><td>${f(meanCI(rs.map(r => r.products_expanded)), 1)}</td><td>${to.n ? to.mean.toFixed(0) + "%" : "—"}</td></tr>`; };
        let body = ""; NX.CATS.forEach(c => { NX.SIZES.forEach(z => body += line(CAT_LABEL[c], c, z)); body += line(CAT_LABEL[c], c, 0, "all"); });
        NX.SIZES.forEach(z => body += line("All categories", null, z)); body += line("All categories", null, 0, "all");
        el.innerHTML = `<div class="tablewrap"><table class="sum"><thead><tr><th>Category</th><th>Options</th><th>n</th><th>Difficulty</th><th>Confidence</th><th>Satisfaction</th><th>Reconsider</th><th>Deferral urge ≥5</th><th>Skipped</th><th>Time (s)</th><th>Alternatives considered (approx.)</th><th>Cards opened</th><th>Timed out</th></tr></thead><tbody>${body}</tbody></table></div>
          <p class="note">Means on 1–7 scales unless marked %. The timed-out and skipped toggles apply; the category and size filters do not. Alternatives considered uses band midpoints (1, 2.5, 5, 8.5, 12).</p>`;
      } }
  ];

  /* ---------------- render ---------------- */
  function render() {
    const has = S.decisions.length > 0 || S.source !== "none";
    $("strip").hidden = $("filters").hidden = $("stage").hidden = !has;
    if (!has) return;
    const started = S.sessions.length, done = S.sessions.filter(s => s.completed_at).length;
    $("tStarted").textContent = started; $("tDone").textContent = done; $("tRows").textContent = S.decisions.length;
    $("tClient").textContent = new Set(S.decisions.filter(r => r.assignment_source === "client").map(r => r.session_id)).size;
    let cells = `<thead><tr><th>Decisions stored</th>${NX.SIZES.map(z => `<th>${z} options</th>`).join("")}</tr></thead><tbody>`;
    NX.CATS.forEach(c => { cells += `<tr><td>${CAT_LABEL[c]}</td>${NX.SIZES.map(z => `<td>${S.decisions.filter(r => r.product_category === c && r.choice_set_size === z).length}</td>`).join("")}</tr>`; });
    $("cells").innerHTML = cells + "</tbody>";
    renderFilters(); renderSteps(); renderStep();
  }
  function seg(id, key, opts) {
    $(id).innerHTML = opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${String(S.f[key]) === String(v)}">${l}</button>`).join("");
    $(id).querySelectorAll("button").forEach(b => b.onclick = () => {
      S.f[key] = b.dataset.v;
      if (key === "cat") S.f.inv = S.f.cat === "all" ? "all" : NX.INVOLVEMENT[S.f.cat];
      if (key === "inv") S.f.cat = S.f.inv === "all" ? "all" : NX.CATS.find(c => NX.INVOLVEMENT[c] === S.f.inv);
      render();
    });
  }
  function renderFilters() {
    seg("fCat", "cat", [["all", "All categories"], ["chocolate", "Chocolate"], ["running_shoes", "Shoes"], ["smartphones", "Phones"]]);
    seg("fSize", "size", [["all", "All sizes"], ["3", "3"], ["9", "9"], ["18", "18"]]);
    seg("fInv", "inv", [["all", "All involvement"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]]);
  }
  function renderSteps() {
    $("steps").innerHTML = STEPS.map((s, i) => `<button type="button" data-i="${i}" aria-current="${i === S.step}"><span class="k">${i + 1}</span>${esc(s.title)}${S.revealed.has(i) ? `<span class="rv">shown</span>` : ""}</button>`).join("");
    $("steps").querySelectorAll("button").forEach(b => b.onclick = () => { S.step = +b.dataset.i; renderSteps(); renderStep(); });
  }
  function filterLabel() {
    const parts = []; if (S.f.cat !== "all") parts.push(CAT_LABEL[S.f.cat]); if (S.f.size !== "all") parts.push(S.f.size + " options");
    if (!S.f.timeouts) parts.push("excluding timeouts"); if (!S.f.defer) parts.push("excluding skipped");
    return parts.length ? parts.join(" · ") : "All categories, all set sizes";
  }
  function renderStep() {
    const st = STEPS[S.step]; const el = $("step"); const shown = S.revealed.has(S.step);
    el.innerHTML = `<h2>${S.step + 1}. ${esc(st.title)}</h2><p class="prompt">${st.prompt}</p>
      <div class="note" style="margin:-6px 0 10px">${esc(filterLabel())}</div>
      ${shown ? `<div id="viz"></div><div class="reveal"><button class="btn ghost small" id="hide">Hide chart</button></div>` : `<div class="reveal"><button class="btn" id="show">Reveal results</button><span class="note">Ask the class first. Shortcut: press R.</span></div>`}
      <div class="pnav"><button class="btn ghost" id="prev">← Previous</button><button class="btn" id="next">Next →</button></div>`;
    if (shown) {
      const rows = filtered();
      if (!S.decisions.length) $("viz").innerHTML = `<div class="empty">No decisions stored yet. Rows appear as students finish each decision.</div>`;
      else st.render($("viz"), rows);
      $("hide").onclick = () => { S.revealed.delete(S.step); renderSteps(); renderStep(); };
    } else $("show").onclick = reveal;
    $("prev").onclick = () => move(-1); $("next").onclick = () => move(1);
  }
  function reveal() { S.revealed.add(S.step); renderSteps(); renderStep(); }
  function move(d) { S.step = Math.max(0, Math.min(STEPS.length - 1, S.step + d)); renderSteps(); renderStep(); $("step").focus({ preventScroll: true }); }

  /* ---------------- QR, export, presenter ---------------- */
  function studentURL() {
    const u = new URL("index.html", location.href); const code = S.classCode || (S.source === "none" ? CFG.CLASS_CODE : S.classCode) || CFG.CLASS_CODE;
    u.search = "?c=" + encodeURIComponent(code); return { url: u.toString(), code };
  }
  function showQR() {
    const { url, code } = studentURL(); const qr = QR.encode(url, "M");
    $("qrImg").innerHTML = QR.toSVG(qr); $("qrUrl").textContent = url; $("qrCode").textContent = code;
    const n = qr.size + 8, px = 12, cv = document.createElement("canvas"); cv.width = cv.height = n * px;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.fillStyle = "#000";
    qr.modules.forEach((row, y) => row.forEach((v, x) => { if (v) g.fillRect((x + 4) * px, (y + 4) * px, px, px); }));
    $("qrDownload").href = cv.toDataURL("image/png"); $("qrDownload").download = `nexamart-qr-${code}.png`;
    $("qrOverlay").hidden = false; $("qrClose").focus();
  }
  function exportCSV() {
    const rows = filtered(); const cols = NX.DECISION_FIELDS;
    const q = v => { const s = Array.isArray(v) ? v.join(";") : (v ?? ""); return /[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s); };
    const csv = [cols.join(",")].concat(rows.map(r => cols.map(c => q(r[c])).join(","))).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `nexamart-${S.classCode || S.source}-filtered.csv`; document.body.appendChild(a); a.click(); a.remove();
  }
  function setPresent(on) { document.body.classList.toggle("presenting", on); $("btnPresent").setAttribute("aria-pressed", on); }

  /* ---------------- wire up ---------------- */
  async function init() {
    try { S.products = await (await fetch("products.json", { cache: "no-cache" })).json(); } catch (e) { S.products = null; }
    const Q = new URLSearchParams(location.search);
    $("inApi").value = Q.get("api") || lsGet("nxd_api") || CFG.API_URL || "";
    $("inKey").value = Q.get("key") || lsGet("nxd_key") || "";
    $("inClass").value = Q.get("c") || lsGet("nxd_class") || CFG.CLASS_CODE || "";
    S.classCode = $("inClass").value;
    $("btnConnect").onclick = connect; $("btnDemo").onclick = simulate;
    $("inCsv").onchange = e => e.target.files[0] && loadCSV(e.target.files[0]);
    $("btnSetup").onclick = () => { $("setup").hidden = !$("setup").hidden; };
    $("btnQR").onclick = () => { S.classCode = S.source === "live" ? S.classCode : ($("inClass").value.trim() || CFG.CLASS_CODE); showQR(); };
    $("qrClose").onclick = () => { $("qrOverlay").hidden = true; };
    $("qrOverlay").onclick = e => { if (e.target === $("qrOverlay")) $("qrOverlay").hidden = true; };
    $("btnPresent").onclick = () => setPresent(!document.body.classList.contains("presenting"));
    $("btnExport").onclick = exportCSV;
    $("fTimeout").onchange = e => { S.f.timeouts = e.target.checked; renderStep(); };
    $("fDefer").onchange = e => { S.f.defer = e.target.checked; renderStep(); };
    document.addEventListener("keydown", e => {
      if (e.target.matches("input,textarea")) return;
      if (e.key === "Escape") { $("qrOverlay").hidden = true; setPresent(false); }
      if ($("stage").hidden) return;
      if (e.key === "ArrowRight") move(1); else if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "r" || e.key === "R") reveal(); else if (e.key === "p" || e.key === "P") setPresent(!document.body.classList.contains("presenting"));
    });
    if (CFG.PREVIEW) { $("btnExport").hidden = true; $("qrDownload").hidden = true; $("inCsv").closest("label").hidden = true; }
    if (Q.get("demo") === "1" || CFG.PREVIEW) simulate();
    else if ($("inApi").value && $("inKey").value && $("inClass").value && Q.get("auto") !== "0") connect();
  }
  init();
})();
