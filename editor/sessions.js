// Session store. Keeps multiple named Event Modeling documents in localStorage
// and tracks which one is open. All localStorage access lives here; the rest of
// the app talks to `window.Sessions`.
//
// Storage layout (two keys, one JSON blob — documents are small text):
//   em.sessions  -> [{ id, name, content, createdAt, updatedAt }]
//   em.activeId  -> id of the open session
//
// If localStorage is unavailable (private mode, quota, disabled), everything
// degrades to an in-memory array so the editor still works for the page load.
(function () {
  "use strict";

  const SESSIONS_KEY = "em.sessions";
  const ACTIVE_KEY = "em.activeId";
  const SEED = '{\n  "slices": []\n}';

  // Probe localStorage once; fall back to an in-memory shim if it throws.
  let store;
  try {
    const k = "em.__probe";
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    store = window.localStorage;
  } catch (_) {
    const mem = new Map();
    store = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: (k) => mem.delete(k),
    };
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // Read the sessions array, tolerating a missing or corrupt blob.
  function readAll() {
    const raw = store.getItem(SESSIONS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeAll(sessions) {
    try {
      store.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (_) {
      /* quota or serialization failure — nothing useful to do here */
    }
  }

  function list() {
    return readAll().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function get(id) {
    return readAll().find((s) => s.id === id) || null;
  }

  function create(name, content) {
    const now = Date.now();
    const session = {
      id: newId(),
      name: (name && String(name).trim()) || "Untitled",
      content: content != null ? String(content) : "",
      createdAt: now,
      updatedAt: now,
    };
    const sessions = readAll();
    sessions.push(session);
    writeAll(sessions);
    return session;
  }

  function update(id, content) {
    const sessions = readAll();
    const s = sessions.find((x) => x.id === id);
    if (!s) return null;
    s.content = content != null ? String(content) : "";
    s.updatedAt = Date.now();
    writeAll(sessions);
    return s;
  }

  function rename(id, name) {
    const trimmed = name && String(name).trim();
    if (!trimmed) return null;
    const sessions = readAll();
    const s = sessions.find((x) => x.id === id);
    if (!s) return null;
    s.name = trimmed;
    s.updatedAt = Date.now();
    writeAll(sessions);
    return s;
  }

  function remove(id) {
    writeAll(readAll().filter((s) => s.id !== id));
    if (getActiveId() === id) setActiveId(null);
  }

  function getActiveId() {
    return store.getItem(ACTIVE_KEY);
  }

  function setActiveId(id) {
    if (id == null) store.removeItem(ACTIVE_KEY);
    else store.setItem(ACTIVE_KEY, id);
  }

  // Guarantee at least one session exists and an active id points at a real one.
  // Returns the active session.
  function ensureDefault() {
    let sessions = readAll();
    if (sessions.length === 0) {
      const s = create("Untitled", SEED);
      setActiveId(s.id);
      return s;
    }
    let active = get(getActiveId());
    if (!active) {
      active = list()[0]; // most recently updated
      setActiveId(active.id);
    }
    return active;
  }

  window.Sessions = {
    list,
    get,
    create,
    update,
    rename,
    remove,
    getActiveId,
    setActiveId,
    ensureDefault,
  };
})();
