//asset transfer in the popup: owner sends, receiver claims (both log in on the same single-user core)
//node asset.mjs <extension dir> <screenshot dir>
//env NODE_URL, FROM_USER/FROM_PASS/FROM_PIN, TO_USER/TO_PASS/TO_PIN, ASSET_NAME, BLOCK_WAIT_MS, STEP=send|claim|both
import { chromium } from 'playwright';
import { unlockIfLocked } from './helpers.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './asset-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeUrl = env.NODE_URL || 'http://127.0.0.1:7080';
const from = { user: env.FROM_USER || 'alice', pass: env.FROM_PASS || 'alicepass1', pin: env.FROM_PIN || '1111' };
const to = { user: env.TO_USER || 'bob', pass: env.TO_PASS || 'bobpass12', pin: env.TO_PIN || '2222' };
const assetName = env.ASSET_NAME || 'painting';
const blockWait = Number(env.BLOCK_WAIT_MS || 75000);
const step = env.STEP || 'both';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxa-'));
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

async function loginAs(u) {
  //log out whoever is on the core first
  if (await page.locator('.balance-card').isVisible()) {
    await page.getByRole('button', { name: 'Settings' }).click();
    const current = await page.locator('dl.review dd').first().textContent();
    if (current.startsWith(u.user + ' ')) {
      await page.getByRole('button', { name: 'Back' }).click();
      return;
    }
    const other = current.startsWith(from.user + ' ') ? from : to;
    await page.locator('form.card').getByLabel('PIN').fill(other.pin);
    await page.getByRole('button', { name: 'Log out' }).click();
  }
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await page.getByLabel('Username').fill(u.user);
  await page.getByLabel('Password').fill(u.pass);
  await page.getByLabel('PIN').fill(u.pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
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
  //the core may be logged in as either test user
  for (const u of [from, to]) {
    if (await page.locator('.lock-icon').isVisible()) {
      await unlockIfLocked(page, u.pin, u.pass).catch(() => {});
    }
  }

  if (step !== 'claim') {
    await loginAs(from);
    await page.getByRole('button', { name: /^Assets/ }).click();
    await page.locator('li.clickable', { hasText: assetName }).click();
    await page.getByLabel('Recipient').fill(to.user);
    await page.getByLabel('Confirm with your PIN').fill(from.pin);
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    await page.locator('.notice.ok, .card .notice.error').first().waitFor({ timeout: 60000 });
    await shot('transfer-sent');
    check('asset transfer sent', await page.locator('.notice.ok').isVisible(), (await page.locator('.notice').first().textContent()) ?? '');
    await page.getByRole('button', { name: 'Back' }).click();
    await page.waitForTimeout(blockWait);
  }

  if (step !== 'send') {
    await loginAs(to);
    await page.waitForTimeout(5000);
    await page.reload();
    await page.locator('.balance-card').waitFor({ timeout: 60000 });
    //the core holds back notifications for a while after login (longer on the desktop core)
    await page.locator('.notice.info.clickable').waitFor({ timeout: 240000 });
    await shot('incoming');
    await page.locator('.notice.info.clickable').click();
    await page.getByRole('button', { name: 'Claim all' }).waitFor();
    await shot('claim');
    check('asset shows as incoming', (await page.locator('ul.list').textContent()).includes(assetName));
    await page.getByLabel('Confirm with your PIN').fill(to.pin);
    await page.getByRole('button', { name: 'Claim all' }).click();
    await page.locator('.balance-card').waitFor({ timeout: 60000 });
    await page.waitForTimeout(blockWait);
    await page.reload();
    await page.locator('.balance-card').waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: /^Assets/ }).click();
    await page.locator('li.clickable, p.empty').first().waitFor({ timeout: 30000 });
    await shot('receiver-assets');
    check('receiver owns the asset', (await page.locator('.page').textContent()).includes(assetName));
  }

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
