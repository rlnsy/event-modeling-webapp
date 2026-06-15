(function () {
  "use strict";

  const input = document.getElementById("input");
  const highlight = document.getElementById("highlight");
  const gutter = document.getElementById("gutter");
  const statusbar = document.getElementById("statusbar");
  const modelStatusText = document.getElementById("modelStatusText");
  const editorStatus = document.getElementById("editorStatus");
  const editorStatusText = document.getElementById("editorStatusText");
  const editorStatusMeta = document.getElementById("editorStatusMeta");
  const problems = document.getElementById("problems");
  const problemsList = document.getElementById("problemsList");
  const editorProblems = document.getElementById("editorProblems");
  const editorProblemsList = document.getElementById("editorProblemsList");
  const formatBtn = document.getElementById("formatBtn");
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

  // A field's identity for redundancy matching: name + type. Two fields with the
  // same name and type are considered the same field.
  function fieldSig(f) {
    return String(f.name) + " " + (f.type != null ? String(f.type) : "");
  }

  // When `redundant` (a Set of field signatures) is supplied, any field whose
  // signature is in it is marked `.f-redundant` so CSS can hide it — used by
  // events to suppress fields identical to ones already shown on the slice's
  // commands.
  function fieldList(fields, redundant) {
    const ul = document.createElement("ul");
    ul.className = "card-fields";
    for (const f of asArray(fields)) {
      const li = fieldLine(f);
      if (redundant && f && typeof f === "object" && f.name != null && redundant.has(fieldSig(f))) {
        li.classList.add("f-redundant");
      }
      ul.appendChild(li);
    }
    return ul;
  }

  // Emoji prefixed to a card's title to signal its element type at a glance.
  // Types not listed here (actor, screen, table, …) render their title plain.
  const TYPE_ICONS = {
    readmodel: "👁️",
    event: "💾",
    command: "📣",
    automation: "⚙️", // slice.processors render as the "automation" card type
    specification: "ℹ️",
  };

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
    // Anchor for flow lines: lets the SVG overlay locate this card by element id.
    if (item && item.id != null) card.dataset.elId = String(item.id);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    const t = document.createElement("div");
    t.className = "card-title";
    const titleText = title != null && title !== "" ? String(title) : "(untitled)";
    const icon = TYPE_ICONS[type];
    t.textContent = icon ? icon + " " + titleText : titleText;
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
  function screenImageBody(item, className) {
    if (!item || !item.url) {
      const note = document.createElement("div");
      note.className = "img-missing";
      note.textContent = "(no image url)";
      return note;
    }
    const img = document.createElement("img");
    img.className = className || "screen-img";
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

  function cardFor(type, item, ctx, opts) {
    if (type === "actor") {
      return makeCard("actor", item && item.name, null, item, !!(item && item.authRequired), ctx);
    }
    if (type === "screenimage") {
      return makeCard("screenimage", item && item.title, item ? screenImageBody(item) : null, item, false, ctx);
    }
    if (type === "specification") {
      return makeCard("specification", item && item.title, item ? specBody(item) : null, item, false, ctx);
    }
    // Top-level elements (processors/automations) omit their fields in the main
    // visualizer to save vertical space; the full field list still appears in
    // the detail modal and feeds the information-completeness check.
    const body = item && type !== "automation"
      ? fieldList(item.fields, opts && opts.redundant)
      : null;
    return makeCard(type, item && item.title, body, item, false, ctx);
  }

  // An image embedded inside a screen card. The screen and its image are one
  // concept, so the click isn't handled here — it bubbles up to the screen
  // card's handler, which opens the screen detail (where the image can be viewed
  // larger and its URL edited).
  function embeddedImage(im) {
    const wrap = document.createElement("div");
    wrap.className = "screen-img-wrap";
    wrap.appendChild(screenImageBody(im));
    return wrap;
  }

  // A screen card: a top-level element, so its fields are omitted from the main
  // visualizer (they remain in the detail modal and feed the IC check); just the
  // slice screen images render here. When a screen has image(s) but no
  // description, the screen and its image are one and the same — so the card's
  // own title and chrome drop away and only the image shows (clicking it still
  // opens the screen). A described screen keeps its card, with the image inside.
  // `ctx` locates the screen; clicking the card (or its image) opens it.
  function screenCard(screen, images, ctx) {
    const imgs = asArray(images);
    const collapse = imgs.length && !(screen && screen.description);
    const body = document.createDocumentFragment();
    imgs.forEach((im) => {
      body.appendChild(embeddedImage(im));
    });
    const title = collapse ? "" : (screen && screen.title);
    const card = makeCard("screen", title, body, screen, false, ctx);
    if (collapse) card.classList.add("no-title");
    return card;
  }

  // ---------- Detail modal ----------
  // Identifiers used purely to wire nodes together — element ids, id-based
  // references, and the trigger lists that point at command ids. They're
  // plumbing, not domain content, so we keep them out of the detail view.
  const LINK_ID_KEYS = new Set(["id", "linkedId", "triggers"]);

  // Recursively render any JSON value as a readable tree so the modal shows
  // every meaningful property of an element. Node-linking ids (see
  // LINK_ID_KEYS) are skipped so the model reads in domain terms.
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
      if (LINK_ID_KEYS.has(key)) continue;
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

  // The image section shown atop a screen's detail modal: each of the slice's
  // screen images rendered large enough to read, each with an Edit button, plus
  // an "+ Add image" button. Screen and image are one concept, so this is where
  // a screen's image URL is managed. Returns null when there's nothing to show
  // and no slice context to add into.
  function screenImagesSection(ctx) {
    if (!ctx) return null;
    const model = modelForEditing();
    const slice = model && findSlice(model, ctx.sliceId, ctx.sliceIdx);
    if (!slice) return null;
    const images = asArray(slice.screenImages);

    const section = document.createElement("div");
    section.className = "modal-screen-images";
    images.forEach((im, idx) => {
      const fig = document.createElement("div");
      fig.className = "modal-screen-image";
      fig.appendChild(screenImageBody(im, "modal-screen-img"));
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "btn-secondary modal-img-edit";
      editBtn.textContent = im && im.url ? "Edit image" : "Edit image URL";
      editBtn.addEventListener("click", () =>
        editComponent(makeCtx(ctx.sliceId, ctx.sliceIdx, "screenImages", im, idx)));
      fig.appendChild(editBtn);
      section.appendChild(fig);
    });

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn-secondary modal-img-add";
    addBtn.textContent = "+ Add image";
    addBtn.addEventListener("click", () => {
      closeDetail();
      startAdd("screenImage", ctx.sliceId, ctx.sliceIdx);
    });
    section.appendChild(addBtn);
    return section;
  }

  function openDetail(type, item, ctx) {
    detailCtx = ctx || null;
    const name = item && (item.title || item.name);
    modalTitle.textContent = (name ? String(name) : "(untitled)") +
      "  ·  " + (TYPE_LABELS[type] || type);
    modalBody.innerHTML = "";
    if (type === "screen") {
      const imgs = screenImagesSection(detailCtx);
      if (imgs) modalBody.appendChild(imgs);
    }
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

  // Signatures (name + type) of every field across the slice's commands. An
  // event field whose signature is in here merely echoes a command field, so
  // it's hidden on the event card (see fieldList's `redundant`).
  function commandFieldSigs(slice) {
    const set = new Set();
    for (const cmd of asArray(slice && slice.commands)) {
      for (const f of asArray(cmd && cmd.fields)) {
        if (f && typeof f === "object" && f.name != null) set.add(fieldSig(f));
      }
    }
    return set;
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
    const name = (item && (item.title || item.name)) || "this item";
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    arr.splice(idx, 1);
    commitModel(model);
    closeDetail();
  }

  // A per-slice "+ Add" disclosure menu listing every addable element type.
  // Uses a native <details> so no global open/close state is needed.
  // "Screen Image" is intentionally absent: a screen and its image are one
  // concept, so images are added/edited from within the screen detail modal.
  const SLICE_ADD_ITEMS = [
    ["command", "Command"], ["event", "Event"], ["readmodel", "Read Model"],
    ["screen", "Screen"], ["processor", "Processor"], ["actor", "Actor"],
    ["table", "Table"], ["specification", "Specification"],
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

  // ---------- Editor visibility ----------
  // The visualizer fills the full width by default; the JSON text editor stays
  // hidden until the user opts in via the edit toggle in the preview's top-left
  // corner. Transient view state — held in memory only, not persisted, and reset
  // to hidden on reload.

  let editorHidden = true;
  let editToggleBtn = null; // the pencil button in the most recently rendered toolbar
  const paneToggle = document.getElementById("paneToggle"); // collapse handle on the divider

  function svg(path) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>"
    );
  }

  // Pencil/edit icon for the toolbar toggle.
  const EDIT_ICON = svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>');
  // Chevrons for the divider handle: point in the direction the divider will move.
  const CHEVRON_LEFT = svg('<path d="m15 18-6-6 6-6"/>');
  const CHEVRON_RIGHT = svg('<path d="m9 18 6-6-6-6"/>');

  // Sync the pencil toolbar button to the current visibility.
  function updateEditToggleBtn() {
    if (!editToggleBtn) return;
    const label = editorHidden ? "Show editor" : "Hide editor";
    editToggleBtn.title = label;
    editToggleBtn.setAttribute("aria-label", label);
    editToggleBtn.setAttribute("aria-pressed", editorHidden ? "false" : "true");
    editToggleBtn.classList.toggle("active", !editorHidden);
  }

  // Sync the divider collapse handle: a right chevron invites expansion when the
  // editor is hidden; a left chevron collapses it back when visible.
  function updatePaneToggle() {
    if (!paneToggle) return;
    paneToggle.innerHTML = editorHidden ? CHEVRON_RIGHT : CHEVRON_LEFT;
    const label = editorHidden ? "Show editor" : "Hide editor";
    paneToggle.title = label;
    paneToggle.setAttribute("aria-label", label);
    paneToggle.setAttribute("aria-expanded", editorHidden ? "false" : "true");
  }

  function setEditorHidden(on) {
    editorHidden = !!on;
    document.body.classList.toggle("editor-hidden", editorHidden);
    updateEditToggleBtn();
    updatePaneToggle();
    if (!editorHidden) sizeEditor(); // editor is back; refit it to its text
    // Toggling the pane flips the .preview-row padding (see styles.css) without
    // changing the row's content-box, so the flow-line ResizeObserver never
    // fires — redraw the overlay explicitly so the arrows track the cards.
    drawFlowLines();
  }

  if (paneToggle) {
    paneToggle.addEventListener("click", () => setEditorHidden(!editorHidden));
  }

  // Full-width visualizer is the default view.
  document.body.classList.add("editor-hidden");
  updatePaneToggle();

  function renderModel(parsed) {
    preview.innerHTML = "";

    // Always offer a global "Add Slice" so an empty document can be bootstrapped.
    const toolbar = document.createElement("div");
    toolbar.className = "preview-toolbar";

    // Edit toggle pinned to the top-left corner: shows/hides the JSON editor.
    editToggleBtn = document.createElement("button");
    editToggleBtn.type = "button";
    editToggleBtn.className = "edit-toggle-btn";
    editToggleBtn.innerHTML = EDIT_ICON;
    editToggleBtn.addEventListener("click", () => setEditorHidden(!editorHidden));
    updateEditToggleBtn();
    toolbar.appendChild(editToggleBtn);

    const addSliceBtn = document.createElement("button");
    addSliceBtn.type = "button";
    addSliceBtn.className = "add-btn";
    addSliceBtn.textContent = "+ Add Slice";
    addSliceBtn.addEventListener("click", () => startAdd("slice", null, null));
    toolbar.appendChild(addSliceBtn);

    preview.appendChild(toolbar);

    const slices = parsed && Array.isArray(parsed.slices) ? parsed.slices : null;
    if (!slices || slices.length === 0) {
      lastOrdered = null;
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
      if (slice.status) {
        const status = document.createElement("span");
        status.className = "slice-status";
        status.textContent = String(slice.status);
        headMain.appendChild(status);
      }
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
            // Events hide fields identical to ones already on the slice's commands.
            const opts = type === "event" ? { redundant: commandFieldSigs(slice) } : null;
            asArray(slice[key]).forEach((item, idx) => {
              lane.appendChild(cardFor(type, item, makeCtx(slice.id, i, key, item, idx), opts));
              count++;
            });
          }
        }

        if (count > 0) col.appendChild(lane);
      }

      row.appendChild(col);
    });

    lastOrdered = ordered;
    preview.appendChild(row);
    if (flowObserver) { flowObserver.disconnect(); flowObserver.observe(row); }
    drawFlowLines();
  }

  // Editor-scoped bar: JSON syntax + schema errors. state "" hides the bar.
  function setEditorStatus(state, text, meta) {
    editorStatus.hidden = !state;
    editorStatus.className = "statusbar editor-status" + (state ? " " + state : "");
    editorStatusText.textContent = text || "";
    editorStatusMeta.textContent = meta || "";
  }

  // Single model-status indicator in the footer bottom-right.
  function setModelStatus(state, text) {
    statusbar.className = "statusbar" + (state ? " " + state : "");
    modelStatusText.textContent = text;
  }

  function renderProblems(sectionEl, listEl, items) {
    listEl.innerHTML = "";
    if (items.length === 0) {
      sectionEl.hidden = true;
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
      listEl.appendChild(li);
    }
    sectionEl.hidden = false;
  }

  // Editor-scoped list: JSON syntax + schema errors.
  function showEditorProblems(items) {
    renderProblems(editorProblems, editorProblemsList, items);
  }

  // Global list: information-completeness warnings only.
  function showProblems(items) {
    renderProblems(problems, problemsList, items);
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

  // ---------- Flow lines ----------
  // Thin directional arrows between dependent elements, derived from each
  // element's explicit `dependencies` (normalized to data-flow direction).
  // Drawn as an SVG overlay over the preview row; see drawFlowLines.

  const SVG_NS = "http://www.w3.org/2000/svg";

  // Index every id-bearing element by id, plus the display position of the
  // slice that owns it. `ordered` is orderedSlices()'s output, so positions
  // already respect each slice's `index`.
  function indexElements(ordered) {
    const byId = new Map();     // id -> element
    const slicePos = new Map(); // id -> display position of owning slice
    ordered.forEach(({ s }, pos) => {
      if (!s) return;
      for (const key of ["commands", "events", "readmodels", "screens", "processors"]) {
        for (const el of asArray(s[key])) {
          if (el && el.id != null) { byId.set(el.id, el); slicePos.set(el.id, pos); }
        }
      }
    });
    return { byId, slicePos };
  }

  // Intra-slice lane flow (data-flow direction). These connections are inferred
  // from the slice's *structure* — what elements sit in which lanes — because a
  // model often expresses screen->command->event flow by layout rather than by
  // declaring an explicit dependency on every hop. Read-model->event, by
  // contrast, is always declared, so it stays explicit-only (see below).
  const INTRA_FLOW = [
    ["screens", "commands"], ["processors", "commands"],
    ["commands", "events"], ["readmodels", "screens"],
  ];

  // Build the data-flow edges to draw, deduped (so an edge that is both implied
  // by structure and declared explicitly draws once):
  //   intra: screen->command, command->event, readmodel->screen  (same slice,
  //          from the slice's lane structure)
  //   cross: event->readmodel  (explicitly declared, event one slice to the
  //          left of the read model)
  function flowLineEdges(ordered) {
    const { byId, slicePos } = indexElements(ordered);
    const seen = new Set();
    const edges = [];
    const add = (from, to, kind) => {
      if (!from || !to || from.id == null || to.id == null || from.id === to.id) return;
      const k = from.id + ">" + to.id;
      if (seen.has(k)) return;
      seen.add(k);
      edges.push({ fromId: from.id, toId: to.id, kind });
    };

    // Intra-slice arrows from lane structure.
    ordered.forEach(({ s }) => {
      if (!s) return;
      for (const [fromKey, toKey] of INTRA_FLOW) {
        for (const from of asArray(s[fromKey])) {
          for (const to of asArray(s[toKey])) add(from, to, "intra");
        }
      }
    });

    // Cross-slice event->readmodel arrows from explicit dependencies, only when
    // the event sits in the slice immediately to the left of the read model.
    for (const el of byId.values()) {
      for (const dep of asArray(el.dependencies)) {
        if (!dep || dep.id == null) continue;
        const other = byId.get(dep.id);
        if (!other) continue;
        // Normalize to data-flow direction: source feeds target.
        let source, target;
        if (dep.type === "OUTBOUND") { source = el; target = other; }
        else if (dep.type === "INBOUND") { source = other; target = el; }
        else continue;
        if (source.type === "EVENT" && target.type === "READMODEL" &&
            slicePos.get(source.id) === slicePos.get(target.id) - 1) {
          add(source, target, "cross");
        }
      }
    }
    return edges;
  }

  // The slice ordering from the most recent renderModel, so redraws (observer /
  // resize) can rebuild the overlay without re-parsing. null when nothing is
  // rendered (empty/invalid document).
  let lastOrdered = null;

  // Redraws the overlay when the row's size changes (field toggles, lazy image
  // loads). Created at init, retargeted at the end of each renderModel.
  let flowObserver = null;

  // Escape an id for use in a CSS attribute selector.
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(String(s));
    return String(s).replace(/["\\\]]/g, "\\$&");
  }

  // Each *Path returns { d, tip, dir }: the SVG path data, the consumer-end point
  // the arrowhead sits at, and the unit vector of the line's tangent there. The
  // arrowhead is drawn explicitly from `dir` (not an SVG marker), so it always
  // lines up with the curve regardless of browser marker-orient behavior. Boxes
  // are { x, y, w, h, cx, cy } in the row's content coordinate space.

  // Intra-slice edge: two cards stacked in the same column a short gap apart.
  // The line bows out to the left (into the gutter, against the empty background
  // where a thin line reads clearly) and then comes straight back in along the
  // vertical — entering the target's top/bottom edge dead vertical, so the
  // arrowhead points straight down (or up) and lines up with the approach.
  // A clean straight vertical connector between two cards stacked in the same
  // column: source edge center to target edge center. Spans exactly the gap
  // between them, so it never overshoots into either card.
  function intraPath(a, b) {
    const down = b.cy >= a.cy; // target below source
    const p = { x: a.cx, y: down ? a.y + a.h : a.y };
    const q = { x: b.cx, y: down ? b.y : b.y + b.h };
    const d = "M" + p.x + "," + p.y + " L" + q.x + "," + q.y;
    return { d, tip: q, dir: { x: 0, y: down ? 1 : -1 } };
  }

  // Cross-slice event -> read-model edge. Always enters the bottom of the read
  // model on a dead-vertical final segment, so the upward arrowhead is guaranteed
  // to line up. The shape depends on the event's position relative to the read
  // model:
  //   - event at/above the read model: a straight-sided U out of the event's
  //     bottom, down to a baseline below both cards, and straight up.
  //   - event clearly below the read model (the usual case — events sit a lane
  //     lower): a right-angle corner — straight out of the event's right side,
  //     then 90° straight up into the read model. Only used when the event sits
  //     far enough below for a clean rise; when they're near the same level the
  //     corner would be mashed, so it falls back to the U.
  const CROSS_DIP = 40;      // px the U's baseline sits below the lower card
  const CROSS_MIN_RISE = 28; // min vertical room below the read model for a corner
  function crossPath(a, b) {
    const q = { x: b.cx, y: b.y + b.h }; // enter read model from below, head up
    let d;
    if (a.cy - q.y >= CROSS_MIN_RISE) {
      const p = { x: a.x + a.w, y: a.cy }; // exit the event's right side
      d = "M" + p.x + "," + p.y +
        " L" + q.x + "," + p.y +
        " L" + q.x + "," + q.y;
    } else {
      const p = { x: a.cx, y: a.y + a.h }; // exit the event's bottom
      const baseY = Math.max(a.y + a.h, b.y + b.h) + CROSS_DIP;
      d = "M" + p.x + "," + p.y +
        " L" + p.x + "," + baseY +
        " L" + q.x + "," + baseY +
        " L" + q.x + "," + q.y;
    }
    return { d, tip: q, dir: { x: 0, y: -1 } };
  }

  // Draw a small filled triangle arrowhead at `tip`, pointing along unit `dir`.
  const HEAD_LEN = 10, HEAD_HALF = 3.5;
  function drawArrowHead(svg, tip, dir) {
    const bx = tip.x - dir.x * HEAD_LEN, by = tip.y - dir.y * HEAD_LEN;
    const px = -dir.y, py = dir.x; // unit perpendicular
    const poly = document.createElementNS(SVG_NS, "polygon");
    poly.setAttribute("points",
      tip.x + "," + tip.y + " " +
      (bx + px * HEAD_HALF) + "," + (by + py * HEAD_HALF) + " " +
      (bx - px * HEAD_HALF) + "," + (by - py * HEAD_HALF));
    poly.setAttribute("class", "flow-arrowhead");
    svg.appendChild(poly);
  }

  // (Re)build the flow-line overlay over the current preview row. Safe to call
  // repeatedly; removes any prior overlay first. No-op when nothing is rendered.
  function drawFlowLines() {
    const row = preview.querySelector(".preview-row");
    if (!row || !lastOrdered) return;
    const prior = row.querySelector("svg.flow-lines");
    if (prior) prior.remove();

    const edges = flowLineEdges(lastOrdered);
    if (edges.length === 0) return;

    const rowRect = row.getBoundingClientRect();
    const W = row.scrollWidth, H = row.scrollHeight;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "flow-lines");
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);

    // A card's box in the row's content coordinate space. The row is not the
    // scrolling element (#preview is), so subtracting rowRect already accounts
    // for scroll — both rects move together.
    const boxOf = (id) => {
      const card = preview.querySelector('[data-el-id="' + cssEscape(id) + '"]');
      if (!card) return null;
      const r = card.getBoundingClientRect();
      const x = r.left - rowRect.left, y = r.top - rowRect.top;
      return { x, y, w: r.width, h: r.height, cx: x + r.width / 2, cy: y + r.height / 2 };
    };

    for (const { fromId, toId, kind } of edges) {
      const a = boxOf(fromId), b = boxOf(toId);
      if (!a || !b) continue;
      const shape = kind === "cross" ? crossPath(a, b) : intraPath(a, b);
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("class", "flow-line");
      path.setAttribute("d", shape.d);
      svg.appendChild(path);
      drawArrowHead(svg, shape.tip, shape.dir);
    }

    row.appendChild(svg);
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
      setEditorStatus("");
      setModelStatus("", "No model");
      renderGutter(text, errorLines);
      renderHighlight(text, errorLines);
      showEditorProblems([]);
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
      setEditorStatus("err", "Invalid JSON", `Ln ${line}, Col ${col}`);
      showEditorProblems([{ line, col, offset, msg: clean }]);
      setModelStatus("err", "Invalid JSON");
      showProblems([]);
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
      setEditorStatus("err", "Schema errors", `${schemaErrors.length} problem${schemaErrors.length > 1 ? "s" : ""}`);
      showEditorProblems(schemaErrors.slice(0, 200).map((e) => ({ path: e.path || "(root)", msg: e.msg })));
      setModelStatus("err", "Schema errors");
      showProblems([]);
      return;
    }

    // Schema-valid: no editor-level errors, so the editor bar is hidden.
    // Completeness warnings never block — the model is still valid and
    // saves/exports, so the Download button is enabled here.
    setEditorStatus("");
    showEditorProblems([]);
    setSchemaValid(true);
    if (completenessWarnings.length) {
      const n = completenessWarnings.length;
      setModelStatus("warn", `${n} completeness warning${n > 1 ? "s" : ""}`);
    } else {
      setModelStatus("ok", "Model complete");
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
    if (editorHidden) return; // editor is hidden; nothing to size
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
    updateTitle();
  }

  // Reflect the active session's name in the browser tab title.
  function updateTitle() {
    const active = Sessions.get(activeId);
    document.title = active ? active.name : "Event Modeling Tool";
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
    sizeEditor(); // refit the pane as the longest line changes
    scheduleValidate();
  });

  // Refit on viewport changes (the min/max clamps are relative to the wrap width).
  window.addEventListener("resize", sizeEditor);

  // Flow-line overlay redraws: when card sizes change (field toggles, lazy image
  // loads) and on window resize. The overlay is absolute + pointer-events:none,
  // so it never feeds back into the observed layout.
  if (window.ResizeObserver) {
    flowObserver = new ResizeObserver(() => drawFlowLines());
  }
  window.addEventListener("resize", drawFlowLines);
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

  // Open the active session (creating a seeded default on first run).
  const active = Sessions.ensureDefault();
  activeId = active.id;
  input.value = active.content;
  refreshSessionSelect();
  validate();
  input.focus();
})();
