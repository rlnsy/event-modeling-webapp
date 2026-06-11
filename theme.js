// Theme module. Owns the light/dark/system preference, persists it, and applies
// a concrete `data-theme` ("light" | "dark") to <html>. Loaded in <head> so the
// attribute is set before first paint — no flash of the wrong theme.
//
// Storage (one key, following the em. convention used by sessions.js):
//   em.theme -> "light" | "dark" | "system"
//
// In "system" mode the OS preference is tracked via matchMedia and applied live
// when it changes. If localStorage is unavailable (private mode, quota, disabled)
// the choice simply isn't persisted; theming still works for the page load.
(function () {
  "use strict";

  const KEY = "em.theme";
  const MODES = ["light", "dark", "system"];

  // Probe localStorage once; fall back to an in-memory shim if it throws.
  let store;
  try {
    const k = "em.__theme_probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    store = window.localStorage;
  } catch (_) {
    let val = null;
    store = {
      getItem: () => val,
      setItem: (_k, v) => { val = String(v); },
      removeItem: () => { val = null; },
    };
  }

  const mql = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

  const listeners = [];
  let mode = readMode();

  function readMode() {
    const raw = store.getItem(KEY);
    return MODES.includes(raw) ? raw : "system";
  }

  // The concrete theme actually painted, resolving "system" against the OS.
  // Falls back to dark when matchMedia is unavailable.
  function resolved() {
    if (mode === "light" || mode === "dark") return mode;
    return mql && mql.matches ? "dark" : mql ? "light" : "dark";
  }

  function apply() {
    document.documentElement.setAttribute("data-theme", resolved());
  }

  function notify() {
    for (const cb of listeners) {
      try { cb(mode, resolved()); } catch (_) { /* a bad listener shouldn't break theming */ }
    }
  }

  function set(next) {
    if (!MODES.includes(next)) return;
    mode = next;
    try { store.setItem(KEY, mode); } catch (_) { /* quota — apply anyway */ }
    apply();
    notify();
  }

  // light -> dark -> system -> light
  function cycle() {
    set(MODES[(MODES.indexOf(mode) + 1) % MODES.length]);
  }

  function onChange(cb) {
    if (typeof cb !== "function") return;
    listeners.push(cb);
    cb(mode, resolved()); // fire immediately so the UI can sync on load
  }

  // Re-apply when the OS theme flips, but only while following the system.
  if (mql) {
    const handler = () => {
      if (mode === "system") { apply(); notify(); }
    };
    if (typeof mql.addEventListener === "function") mql.addEventListener("change", handler);
    else if (typeof mql.addListener === "function") mql.addListener(handler);
  }

  apply(); // pre-paint application during <head> parse

  window.Theme = { get: () => mode, resolved, set, cycle, onChange };
})();
