const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.MODEL_TEST_URL || 'http://localhost:8777');
    const step = (type, title) => ({ id: title, type, title, linkedId: 'shared-id',
      fields: [{ name: 'orderId', type: 'String', example: 'order-123' }] });
    const model = { slices: [{ id: 'slice', title: 'Order scenarios', sliceType: 'STATE_CHANGE',
      commands: [], events: [], readmodels: [], screens: [], processors: [], tables: [],
      specifications: [
        { id: 'spec', title: 'Order accepted', linkedId: '', comments: [{ description: 'An existing customer places an order.' }],
          given: [step('SPEC_EVENT', 'Customer registered')],
          when: [step('SPEC_COMMAND', 'Place order')],
          then: [step('SPEC_EVENT', 'Order placed'), step('SPEC_READMODEL', 'Order summary'), step('SPEC_ERROR', 'Payment declined')] },
        { id: 'empty-given', title: 'First order', linkedId: '', given: [], when: [step('SPEC_COMMAND', 'Place first order')], then: [] },
        { id: 'undefined', title: 'Unspecified', linkedId: '', given: [], when: [], then: [] },
      ] }] };
    await page.locator('#paneToggle').click();
    await page.locator('#input').fill(JSON.stringify(model));
    await page.waitForFunction(() => document.querySelectorAll('.spec-step').length === 6);
    await page.locator('#paneToggle').click();
    const scenario = page.locator('[data-el-id="spec"]');
    assert.equal(await scenario.locator('.spec-step.type-event').count(), 2);
    assert.equal(await scenario.locator('.spec-step.type-command').count(), 1);
    assert.equal(await scenario.locator('.spec-step.type-readmodel').count(), 1);
    assert.equal(await scenario.locator('.spec-step.type-error').count(), 1);
    assert.equal(await scenario.locator('.spec-step [data-el-id], .spec-step[data-el-id], .spec-step[tabindex]').count(), 0);
    assert.equal(await page.locator('[data-el-id="empty-given"] .spec-step-empty').textContent(), 'Nothing');
    assert.match(await page.locator('[data-el-id="undefined"]').textContent(), /not yet defined/);
    assert.match(await scenario.textContent(), /An existing customer/);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => Theme.set(theme), theme);
      await page.waitForTimeout(200); // Let theme transitions settle before visual checks.
      const colors = await scenario.locator('.spec-step').evaluateAll(steps => steps.map(el => getComputedStyle(el).backgroundColor));
      assert.equal(new Set(colors).size, 4, 'each type has a distinct color');
      assert.ok(await scenario.locator('.spec-step').evaluateAll(steps => steps.every(el => el.scrollWidth <= el.clientWidth)), 'fields fit within cards');
      await page.screenshot({ path: `/tmp/task26-${theme}.png`, fullPage: true });
    }
    await scenario.locator('.spec-step.type-command').click();
    assert.match(await page.locator('#modalTitle').textContent(), /Order accepted.*Specification/);
    await page.locator('#modalClose').click();
    await scenario.focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('.card.selected').getAttribute('data-el-id'), 'empty-given');
    assert.deepEqual(errors, []);
    console.log('Scenario cards: all types, themes, field fit, empty states, owning detail, and navigation passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
