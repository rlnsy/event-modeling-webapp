const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(require.resolve("../app.js"), "utf8");
const sizing = source.slice(source.indexOf("  function pxNumber(value)"),
  source.indexOf("  if (paneToggle)", source.indexOf("  function pxNumber(value)")));

function style() {
  const values = new Map();
  return { setProperty: (key, value) => values.set(key, value),
    removeProperty: (key) => values.delete(key), getPropertyValue: (key) => values.get(key) };
}

function fit(fieldWidths, gap = "10px", stackedWidth = 0, scenario = false) {
  const cards = fieldWidths.map((width) => ({
    style: style(),
    querySelectorAll: () => [{ closest: () => scenario ? {} : null, scrollWidth: width, getBoundingClientRect: () => ({ width }) }],
    getBoundingClientRect() { return { width: parseFloat(this.style.getPropertyValue("--card-width")) || 200 }; },
  }));
  const lane = { querySelectorAll: () => cards, columnGap: gap,
    // Centering 620px of events in a 200px lane loses 210px on the left.
    scrollWidth: 410 };
  const allCards = stackedWidth ? [...cards, { style: style(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: stackedWidth }) }] : cards;
  const column = { style: style(), querySelectorAll: (selector) => selector === ".card" ? allCards : [lane] };
  const row = { querySelectorAll: (selector) => selector === ".card" ? allCards : [column] };
  const context = vm.createContext({ getComputedStyle: (element) => element === lane ? lane : {
    paddingLeft: "8px", paddingRight: "8px", borderLeftWidth: "1px", borderRightWidth: "1px",
  } });
  vm.runInContext(sizing + "\nglobalThis.fit = fitCardAndSliceWidths;", context);
  context.fit(row);
  const first = column.style.getPropertyValue("--slice-width");
  context.fit(row);
  assert.equal(column.style.getPropertyValue("--slice-width"), first, "repeat fitting remains stable");
  return first;
}

test("slice includes the full centered event row, including left overflow", () => {
  assert.equal(fit([0, 0, 0]), "620px");
});

test("slice includes unequal event widths and fractional gaps", () => {
  assert.equal(fit([250, 300, 0], "10.5px"), "807px");
});

test("a wider stacked card still determines the slice width", () => {
  assert.equal(fit([0, 0], "10px", 800), "800px");
});

test("scenario sizing includes both the step and specification card padding", () => {
  assert.equal(fit([300], "10px", 0, true), "336px");
});
