//transaction details, take back an unclaimed send, contacts, toolbar badge; run in nexus-dev from ~/review
//node features.mjs <extension dir> <screenshot dir>   env NODE_URL, NX_USER, NX_PASS, NX_PIN, SEND_TO, SEND_TOKEN_ACCOUNT
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './feat-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const user = env.NX_USER || 'alice';
const pass = env.NX_PASS || 'alicepass1';
const pin = env.NX_PIN || '1111';
const sendTo = env.SEND_TO || 'bob:testt';
const sendFrom = env.SEND_TOKEN_ACCOUNT || 'testt';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
let n = 0;
let page;
const shot = async (name) => {
  n += 1;
  await page.screenshot({ path: path.join(shots, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true });
};
const field = (label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxft-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
  await page.getByLabel('Core address').fill(env.NODE_URL || 'http://127.0.0.1:7080');
  await page.getByLabel('API user').fill(env.NODE_USER || '');
  await page.getByLabel('API password').fill(env.NODE_PASS || '');
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

  //a fresh send, so there is something the receiver has not claimed yet
  await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  await page.getByLabel('From').locator('option', { hasText: sendFrom + ' ' }).first().waitFor({ state: 'attached', timeout: 30000 });
  const opt = (await page.getByLabel('From').locator('option').allTextContents()).find((o) => o.startsWith(sendFrom + ' '));
  await page.getByLabel('From').selectOption({ label: opt });
  await field('To').fill(sendTo);
  await page.getByLabel('Amount').fill('0.02');
  //short expiry so the test can take it back
  await page.getByLabel('If not claimed').selectOption('600');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.getByText('Sent', { exact: true }).waitFor({ timeout: 60000 });
  const txid = (await page.locator('.mono.break').textContent())?.trim() ?? '';
  await page.getByRole('button', { name: 'Close' }).click();
  //the core lists it after the next block
  await page.waitForTimeout(Number(env.BLOCK_WAIT_MS || 75000));

  //details from the activity list
  await page.reload();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.locator('ul.activity li').first().waitFor({ timeout: 30000 });
  await page.locator('ul.activity li').first().click();
  await page.getByText('Open in the explorer').waitFor({ timeout: 10000 });
  await shot('tx-details');
  const body = (await page.locator('.page').textContent()) ?? '';
  check('details show the send and its state', body.includes('0.02') && body.includes('Not claimed by the receiver yet'), body.slice(0, 160));
  check('details show the txid start', body.includes(txid.slice(0, 14)), txid.slice(0, 14));

  //explorer link opens a tab with the txid
  const [tab] = await Promise.all([ctx.waitForEvent('page'), page.getByRole('button', { name: 'Open in the explorer' }).click()]);
  check('explorer link', tab.url().startsWith('https://explorer.nexus.io/scan/') && tab.url().endsWith(txid), tab.url());
  await tab.close();

  //save the receiver as a contact
  await page.getByRole('button', { name: 'Save as contact' }).first().click();
  check('contact saved from the details', !(await page.getByRole('button', { name: 'Save as contact' }).isVisible()));

  check('take back waits for the expiry', (await page.locator('.page').textContent())?.includes('can claim until'));
  //wait until the 10 minutes are over, then take it back
  await page.waitForTimeout(Number(env.EXPIRY_WAIT_MS || 560000));
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.locator('ul.activity li', { hasText: '0.02' }).first().click();
  await page.getByRole('button', { name: 'Take back (not claimed yet)' }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Take back', exact: true }).click();
  await page.locator('.notice.ok, .card .notice.error').first().waitFor({ timeout: 60000 });
  await shot('voided');
  check('send taken back', await page.locator('.notice.ok').isVisible(), (await page.locator('.notice').first().textContent()) ?? '');

  //contacts page and the picker in Send
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Contacts' }).click();
  await page.locator('ul.list li').first().waitFor({ timeout: 10000 });
  await shot('contacts');
  check('contact listed', (await page.locator('ul.list').textContent())?.includes('testt'));
  await page.locator('ul.list li').first().getByRole('button', { name: 'Send' }).click();
  await field('To').waitFor();
  const prefilled = await field('To').inputValue();
  check('send from a contact fills To', prefilled.startsWith('8'), prefilled);
  check('contact picker shows the contact', (await page.getByLabel('Contact').locator('option').count()) >= 2);
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  //toolbar badge matches the incoming count on the home screen
  await page.locator('.balance-card').waitFor();
  await page.waitForTimeout(3000);
  const banner = await page.locator('.notice.info.clickable').textContent().catch(() => null);
  const incoming = banner ? Number(banner.match(/(\d+)/)?.[1] ?? 0) : 0;
  const badge = await sw.evaluate(() => chrome.action.getBadgeText({}));
  check('toolbar badge matches incoming', badge === (incoming > 0 ? String(incoming) : ''), `badge '${badge}', incoming ${incoming}`);

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  await page?.screenshot({ path: path.join(shots, 'error.png') }).catch(() => {});
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
