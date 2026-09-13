const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.MODEL_TEST_URL || 'http://localhost:8777');
    await page.locator('#findModelBtn').click();
    assert.equal(await page.locator('#modelSearchCount').textContent(), 'No model content to search.');
    await page.keyboard.press('Escape');
    await page.locator('#paneToggle').click();
    const model = { slices: Array.from({ length: 60 }, (_, index) => ({
      id: `slice-${index}`, title: `Scenario ${index}`, index,
      commands: [{ id: `cmd-${index}`, title: 'Submit order', type: 'COMMAND', fields: [] }],
      specifications: [{ id: `spec-${index}`, title: 'Order accepted', given: [], when: [], then: [] }],
    })) };
    await page.locator('#input').fill(JSON.stringify(model));
    await page.waitForFunction(() => document.querySelectorAll('.slice-column').length === 60);
    await page.locator('#paneToggle').click();
    await page.locator('#findModelBtn').click();
    assert.equal(await page.locator('.navigator-result').count(), 180);
    await page.locator('#modelSearch').fill('SCENARIO 59 command');
    assert.equal(await page.locator('.navigator-result').count(), 1);
    await page.locator('#modelSearch').press('Enter');
    assert.equal(await page.locator('#modelNavigator').evaluate(el => el.open), false);
    assert.equal(await page.locator('.card.selected').getAttribute('data-el-id'), 'cmd-59');
    assert.equal(await page.locator('#modalBackdrop').evaluate(el => el.hidden), true);
    assert.ok(await page.locator('#preview').evaluate(el => el.scrollLeft) > 1000);
    await page.locator('#findModelBtn').click();
    await page.locator('#modelSearch').fill('spec-58');
    await page.locator('#modelSearch').press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.card.selected').getAttribute('data-el-id'), 'spec-58');
    await page.locator('#findModelBtn').click();
    await page.locator('#modelSearch').fill('slice-0');
    await page.locator('.navigator-result').click();
    assert.equal(await page.locator('#preview').evaluate(el => el.scrollLeft), 0);
    await page.locator('#findModelBtn').click();
    await page.locator('#modelSearch').fill('no-such-result');
    assert.equal(await page.locator('.navigator-result').count(), 0);
    assert.match(await page.locator('#modelSearchCount').textContent(), /No matches/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#modelNavigator').open);
    assert.equal(await page.locator('#findModelBtn').evaluate(el => el === document.activeElement), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#findModelBtn').click();
    const geometry = await page.locator('#modelNavigator').boundingBox();
    assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= 390);
    assert.ok(await page.locator('.navigator-results').evaluate(el => el.scrollHeight > el.clientHeight));
    await page.screenshot({ path: '/tmp/model-search-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: '/tmp/model-search-desktop.png' });
    assert.deepEqual(errors, []);
    console.log('Model search: 60 slices, duplicate titles, ID/type search, keyboard jumps, empty states, and mobile layout passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
