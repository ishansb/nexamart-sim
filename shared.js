/* Shared logic for student app, dashboard and (copied into) the Apps Script backend.
   Keep ASSIGNMENT + FIELD definitions identical to backend/Code.gs. */
(function (root) {
  const CATS = ["chocolate", "running_shoes", "smartphones"];
  const PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const SIZES = [3, 9, 18];
  const INVOLVEMENT = { chocolate: "low", running_shoes: "medium", smartphones: "high" };

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffled(arr, seedStr) {
    const r = mulberry32(hashStr(seedStr)); const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function range(n) { const a = []; for (let i = 0; i < n; i++) a.push(i); return a; }

  /* n = 0-based participant index within a class code. */
  function assignmentFor(n, seed, classCode, mode) {
    if (mode === "independent") {
      const ordIdx = shuffled(range(6), seed + "|" + classCode + "|ord|" + Math.floor(n / 6))[n % 6];
      const sizes = {};
      CATS.forEach(c => { sizes[c] = shuffled(SIZES, seed + "|" + classCode + "|size|" + c + "|" + Math.floor(n / 3))[n % 3]; });
      return { cell_index: -1, product_order: PERMS[ordIdx].map(i => CATS[i]), sizes };
    }
    // 36 cells = 6 category orders x 6 size mappings, dealt as 4 blocks of 9. Each block pairs a
    // Latin set of orders (EVEN or ODD permutations) with a Latin set of mappings, so every block of 9
    // consecutive students is perfectly balanced: each category gets each size 3 times, each category
    // appears in each position 3 times, each size appears in each position 3 times.
    const EVEN = [0, 3, 4], ODD = [1, 2, 5];
    const deckNo = Math.floor(n / 36), inDeck = n % 36;
    const blockOrder = shuffled([0, 1, 2, 3], seed + "|" + classCode + "|deck|" + deckNo);
    const b = blockOrder[Math.floor(inDeck / 9)];
    const ordSet = b < 2 ? EVEN : ODD, mapSet = b % 2 === 0 ? EVEN : ODD;
    const cells = shuffled(range(9), seed + "|" + classCode + "|block|" + deckNo + "|" + b);
    const c9 = cells[inDeck % 9];
    const ordIdx = ordSet[Math.floor(c9 / 3)], mapIdx = mapSet[c9 % 3];
    const order = PERMS[ordIdx].map(i => CATS[i]);
    const map = PERMS[mapIdx].map(i => SIZES[i]);
    return { cell_index: ordIdx * 6 + mapIdx, product_order: order, sizes: { chocolate: map[0], running_shoes: map[1], smartphones: map[2] } };
  }

  /* Column order of the `decisions` sheet (one row per participant per decision). */
  const DECISION_FIELDS = [
    "row_key", "session_id", "class_code", "participant_number", "server_timestamp", "client_timestamp",
    "product_order", "round_index", "assignment_source", "assignment_mode",
    "product_category", "involvement_level", "choice_set_size", "assigned_time_seconds", "card_order",
    "selected_product_id", "provisional_product_id", "deferred_choice", "timed_out",
    "actual_decision_time_ms", "time_to_first_selection_ms", "selection_changes",
    "products_viewed", "products_expanded", "expand_time_ms", "refresh_count", "tab_hidden_ms",
    "preferred_attribute", "difficulty", "confidence", "satisfaction", "reconsideration", "choice_deferral",
    "alternatives_considered", "alternatives_considered_mid", "strategies",
    "app_version", "images_manifest_hash", "device_class", "test_mode"
  ];
  const SESSION_FIELDS = [
    "session_id", "class_code", "participant_number", "assignment_source", "assignment_mode", "cell_index",
    "product_order", "size_chocolate", "size_running_shoes", "size_smartphones",
    "started_at", "completed_at", "hardest_decision", "decisions_sent", "device_class", "app_version", "test_mode"
  ];

  const ALT_BANDS = [["1", 1], ["2–3", 2.5], ["4–6", 5], ["7–10", 8.5], ["More than 10", 12]];
  const STRATEGIES = [
    ["compared", "Compared most options carefully"],
    ["eliminated", "Eliminated options quickly"],
    ["one_feature", "Focused on one feature"],
    ["price", "Used price as a shortcut"],
    ["ratings", "Relied on ratings"],
    ["first_good", "Took the first good-enough option"],
    ["brand_look", "Went by brand or look"]
  ];

  root.NX = { CATS, PERMS, SIZES, INVOLVEMENT, hashStr, mulberry32, shuffled, range, assignmentFor,
    DECISION_FIELDS, SESSION_FIELDS, ALT_BANDS, STRATEGIES };
})(typeof window !== "undefined" ? window : globalThis);
