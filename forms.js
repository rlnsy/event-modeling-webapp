// Add-component form modal. Self-contained module exposing `window.AddForms`.
// It owns *what* a component looks like — the per-type form fields and the
// builder that turns collected values into a schema-valid object. The host
// (app.js) decides *where* the new object goes and commits the mutated model.
//
// All option lists and required-field choices mirror eventmodeling.schema.json.
(function () {
  "use strict";

  // Enum sources (kept in sync with the schema's $defs).
  const SLICE_TYPES = ["STATE_CHANGE", "STATE_VIEW", "AUTOMATION"];
  const SLICE_STATUS = ["Created", "InProgress", "Done"];
  const FIELD_TYPES = [
    "String", "Boolean", "Double", "Decimal", "Long",
    "Custom", "Date", "DateTime", "UUID", "Int",
  ];
  const CARDINALITY = ["Single", "List"];

  // The five Element-backed cards share one form shape; only the resulting
  // `type` discriminator differs.
  const ELEMENT_TYPE = {
    command: "COMMAND",
    event: "EVENT",
    readmodel: "READMODEL",
    screen: "SCREEN",
    processor: "AUTOMATION",
  };

  const TYPE_TITLES = {
    slice: "Slice",
    command: "Command",
    event: "Event",
    readmodel: "Read Model",
    screen: "Screen",
    processor: "Processor",
    actor: "Actor",
    screenImage: "Screen Image",
    table: "Table",
    specification: "Specification",
  };

  // input kinds: "text" | "select" | "checkbox" | "fieldlist". `required` marks
  // a hard requirement; selects without `required` get a leading blank option.
  // A "fieldlist" renders the repeatable Field editor.
  const FIELDLIST = { key: "fields", kind: "fieldlist", label: "Fields" };
  const ELEMENT_BASE = [
    { key: "title", label: "Title", kind: "text", required: true },
    { key: "description", label: "Description", kind: "text" },
  ];

  const SPECS = {
    slice: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "sliceType", label: "Slice type", kind: "select", options: SLICE_TYPES, required: true },
      { key: "status", label: "Status", kind: "select", options: SLICE_STATUS, placeholder: "(none)" },
      { key: "context", label: "Context", kind: "text" },
    ],
    command: [...ELEMENT_BASE, FIELDLIST],
    event: [...ELEMENT_BASE, FIELDLIST],
    readmodel: [
      ...ELEMENT_BASE,
      { key: "listElement", label: "List read model", kind: "checkbox" },
      FIELDLIST,
    ],
    screen: [...ELEMENT_BASE, FIELDLIST],
    processor: [...ELEMENT_BASE, FIELDLIST],
    actor: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "authRequired", label: "Auth required", kind: "checkbox" },
    ],
    screenImage: [
      { key: "title", label: "Title", kind: "text", required: true },
      { key: "url", label: "Image URL", kind: "text" },
    ],
    table: [
      { key: "title", label: "Title", kind: "text", required: true },
      FIELDLIST,
    ],
    specification: [
      { key: "title", label: "Title", kind: "text", required: true },
    ],
  };

  // Mirrors the id generator in sessions.js.
  function genId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  // Turn collected form values into a fully schema-valid object. Required-but-
  // empty collections (spec steps) start empty and are refined by hand in the
  // editor; `fields` comes from the inline field editor and `dependencies` from
  // the read-model dependency editor (empty for other element types).
  function build(type, v) {
    if (type === "slice") {
      const o = {
        id: genId(),
        title: v.title,
        sliceType: v.sliceType,
        commands: [], events: [], readmodels: [], screens: [],
        processors: [], tables: [], specifications: [],
      };
      if (v.status) o.status = v.status;
      if (v.context) o.context = v.context;
      return o;
    }
    if (ELEMENT_TYPE[type]) {
      const o = {
        id: genId(),
        title: v.title,
        type: ELEMENT_TYPE[type],
        fields: Array.isArray(v.fields) ? v.fields : [],
        dependencies: Array.isArray(v.dependencies) ? v.dependencies : [],
      };
      if (v.description) o.description = v.description;
      if (v.listElement) o.listElement = true;
      return o;
    }
    if (type === "actor") {
      return { name: v.name, authRequired: !!v.authRequired };
    }
    if (type === "screenImage") {
      const o = { id: genId(), title: v.title };
      if (v.url) o.url = v.url;
      return o;
    }
    if (type === "table") {
      return { id: genId(), title: v.title, fields: Array.isArray(v.fields) ? v.fields : [] };
    }
    if (type === "specification") {
      const o = {
        id: genId(),
        title: v.title,
        given: Array.isArray(v.given) ? v.given : [],
        when: Array.isArray(v.when) ? v.when : [],
        then: Array.isArray(v.then) ? v.then : [],
        linkedId: v.linkedId || "",
      };
      if (Array.isArray(v.comments) && v.comments.length) o.comments = v.comments;
      return o;
    }
    return null;
  }

  // Apply collected form values onto an existing object for an edit. Clones the
  // original and overwrites only the keys the form manages, so the object's id,
  // child arrays, and any properties the form doesn't expose are preserved.
  function applyEdit(type, initial, v) {
    const o = { ...initial };
    if (type === "slice") {
      o.title = v.title;
      o.sliceType = v.sliceType;
      setOrDelete(o, "status", v.status);
      setOrDelete(o, "context", v.context);
      return o;
    }
    if (ELEMENT_TYPE[type]) {
      o.title = v.title;
      o.fields = Array.isArray(v.fields) ? v.fields : [];
      setOrDelete(o, "description", v.description);
      if (type === "readmodel") {
        // The dependency editor is the source of truth for a read model's
        // dependencies — but only when it was rendered (it needs model-wide
        // events). When absent, leave the existing dependencies untouched rather
        // than wiping them. Other element types keep theirs untouched too.
        if ("dependencies" in v) {
          o.dependencies = Array.isArray(v.dependencies) ? v.dependencies : [];
        }
        setOrDelete(o, "listElement", v.listElement);
      }
      return o;
    }
    if (type === "actor") {
      o.name = v.name;
      o.authRequired = !!v.authRequired;
      return o;
    }
    if (type === "screenImage") {
      o.title = v.title;
      setOrDelete(o, "url", v.url);
      return o;
    }
    if (type === "table") {
      o.title = v.title;
      o.fields = Array.isArray(v.fields) ? v.fields : [];
      return o;
    }
    if (type === "specification") {
      o.title = v.title;
      o.given = Array.isArray(v.given) ? v.given : [];
      o.when = Array.isArray(v.when) ? v.when : [];
      o.then = Array.isArray(v.then) ? v.then : [];
      o.linkedId = v.linkedId || o.linkedId || "";
      if (Array.isArray(v.comments) && v.comments.length) o.comments = v.comments;
      else delete o.comments;
      return o;
    }
    return o;
  }

  // ---------- Field editor (repeatable rows) ----------

  function selectEl(options) {
    const sel = document.createElement("select");
    sel.className = "form-input";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    }
    return sel;
  }

  // A labelled checkbox shown compactly inside a field row.
  function flagToggle(label, title) {
    const wrap = document.createElement("label");
    wrap.className = "field-flag";
    wrap.title = title;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(label));
    return { wrap, cb };
  }

  // Append one field row to `rowsEl`, tracking it in `rows` so submit can read
  // it and the row's × button can remove it. `showGenerated` adds the "gen"
  // toggle, which only makes sense for event fields (system-produced values).
  // `initial` pre-populates the row (used when copying fields from an event).
  //
  // A `Custom` field models a nested object: the row reveals an indented,
  // collapsible "+ subfield" area whose rows are produced by recursing into this
  // same function, so subfields nest arbitrarily deep. Switching the type away
  // from Custom hides (but keeps) the child rows so toggling back restores them.
  function addFieldRow(rowsEl, rows, showGenerated, initial) {
    // Wrapper stacks the input row above its nested subfield area.
    const item = document.createElement("div");
    item.className = "field-item";

    const row = document.createElement("div");
    row.className = "field-row";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "field-toggle";
    toggle.title = "Collapse/expand subfields";
    toggle.textContent = "▾";

    const name = document.createElement("input");
    name.type = "text";
    name.className = "form-input field-name";
    name.placeholder = "name";

    const mapping = document.createElement("input");
    mapping.type = "text";
    mapping.className = "form-input field-mapping";
    mapping.placeholder = "source";
    mapping.title = "Upstream source field or path";

    const type = selectEl(FIELD_TYPES);
    type.classList.add("field-type");

    const card = selectEl(CARDINALITY);
    card.classList.add("field-card");
    card.title = "Cardinality";

    const computed = flagToggle("computed", "Computed from source fields; allows a different type");
    const opt = flagToggle("opt", "Optional");
    const idf = flagToggle("id", "ID attribute");
    const gen = showGenerated ? flagToggle("gen", "Generated by the system") : null;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "field-remove";
    remove.title = "Remove field";
    remove.textContent = "×";

    row.append(toggle, name, mapping, type, card, computed.wrap, opt.wrap, idf.wrap);
    if (gen) row.append(gen.wrap);
    row.append(remove);

    // Nested subfield area (only meaningful for Custom fields).
    const sub = document.createElement("div");
    sub.className = "field-subrows";
    const subRowsEl = document.createElement("div");
    subRowsEl.className = "field-rows";
    const childRows = [];
    const addSub = document.createElement("button");
    addSub.type = "button";
    addSub.className = "add-field-btn add-subfield-btn";
    addSub.textContent = "+ subfield";
    addSub.addEventListener("click", () =>
      addFieldRow(subRowsEl, childRows, showGenerated)
    );
    sub.append(subRowsEl, addSub);

    item.append(row, sub);

    // Show the toggle + subfield area only when the type is Custom.
    function syncCustom() {
      item.classList.toggle("has-sub", type.value === "Custom");
    }
    type.addEventListener("change", syncCustom);
    toggle.addEventListener("click", () => {
      const collapsed = item.classList.toggle("collapsed");
      toggle.textContent = collapsed ? "▸" : "▾";
    });

    const entry = {
      el: item,
      // Child field rows, read recursively by collectFields for Custom fields.
      childRows,
      // The field this row was seeded from (edit/copy), so collectFields can
      // preserve attributes the editor doesn't expose (example, mapping, …).
      source: initial || null,
      read: () => ({
        name: name.value.trim(),
        mapping: mapping.value.trim(),
        type: type.value,
        cardinality: card.value,
        computed: computed.cb.checked,
        optional: opt.cb.checked,
        idAttribute: idf.cb.checked,
        generated: gen ? gen.cb.checked : false,
      }),
    };
    remove.addEventListener("click", () => {
      const i = rows.indexOf(entry);
      if (i >= 0) rows.splice(i, 1);
      item.remove();
    });

    if (initial) {
      if (initial.name) name.value = initial.name;
      if (initial.mapping) mapping.value = initial.mapping;
      if (initial.type) type.value = initial.type;
      if (initial.cardinality) card.value = initial.cardinality;
      computed.cb.checked = initial.computed === true;
      opt.cb.checked = !!initial.optional;
      idf.cb.checked = !!initial.idAttribute;
      if (gen) gen.cb.checked = !!initial.generated;
      // Rebuild nested subfields so the editor reconstructs nested data on open.
      if (Array.isArray(initial.subfields)) {
        for (const sf of initial.subfields) {
          addFieldRow(subRowsEl, childRows, showGenerated, sf);
        }
      }
    }
    syncCustom();

    rows.push(entry);
    rowsEl.appendChild(item);
    if (!initial) name.focus();
  }

  // Set `o[key]` to `val` when truthy, otherwise remove the key. Keeps edited
  // objects clean (an unchecked flag disappears rather than becoming `false`).
  function setOrDelete(o, key, val) {
    if (val) o[key] = val;
    else delete o[key];
  }

  // Gather field rows into schema-valid Field objects, dropping nameless rows
  // and omitting attributes left at their defaults to keep the JSON clean. When
  // a row was seeded from an existing field (`source`), the managed values are
  // merged onto a clone of it so unmanaged attributes (example,
  // technicalAttribute, schema) survive the round-trip. Recurses into a row's
  // child rows for Custom fields to build their `subfields`.
  function collectFields(rows) {
    return rows
      .map((r) => ({ v: r.read(), source: r.source, childRows: r.childRows }))
      .filter((r) => r.v.name !== "")
      .map(({ v, source, childRows }) => {
        const f = source ? { ...source } : {};
        f.name = v.name;
        setOrDelete(f, "mapping", v.mapping);
        f.type = v.type;
        setOrDelete(f, "computed", v.computed);
        setOrDelete(f, "optional", v.optional);
        setOrDelete(f, "idAttribute", v.idAttribute);
        setOrDelete(f, "generated", v.generated);
        setOrDelete(f, "cardinality", v.cardinality === "List" ? "List" : null);
        // Subfields are editor-managed for Custom fields only; for other types
        // any subfields on `source` ride along untouched via the clone above.
        if (v.type === "Custom") {
          const subs = collectFields(childRows || []);
          if (subs.length) f.subfields = subs;
          else delete f.subfields;
        }
        return f;
      });
  }

  // ---------- Dependency editor (read models) ----------

  // Seed the field editor from `ev`'s fields, reusing addFieldRow. Skips
  // generated fields and names already present, so it's safe to click twice.
  function copyEventFields(ev, fieldEditor) {
    if (!fieldEditor) return;
    const present = new Set(fieldEditor.rows.map((r) => r.read().name).filter(Boolean));
    for (const f of (ev && Array.isArray(ev.fields) ? ev.fields : [])) {
      if (!f || !f.name || f.generated || present.has(f.name)) continue;
      fieldEditor.addRow(f);
      present.add(f.name);
    }
  }

  // Build the "Dependencies" section for a read model: an "Add dependency"
  // button reveals a scrollable list of every event in the model. Selecting one
  // adds a row contributing { id, type: "INBOUND", title, elementType: "EVENT" }
  // and exposing a per-row "Copy fields" button that seeds the field editor from
  // that specific event. When editing, `initialDeps` pre-populates the rows.
  // Returns { section, read } where read() yields the Dependency objects in row
  // order.
  function buildDependencySection(events, fieldEditor, initialDeps) {
    const depRows = [];
    const eventById = new Map(events.map((ev) => [ev.id, ev]));

    const section = document.createElement("div");
    section.className = "form-row field-section";
    const lbl = document.createElement("span");
    lbl.className = "form-label";
    lbl.textContent = "Dependencies";
    section.appendChild(lbl);

    const rowsEl = document.createElement("div");
    rowsEl.className = "dep-rows";
    section.appendChild(rowsEl);

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "add-field-btn";
    addBtn.textContent = "+ Add dependency";
    section.appendChild(addBtn);

    // Hidden until the button is clicked; one button per model-wide event.
    const selector = document.createElement("div");
    selector.className = "dep-selector";
    selector.hidden = true;
    addBtn.addEventListener("click", () => { selector.hidden = !selector.hidden; });

    // Add a row for a dependency object. The matching event (looked up by id) is
    // used for the "Copy fields" button; if it isn't in the model, the row still
    // renders from the stored title and Copy is omitted.
    function addDepRow(dep) {
      const ev = eventById.get(dep.id) || null;

      const row = document.createElement("div");
      row.className = "dep-row";

      const name = document.createElement("span");
      name.className = "dep-name";
      name.textContent = dep.title || (ev && ev.title) || dep.id;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "field-remove";
      remove.title = "Remove dependency";
      remove.textContent = "×";

      if (ev) {
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "add-field-btn";
        copyBtn.textContent = "Copy fields";
        copyBtn.addEventListener("click", () => copyEventFields(ev, fieldEditor));
        row.append(name, copyBtn, remove);
      } else {
        row.append(name, remove);
      }

      const entry = { el: row, dep };
      remove.addEventListener("click", () => {
        const i = depRows.indexOf(entry);
        if (i >= 0) depRows.splice(i, 1);
        row.remove();
      });

      depRows.push(entry);
      rowsEl.appendChild(row);
    }

    for (const ev of events) {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "dep-option";
      opt.textContent = ev.title || ev.id;
      opt.addEventListener("click", () => {
        addDepRow({ id: ev.id, type: "INBOUND", title: ev.title || "", elementType: "EVENT" });
        selector.hidden = true;
      });
      selector.appendChild(opt);
    }
    section.appendChild(selector);

    // Seed existing dependencies when editing.
    for (const dep of (Array.isArray(initialDeps) ? initialDeps : [])) {
      if (dep && dep.id != null) addDepRow(dep);
    }

    return { section, read: () => depRows.map((r) => r.dep) };
  }

  // ---------- Specification editor (GWT) ----------

  const SPEC_STEP_TYPE = {
    COMMAND: "SPEC_COMMAND",
    EVENT: "SPEC_EVENT",
    READMODEL: "SPEC_READMODEL",
  };

  function cloneJson(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  function fieldExampleText(value) {
    if (value == null) return "";
    return typeof value === "object" ? JSON.stringify(value) : String(value);
  }

  function parseFieldExample(text) {
    const v = text.trim();
    if (!v) return null;
    if (v[0] === "{") {
      try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch (_) {
        // Fall through to string storage; schema allows string examples.
      }
    }
    return v;
  }

  function commentText(comments) {
    return (Array.isArray(comments) ? comments : [])
      .map((c) => c && c.description != null ? String(c.description).trim() : "")
      .filter(Boolean)
      .join("\n\n");
  }

  function commentsFromText(text) {
    const value = String(text || "").trim();
    return value ? [{ description: value }] : [];
  }

  function optionLabel(opt) {
    return opt.title + " (" + opt.kind + ")";
  }

  function addSpecFieldRow(rowsEl, rows, initial) {
    const source = initial ? cloneJson(initial) : {};
    const row = document.createElement("div");
    row.className = "spec-field-row";

    const name = document.createElement("input");
    name.type = "text";
    name.className = "form-input spec-field-name";
    name.placeholder = "field";

    const type = selectEl(FIELD_TYPES);
    type.classList.add("spec-field-type");

    const example = document.createElement("input");
    example.type = "text";
    example.className = "form-input spec-field-example";
    example.placeholder = "example";

    const genUuid = document.createElement("button");
    genUuid.type = "button";
    genUuid.className = "spec-example-btn";
    genUuid.title = "Generate UUID example";
    genUuid.textContent = "ID";
    genUuid.addEventListener("click", () => {
      example.value = genId();
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "field-remove";
    remove.title = "Remove field";
    remove.textContent = "×";

    const computed = flagToggle("computed", "Computed from source fields; allows a different type");
    computed.cb.checked = source.computed === true;
    row.append(name, type, computed.wrap, example, genUuid, remove);

    function syncUuidButton() {
      genUuid.hidden = type.value !== "UUID";
    }
    type.addEventListener("change", syncUuidButton);

    const entry = {
      el: row,
      source,
      read: () => {
        const out = { ...source };
        delete out.mapping;
        out.name = name.value.trim();
        out.type = type.value;
        setOrDelete(out, "computed", computed.cb.checked);
        const ex = parseFieldExample(example.value);
        if (ex == null) delete out.example;
        else out.example = ex;
        return out;
      },
    };

    remove.addEventListener("click", () => {
      const i = rows.indexOf(entry);
      if (i >= 0) rows.splice(i, 1);
      row.remove();
    });

    if (initial) {
      if (initial.name) name.value = initial.name;
      if (initial.type) type.value = initial.type;
      example.value = fieldExampleText(initial.example);
    }
    syncUuidButton();

    rows.push(entry);
    rowsEl.appendChild(row);
  }

  function collectSpecFields(rows) {
    return rows
      .map((r) => r.read())
      .filter((f) => f.name !== "");
  }

  function buildSpecEditor(initial, opts) {
    const section = document.createElement("div");
    section.className = "form-row spec-editor";

    const noteRow = document.createElement("label");
    noteRow.className = "form-row";
    const noteLabel = document.createElement("span");
    noteLabel.className = "form-label";
    noteLabel.textContent = "Description";
    const note = document.createElement("textarea");
    note.className = "form-input spec-notes";
    note.rows = 3;
    note.value = commentText(initial && initial.comments);
    noteRow.append(noteLabel, note);
    section.appendChild(noteRow);

    const linkable = Array.isArray(opts.specElements) ? opts.specElements : [];
    const byId = new Map(linkable.map((el) => [el.id, el]));
    const groups = {};

    function linkedForStep(step) {
      return step && step.linkedId ? byId.get(step.linkedId) : null;
    }

    function linkableForGroup(key) {
      if (key === "given") return linkable.filter((el) => el.kind === "EVENT");
      if (key === "when") return linkable.filter((el) => el.kind === "COMMAND");
      return linkable;
    }

    function addStepRow(key, initialStep) {
      const rows = groups[key].rows;
      const linked = linkedForStep(initialStep);
      const isThen = key === "then";
      const options = linkableForGroup(key);
      const source = initialStep ? cloneJson(initialStep) : {};
      const item = document.createElement("div");
      item.className = "spec-step-editor";

      const head = document.createElement("div");
      head.className = "spec-step-head";

      const select = selectEl(["", ...options.map((el) => el.id)]);
      select.classList.add("spec-step-select");
      select.options[0].textContent = options.length ? "Choose element" : "No matching elements";
      select.options[0].value = "";
      for (let i = 0; i < options.length; i++) {
        select.options[i + 1].textContent = optionLabel(options[i]);
      }
      if (linked && options.includes(linked)) {
        select.value = linked.id;
      }

      const errorToggle = document.createElement("label");
      errorToggle.className = "spec-error-toggle";
      const errorCheck = document.createElement("input");
      errorCheck.type = "checkbox";
      errorCheck.checked = !!(isThen && initialStep && initialStep.type === "SPEC_ERROR");
      errorToggle.append(errorCheck, document.createTextNode("expect error"));

      const title = document.createElement("input");
      title.type = "text";
      title.className = "form-input spec-step-title";
      title.placeholder = errorCheck.checked ? "Error title (optional)" : "Step title";
      title.value = initialStep && initialStep.title ? initialStep.title : "";

      const moveUp = document.createElement("button");
      moveUp.type = "button";
      moveUp.className = "spec-step-btn";
      moveUp.title = "Move step up";
      moveUp.textContent = "↑";

      const moveDown = document.createElement("button");
      moveDown.type = "button";
      moveDown.className = "spec-step-btn";
      moveDown.title = "Move step down";
      moveDown.textContent = "↓";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "field-remove";
      remove.title = "Remove step";
      remove.textContent = "×";

      if (isThen) head.append(errorToggle);
      head.append(select, title, moveUp, moveDown, remove);
      item.appendChild(head);

      const fieldsEl = document.createElement("div");
      fieldsEl.className = "spec-field-rows";
      item.appendChild(fieldsEl);
      const fieldRows = [];

      const fieldActions = document.createElement("div");
      fieldActions.className = "spec-field-actions";
      const addField = document.createElement("button");
      addField.type = "button";
      addField.className = "add-field-btn";
      addField.textContent = "+ field";
      addField.addEventListener("click", () => addSpecFieldRow(fieldsEl, fieldRows));
      fieldActions.appendChild(addField);
      item.appendChild(fieldActions);

      const entry = {
        el: item,
        source,
        fieldRows,
        read: () => {
          const selected = byId.get(select.value) || null;
          const expectError = isThen && errorCheck.checked;
          const out = { ...source };
          out.id = out.id || genId();
          out.title = title.value.trim() || (expectError ? "Expected error" : (selected && selected.title) || "");
          out.type = expectError ? "SPEC_ERROR" : (selected ? SPEC_STEP_TYPE[selected.kind] : out.type);
          if (expectError) {
            delete out.linkedId;
            delete out.fields;
            return out;
          }
          if (selected) out.linkedId = selected.id;
          else if (select.value || out.linkedId) out.linkedId = select.value || out.linkedId;
          else delete out.linkedId;
          const fields = collectSpecFields(fieldRows);
          if (fields.length) out.fields = fields;
          else delete out.fields;
          return out;
        },
      };

      function reseedFields(fields) {
        fieldRows.splice(0, fieldRows.length);
        fieldsEl.innerHTML = "";
        for (const f of (Array.isArray(fields) ? fields : [])) {
          if (f && f.name) addSpecFieldRow(fieldsEl, fieldRows, f);
        }
      }

      function syncErrorMode() {
        const on = isThen && errorCheck.checked;
        select.hidden = on;
        fieldsEl.hidden = on;
        fieldActions.hidden = on;
        title.placeholder = on ? "Error title (optional)" : "Step title";
        item.classList.toggle("is-error-step", on);
      }

      select.addEventListener("change", () => {
        const selected = byId.get(select.value);
        if (!selected) return;
        title.value = selected.title || "";
        reseedFields(selected.fields);
      });
      errorCheck.addEventListener("change", syncErrorMode);

      moveUp.addEventListener("click", () => {
        const i = rows.indexOf(entry);
        if (i <= 0) return;
        rows.splice(i, 1);
        rows.splice(i - 1, 0, entry);
        groups[key].rowsEl.insertBefore(item, groups[key].rowsEl.children[i - 1]);
      });
      moveDown.addEventListener("click", () => {
        const i = rows.indexOf(entry);
        if (i < 0 || i >= rows.length - 1) return;
        rows.splice(i, 1);
        rows.splice(i + 1, 0, entry);
        groups[key].rowsEl.insertBefore(groups[key].rowsEl.children[i + 1], item);
      });
      remove.addEventListener("click", () => {
        const i = rows.indexOf(entry);
        if (i >= 0) rows.splice(i, 1);
        item.remove();
      });

      rows.push(entry);
      groups[key].rowsEl.appendChild(item);
      reseedFields(initialStep && Array.isArray(initialStep.fields)
        ? initialStep.fields
        : (linked && linked.fields));
      syncErrorMode();
    }

    for (const [label, key] of [["Given", "given"], ["When", "when"], ["Then", "then"]]) {
      const group = document.createElement("div");
      group.className = "spec-gwt-group";
      const head = document.createElement("div");
      head.className = "spec-gwt-head";
      const lbl = document.createElement("span");
      lbl.className = "form-label";
      lbl.textContent = label;
      const add = document.createElement("button");
      add.type = "button";
      add.className = "add-field-btn";
      add.textContent = "+ Add " + label;
      head.append(lbl, add);
      const rowsEl = document.createElement("div");
      rowsEl.className = "spec-step-rows";
      group.append(head, rowsEl);
      section.appendChild(group);
      groups[key] = { rows: [], rowsEl };
      add.addEventListener("click", () => addStepRow(key));
      for (const step of (initial && Array.isArray(initial[key]) ? initial[key] : [])) {
        addStepRow(key, step);
      }
    }

    return {
      section,
      read: () => ({
        comments: commentsFromText(note.value),
        linkedId: opts.sliceId || (initial && initial.linkedId) || "",
        given: groups.given.rows.map((r) => r.read()).filter((s) => s.title && s.type),
        when: groups.when.rows.map((r) => r.read()).filter((s) => s.title && s.type),
        then: groups.then.rows.map((r) => r.read()).filter((s) => s.title && s.type),
      }),
    };
  }

  // A preview is display-only: image metadata stays with the original model.
  function imagePreview(image) {
    const wrap = document.createElement("div");
    wrap.className = "modal-screen-image";
    if (!image || !image.url) {
      wrap.textContent = "(no image url)";
      wrap.classList.add("img-missing");
      return wrap;
    }
    const img = document.createElement("img");
    img.className = "modal-screen-img";
    img.alt = image.title || "Screen image";
    img.addEventListener("error", () => {
      wrap.textContent = "(image unavailable)";
      wrap.classList.add("img-missing");
    });
    img.src = String(image.url);
    wrap.appendChild(img);
    return wrap;
  }

  // ---------- Modal controller ----------

  const backdrop = document.getElementById("formBackdrop");
  const form = document.getElementById("addForm");
  const titleEl = document.getElementById("formTitle");
  const bodyEl = document.getElementById("formBody");
  const errorEl = document.getElementById("formError");
  const closeBtn = document.getElementById("formClose");
  const cancelBtn = document.getElementById("formCancel");
  const submitBtn = document.getElementById("formSubmit");

  // Set while the modal is open; reads the inputs, validates, builds, and hands
  // the object to the caller's onSubmit.
  let submitHandler = null;

  function close() {
    backdrop.hidden = true;
    bodyEl.innerHTML = "";
    errorEl.textContent = "";
    submitHandler = null;
  }

  // Render the form for `type` and call onSubmit(builtObject) when accepted.
  // `options.copyFromFields` (an array of Field objects) adds a "copy fields"
  // button to the field editor that seeds rows from those fields;
  // `options.copyFromLabel` overrides that button's label (e.g. "Copy fields
  // from command"). `options.events` (an array of event objects) drives the
  // read-model dependency selector, letting the form attach INBOUND event
  // dependencies.
  function open(type, onSubmit, options) {
    const specs = SPECS[type];
    if (!specs) return;
    const opts = options || {};
    // When `opts.initial` is supplied the form runs in edit mode: inputs are
    // pre-populated and submit yields a merged object via applyEdit.
    const initial = opts.initial || null;
    const editing = !!initial;

    titleEl.textContent = (editing ? "Edit " : "Add ") + (TYPE_TITLES[type] || type);
    if (submitBtn) submitBtn.textContent = editing ? "Save" : "Add";
    bodyEl.innerHTML = "";
    errorEl.textContent = "";

    if (type === "screen" && editing && Array.isArray(opts.screenImages)) {
      const previews = document.createElement("div");
      previews.className = "modal-screen-images";
      for (const image of opts.screenImages) previews.appendChild(imagePreview(image));
      if (opts.screenImages.length) bodyEl.appendChild(previews);
    }

    // key -> () => value, so simple inputs and the field editor read uniformly.
    const readers = {};

    // Captured when the fieldlist spec is rendered, so the dependency editor can
    // seed the field rows from a chosen event.
    let fieldEditor = null;

    for (const spec of specs) {
      if (spec.kind === "fieldlist") {
        const section = document.createElement("div");
        section.className = "form-row field-section";
        const lbl = document.createElement("span");
        lbl.className = "form-label";
        lbl.textContent = spec.label;
        section.appendChild(lbl);

        const rowsEl = document.createElement("div");
        rowsEl.className = "field-rows";
        section.appendChild(rowsEl);

        const rows = [];
        const showGenerated = type === "event";
        fieldEditor = {
          rows,
          sectionEl: section,
          addRow: (f) => addFieldRow(rowsEl, rows, showGenerated, f),
        };

        const actions = document.createElement("div");
        actions.className = "field-actions";
        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "add-field-btn";
        addBtn.textContent = "+ Add field";
        addBtn.addEventListener("click", () => addFieldRow(rowsEl, rows, showGenerated));
        actions.appendChild(addBtn);

        // Copy fields seeded by the host (e.g. a command pulling its event's
        // fields). Skips names already present so it's safe to click twice.
        const copyFields = Array.isArray(opts.copyFromFields) ? opts.copyFromFields : [];
        if (copyFields.length) {
          const copyBtn = document.createElement("button");
          copyBtn.type = "button";
          copyBtn.className = "add-field-btn";
          copyBtn.textContent = opts.copyFromLabel || "Copy fields from event";
          copyBtn.addEventListener("click", () => {
            const present = new Set(rows.map((r) => r.read().name).filter(Boolean));
            for (const f of copyFields) {
              if (present.has(f.name)) continue;
              addFieldRow(rowsEl, rows, showGenerated, f);
              present.add(f.name);
            }
          });
          actions.appendChild(copyBtn);
        }
        section.appendChild(actions);

        readers[spec.key] = () => collectFields(rows);
        // Seed existing fields when editing.
        if (editing && Array.isArray(initial.fields)) {
          for (const f of initial.fields) addFieldRow(rowsEl, rows, showGenerated, f);
        }
        bodyEl.appendChild(section);
        continue;
      }

      const row = document.createElement("label");
      row.className = "form-row" + (spec.kind === "checkbox" ? " form-row-inline" : "");

      const lbl = document.createElement("span");
      lbl.className = "form-label";
      lbl.textContent = spec.label + (spec.required ? " *" : "");

      let el;
      if (spec.kind === "select") {
        el = selectEl(spec.required ? spec.options : [spec.placeholder || "(none)", ...spec.options]);
        if (!spec.required) el.options[0].value = ""; // blank leading option
      } else if (spec.kind === "checkbox") {
        el = document.createElement("input");
        el.type = "checkbox";
        el.className = "form-input";
      } else {
        el = document.createElement("input");
        el.type = "text";
        el.autocomplete = "off";
        el.className = "form-input";
      }
      readers[spec.key] = () => (spec.kind === "checkbox" ? el.checked : el.value.trim());

      // Pre-populate from the edited object.
      if (editing && initial[spec.key] != null) {
        if (spec.kind === "checkbox") el.checked = !!initial[spec.key];
        else el.value = initial[spec.key];
      }

      // Checkbox reads better with the control before the label.
      if (spec.kind === "checkbox") {
        row.appendChild(el);
        row.appendChild(lbl);
      } else {
        row.appendChild(lbl);
        row.appendChild(el);
      }
      bodyEl.appendChild(row);
      if (type === "screenImage" && spec.key === "url") {
        const preview = document.createElement("div");
        const updatePreview = () => {
          preview.replaceChildren(imagePreview({ url: el.value.trim(), title: readers.title() }));
        };
        el.addEventListener("input", updatePreview);
        updatePreview();
        bodyEl.appendChild(preview);
      }
    }

    if (type === "specification") {
      const specEditor = buildSpecEditor(initial, opts);
      bodyEl.appendChild(specEditor.section);
      readers.comments = () => specEditor.read().comments;
      readers.linkedId = () => specEditor.read().linkedId;
      readers.given = () => specEditor.read().given;
      readers.when = () => specEditor.read().when;
      readers.then = () => specEditor.read().then;
    }

    // Read models can attach event dependencies drawn from the whole model.
    // Rendered above the field editor so "Copy fields" reads naturally.
    const events = Array.isArray(opts.events) ? opts.events : [];
    if (type === "readmodel" && events.length) {
      const deps = buildDependencySection(events, fieldEditor, editing ? initial.dependencies : null);
      if (fieldEditor && fieldEditor.sectionEl) {
        bodyEl.insertBefore(deps.section, fieldEditor.sectionEl);
      } else {
        bodyEl.appendChild(deps.section);
      }
      readers.dependencies = deps.read;
    }

    submitHandler = () => {
      const values = {};
      for (const key of Object.keys(readers)) values[key] = readers[key]();
      for (const spec of specs) {
        if (spec.required && !values[spec.key]) {
          errorEl.textContent = spec.label + " is required.";
          return;
        }
      }
      const obj = editing ? applyEdit(type, initial, values) : build(type, values);
      close();
      onSubmit(obj);
    };

    backdrop.hidden = false;
    const first = bodyEl.querySelector("input, select");
    if (first) first.focus();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (submitHandler) submitHandler();
  });
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !backdrop.hidden) close();
  });

  window.AddForms = { open, build, genId };
})();
