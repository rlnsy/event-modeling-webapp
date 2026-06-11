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
  const themeToggle = document.getElementById("themeToggle");
  const sessionSelect = document.getElementById("sessionSelect");
  const newSessionBtn = document.getElementById("newSessionBtn");
  const renameSessionBtn = document.getElementById("renameSessionBtn");
  const deleteSessionBtn = document.getElementById("deleteSessionBtn");
  const preview = document.getElementById("preview");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const modalClose = document.getElementById("modalClose");

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
  function fieldLine(f) {
    const li = document.createElement("li");
    if (!f || typeof f !== "object") {
      li.textContent = "?";
      return li;
    }
    const name = document.createElement("span");
    name.className = "f-name";
    name.textContent = f.name != null ? String(f.name) : "?";
    li.appendChild(name);

    if (f.type != null) {
      const ty = document.createElement("span");
      ty.className = "f-type";
      ty.textContent = String(f.type);
      li.appendChild(ty);
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
      li.appendChild(b);
    }

    const ex = exampleText(f.example);
    if (ex != null) {
      const e = document.createElement("span");
      e.className = "f-ex";
      e.textContent = "= " + ex;
      li.appendChild(e);
    }
    return li;
  }

  function fieldList(fields) {
    const ul = document.createElement("ul");
    ul.className = "card-fields";
    for (const f of asArray(fields)) ul.appendChild(fieldLine(f));
    return ul;
  }

  // Wrap a fully-built card so clicking (or Enter/Space) opens the detail modal.
  function makeCard(type, title, body, item, isAuth) {
    const card = document.createElement("div");
    card.className = "card type-" + type + (isAuth ? " auth" : "");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const t = document.createElement("div");
    t.className = "card-title";
    t.textContent = title != null && title !== "" ? String(title) : "(untitled)";
    card.appendChild(t);
    if (body) card.appendChild(body);
    const open = () => openDetail(type, item);
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

  function cardFor(type, item) {
    if (type === "actor") {
      return makeCard("actor", item && item.name, null, item, !!(item && item.authRequired));
    }
    if (type === "screenimage") {
      return makeCard("screenimage", item && item.title, item ? screenImageBody(item) : null, item);
    }
    if (type === "specification") {
      return makeCard("specification", item && item.title, item ? specBody(item) : null, item);
    }
    return makeCard(type, item && item.title, item ? fieldList(item.fields) : null, item);
  }

  // An image embedded inside a screen card. Clicking it opens the image's own
  // detail (it's slice-level data, not part of the screen element), so we stop
  // the click from bubbling up to the screen card's handler.
  function embeddedImage(im) {
    const wrap = document.createElement("div");
    wrap.className = "screen-img-wrap";
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "button");
    wrap.appendChild(screenImageBody(im));
    const open = (e) => { e.stopPropagation(); openDetail("screenimage", im); };
    wrap.addEventListener("click", open);
    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); }
    });
    return wrap;
  }

  // A screen card: title, fields, then any slice screen images beneath them.
  function screenCard(screen, images) {
    const body = document.createDocumentFragment();
    body.appendChild(fieldList(asArray(screen && screen.fields)));
    for (const im of asArray(images)) body.appendChild(embeddedImage(im));
    return makeCard("screen", screen && screen.title, body, screen);
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

  function openDetail(type, item) {
    const name = item && (item.title || item.name || item.id);
    modalTitle.textContent = (name ? String(name) : "(untitled)") +
      "  ·  " + (TYPE_LABELS[type] || type);
    modalBody.innerHTML = "";
    modalBody.appendChild(renderValue(item == null ? {} : item));
    modalBackdrop.hidden = false;
  }

  function closeDetail() {
    modalBackdrop.hidden = true;
  }

  modalClose.addEventListener("click", closeDetail);
  modalBackdrop.addEventListener("click", (e) => {
    if (e.target === modalBackdrop) closeDetail();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalBackdrop.hidden) closeDetail();
  });

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

  // Resolve a slice in `model` by id, falling back to its array position.
  function findSlice(model, sliceId, sliceIdx) {
    const slices = Array.isArray(model.slices) ? model.slices : [];
    return slices.find((s) => s && sliceId != null && s.id === sliceId) || slices[sliceIdx];
  }

  // Non-generated fields from every event in the slice, deduped by name. These
  // seed the "copy fields from event" button when adding a command.
  function eventFieldsOf(slice) {
    const out = [];
    const seen = new Set();
    if (!slice) return out;
    for (const ev of (Array.isArray(slice.events) ? slice.events : [])) {
      for (const f of (ev && Array.isArray(ev.fields) ? ev.fields : [])) {
        if (f && f.name && !f.generated && !seen.has(f.name)) {
          seen.add(f.name);
          out.push(f);
        }
      }
    }
    return out;
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

    // Commands can pull their (non-generated) fields from the slice's event.
    let options = null;
    if (type === "command") {
      const fields = eventFieldsOf(findSlice(snapshot, sliceId, sliceIdx));
      if (fields.length) options = { copyFromFields: fields };
    }

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
          for (const sc of screens) { lane.appendChild(screenCard(sc, images)); count++; }
          // No screen to host them: show images on their own so they aren't lost.
          if (screens.length === 0) {
            for (const im of images) { lane.appendChild(cardFor("screenimage", im)); count++; }
          }
          for (const pr of asArray(slice.processors)) { lane.appendChild(cardFor("automation", pr)); count++; }
        } else {
          for (const key of laneDef.keys) {
            const type = (laneDef.typeFor && laneDef.typeFor[key]) || laneDef.type;
            for (const item of asArray(slice[key])) {
              lane.appendChild(cardFor(type, item));
              count++;
            }
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
      const loc = document.createElement("span");
      loc.className = "loc";
      loc.textContent = it.line ? `Ln ${it.line}, Col ${it.col}` : (it.path || "root");
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

  // ---------- Main validate cycle ----------

  function validate() {
    const text = input.value;
    const errorLines = new Set();

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

    // Parsed OK — refresh the preview best-effort, even if the schema is off.
    try {
      renderModel(parsed);
    } catch (_) {
      /* never let a render glitch break validation */
    }

    // Valid JSON. Always validate against the Event Modeling schema.
    const schemaErrors = [];
    validateSchema(parsed, window.EVENT_MODELING_SCHEMA, window.EVENT_MODELING_SCHEMA, "", schemaErrors);
    if (schemaErrors.length) {
      renderGutter(text, errorLines);
      renderHighlight(text, errorLines);
      setStatus("err", "Schema errors", `${schemaErrors.length} problem${schemaErrors.length > 1 ? "s" : ""}`);
      showProblems(schemaErrors.slice(0, 200).map((e) => ({ path: e.path || "(root)", msg: e.msg })));
      return;
    }

    renderGutter(text, errorLines);
    renderHighlight(text, errorLines);
    setStatus("ok", "Valid", "JSON + schema OK");
    showProblems([]);
  }

  // ---------- Scroll sync ----------

  function syncScroll() {
    highlight.scrollTop = input.scrollTop;
    highlight.scrollLeft = input.scrollLeft;
    gutter.scrollTop = input.scrollTop;
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
    scheduleValidate();
  });
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
