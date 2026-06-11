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

  // ---------- Wiring ----------

  let debounce;
  function scheduleValidate() {
    clearTimeout(debounce);
    debounce = setTimeout(validate, 150);
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

  formatBtn.addEventListener("click", format);
  clearBtn.addEventListener("click", () => {
    input.value = "";
    input.focus();
    validate();
  });
  // Seed with a tiny valid example so the screen isn't bare.
  input.value = '{\n  "slices": []\n}';
  validate();
  input.focus();
})();
