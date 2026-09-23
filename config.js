/* =====================================================================
   NexaMart Choice Simulation — configuration (the only file to edit)
   ===================================================================== */
window.NEXAMART_CONFIG = {
  // Paste the Apps Script Web App URL (ends in /exec) here after deployment.
  // Leave empty to run in offline demo mode (nothing is sent anywhere).
  API_URL: "https://script.google.com/macros/s/AKfycby7ddQ4XN_YfgxsPv_7Z53q1gnhb1kaO4TujLBRp9adte-mzw1mW-8FR9WYTbtbLjcRLw/exec",

  // Default class code. A class code in the link (?c=GIM-CB-S12) overrides this,
  // so you can run separate sections or a TEST run without editing this file.
  CLASS_CODE: "GIM-CB-TEST",

  // "balanced_deck": each student meets 3, 9 and 18 options once, each in a different
  //                  category (recommended; 36-cell balanced deck).
  // "independent":   choice-set size drawn independently (balanced) for each category.
  ASSIGNMENT_MODE: "balanced_deck",

  // Show "I wouldn't buy any of these right now" on decision screens.
  BEHAVIOURAL_DEFERRAL: true,

  // Show consumer rating as the sixth smartphone field.
  SHOW_PHONE_RATING: true,

  // Ask "Which factor matters most to you?" before shoes and phones (skippable).
  ASK_PREFERRED_ATTRIBUTE: true,

  // Ask the "Which of these did you do?" strategy checklist after each decision.
  STRATEGY_ITEM: true,

  // Seconds per alternative (3 -> 30 s, 9 -> 90 s, 18 -> 180 s).
  SECONDS_PER_ALTERNATIVE: 10,

  // Optional soft tick in the last 5 seconds (off by default).
  TICK_SOUND: false,

  APP_VERSION: "1.0.0",

  // true only in the hosted preview copies (demo banner / simulated class). Keep false for class.
  PREVIEW: false
};
