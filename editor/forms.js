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
  // empty collections (dependencies, spec steps) start empty and are refined by
  // hand in the editor; `fields` is populated from the inline field editor.
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
        dependencies: [],
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
      return { id: genId(), title: v.title, given: [], when: [], then: [], linkedId: "" };
    }
    return null;
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
  function addFieldRow(rowsEl, rows, showGenerated, initial) {
    const row = document.createElement("div");
    row.className = "field-row";

    const name = document.createElement("input");
    name.type = "text";
    name.className = "form-input field-name";
    name.placeholder = "name";

    const type = selectEl(FIELD_TYPES);
    type.classList.add("field-type");

    const card = selectEl(CARDINALITY);
    card.classList.add("field-card");
    card.title = "Cardinality";

    const opt = flagToggle("opt", "Optional");
    const idf = flagToggle("id", "ID attribute");
    const gen = showGenerated ? flagToggle("gen", "Generated by the system") : null;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "field-remove";
    remove.title = "Remove field";
    remove.textContent = "×";

    row.append(name, type, card, opt.wrap, idf.wrap);
    if (gen) row.append(gen.wrap);
    row.append(remove);

    const entry = {
      el: row,
      read: () => ({
        name: name.value.trim(),
        type: type.value,
        cardinality: card.value,
        optional: opt.cb.checked,
        idAttribute: idf.cb.checked,
        generated: gen ? gen.cb.checked : false,
      }),
    };
    remove.addEventListener("click", () => {
      const i = rows.indexOf(entry);
      if (i >= 0) rows.splice(i, 1);
      row.remove();
    });

    if (initial) {
      if (initial.name) name.value = initial.name;
      if (initial.type) type.value = initial.type;
      if (initial.cardinality) card.value = initial.cardinality;
      opt.cb.checked = !!initial.optional;
      idf.cb.checked = !!initial.idAttribute;
      if (gen) gen.cb.checked = !!initial.generated;
    }

    rows.push(entry);
    rowsEl.appendChild(row);
    if (!initial) name.focus();
  }

  // Gather field rows into schema-valid Field objects, dropping nameless rows
  // and omitting attributes left at their defaults to keep the JSON clean.
  function collectFields(rows) {
    return rows
      .map((r) => r.read())
      .filter((r) => r.name !== "")
      .map((r) => {
        const f = { name: r.name, type: r.type };
        if (r.optional) f.optional = true;
        if (r.idAttribute) f.idAttribute = true;
        if (r.generated) f.generated = true;
        if (r.cardinality === "List") f.cardinality = "List";
        return f;
      });
  }

  // ---------- Modal controller ----------

  const backdrop = document.getElementById("formBackdrop");
  const form = document.getElementById("addForm");
  const titleEl = document.getElementById("formTitle");
  const bodyEl = document.getElementById("formBody");
  const errorEl = document.getElementById("formError");
  const closeBtn = document.getElementById("formClose");
  const cancelBtn = document.getElementById("formCancel");

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
  // button to the field editor that seeds rows from those fields.
  function open(type, onSubmit, options) {
    const specs = SPECS[type];
    if (!specs) return;
    const opts = options || {};

    titleEl.textContent = "Add " + (TYPE_TITLES[type] || type);
    bodyEl.innerHTML = "";
    errorEl.textContent = "";

    // key -> () => value, so simple inputs and the field editor read uniformly.
    const readers = {};

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
          copyBtn.textContent = "Copy fields from event";
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

      // Checkbox reads better with the control before the label.
      if (spec.kind === "checkbox") {
        row.appendChild(el);
        row.appendChild(lbl);
      } else {
        row.appendChild(lbl);
        row.appendChild(el);
      }
      bodyEl.appendChild(row);
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
      const obj = build(type, values);
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
