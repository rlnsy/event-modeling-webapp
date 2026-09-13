const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.MODEL_TEST_URL || 'http://localhost:8777');
    await page.locator('#paneToggle').click();
    await page.locator('#input').fill(JSON.stringify({ slices: [0, 1, 2].map(index => ({
      id: `slice-${index}`, title: `Slice ${index}`, index,
      commands: [{ id: `cmd-${index}`, title: `Command ${index}`, type: 'COMMAND', fields: [] }],
    })) }));
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 3);
    await page.locator('#paneToggle').click();
    await page.locator('[data-el-id="cmd-0"]').click();
    // Arrow navigation swaps the detail modal as well as diagram selection.
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.card.selected').getAttribute('data-el-id'), 'cmd-1');
    assert.equal(await page.locator('.card:focus').getAttribute('data-el-id'), 'cmd-1');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#modalBackdrop').evaluate(el => el.hidden), true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('.card.selected').getAttribute('data-el-id'), 'cmd-2');
    assert.equal(await page.locator('.card:focus').getAttribute('data-el-id'), 'cmd-2');
    assert.equal(await page.locator('[data-el-id="cmd-0"]').evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    await page.keyboard.press('h');
    assert.equal(await page.locator('.card:focus').getAttribute('data-el-id'), 'cmd-1');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.card.selected, .card:focus-visible').count(), 0);
    // Tab focus remains visibly accessible after clearing the selection.
    await page.locator('[data-el-id="cmd-0"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.card:focus-visible').count(), 1);
    assert.deepEqual(errors, []);
    console.log('Card focus follows arrows/hjkl, modal navigation, Escape, and Tab correctly.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
