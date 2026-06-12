(function () {
  "use strict";

  const input = document.getElementById("input");
  const highlight = document.getElementById("highlight");
  const gutter = document.getElementById("gutter");
  const statusbar = document.getElementById("statusbar");
  const statusText = document.getElementById("statusText");
  const statusMeta = document.getElementById("statusMeta");
  const problems = document.getElementById("problems");
  const problemsList = document.getElementById("problemsList");
  const formatBtn = document.getElementById("formatBtn");
  const clearBtn = document.getElementById("clearBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const themeToggle = document.getElementById("themeToggle");
  const sessionSelect = document.getElementById("sessionSelect");
  const newSessionBtn = document.getElementById("newSessionBtn");
  const renameSessionBtn = document.getElementById("renameSessionBtn");
  const deleteSessionBtn = document.getElementById("deleteSessionBtn");
  const preview = document.getElementById("preview");
  const editor = document.getElementById("editor");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");
  const modalFoot = document.getElementById("modalFoot");
  const modalEditBtn = document.getElementById("modalEdit");
  const modalDeleteBtn = document.getElementById("modalDelete");

  // ---------- Helpers ----------

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // Translate an absolute character offset into a 1-based {line, col}.
  function offsetToLineCol(text, offset) {
    offset = Math.max(0, Math.min(offset, text.length));
    let line = 1, col = 1;
    for (let i = 0; i < offset; i++) {
      if (text[i] === "\n") { line++; col = 1; } else { col++; }
    }
    return { line, col };
  }

  // Pull a character offset out of the various JSON.parse error messages that
  // browsers produce. Returns null if no position can be determined.
  function extractErrorOffset(message, text) {
    // Chrome / V8: "... at position 123" (sometimes with line/column too)
    let m = message.match(/at position (\d+)/i);
    if (m) return parseInt(m[1], 10);

    // Chrome newer: "... in JSON at line 3 column 5"
    m = message.match(/line (\d+) column (\d+)/i);
    if (m) {
      const targetLine = parseInt(m[1], 10);
      const targetCol = parseInt(m[2], 10);
      let line = 1, off = 0;
      for (; off < text.length && line < targetLine; off++) {
        if (text[off] === "\n") line++;
      }
      return off + (targetCol - 1);
    }

    // Firefox: "... at line 3 column 5 of the JSON data"
    // (covered by the line/column regex above)

    // Safari: "JSON Parse error: ..." — no position. Fall back to a scan.
    return null;
  }

  // Last-resort locator: re-scan to find roughly where structure breaks.
  // Good enough to highlight the offending line when the engine gives nothing.
  function guessOffset(text) {
    // Find the first character that isn't valid as a prefix by binary-ish probing
    // is overkill; instead point at the last non-whitespace char.
    const trimmed = text.replace(/\s+$/, "");
    return Math.max(0, trimmed.length - 1);
  }

  // ---------- Schema validation (draft-07 subset) ----------
  // Supports: type (string | array), enum, properties, required,
  // additionalProperties (false), items, $ref (#/$defs/...), oneOf.

  function resolveRef(ref, root) {
    // e.g. "#/$defs/Slice"
    const parts = ref.replace(/^#\//, "").split("/");
    let node = root;
    for (const p of parts) {
      node = node[p.replace(/~1/g, "/").replace(/~0/g, "~")];
      if (node === undefined) return null;
    }
    return node;
  }

  function jsonType(value) {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (Number.isInteger(value)) return "integer";
    return typeof value; // string | number | boolean | object
  }

  function typeMatches(expected, value) {
    const t = jsonType(value);
    if (expected === "number") return t === "number" || t === "integer";
    if (expected === "integer") return t === "integer";
    return expected === t;
  }

  function validateSchema(value, schema, root, path, errors) {
    if (!schema) return;

    if (schema.$ref) {
      const resolved = resolveRef(schema.$ref, root);
      if (resolved) validateSchema(value, resolved, root, path, errors);
      return;
    }

    if (schema.oneOf) {
      const matches = schema.oneOf.filter((sub) => {
        const local = [];
        validateSchema(value, sub, root, path, local);
        return local.length === 0;
      });
      if (matches.length !== 1) {
        errors.push({ path, msg: `must match exactly one of the allowed shapes (matched ${matches.length})` });
      }
      return;
    }

    // type
    if (schema.type) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      if (!types.some((t) => typeMatches(t, value))) {
        errors.push({ path, msg: `expected ${types.join(" or ")}, got ${jsonType(value)}` });
        return; // further checks would be noise once the type is wrong
      }
    }

    // enum
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push({ path, msg: `value ${JSON.stringify(value)} is not one of: ${schema.enum.join(", ")}` });
    }

    // object
    if (jsonType(value) === "object") {
      if (schema.required) {
        for (const key of schema.required) {
          if (!(key in value)) {
            errors.push({ path, msg: `missing required property "${key}"` });
          }
        }
      }
      const props = schema.properties || {};
      for (const key of Object.keys(value)) {
        if (props[key]) {
          validateSchema(value[key], props[key], root, path ? path + "." + key : key, errors);
        } else if (schema.additionalProperties === false) {
          errors.push({ path: path ? path + "." + key : key, msg: `unknown property "${key}"` });
        }
      }
    }

    // array
    if (jsonType(value) === "array" && schema.items) {
      value.forEach((item, i) => {
        validateSchema(item, schema.items, root, `${path}[${i}]`, errors);
      });
    }
  }

  // ---------- Rendering ----------

  // A standard trash-can glyph as inline SVG. Uses `currentColor` so it inherits
  // the button's (red) text color, and is hidden from a11y tools since the
  // button carries an aria-label.
  const TRASH_ICON =
    '<svg class="icon-trash" viewBox="0 0 16 16" width="12" height="12" ' +
    'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M2.5 4h11"/><path d="M6 4V2.5h4V4"/>' +
    '<path d="M3.75 4l.6 9.5h7.3l.6-9.5"/>' +
    '<path d="M6.5 6.5v5M9.5 6.5v5"/></svg>';

  function lineCount(text) {
    let n = 1;
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") n++;
    return n;
  }

  function renderGutter(text, errorLines) {
    const total = lineCount(text);
    let html = "";
    for (let i = 1; i <= total; i++) {
      html += errorLines.has(i) ? `<span class="err-line">${i}</span>\n` : i + "\n";
    }
    gutter.innerHTML = html;
  }

  // Paint a faint red band over each error line, in a layer behind the text.
  function renderHighlight(text, errorLines) {
    if (errorLines.size === 0) {
      highlight.textContent = "";
      return;
    }
    const lines = text.split("\n");
    let html = "";
    for (let i = 0; i < lines.length; i++) {
      const content = escapeHtml(lines[i]) || " ";
      if (errorLines.has(i + 1)) {
        html += `<span class="err-row">${content}</span>\n`;
      } else {
        html += content + "\n";
      }
    }
    highlight.innerHTML = html;
  }

  // ---------- Model preview ----------
  // Lanes top-to-bottom within a slice column. Each lane pulls from one or more
  // slice arrays; cards are tagged by `type` for color coding.
  const LANES = [
    { type: "actor", keys: ["actors"] },
    { type: "screen" }, // screens (with embedded screenImages) + processors; handled specially
    { type: "command", keys: ["readmodels", "commands"], typeFor: { readmodels: "readmodel", commands: "command" } },
    { type: "event", keys: ["events"] },
    { type: "specification", keys: ["specifications"] },
    { type: "table", keys: ["tables"] },
  ];

  function asArray(v) {
    return Array.isArray(v) ? v : [];
  }

  const TYPE_LABELS = {
    actor: "Actor", screen: "Screen", screenimage: "Screen Image", command: "Command",
    readmodel: "Read Model", automation: "Automation", event: "Event",
    specification: "Specification", table: "Table",
  };

  // Compact, human-readable form of a field's `example` value.
  function exampleText(ex) {
    if (ex == null) return null;
    if (typeof ex === "string") return JSON.stringify(ex);
    const s = JSON.stringify(ex);
    return s.length > 32 ? s.slice(0, 31) + "…" : s;
  }

  // One field line: name, type, flag badges, and example value when present.
  // When the field carries `subfields` (a nested object), a disclosure toggle is
  // prepended and the subfields render as a collapsible, indented nested list —
  // recursively, so each deeper Custom field gets its own toggle.
  function fieldLine(f) {
    const li = document.createElement("li");
    if (!f || typeof f !== "object") {
      li.textContent = "?";
      return li;
    }
    const subfields = asArray(f.subfields).filter((s) => s && typeof s === "object");
    const hasSub = subfields.length > 0;

    // The header row holds toggle + name + type + flags + example. Kept as its
    // own element so the nested list can sit beneath it inside the same <li>.
    const head = hasSub ? document.createElement("div") : li;
    if (hasSub) {
      head.className = "f-head";
      li.classList.add("has-sub");
    }

    let toggle = null;
    if (hasSub) {
      toggle = document.createElement("span");
      toggle.className = "f-toggle";
      toggle.textContent = "▾";
      head.appendChild(toggle);
    }

    const name = document.createElement("span");
    name.className = "f-name";
    name.textContent = f.name != null ? String(f.name) : "?";
    head.appendChild(name);

    if (f.type != null) {
      const ty = document.createElement("span");
      ty.className = "f-type";
      ty.textContent = String(f.type);
      head.appendChild(ty);
    }

    const flags = [];
    if (f.idAttribute) flags.push("id");
    if (f.optional) flags.push("opt");
    if (f.generated) flags.push("gen");
    if (f.technicalAttribute) flags.push("tech");
    if (f.cardinality === "List") flags.push("list");
    for (const fl of flags) {
      const b = document.createElement("span");
      b.className = "f-flag";
      b.textContent = fl;
      head.appendChild(b);
    }

    const ex = exampleText(f.example);
    if (ex != null) {
      const e = document.createElement("span");
      e.className = "f-ex";
      e.textContent = "= " + ex;
      head.appendChild(e);
    }

    if (!hasSub) return li;

    // Nest the subfields under this line and wire the toggle to collapse them.
    // Default expanded so structure is visible on load.
    li.appendChild(head);
    const sub = document.createElement("ul");
    sub.className = "card-fields card-subfields";
    for (const s of subfields) sub.appendChild(fieldLine(s));
    li.appendChild(sub);

    toggle.addEventListener("click", (e) => {
      e.stopPropagation();
      const collapsed = li.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "▸" : "▾";
    });
    return li;
  }

  function fieldList(fields) {
    const ul = document.createElement("ul");
    ul.className = "card-fields";
    for (const f of asArray(fields)) ul.appendChild(fieldLine(f));
    return ul;
  }

  // Wrap a fully-built card so clicking (or Enter/Space) opens the detail modal.
  // `ctx` (when present) locates the item in the model so the detail modal can
  // offer Edit/Delete.
  function makeCard(type, title, body, item, isAuth, ctx) {
    const card = document.createElement("div");
    card.className = "card type-" + type + (isAuth ? " auth" : "");
    // A list read model is drawn as a stack of cards (see styles.css) to signal
    // it holds a collection of records rather than a single one.
    if (type === "readmodel" && item && item.listElement) card.classList.add("is-list");
    // Mark traced consumers that have an information-completeness gap.
    if (item && item.id && completenessFlags.has(item.id)) card.classList.add("has-gap");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const t = document.createElement("div");
    t.className = "card-title";
    t.textContent = title != null && title !== "" ? String(title) : "(untitled)";
    card.appendChild(t);
    if (body) card.appendChild(body);
    const open = () => openDetail(type, item, ctx);
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    return card;
  }

  // A specification card: each given/when/then step with its fields inline.
  function specBody(spec) {
    const wrap = document.createDocumentFragment();
    for (const [label, key] of [["Given", "given"], ["When", "when"], ["Then", "then"]]) {
      const steps = asArray(spec[key]);
      if (steps.length === 0) continue;
      const group = document.createElement("div");
      group.className = "spec-group";
      const lbl = document.createElement("div");
      lbl.className = "spec-label";
      lbl.textContent = label;
      group.appendChild(lbl);
      for (const step of steps) {
        const st = document.createElement("div");
        st.className = "spec-step";
        st.textContent = step && step.title != null ? String(step.title) : "?";
        group.appendChild(st);
        const fields = asArray(step && step.fields);
        if (fields.length) group.appendChild(fieldList(fields));
      }
      wrap.appendChild(group);
    }
    return wrap;
  }

  // A screen-image card: a thumbnail of the `url`, degrading to a note if the
  // image is missing or fails to load.
  function screenImageBody(item) {
    if (!item || !item.url) {
      const note = document.createElement("div");
      note.className = "img-missing";
      note.textContent = "(no image url)";
      return note;
    }
    const img = document.createElement("img");
    img.className = "screen-img";
    img.src = String(item.url);
    img.alt = item.title != null ? String(item.title) : "screen image";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      const note = document.createElement("div");
      note.className = "img-missing";
      note.textContent = "(image unavailable)";
      img.replaceWith(note);
    });
    return img;
  }

  function cardFor(type, item, ctx) {
    if (type === "actor") {
      return makeCard("actor", item && item.name, null, item, !!(item && item.authRequired), ctx);
    }
    if (type === "screenimage") {
      return makeCard("screenimage", item && item.title, item ? screenImageBody(item) : null, item, false, ctx);
    }
    if (type === "specification") {
      return makeCard("specification", item && item.title, item ? specBody(item) : null, item, false, ctx);
    }
    return makeCard(type, item && item.title, item ? fieldList(item.fields) : null, item, false, ctx);
  }

  // An image embedded inside a screen card. Clicking it opens the image's own
  // detail (it's slice-level data, not part of the screen element), so we stop
  // the click from bubbling up to the screen card's handler.
  function embeddedImage(im, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "screen-img-wrap";
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "button");
    wrap.appendChild(screenImageBody(im));
    const open = (e) => { e.stopPropagation(); openDetail("screenimage", im, ctx); };
    wrap.addEventListener("click", open);
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); }
    });
    return wrap;
  }

  // A screen card: title, fields, then any slice screen images beneath them.
  // `ctx` locates the screen; embedded images get their own screenImages ctx.
  function screenCard(screen, images, ctx) {
    const body = document.createDocumentFragment();
    body.appendChild(fieldList(asArray(screen && screen.fields)));
    asArray(images).forEach((im, idx) => {
      const imCtx = ctx ? makeCtx(ctx.sliceId, ctx.sliceIdx, "screenImages", im, idx) : null;
      body.appendChild(embeddedImage(im, imCtx));
    });
    return makeCard("screen", screen && screen.title, body, screen, false, ctx);
  }

  // ---------- Detail modal ----------
  // Recursively render any JSON value as a readable tree so the modal shows
  // *every* property of an element, with nothing hand-picked or dropped.
  function renderValue(value) {
    if (value === null || value === undefined) {
      const s = document.createElement("span");
      s.className = "detail-scalar detail-muted";
      s.textContent = "null";
      return s;
    }
    const t = typeof value;
    if (t === "string" || t === "number" || t === "boolean") {
      const s = document.createElement("span");
      s.className = "detail-scalar";
      s.textContent = t === "string" ? value : String(value);
      return s;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        const s = document.createElement("span");
        s.className = "detail-scalar detail-muted";
        s.textContent = "(empty)";
        return s;
      }
      const ul = document.createElement("ul");
      ul.className = "detail-array";
      for (const item of value) {
        const li = document.createElement("li");
        li.appendChild(renderValue(item));
        ul.appendChild(li);
      }
      return ul;
    }
    const obj = document.createElement("div");
    obj.className = "detail-object";
    for (const key of Object.keys(value)) {
      const row = document.createElement("div");
      row.className = "detail-row";
      const k = document.createElement("span");
      k.className = "detail-key";
      k.textContent = key;
      row.appendChild(k);
      const v = renderValue(value[key]);
      v.classList.add("detail-val");
      row.appendChild(v);
      obj.appendChild(row);
    }
    return obj;
  }

  // The element currently shown in the detail modal, so the footer's Edit/Delete
  // buttons know what to act on. Cleared when the modal opens without context.
  let detailCtx = null;

  function openDetail(type, item, ctx) {
    detailCtx = ctx || null;
    const name = item && (item.title || item.name || item.id);
    modalTitle.textContent = (name ? String(name) : "(untitled)") +
      "  ·  " + (TYPE_LABELS[type] || type);
    modalBody.innerHTML = "";
    modalBody.appendChild(renderValue(item == null ? {} : item));
    if (modalFoot) modalFoot.hidden = !detailCtx;
    modalBackdrop.hidden = false;
  }

  function closeDetail() {
    modalBackdrop.hidden = true;
    detailCtx = null;
  }

  modalClose.addEventListener("click", closeDetail);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalBackdrop.hidden) closeDetail();
  });
  if (modalEditBtn) modalEditBtn.addEventListener("click", () => editComponent(detailCtx));
  if (modalDeleteBtn) modalDeleteBtn.addEventListener("click", () => deleteComponent(detailCtx));

  // ---------- Adding components ----------
  // The textarea is the source of truth: every add parses it, splices the new
  // object into the parsed model, and re-serializes the whole document. The
  // existing validate() cycle then refreshes the preview, gutter, and status.

  // Where each addable type lands inside its slice.
  const TARGET_KEY = {
    command: "commands",
    event: "events",
    readmodel: "readmodels",
    screen: "screens",
    processor: "processors",
    actor: "actors",
    screenImage: "screenImages",
    table: "tables",
    specification: "specifications",
  };

  // Inverse of TARGET_KEY: the slice array key -> the AddForms/edit type. Lets a
  // rendered card (which only knows its array key) name the form type for edit.
  const FORM_TYPE_FOR_KEY = {
    commands: "command",
    events: "event",
    readmodels: "readmodel",
    screens: "screen",
    processors: "processor",
    actors: "actor",
    screenImages: "screenImage",
    tables: "table",
    specifications: "specification",
  };

  // Locate context for a rendered card: which slice, which array, and which item
  // (preferring `id`, falling back to array position for id-less items / actors).
  function makeCtx(sliceId, sliceIdx, key, item, itemIndex) {
    return {
      sliceId,
      sliceIdx,
      formType: FORM_TYPE_FOR_KEY[key],
      itemId: item && item.id != null ? item.id : null,
      itemIndex,
    };
  }

  // Find an item's current position in `arr`, by id when known, else by the
  // recorded index. Returns -1 when nothing matches.
  function findItemIndex(arr, itemId, itemIndex) {
    if (itemId != null) {
      const i = arr.findIndex((x) => x && x.id === itemId);
      if (i >= 0) return i;
    }
    return Number.isInteger(itemIndex) && itemIndex >= 0 && itemIndex < arr.length ? itemIndex : -1;
  }

  // Parse the editor text into a model object suitable for editing, or null if
  // it can't be (syntax error, or a non-object root). An empty document is
  // treated as a fresh, sliceless model so the first slice can be added.
  function modelForEditing() {
    if (input.value.trim() === "") return { slices: [] };
    let parsed;
    try {
      parsed = JSON.parse(input.value);
    } catch (_) {
      return null;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  }

  // Serialize a mutated model back into the editor and run the normal cycle.
  function commitModel(model) {
    input.value = JSON.stringify(model, null, 2);
    saveActive();
    validate();
  }

  // Slices in display order: by `index` when present, else array position.
  // Returns `{ s, i }` pairs where `i` is the original array position.
  function orderedSlices(slices) {
    return slices
      .map((s, i) => ({ s, i }))
      .sort((a, b) => {
        const ai = Number.isInteger(a.s && a.s.index) ? a.s.index : a.i;
        const bi = Number.isInteger(b.s && b.s.index) ? b.s.index : b.i;
        return ai - bi;
      });
  }

  // Move a slice one position left (dir -1) or right (dir +1) in display order,
  // then normalize every slice's `index` to its new 0..N-1 position. The `s`
  // objects are references into `model.slices`, so mutating `s.index` mutates
  // the model directly.
  function moveSlice(sliceId, sliceIdx, dir) {
    const model = modelForEditing();
    if (model == null) {
      setStatus("err", "Resolve JSON errors before reordering", "");
      return;
    }
    const slices = Array.isArray(model.slices) ? model.slices : [];
    const ordered = orderedSlices(slices);
    const pos = ordered.findIndex(({ s, i }) =>
      (sliceId != null && s && s.id === sliceId) || i === sliceIdx);
    const target = pos + dir;
    if (pos < 0 || target < 0 || target >= ordered.length) return;
    const tmp = ordered[pos];
    ordered[pos] = ordered[target];
    ordered[target] = tmp;
    ordered.forEach(({ s }, idx) => { if (s) s.index = idx; });
    commitModel(model);
  }

  // ◀ / ▶ controls in the slice header. The leftmost slice's ◀ and the
  // rightmost slice's ▶ are disabled.
  function sliceReorderControls(sliceId, sliceIdx, pos, total) {
    const wrap = document.createElement("div");
    wrap.className = "slice-reorder";
    const mk = (label, dir, disabled, titleText) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "reorder-btn";
      b.textContent = label;
      b.title = titleText;
      b.disabled = disabled;
      b.addEventListener("click", () => moveSlice(sliceId, sliceIdx, dir));
      return b;
    };
    wrap.appendChild(mk("◀", -1, pos === 0, "Move left"));
    wrap.appendChild(mk("▶", +1, pos === total - 1, "Move right"));
    return wrap;
  }

  // Open the slice form pre-filled to edit a slice's title/type/status/context.
  // applyEdit preserves the slice's id, index, and child element arrays.
  function editSlice(sliceId, sliceIdx) {
    const snapshot = modelForEditing();
    if (snapshot == null) {
      setStatus("err", "Resolve JSON errors before editing", "");
      return;
    }
    const slice = findSlice(snapshot, sliceId, sliceIdx);
    if (!slice) {
      setStatus("err", "Could not find the target slice", "");
      return;
    }
    AddForms.open("slice", (obj) => {
      const model = modelForEditing();
      if (model == null) {
        setStatus("err", "Resolve JSON errors before editing", "");
        return;
      }
      const slices = Array.isArray(model.slices) ? model.slices : [];
      const i = findItemIndex(slices, sliceId, sliceIdx);
      if (i < 0) {
        setStatus("err", "Could not find the slice to edit", "");
        return;
      }
      slices[i] = obj;
      commitModel(model);
    }, { initial: slice });
  }

  // Remove a slice after confirmation, then renormalize the remaining slices'
  // `index` values to their 0..N-1 display order (mirrors moveSlice).
  function deleteSlice(sliceId, sliceIdx) {
    const model = modelForEditing();
    if (model == null) {
      setStatus("err", "Resolve JSON errors before deleting", "");
      return;
    }
    const slices = Array.isArray(model.slices) ? model.slices : [];
    const i = findItemIndex(slices, sliceId, sliceIdx);
    if (i < 0) {
      setStatus("err", "Could not find the slice to delete", "");
      return;
    }
    const name = (slices[i] && slices[i].title) || "this slice";
    if (!window.confirm(`Delete slice "${name}"? This cannot be undone.`)) return;
    slices.splice(i, 1);
    orderedSlices(slices).forEach(({ s }, idx) => { if (s) s.index = idx; });
    commitModel(model);
  }

  // ✎ / 🗑 controls in the slice header.
  function sliceEditControls(sliceId, sliceIdx) {
    const wrap = document.createElement("div");
    wrap.className = "slice-edit-controls";
    const mk = (markup, titleText, cls, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slice-edit-btn" + (cls ? " " + cls : "");
      b.innerHTML = markup; // trusted static glyph/icon markup
      b.title = titleText;
      b.setAttribute("aria-label", titleText);
      b.addEventListener("click", fn);
      return b;
    };
    wrap.appendChild(mk("✎", "Edit slice", "", () => editSlice(sliceId, sliceIdx)));
    wrap.appendChild(mk(TRASH_ICON, "Delete slice", "slice-del-btn", () => deleteSlice(sliceId, sliceIdx)));
    return wrap;
  }

  // Resolve a slice in `model` by id, falling back to its array position.
  function findSlice(model, sliceId, sliceIdx) {
    const slices = Array.isArray(model.slices) ? model.slices : [];
    return slices.find((s) => s && sliceId != null && s.id === sliceId) || slices[sliceIdx];
  }

  // Non-generated fields from a list of elements, deduped by name. Seeds the
  // "copy fields" buttons: a command copies its slice's event fields, a state-
  // change screen copies its command fields, a state-view screen copies its
  // read-model fields.
  function fieldsFromElements(list) {
    const out = [];
    const seen = new Set();
    for (const el of asArray(list)) {
      for (const f of asArray(el && el.fields)) {
        if (f && f.name && !f.generated && !seen.has(f.name)) {
          seen.add(f.name);
          out.push(f);
        }
      }
    }
    return out;
  }

  // The slice's event fields that seed a command's "copy fields" button.
  function eventFieldsOf(slice) {
    return fieldsFromElements(slice && slice.events);
  }

  // Every event across the whole model, in slice/array order. Read models pick
  // their dependencies from this list, so a read model can depend on events
  // outside its own slice.
  function allEvents(model) {
    const out = [];
    for (const s of (Array.isArray(model.slices) ? model.slices : [])) {
      for (const ev of (s && Array.isArray(s.events) ? s.events : [])) {
        if (ev && ev.id) out.push(ev);
      }
    }
    return out;
  }

  // Copy-fields / dependency options for a form, shared by add and edit. Commands
  // pull their (non-generated) fields from the slice's event. Read models attach
  // model-wide events as INBOUND dependencies and copy a chosen event's fields.
  // Screens copy from the element that feeds them: a state-change screen from the
  // slice's command(s), a state-view screen from the slice's read model(s). An
  // automation copies from the command it triggers (same slice).
  function addOptions(type, slice, model) {
    if (type === "command") {
      const fields = eventFieldsOf(slice);
      if (fields.length) return { copyFromFields: fields };
    } else if (type === "readmodel") {
      const events = allEvents(model);
      if (events.length) return { events };
    } else if (type === "screen") {
      if (slice && slice.sliceType === "STATE_VIEW") {
        const fields = fieldsFromElements(slice.readmodels);
        if (fields.length) return { copyFromFields: fields, copyFromLabel: "Copy fields from read model" };
      } else if (slice && slice.sliceType === "STATE_CHANGE") {
        const fields = fieldsFromElements(slice.commands);
        if (fields.length) return { copyFromFields: fields, copyFromLabel: "Copy fields from command" };
      }
    } else if (type === "processor") {
      const fields = fieldsFromElements(slice && slice.commands);
      if (fields.length) return { copyFromFields: fields, copyFromLabel: "Copy fields from command" };
    }
    return null;
  }

  // Open the add-form for `type`, targeting the slice identified by `sliceId`
  // (falling back to `sliceIdx` if the slice has no id). `type === "slice"`
  // appends to the top-level slices array instead.
  function startAdd(type, sliceId, sliceIdx) {
    const snapshot = modelForEditing();
    if (snapshot == null) {
      setStatus("err", "Resolve JSON errors before adding", "");
      return;
    }

    const options = addOptions(type, findSlice(snapshot, sliceId, sliceIdx), snapshot);

    AddForms.open(type, (obj) => {
      const model = modelForEditing();
      if (model == null) {
        setStatus("err", "Resolve JSON errors before adding", "");
        return;
      }
      if (type === "slice") {
        if (!Array.isArray(model.slices)) model.slices = [];
        obj.index = model.slices.length;
        model.slices.push(obj);
      } else {
        const slice = findSlice(model, sliceId, sliceIdx);
        if (!slice) {
          setStatus("err", "Could not find the target slice", "");
          return;
        }
        const key = TARGET_KEY[type];
        if (!Array.isArray(slice[key])) slice[key] = [];
        slice[key].push(obj);
      }
      commitModel(model);
    }, options);
  }

  // Open the edit-form for the component located by `ctx`, pre-filled with its
  // current values; on save, replace it in place and re-commit the model.
  function editComponent(ctx) {
    if (!ctx) return;
    const snapshot = modelForEditing();
    if (snapshot == null) {
      setStatus("err", "Resolve JSON errors before editing", "");
      return;
    }
    const slice = findSlice(snapshot, ctx.sliceId, ctx.sliceIdx);
    const key = TARGET_KEY[ctx.formType];
    const arr = slice && Array.isArray(slice[key]) ? slice[key] : [];
    const idx = findItemIndex(arr, ctx.itemId, ctx.itemIndex);
    if (idx < 0) {
      setStatus("err", "Could not find the item to edit", "");
      return;
    }

    const options = addOptions(ctx.formType, slice, snapshot) || {};
    options.initial = arr[idx];

    closeDetail();
    AddForms.open(ctx.formType, (obj) => {
      const model = modelForEditing();
      if (model == null) {
        setStatus("err", "Resolve JSON errors before editing", "");
        return;
      }
      const sl = findSlice(model, ctx.sliceId, ctx.sliceIdx);
      const a = sl && Array.isArray(sl[key]) ? sl[key] : [];
      const i = findItemIndex(a, ctx.itemId, ctx.itemIndex);
      if (i < 0) {
        setStatus("err", "Could not find the item to edit", "");
        return;
      }
      a[i] = obj;
      commitModel(model);
    }, options);
  }

  // Remove the component located by `ctx` after confirmation, then re-commit.
  function deleteComponent(ctx) {
    if (!ctx) return;
    const model = modelForEditing();
    if (model == null) {
      setStatus("err", "Resolve JSON errors before deleting", "");
      return;
    }
    const slice = findSlice(model, ctx.sliceId, ctx.sliceIdx);
    const key = TARGET_KEY[ctx.formType];
    const arr = slice && Array.isArray(slice[key]) ? slice[key] : [];
    const idx = findItemIndex(arr, ctx.itemId, ctx.itemIndex);
    if (idx < 0) {
      setStatus("err", "Could not find the item to delete", "");
      return;
    }
    const item = arr[idx];
    const name = (item && (item.title || item.name || item.id)) || "this item";
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    arr.splice(idx, 1);
    commitModel(model);
    closeDetail();
  }

  // A per-slice "+ Add" disclosure menu listing every addable element type.
  // Uses a native <details> so no global open/close state is needed.
  const SLICE_ADD_ITEMS = [
    ["command", "Command"], ["event", "Event"], ["readmodel", "Read Model"],
    ["screen", "Screen"], ["processor", "Processor"], ["actor", "Actor"],
    ["screenImage", "Screen Image"], ["table", "Table"], ["specification", "Specification"],
  ];

  function sliceAddMenu(sliceId, sliceIdx) {
    const det = document.createElement("details");
    det.className = "add-menu";
    const summary = document.createElement("summary");
    summary.className = "add-btn";
    summary.textContent = "+ Add";
    det.appendChild(summary);
    const list = document.createElement("div");
    list.className = "add-menu-list";
    for (const [type, label] of SLICE_ADD_ITEMS) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "add-menu-item";
      item.textContent = label;
      item.addEventListener("click", () => {
        det.open = false;
        startAdd(type, sliceId, sliceIdx);
      });
      list.appendChild(item);
    }
    det.appendChild(list);
    return det;
  }

  // ---------- Fullscreen (maximized preview) ----------
  // Transient view state: maximize the preview to fill the working area below the
  // topbar for presenting/reviewing. Held in memory only — not persisted, and
  // reset on reload and session switch. The editor (and statusbar) hide while
  // maximized, so the model is read-only until fullscreen is exited.

  let maximized = false;
  let maximizeBtn = null; // the button in the most recently rendered toolbar

  // Sync the toolbar button's icon/labels to the current state.
  function updateMaximizeBtn() {
    if (!maximizeBtn) return;
    maximizeBtn.textContent = maximized ? "⤡" : "⤢";
    const label = maximized ? "Exit fullscreen (Esc)" : "Maximize preview";
    maximizeBtn.title = label;
    maximizeBtn.setAttribute("aria-label", label);
    maximizeBtn.setAttribute("aria-pressed", maximized ? "true" : "false");
  }

  function setMaximized(on) {
    maximized = !!on;
    document.body.classList.toggle("preview-maximized", maximized);
    updateMaximizeBtn();
    if (!maximized) sizeEditor(); // editor is back; refit it to its text
  }

  // Esc exits fullscreen (only acts while maximized).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && maximized) setMaximized(false);
  });

  function renderModel(parsed) {
    preview.innerHTML = "";

    // Always offer a global "Add Slice" so an empty document can be bootstrapped.
    const toolbar = document.createElement("div");
    toolbar.className = "preview-toolbar";
    const addSliceBtn = document.createElement("button");
    addSliceBtn.type = "button";
    addSliceBtn.className = "add-btn";
    addSliceBtn.textContent = "+ Add Slice";
    addSliceBtn.addEventListener("click", () => startAdd("slice", null, null));
    toolbar.appendChild(addSliceBtn);

    // Maximize toggle, always available regardless of validation state.
    maximizeBtn = document.createElement("button");
    maximizeBtn.type = "button";
    maximizeBtn.className = "preview-max-btn";
    maximizeBtn.addEventListener("click", () => setMaximized(!maximized));
    updateMaximizeBtn();
    toolbar.appendChild(maximizeBtn);

    preview.appendChild(toolbar);

    const slices = parsed && Array.isArray(parsed.slices) ? parsed.slices : null;
    if (!slices || slices.length === 0) {
      const empty = document.createElement("div");
      empty.className = "preview-empty";
      empty.textContent = slices ? "No slices yet — add one to begin." : "Nothing to preview.";
      preview.appendChild(empty);
      return;
    }

    // Render in `index` order when present, else input order.
    const ordered = orderedSlices(slices);

    const row = document.createElement("div");
    row.className = "preview-row";

    ordered.forEach(({ s, i }, pos) => {
      const slice = s || {};
      const col = document.createElement("div");
      col.className = "slice-column";

      const header = document.createElement("div");
      header.className = "slice-header";
      const headMain = document.createElement("div");
      headMain.className = "slice-head-main";
      const title = document.createElement("div");
      title.className = "slice-title";
      title.textContent = slice.title != null && slice.title !== "" ? String(slice.title) : "(untitled slice)";
      headMain.appendChild(title);
      const meta = document.createElement("div");
      meta.className = "slice-meta";
      meta.textContent = [slice.sliceType, slice.status].filter(Boolean).join(" · ");
      if (meta.textContent) headMain.appendChild(meta);
      header.appendChild(headMain);
      const headActions = document.createElement("div");
      headActions.className = "slice-head-actions";
      headActions.appendChild(sliceReorderControls(slice.id, i, pos, ordered.length));
      headActions.appendChild(sliceEditControls(slice.id, i));
      headActions.appendChild(sliceAddMenu(slice.id, i));
      header.appendChild(headActions);
      col.appendChild(header);

      for (const laneDef of LANES) {
        const lane = document.createElement("div");
        lane.className = "lane";
        let count = 0;

        if (laneDef.type === "screen") {
          // Screens render their slice's screenImages embedded under the fields.
          const screens = asArray(slice.screens);
          const images = asArray(slice.screenImages);
          screens.forEach((sc, idx) => {
            lane.appendChild(screenCard(sc, images, makeCtx(slice.id, i, "screens", sc, idx)));
            count++;
          });
          // No screen to host them: show images on their own so they aren't lost.
          if (screens.length === 0) {
            images.forEach((im, idx) => {
              lane.appendChild(cardFor("screenimage", im, makeCtx(slice.id, i, "screenImages", im, idx)));
              count++;
            });
          }
          asArray(slice.processors).forEach((pr, idx) => {
            lane.appendChild(cardFor("automation", pr, makeCtx(slice.id, i, "processors", pr, idx)));
            count++;
          });
        } else {
          for (const key of laneDef.keys) {
            const type = (laneDef.typeFor && laneDef.typeFor[key]) || laneDef.type;
            asArray(slice[key]).forEach((item, idx) => {
              lane.appendChild(cardFor(type, item, makeCtx(slice.id, i, key, item, idx)));
              count++;
            });
          }
        }

        if (count > 0) col.appendChild(lane);
      }

      row.appendChild(col);
    });

    preview.appendChild(row);
  }

  function setStatus(state, text, meta) {
    statusbar.className = "statusbar" + (state ? " " + state : "");
    statusText.textContent = text;
    statusMeta.textContent = meta || "";
  }

  function showProblems(items) {
    problemsList.innerHTML = "";
    if (items.length === 0) {
      problems.hidden = true;
      return;
    }
    for (const it of items) {
      const li = document.createElement("li");
      if (it.kind) li.classList.add("problem-" + it.kind);
      const loc = document.createElement("span");
      loc.className = "loc";
      loc.textContent = it.line ? `Ln ${it.line}, Col ${it.col}` : (it.locLabel || it.path || "root");
      const msg = document.createElement("span");
      msg.className = "msg";
      if (it.path) {
        msg.innerHTML = `<span class="path">${escapeHtml(it.path)}</span> &mdash; ${escapeHtml(it.msg)}`;
      } else {
        msg.textContent = it.msg;
      }
      li.appendChild(loc);
      li.appendChild(msg);
      if (it.offset != null) {
        li.addEventListener("click", () => {
          input.focus();
          input.setSelectionRange(it.offset, it.offset);
          // Nudge the caret into view.
          const before = input.value.slice(0, it.offset);
          const ln = before.split("\n").length;
          input.scrollTop = Math.max(0, (ln - 3) * 20);
          syncScroll();
        });
      }
      problemsList.appendChild(li);
    }
    problems.hidden = false;
  }

  // ---------- Information completeness ----------
  // Verify that every field on a downstream consumer can be traced back to a
  // field provided by something upstream that feeds it. All findings are
  // *warnings*: they surface in the problems panel but never block save/export.

  // Traced consumer element types. Automations/processors are excluded — the
  // translation pattern models them as inputless automations, so tracing them
  // would produce false gaps. Events are traced too, but only when something
  // upstream feeds them (e.g. Command → Event in a state-change slice); an event
  // with no inbound source is an origin/external event and stays a pure source.
  const TRACED_TYPES = new Set(["COMMAND", "READMODEL", "SCREEN", "EVENT"]);
  const CONSUMER_LABEL = { COMMAND: "Command", READMODEL: "Read Model", SCREEN: "Screen", EVENT: "Event" };

  // Element ids with at least one completeness finding, used to mark the
  // affected cards in the preview. Refreshed on every schema-valid validate().
  let completenessFlags = new Set();

  // Every element across every slice that can act as a source or a consumer,
  // flattened as `{ el, sliceType }` so the owning slice's type is available
  // for tracing decisions (e.g. input vs. display screens).
  function collectElements(model) {
    const out = [];
    const slices = Array.isArray(model && model.slices) ? model.slices : [];
    for (const s of slices) {
      if (!s) continue;
      for (const key of ["commands", "events", "readmodels", "screens", "processors"]) {
        for (const el of asArray(s[key])) {
          if (el && el.id) out.push({ el, sliceType: s.sliceType });
        }
      }
    }
    return out;
  }

  // Implicit data flow through a slice's lanes, by slice type. Event Modeling
  // routes data along these lanes even when a model doesn't record an explicit
  // dependency edge for every hop, so we treat each `[fromKey → toKey]` pair as
  // an edge from every `fromKey` element to every `toKey` element in the slice.
  const SLICE_FLOW = {
    STATE_CHANGE: [["screens", "commands"], ["processors", "commands"], ["commands", "events"]],
    STATE_VIEW:   [["events", "readmodels"], ["readmodels", "screens"]],
    AUTOMATION:   [["events", "processors"], ["processors", "commands"]],
  };

  // Build a "who feeds whom" graph from two sources, unioned:
  //   1. Explicit dependency edges — A feeds B when A has an `OUTBOUND → B`
  //      dependency OR B has an `INBOUND → A` dependency.
  //   2. Implicit intra-slice lane flow (SLICE_FLOW above).
  // Returns both directions: `inbound` maps a consumer id to the Set of elements
  // that feed it; `outbound` maps a source id to the Set of elements it feeds.
  function buildFlowGraph(model) {
    const slices = Array.isArray(model && model.slices) ? model.slices : [];
    const byId = new Map();
    for (const s of slices) {
      if (!s) continue;
      for (const key of ["commands", "events", "readmodels", "screens", "processors"]) {
        for (const el of asArray(s[key])) if (el && el.id) byId.set(el.id, el);
      }
    }

    const inbound = new Map();
    const outbound = new Map();
    const link = (map, key, el) => {
      if (!el) return;
      let set = map.get(key);
      if (!set) { set = new Set(); map.set(key, set); }
      set.add(el);
    };
    // `source` feeds `target`: record it on both directions.
    const feed = (source, target) => {
      if (!source || !target || source === target) return;
      link(inbound, target.id, source);
      link(outbound, source.id, target);
    };

    // 1. Explicit dependency edges.
    for (const el of byId.values()) {
      for (const dep of asArray(el.dependencies)) {
        if (!dep || dep.id == null) continue;
        const other = byId.get(dep.id);
        if (!other) continue;
        if (dep.type === "OUTBOUND") feed(el, other);      // el feeds the target
        else if (dep.type === "INBOUND") feed(other, el);  // the target feeds el
      }
    }

    // 2. Implicit intra-slice lane flow.
    for (const s of slices) {
      if (!s) continue;
      const flow = SLICE_FLOW[s.sliceType];
      if (!flow) continue;
      for (const [fromKey, toKey] of flow) {
        for (const a of asArray(s[fromKey])) {
          for (const b of asArray(s[toKey])) feed(a, b);
        }
      }
    }

    return { inbound, outbound };
  }

  // True when `el` feeds at least one element of the given element `type`.
  function feedsType(outbound, el, type) {
    const targets = outbound.get(el.id);
    if (!targets) return false;
    for (const t of targets) if (t && t.type === type) return true;
    return false;
  }

  // Flatten a field list to its leaf fields, descending through any field that
  // carries `subfields` (a nested object / Custom container). A container is
  // structure, not data — the values that get sourced live in its leaves — so
  // completeness is traced against leaves, not container names. Each leaf is
  // returned with a dotted `path` (e.g. "posts.title") for clear findings.
  function leafFields(fields, prefix) {
    const out = [];
    for (const f of asArray(fields)) {
      if (!f || !f.name) continue;
      const path = prefix ? prefix + "." + f.name : f.name;
      const subs = asArray(f.subfields).filter((s) => s && s.name);
      if (subs.length) out.push(...leafFields(subs, path));
      else out.push({ field: f, path });
    }
    return out;
  }

  // One finding per unsourced consumer leaf field, plus a lower-severity finding
  // per leaf whose name matches an upstream field but whose type drifts.
  // `generated` fields are system-produced and exempt (mirrors eventFieldsOf's
  // copy behavior). Container fields (those with subfields) are traced through
  // to their leaves, so a list of records resolves against the events that
  // source the record's fields rather than the container's own name.
  function completenessFindings(model) {
    const entries = collectElements(model);
    const { inbound, outbound } = buildFlowGraph(model);
    const findings = [];

    for (const { el, sliceType } of entries) {
      if (!TRACED_TYPES.has(el.type)) continue;
      // An input screen is a *source* of user input, not a consumer: its fields
      // originate the data, so they need no upstream source. A screen counts as
      // input when it lives in a STATE_CHANGE slice (Actor → Screen → Command) or
      // feeds a command directly. Display screens in STATE_VIEW slices (fed by a
      // read model) stay traced.
      if (el.type === "SCREEN" && (sliceType === "STATE_CHANGE" || feedsType(outbound, el, "COMMAND"))) continue;
      const label = CONSUMER_LABEL[el.type] || el.type;
      const title = el.title != null && el.title !== "" ? String(el.title) : "(untitled)";
      const srcEls = inbound.has(el.id) ? Array.from(inbound.get(el.id)) : [];
      // An event with no upstream is an origin/external event — a pure source,
      // not a consumer — so it has nothing to trace against.
      if (el.type === "EVENT" && srcEls.length === 0) continue;

      // Available upstream fields: leaf name -> set of types offered by any
      // source. Sources are flattened to leaves too, so a source that nests its
      // data still contributes the leaf names a consumer can draw from.
      const available = new Map();
      for (const src of srcEls) {
        for (const { field: f } of leafFields(src.fields)) {
          let types = available.get(f.name);
          if (!types) { types = new Set(); available.set(f.name, types); }
          if (f.type != null) types.add(f.type);
        }
      }

      for (const { field: f, path } of leafFields(el.fields)) {
        if (f.generated) continue;
        if (!available.has(f.name)) {
          findings.push({
            kind: "warning", locLabel: "completeness", elementId: el.id,
            msg: `${label} '${title}': field '${path}' has no upstream source.`,
          });
          continue;
        }
        // Sourced — but surface a type drift when no source offers a matching type.
        const types = available.get(f.name);
        if (f.type != null && types.size > 0 && !types.has(f.type)) {
          findings.push({
            kind: "warning", locLabel: "type", elementId: el.id,
            msg: `${label} '${title}': field '${path}' type ${f.type} differs from upstream type ${Array.from(types).join(" / ")}.`,
          });
        }
      }
    }
    return findings;
  }

  // ---------- Download ----------
  // The Download button exports the active session, pretty-printed, but only
  // when the document is fully schema-valid. `schemaValid` is the single source
  // of truth, updated by the validate cycle below; the button reads it.

  const DOWNLOAD_DISABLED_TIP = "Fix validation errors to enable download";
  let schemaValid = false;

  // Reflect schema validity into the Download button's enabled state + tooltip.
  function setSchemaValid(ok) {
    schemaValid = ok;
    if (!downloadBtn) return;
    downloadBtn.disabled = !ok;
    downloadBtn.title = ok ? "Download session as JSON" : DOWNLOAD_DISABLED_TIP;
  }

  // Turn a session name into a filename stem: lowercase, non-alphanumerics to
  // hyphens, collapsed and trimmed. Empty or "Untitled" falls back to a default.
  function slugifySessionName(name) {
    const slug = String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug && slug !== "untitled" ? slug : "event-model";
  }

  // Today's local date as YYYY-MM-DD.
  function todayStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // Export the active document as a pretty-printed .json download. Guarded by the
  // disabled state, but re-checks parse/validity so a stale click can't export junk.
  function downloadActive() {
    if (!schemaValid) return;
    let pretty;
    try {
      pretty = JSON.stringify(JSON.parse(input.value), null, 2);
    } catch (_) {
      return; // unparseable — nothing safe to export
    }
    const session = Sessions.get(activeId);
    const stem = slugifySessionName(session && session.name);
    const filename = `${stem}-${todayStamp()}.json`;

    const blob = new Blob([pretty], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- Main validate cycle ----------

  function validate() {
    const text = input.value;
    const errorLines = new Set();

    sizeEditor(); // refit the editor pane on every path (load, format, clear, typing)

    // Assume invalid until the schema-valid path is reached; this keeps the
    // Download button disabled for empty/unparseable/schema-error documents.
    setSchemaValid(false);

    if (text.trim() === "") {
      setStatus("", "Empty", "");
      renderGutter(text, errorLines);
      renderHighlight(text, errorLines);
      showProblems([]);
      renderModel(null);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      let offset = extractErrorOffset(e.message, text);
      if (offset == null) offset = guessOffset(text);
      const { line, col } = offsetToLineCol(text, offset);
      errorLines.add(line);

      // Clean up the raw engine message a little.
      const clean = e.message.replace(/\s+in JSON at position \d+.*/i, "")
        .replace(/\s+at line \d+ column \d+.*/i, "")
        .replace(/^JSON\.parse:\s*/i, "");

      renderGutter(text, errorLines);
      renderHighlight(text, errorLines);
      setStatus("err", "Invalid JSON", `Ln ${line}, Col ${col}`);
      showProblems([{ line, col, offset, msg: clean }]);
      return;
    }

    // Valid JSON. Always validate against the Event Modeling schema.
    const schemaErrors = [];
    validateSchema(parsed, window.EVENT_MODELING_SCHEMA, window.EVENT_MODELING_SCHEMA, "", schemaErrors);

    // Recompute information completeness on every schema-valid edit. The flags
    // drive the preview marker, so they must be set before renderModel runs.
    let completenessWarnings = [];
    completenessFlags = new Set();
    if (schemaErrors.length === 0) {
      completenessWarnings = completenessFindings(parsed);
      for (const w of completenessWarnings) completenessFlags.add(w.elementId);
    }

    // Refresh the preview best-effort, even if the schema is off.
    try {
      renderModel(parsed);
    } catch (_) {
      /* never let a render glitch break validation */
    }

    renderGutter(text, errorLines);
    renderHighlight(text, errorLines);

    if (schemaErrors.length) {
      setStatus("err", "Schema errors", `${schemaErrors.length} problem${schemaErrors.length > 1 ? "s" : ""}`);
      showProblems(schemaErrors.slice(0, 200).map((e) => ({ path: e.path || "(root)", msg: e.msg })));
      return;
    }

    // Schema-valid: completeness warnings never block — the model is still
    // "Valid" and saves/exports, so the Download button is enabled here.
    setSchemaValid(true);
    if (completenessWarnings.length) {
      const n = completenessWarnings.length;
      setStatus("ok", "Valid", `${n} completeness warning${n > 1 ? "s" : ""}`);
    } else {
      setStatus("ok", "Valid", "JSON + schema OK");
    }
    showProblems(completenessWarnings);
  }

  // ---------- Scroll sync ----------

  function syncScroll() {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
    gutter.scrollTop = input.scrollTop;
  }

  // ---------- Editor sizing ----------
  // Size the editor pane to fit the longest line of JSON so the preview can use
  // the rest of the width. A textarea's own scrollWidth is floored at its
  // clientWidth (it reports the box, not the text), so we measure the text in a
  // detached <pre> that shrink-wraps to its content and read its offsetWidth.
  const measurePre = document.createElement("pre");
  measurePre.setAttribute("aria-hidden", "true");
  measurePre.style.cssText =
    "position:absolute; top:0; left:-9999px; visibility:hidden; margin:0; " +
    "white-space:pre; pointer-events:none;";
  document.body.appendChild(measurePre);

  function measureTextWidth(text) {
    const cs = getComputedStyle(input);
    measurePre.style.fontFamily = cs.fontFamily;
    measurePre.style.fontSize = cs.fontSize;
    measurePre.style.fontWeight = cs.fontWeight;
    measurePre.style.letterSpacing = cs.letterSpacing;
    measurePre.style.tabSize = cs.tabSize;
    measurePre.style.paddingLeft = cs.paddingLeft;
    measurePre.style.paddingRight = cs.paddingRight;
    // A trailing space keeps a non-empty box so the caret column is reachable.
    measurePre.textContent = (text || "") + " ";
    return measurePre.offsetWidth;
  }

  function sizeEditor() {
    if (maximized) return; // editor is hidden; nothing to size
    const wrap = editor.parentElement; // .editor-wrap
    const wrapW = wrap.clientWidth;
    if (!wrapW) return;
    const gutterW = gutter.offsetWidth;
    // A few px of slack for the caret and a possible vertical scrollbar.
    const ideal = measureTextWidth(input.value) + gutterW + 4;
    // Keep the editor usable, but never let it crowd the preview out.
    const min = Math.min(360, wrapW * 0.3);
    const max = wrapW * 0.6;
    editor.style.width = Math.round(Math.max(min, Math.min(ideal, max))) + "px";
  }

  // ---------- Sessions ----------
  // The active session's content is autosaved on every (debounced) edit. The
  // select, New/Rename/Delete buttons switch and manage named documents stored
  // by sessions.js.

  let activeId = null;

  // Rebuild the <select> from the stored sessions, keeping the active one shown.
  function refreshSessionSelect() {
    sessionSelect.innerHTML = "";
    for (const s of Sessions.list()) {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      if (s.id === activeId) opt.selected = true;
      sessionSelect.appendChild(opt);
    }
  }

  // Open a session: make it active, load its text, validate, refresh the select.
  function loadSession(id) {
    const s = Sessions.get(id);
    if (!s) return;
    activeId = s.id;
    Sessions.setActiveId(s.id);
    input.value = s.content;
    setMaximized(false); // fullscreen is transient — reset on session switch
    refreshSessionSelect();
    validate();
  }

  // Persist the current editor text into the active session.
  function saveActive() {
    if (activeId) Sessions.update(activeId, input.value);
  }

  sessionSelect.addEventListener("change", () => loadSession(sessionSelect.value));

  newSessionBtn.addEventListener("click", () => {
    const name = window.prompt("Name for the new session:", "Untitled");
    if (name === null) return; // cancelled
    const s = Sessions.create(name, '{\n  "slices": []\n}');
    loadSession(s.id);
    input.focus();
  });

  renameSessionBtn.addEventListener("click", () => {
    const current = Sessions.get(activeId);
    if (!current) return;
    const name = window.prompt("Rename session:", current.name);
    if (name === null || name.trim() === "") return;
    Sessions.rename(activeId, name);
    refreshSessionSelect();
  });

  deleteSessionBtn.addEventListener("click", () => {
    const current = Sessions.get(activeId);
    if (!current) return;
    if (!window.confirm(`Delete session "${current.name}"? This cannot be undone.`)) return;
    Sessions.remove(activeId);
    // Always keep at least one session open.
    const next = Sessions.ensureDefault();
    loadSession(next.id);
  });

  // ---------- Wiring ----------

  let debounce;
  function scheduleValidate() {
    clearTimeout(debounce);
    debounce = setTimeout(() => { saveActive(); validate(); }, 150);
  }

  input.addEventListener("input", () => {
    renderGutter(input.value, new Set()); // keep gutter in step while typing
    sizeEditor(); // refit the pane as the longest line changes
    scheduleValidate();
  });

  // Refit on viewport changes (the min/max clamps are relative to the wrap width).
  window.addEventListener("resize", sizeEditor);
  input.addEventListener("scroll", syncScroll);

  // Tab inserts two spaces instead of moving focus.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = input.selectionStart, en = input.selectionEnd;
      input.value = input.value.slice(0, s) + "  " + input.value.slice(en);
      input.selectionStart = input.selectionEnd = s + 2;
      scheduleValidate();
    }
    // Ctrl/Cmd+S formats instead of saving the page.
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      format();
    }
  });

  function format() {
    try {
      const obj = JSON.parse(input.value);
      input.value = JSON.stringify(obj, null, 2);
      validate();
    } catch (_) {
      validate(); // surface the parse error; nothing to format
    }
  }

  // Theme toggle cycles light -> dark -> system; the label reflects the choice.
  // Theme.onChange fires immediately so the button is labelled correctly on load.
  const THEME_LABELS = {
    light: "☀️ Light",
    dark: "🌙 Dark",
    system: "🖥️ System",
  };
  if (window.Theme) {
    Theme.onChange((mode) => {
      const label = THEME_LABELS[mode] || THEME_LABELS.system;
      themeToggle.textContent = label;
      themeToggle.title = "Theme: " + label + " · click to cycle";
      themeToggle.setAttribute("aria-label", "Theme: " + label);
    });
    themeToggle.addEventListener("click", () => Theme.cycle());
  }

  formatBtn.addEventListener("click", format);
  downloadBtn.addEventListener("click", downloadActive);
  clearBtn.addEventListener("click", () => {
    input.value = "";
    input.focus();
    saveActive();
    validate();
  });

  // Open the active session (creating a seeded default on first run).
  const active = Sessions.ensureDefault();
  activeId = active.id;
  input.value = active.content;
  refreshSessionSelect();
  validate();
  input.focus();
})();
