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
    // Exercise scrolling in both axes, including sticky headers and attempts
    // to move beyond each outer edge of a diagram larger than the viewport.
    await page.setViewportSize({ width: 800, height: 500 });
    await page.locator('#paneToggle').click();
    await page.locator('#input').fill(JSON.stringify({ slices: [0, 1, 2, 3, 4].map(index => ({
      id: `edge-slice-${index}`, title: `Edge slice ${index}`, index,
      commands: Array.from({ length: 6 }, (_, row) => ({
        id: `edge-${index}-${row}`, title: `Command ${index} row ${row}`, type: 'COMMAND', fields: [],
      })),
    })) }));
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 30);
    await page.locator('#paneToggle').click();
    await page.locator('[data-el-id="edge-0-0"]').click();
    await page.keyboard.press('Space');
    async function assertVisible() {
      const bounds = await page.locator('.card.selected').evaluate(card => {
        const preview = document.querySelector('#preview');
        const p = preview.getBoundingClientRect();
        const c = card.getBoundingClientRect();
        const h = card.closest('.slice-column').querySelector('.slice-header').getBoundingClientRect();
        return { id: card.dataset.elId, top: c.top, bottom: c.bottom, left: c.left, right: c.right,
          minTop: Math.max(p.top + preview.clientTop, h.bottom) + 6,
          maxBottom: p.top + preview.clientTop + preview.clientHeight - 6,
          minLeft: p.left + preview.clientLeft + 6,
          maxRight: p.left + preview.clientLeft + preview.clientWidth - 6 };
      });
      assert.ok(bounds.top >= bounds.minTop - 1 && bounds.bottom <= bounds.maxBottom + 1 &&
        bounds.left >= bounds.minLeft - 1 && bounds.right <= bounds.maxRight + 1,
        `Selected card must clear headers and viewport edges: ${JSON.stringify(bounds)}`);
    }
    for (const key of ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft']) {
      for (let step = 0; step < 7; step++) {
        await page.keyboard.press(key);
        await assertVisible();
      }
    }
    // A boundary key should also restore visibility after manual scrolling.
    await page.locator('#preview').evaluate(el => { el.scrollTop = 100; el.scrollLeft = 100; });
    await page.keyboard.press('ArrowLeft');
    await assertVisible();
    assert.deepEqual(errors, []);
    console.log('Card focus and scrolling pass arrows/hjkl, modal, Escape, Tab, and all viewport edges.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
