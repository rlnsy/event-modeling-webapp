const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { test } = require("node:test");
const vm = require("node:vm");

// Exercise the actual navigation code with DOM layout fixtures, without booting
// the unrelated editor, storage, and schema validation services.
const source = readFileSync(require.resolve("../app.js"), "utf8");
const navigation = source.slice(source.indexOf("  let selectedEl = null;"),
  source.indexOf("  // Search the rendered model"));

function fixture(layout) {
  const cards = {};
  const document = { activeElement: null };
  const columns = layout.map((lanes, colIndex) => {
    const column = { querySelector: () => null, querySelectorAll: (selector) => selector === ".lane" ? rows : rows.flatMap((lane) => lane.cards) };
    const rows = lanes.map(({ names, horizontal = false }, laneIndex) => {
      const lane = { classList: { contains: () => horizontal }, querySelectorAll: () => lane.cards };
      lane.cards = names.map((name, index) => {
        const top = laneIndex * 200 + (horizontal ? 0 : index * 80);
        const left = colIndex * 600 + (horizontal ? index * 150 : 0);
        const classes = new Set(["card"]);
        const card = { name, classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) }, scrollIntoView() {},
          focus() { document.activeElement = card; }, blur() { document.activeElement = null; },
          closest: () => column, getBoundingClientRect: () => ({ top, bottom: top + 60, left, right: left + 120 }) };
        cards[name] = card;
        return card;
      });
      return lane;
    });
    return column;
  });
  let keydown;
  const context = vm.createContext({
    preview: { querySelectorAll: () => columns, getBoundingClientRect: () => ({ top: 0, left: 0 }),
      clientTop: 0, clientLeft: 0, clientWidth: 1280, clientHeight: 720, scrollTop: 0, scrollLeft: 0 },
    modelNavigator: { open: false },
    modalBackdrop: { hidden: true },
    document: Object.assign(document, { addEventListener: (_, handler) => { keydown = handler; }, getElementById: () => null }),
  });
  vm.runInContext(navigation + "\n globalThis.nav = { selectCard, navKey, selected: () => selectedEl };", context);
  return {
    select: (name) => context.nav.selectCard(cards[name]),
    cards,
    document,
    selected: () => context.nav.selected(),
    keydown: (key, target) => keydown({ key, target, preventDefault() {} }),
    press(key, expected) {
      let prevented = false;
      assert.equal(context.nav.navKey({ key, preventDefault() { prevented = true; } }), true);
      assert.equal(prevented, true);
      assert.equal(context.nav.selected().name, expected);
    },
  };
}

const multiEventLayout = [
  [{ names: ["command"] }, { names: ["event1", "event2", "event3"], horizontal: true }, { names: ["readmodel"] }],
  [],
  [{ names: ["nextCommand"] }, { names: ["next1", "next2"], horizontal: true }],
];

test("horizontal arrows traverse events before crossing nonempty slices", () => {
  const nav = fixture(multiEventLayout);
  nav.select("event1");
  nav.press("ArrowRight", "event2");
  nav.press("ArrowRight", "event3");
  nav.press("ArrowRight", "next1");
  nav.press("ArrowLeft", "event3");
  nav.press("ArrowLeft", "event2");
  nav.press("ArrowLeft", "event1");
  nav.press("ArrowLeft", "event1");
});

test("vertical arrows skip sibling events and enter the nearest event", () => {
  const nav = fixture(multiEventLayout);
  nav.select("event2");
  nav.press("ArrowUp", "command");
  nav.press("ArrowDown", "event1");
  nav.select("event3");
  nav.press("ArrowDown", "readmodel");
  nav.press("ArrowDown", "readmodel");
  nav.press("ArrowUp", "event1");
});

test("hjkl follow the same visual rows", () => {
  const nav = fixture(multiEventLayout);
  nav.select("event1");
  nav.press("l", "event2");
  nav.press("h", "event1");
  nav.press("k", "command");
  nav.press("j", "event1");
});

test("stacked events retain vertical navigation and selection initializes", () => {
  const nav = fixture([[{ names: ["first", "second"] }], [{ names: ["other"] }]]);
  nav.press("ArrowRight", "first");
  nav.press("ArrowDown", "second");
  nav.press("ArrowUp", "first");
  nav.press("ArrowRight", "other");
  nav.press("ArrowRight", "other");
});


test("Escape removes the highlight and resets keyboard navigation", () => {
  const nav = fixture(multiEventLayout);
  nav.select("event2");
  assert.equal(nav.cards.event2.classList.contains("selected"), true);
  nav.keydown("Escape");
  assert.equal(nav.cards.event2.classList.contains("selected"), false);
  assert.equal(nav.selected(), null);
  nav.keydown("Escape");
  nav.press("ArrowRight", "command");
});

test("Escape in an input leaves diagram selection alone", () => {
  const nav = fixture(multiEventLayout);
  nav.select("event2");
  nav.keydown("Escape", { tagName: "INPUT" });
  assert.equal(nav.selected(), nav.cards.event2);
  assert.equal(nav.cards.event2.classList.contains("selected"), true);
});


test("arrow navigation moves clicked card focus with the selection", () => {
  const nav = fixture(multiEventLayout);
  nav.cards.event1.focus();
  nav.select("event1");
  nav.press("ArrowRight", "event2");
  assert.equal(nav.document.activeElement, nav.cards.event2);
  assert.equal(nav.cards.event1.classList.contains("selected"), false);
  nav.press("j", "readmodel");
  assert.equal(nav.document.activeElement, nav.cards.readmodel);
  nav.keydown("Escape");
  assert.equal(nav.document.activeElement, null);
  assert.equal(nav.selected(), null);
});

test("selection does not steal focus from controls outside the diagram", () => {
  const nav = fixture(multiEventLayout);
  const control = { classList: { contains: () => false } };
  nav.document.activeElement = control;
  nav.select("event1");
  nav.press("ArrowRight", "event2");
  assert.equal(nav.document.activeElement, control);
});
