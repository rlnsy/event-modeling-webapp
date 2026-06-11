# Proposal: Convert the editor to a full YAML editor

## Summary

Replace JSON with YAML as the editor's input/output format, while keeping the
existing schema validator unchanged. The editor would parse YAML, validate the
resulting data against the Event Modeling schema, and round-trip in YAML.

## Motivation

YAML is more comfortable to hand-author than JSON: no trailing-comma or
quote-everything friction, comments are allowed, and the indentation-based
structure reads well for nested event-modeling documents. Since the validator
operates on the parsed data — not on the source text — the format is essentially
a presentation choice.

## Why this is low-risk

The schema validator never touches the source text. In `app.js`, `validate()`
parses the text into a plain JS object and then calls `validateSchema()`, which
walks that object tree (objects, arrays, strings, numbers, booleans, null):

```js
parsed = JSON.parse(text);                              // text → object
validateSchema(parsed, window.EVENT_MODELING_SCHEMA, ...); // validates the object
```

A YAML parser produces the **same object shape** for any document within the
JSON data model. So `validateSchema`, `schema.js`, and
`eventmodeling.schema.json` all stay exactly as they are. JSON Schema validates
the data model, not the syntax.

### Note on "YAML is 1:1 with JSON"

Not quite — JSON is a *subset* of YAML. YAML's data model is a superset and
adds features JSON has no concept of: anchors/aliases (`&`/`*`), non-string
mapping keys, multiple documents per file, native dates, `NaN`/`Infinity`, etc.
For this editor that's fine: as long as documents stay within the JSON data
model (which the schema enforces), the parsed object is indistinguishable from
what `JSON.parse` would have produced. The superset features are simply
additional authoring conveniences (or things the schema will reject).

## Scope of changes

All changes are confined to the `editor/` directory. The schema files are
untouched.

### 1. Add a YAML library

There is no build step — the app is static files served by `http-server`. Add
[`js-yaml`](https://github.com/nodeca/js-yaml) as a vendored file (or a
`<script>` tag in `index.html`). It exposes `jsyaml.load()` and `jsyaml.dump()`
on `window`.

- **File:** `editor/index.html` (add the script tag) plus a vendored
  `editor/vendor/js-yaml.min.js`.

### 2. Swap the parse call

In `app.js:251`, replace:

```js
parsed = JSON.parse(text);
```

with:

```js
parsed = jsyaml.load(text);
```

`jsyaml.load` returns `undefined` for empty/comment-only input — the existing
empty-text guard at `app.js:241` already handles the empty case, but a
`undefined` result from an all-comments document should be treated as "nothing
to validate" rather than passed to the schema validator.

### 3. Rewrite error-position handling

This is the only substantial work. The current error handling
(`extractErrorOffset`, `app.js:33-55`, and the `catch` block at
`app.js:252-268`) is built around browser `JSON.parse` message formats
("at position 123", "line 3 column 5") parsed with regexes.

`js-yaml` throws a `YAMLException` carrying a structured `.mark` object with
`mark.line`, `mark.column` (0-based), and `mark.position` (absolute offset) —
no string scraping needed. Net effect: `extractErrorOffset` and `guessOffset`
can be **deleted**, and the `catch` block becomes simpler:

```js
} catch (e) {
  const mark = e.mark;
  const offset = mark ? mark.position : guessOffset(text);
  const line = mark ? mark.line + 1 : ...;
  const col  = mark ? mark.column + 1 : ...;
  // ... existing errorLines / render / showProblems flow
}
```

The clean-up regexes that strip JSON-specific suffixes from `e.message`
(`app.js:259-261`) should be replaced with `e.reason` (the human-readable part
of a `YAMLException`).

### 4. Update `format()`

`format()` (`app.js:325-333`) currently round-trips through `JSON.stringify`.
For a YAML editor, point it at `jsyaml.dump(obj)`:

```js
const obj = jsyaml.load(input.value);
input.value = jsyaml.dump(obj, { indent: 2, lineWidth: -1 });
```

Caveat: re-dumping discards comments and normalizes formatting. That's the
standard trade-off for a "format/prettify" action and is acceptable, but worth
noting since YAML comments are a reason people choose YAML.

### 5. Cosmetic / labeling

- Seed example (`app.js:342`) becomes YAML: `slices: []`.
- Rename `example.json` → `example.yaml` (convert contents).
- Status strings ("Invalid JSON", "JSON + schema OK") → YAML equivalents.
- Tab-insert behavior (`app.js:310-317`) already inserts two spaces, which suits
  YAML well — no change needed.

## Out of scope

- Syntax highlighting of YAML tokens (the highlight layer only paints error
  rows today; it does not tokenize).
- Anchors/aliases or multi-document (`---`) support beyond whatever `js-yaml`
  does by default. If multi-document input should be rejected, use
  `jsyaml.load` (single doc) rather than `loadAll`.

## Effort estimate

| Change | Effort |
| --- | --- |
| Add js-yaml | Trivial |
| Swap parse call | Trivial |
| Rewrite error handling | Moderate — the only real work |
| Update `format()` | Trivial |
| Labels / example / seed | Trivial |

## Open questions

1. Vendor `js-yaml` locally vs. load from a CDN? (Local keeps the editor
   offline-capable, matching the current zero-dependency-at-runtime design.)
2. Should `format()` preserve comments? If yes, a plain `load`/`dump` round-trip
   won't do it and a comment-preserving approach would be needed (larger scope).
3. Reject multi-document YAML, or accept the first document silently?
