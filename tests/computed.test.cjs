const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const vm = require('node:vm');
const source = readFileSync(require.resolve('../app.js'), 'utf8');
const context = vm.createContext({ asArray: value => Array.isArray(value) ? value : [] });
vm.runInContext(source.slice(source.indexOf('  const TRACED_TYPES'), source.indexOf('  // ---------- Flow lines ----------')) + source.slice(source.indexOf('  function feedsType('), source.indexOf('  // ---------- Download ----------')), context);
function findings(field, spec = false) {
  const event = { id: 'e', type: 'EVENT', fields: [{ name: 'amount', type: 'Int' }, { name: 'tax', type: 'Int' }] };
  const model = { slices: [{ sliceType: 'STATE_VIEW', events: [event],
    readmodels: spec ? [] : [{ id: 'r', type: 'READMODEL', fields: [field] }],
    specifications: spec ? [{ id: 's', given: [{ linkedId: 'e', fields: [field] }] }] : [] }] };
  return context.completenessFindings(model);
}
for (const spec of [false, true]) {
  test(`explicit computed flag controls type differences (${spec ? 'scenario' : 'model'})`, () => {
    for (const mapping of ['amount', 'amount+tax']) {
      for (const computed of [undefined, false, 'true']) {
        assert.ok(findings({ name: 'total', type: 'String', mapping, computed }, spec).length);
      }
      assert.equal(findings({ name: 'total', type: 'String', mapping, computed: true }, spec).length, 0);
      assert.equal(findings({ name: 'total', type: 'Int', mapping }, spec).length, 0);
    }
    assert.equal(findings({ name: 'amount', type: 'String', computed: true }, spec).length, 0);
    assert.match(findings({ name: 'total', type: 'String', mapping: 'missing', computed: true }, spec)[0].msg, /missing.*source field/);
    assert.equal(findings({ name: 'record', type: 'Custom', subfields: [{ name: 'total', type: 'String', mapping: 'amount', computed: true }] }, spec).length, 0);
  });
}
test('both schemas allow only a boolean computed flag', () => {
  const schemaContext = vm.createContext({ window: {} });
  vm.runInContext(readFileSync(require.resolve('../schema.js'), 'utf8'), schemaContext);
  const external = JSON.parse(readFileSync(require.resolve('../eventmodeling.schema.json'), 'utf8'));
  for (const schema of [schemaContext.window.EVENT_MODELING_SCHEMA, external]) {
    assert.equal(schema.$defs.Field.properties.computed.type, 'boolean');
  }
});
