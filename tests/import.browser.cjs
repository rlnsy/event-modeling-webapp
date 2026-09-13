const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.MODEL_TEST_URL || 'http://localhost:8777');
    const originalId = await page.locator('#sessionSelect').inputValue();
    const model = { slices: [{ id: 'imported', title: 'Imported slice', sliceType: 'STATE_CHANGE',
      commands: [], events: [], readmodels: [], screens: [], processors: [], tables: [], specifications: [] }] };
    const upload = (text, name = 'My model.JSON') => page.locator('#importFile').setInputFiles({
      name, mimeType: 'application/json', buffer: Buffer.from(text),
    });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles([]);
    assert.equal(await page.locator('#sessionSelect option').count(), 1);

    // Import in the same event loop turn as an edit, before autosave fires.
    const pendingText = '{"slices": [], "title": "Pending edit"}';
    await page.evaluate(({ model, pendingText }) => {
      const input = document.querySelector('#input');
      input.value = pendingText;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const transfer = new DataTransfer();
      transfer.items.add(new File(['\uFEFF' + JSON.stringify(model)], 'My model.JSON', { type: 'application/json' }));
      const file = document.querySelector('#importFile');
      file.files = transfer.files;
      file.dispatchEvent(new Event('change', { bubbles: true }));
    }, { model, pendingText });
    await page.waitForFunction(() => document.querySelectorAll('#sessionSelect option').length === 2);
    assert.equal(await page.locator('#sessionSelect option:checked').textContent(), 'My model');
    assert.deepEqual(JSON.parse(await page.locator('#input').inputValue()), model);
    assert.match(await page.locator('#preview').textContent(), /Imported slice/);
    assert.equal(await page.evaluate(id => Sessions.get(id).content, originalId), pendingText);
    const importedId = await page.locator('#sessionSelect').inputValue();
    await page.reload();
    assert.equal(await page.locator('#sessionSelect').inputValue(), importedId);
    assert.deepEqual(JSON.parse(await page.locator('#input').inputValue()), model);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const download = await downloadPromise;
    const exported = await fs.readFile(await download.path(), 'utf8');
    assert.deepEqual(JSON.parse(exported), model);
    await upload(exported);
    await page.waitForFunction(() => document.querySelectorAll('#sessionSelect option').length === 3);
    await upload(exported);
    await page.waitForFunction(() => document.querySelectorAll('#sessionSelect option').length === 4);

    for (const invalid of ['', '{broken', 'null', '[]', '42']) {
      await upload(invalid);
      await page.waitForFunction(() => document.querySelector('#toastRegion').textContent.includes('Import failed'));
      assert.equal(await page.locator('#sessionSelect option').count(), 4);
      assert.deepEqual(JSON.parse(await page.locator('#input').inputValue()), model);
      assert.equal(await page.locator('#importBtn').isEnabled(), true);
    }
    await page.evaluate(() => { File.prototype.text = async () => { throw new Error('Read failed'); }; });
    await upload(exported);
    await page.waitForFunction(() => document.querySelector('#toastRegion').textContent.includes('Could not read'));
    assert.equal(await page.locator('#sessionSelect option').count(), 4);
    assert.equal(await page.locator('#importBtn').isEnabled(), true);
    await page.reload();
    await upload('{"slices":"invalid"}', 'Needs repair.json');
    await page.waitForFunction(() => document.querySelectorAll('#sessionSelect option').length === 5);
    assert.equal(await page.locator('#modelStatusText').textContent(), 'Schema errors');
    assert.deepEqual(errors, []);
    console.log('JSON import: picker cancellation, pending edits, BOM, filename, rendering, persistence, export round-trip, repeated files, invalid JSON, read failure, and schema feedback passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
