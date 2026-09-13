const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(process.env.MODEL_TEST_URL || 'http://localhost:8777');
    await page.evaluate(() => {
      window.savedFieldModel = { id: 'test', title: 'Computed test', type: 'EVENT', dependencies: [],
        fields: [{ name: 'total', type: 'String', mapping: 'amount' }] };
      window.openTestForm = () => AddForms.open('event', value => { window.savedFieldModel = value; }, { initial: window.savedFieldModel });
      window.openTestForm();
    });
    const checkbox = page.getByRole('checkbox', { name: 'computed', exact: true });
    assert.equal(await checkbox.isChecked(), false);
    await checkbox.check();
    await page.locator('#formSubmit').click();
    assert.equal(await page.evaluate(() => window.savedFieldModel.fields[0].computed), true);
    await page.evaluate(() => window.openTestForm());
    assert.equal(await checkbox.isChecked(), true);
    await checkbox.uncheck();
    await page.locator('#formSubmit').click();
    assert.deepEqual(await page.evaluate(() => window.savedFieldModel.fields[0]), { name: 'total', type: 'String', mapping: 'amount' });
    console.log('Computed checkbox defaults, save, reopen, and removal passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
