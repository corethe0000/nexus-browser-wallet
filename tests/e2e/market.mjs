//market in the popup: fill a waiting order, place an order, cancel it; run in nexus-dev from ~/review
//node market.mjs <extension dir> <screenshot dir>   env NODE_URL, NX_USER, NX_PASS, NX_PIN, PAIR_A, PAIR_B, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import { unlockIfLocked } from './helpers.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './market-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const user = process.env.NX_USER || 'alice';
const pass = process.env.NX_PASS || 'alicepass1';
const pin = process.env.NX_PIN || '1111';
const pairA = process.env.PAIR_A || 'TESTT';
const pairB = process.env.PAIR_B || 'BOBT';
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxm-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
let n = 0;
let page;
async function shot(name) {
  n += 1;
  await page.screenshot({ path: `${shots}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: true });
  console.log('shot', name);
}

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${extId}/popup.html`);
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill(process.env.NODE_USER || '');
  await page.getByLabel('API password').fill(process.env.NODE_PASS || '');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
  await unlockIfLocked(page, pin, pass);
  if (await page.locator('input[autocomplete=username]').isVisible()) {
    await page.getByLabel('Username').fill(user);
    await page.getByLabel('Password').fill(pass);
    await page.getByLabel('PIN').fill(pin);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await page.locator('li.account').first().waitFor({ timeout: 60000 });

  const openMarket = async () => {
    await page.locator('.balance-card').getByRole('button', { name: 'Market' }).click();
    await page.getByLabel('Token').selectOption({ label: pairA });
    await page.getByLabel('Priced in').selectOption({ label: pairB });
    await page.getByRole('heading', { name: /^My orders/ }).waitFor({ timeout: 30000 });
  };
  await openMarket();
  await shot('market');

  //fill the first order someone else is waiting with
  const fill = page.locator('ul.list li').locator('button', { hasText: /^(Buy|Sell)$/ }).first();
  if (await fill.count()) {
    await fill.click();
    await page.getByText('Fill this order').waitFor();
    await shot('fill');
    const pay = await page.locator('dl.review dd').first().textContent();
    await page.getByLabel('Confirm with your PIN').fill(pin);
    await page.getByRole('button', { name: 'Confirm' }).click();
    await page.locator('.notice.ok, .card .notice.error').first().waitFor({ timeout: 60000 });
    const ok = await page.locator('.notice.ok').isVisible();
    check('order filled', ok, ok ? `paid ${pay}` : await page.locator('.card .notice.error').textContent());
  } else {
    console.log('no order of another user to fill');
  }

  //place a sell order, then cancel it after the next block
  await page.getByRole('button', { name: 'New order' }).click();
  await page.getByLabel(`Amount (${pairA})`).fill('5');
  await page.getByLabel(`Price each (${pairB})`).fill('3');
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await shot('new-order');
  const summary = await page.locator('dl.review').textContent();
  check('new order summary', summary.includes(`5 ${pairA}`) && summary.includes(`15 ${pairB}`), summary);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.locator('.notice.ok', { hasText: 'Order placed' }).or(page.locator('.card .notice.error')).first().waitFor({ timeout: 60000 });
  check('order placed', await page.locator('.notice.ok', { hasText: 'Order placed' }).isVisible(), (await page.locator('.notice').first().textContent()) ?? '');

  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Back' }).click();
  await openMarket();
  const cancel = page.locator('li', { hasText: `Sell 5 ${pairA}` }).getByRole('button', { name: 'Cancel order' });
  await cancel.first().waitFor({ timeout: 30000 });
  await shot('my-orders');
  await cancel.first().click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.locator('.notice.ok', { hasText: 'cancelled' }).or(page.locator('.card .notice.error')).first().waitFor({ timeout: 60000 });
  check('order cancelled', await page.locator('.notice.ok', { hasText: 'cancelled' }).isVisible(), (await page.locator('.notice').first().textContent()) ?? '');

  //buy order: the core takes the amount in the token that is paid
  await page.getByRole('button', { name: 'New order' }).click();
  await page.getByRole('button', { name: `Buy ${pairA}` }).click();
  await page.getByLabel(`Amount (${pairA})`).fill('2');
  await page.getByLabel(`Price each (${pairB})`).fill('1.5');
  await page.getByLabel('Confirm with your PIN').fill(pin);
  const buySummary = await page.locator('dl.review').textContent();
  check('buy summary', buySummary.includes(`3 ${pairB}`) && buySummary.includes(`2 ${pairA}`), buySummary);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.locator('.notice.ok', { hasText: 'Order placed' }).or(page.locator('.card .notice.error')).first().waitFor({ timeout: 60000 });
  check('buy order placed', await page.locator('.notice.ok', { hasText: 'Order placed' }).isVisible(), (await page.locator('.notice').first().textContent()) ?? '');
  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Back' }).click();
  await openMarket();
  const buyRow = page.locator('ul.list li', { hasText: `Buy 2 ${pairA}` });
  await buyRow.first().waitFor({ timeout: 30000 });
  check('buy order in book at 1.5', (await page.locator('ul.list').nth(0).textContent()).includes('1.5') || (await page.content()).includes(`1.5 ${pairB}`));
  await shot('buy-order');
  await buyRow.getByRole('button', { name: 'Cancel order' }).first().click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await page.locator('.notice.ok', { hasText: 'cancelled' }).or(page.locator('.card .notice.error')).first().waitFor({ timeout: 60000 });
  check('buy order cancelled', await page.locator('.notice.ok', { hasText: 'cancelled' }).isVisible());

  check('no console errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  try {
    await shot('error');
  } catch {
    //no page
  }
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
