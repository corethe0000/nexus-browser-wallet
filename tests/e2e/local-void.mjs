//"sign in this browser": send expiry and take back, send to an own account has no expiry; private chain, alice
//node local-void.mjs <extension dir> <screenshot dir>   env NODE_URL, NX_USER, NX_PASS, NX_PIN, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-void-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeUrl = env.NODE_URL || 'http://127.0.0.1:7080';
const user = env.NX_USER || 'alice';
const pass = env.NX_PASS || 'alicepass1';
const pin = env.NX_PIN || '1111';
const blockWait = Number(env.BLOCK_WAIT_MS || 75000);
const expirySeconds = 600;

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
const api = async (method, params) => (await (await fetch(`${nodeUrl}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })).json());
const nameOf = async (name) => (await api('names/get/name', { name })).result?.register;
const balanceOf = async (address) => Number((await api('register/get/any', { address })).result.balance);
const debitOf = async (hash) => (await api('ledger/get/transaction', { hash, verbose: 'summary' })).result?.contracts?.find((c) => c.OP === 'DEBIT');

//a second account of the same token, for the send to an own account
let second = await nameOf(`${user}:testt2`);
if (!second) {
  const made = await api('finance/create/account', { name: 'testt2', token: 'TESTT', pin });
  check('second account made', !!made.result?.address, JSON.stringify(made.error ?? ''));
  second = made.result?.address;
  await new Promise((r) => setTimeout(r, blockWait));
}
const first = await nameOf(`${user}:testt`);

async function send(to, amount, expiry) {
  await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  await page.getByLabel('From').locator('option', { hasText: 'testt ' }).first().waitFor({ state: 'attached', timeout: 30000 });
  const opt = (await page.getByLabel('From').locator('option').allTextContents()).find((o) => o.startsWith('testt '));
  await page.getByLabel('From').selectOption({ label: opt });
  await field('To').fill(to);
  await page.getByLabel('Amount').fill(amount);
  if (expiry) {
    await page.getByLabel('If not claimed').selectOption(String(expiry));
  }
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.getByText('Sent', { exact: true }).waitFor({ timeout: 90000 });
  const txid = ((await page.locator('.mono.break').textContent()) ?? '').trim();
  await page.getByRole('button', { name: 'Close' }).click();
  return txid;
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlv-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 640 });
  const url = `chrome-extension://${sw.url().split('/')[2]}/popup.html`;
  await page.goto(url);
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByText('Sign in this browser (no login on the node)').click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.locator('li.account').first().waitFor({ timeout: 60000 });

  //a send to someone else carries the expiry
  const txid = await send('bob:testt', '0.04', expirySeconds);
  const sentAt = Date.now();
  check('send to bob signed here', /^01[0-9a-f]{126}$/.test(txid), txid.slice(0, 20));
  await page.waitForTimeout(blockWait);
  const debit = await debitOf(txid);
  check('expiry on chain in the core form', (debit?.conditions ?? '').includes(`contract.timestamp + ${expirySeconds} > caller.timestamp`) && (debit?.conditions ?? '').includes(`contract.timestamp + ${expirySeconds} < caller.timestamp`), debit?.conditions?.slice(0, 80));

  //before the expiry the details only say until when
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.locator('ul.activity li', { hasText: '0.04' }).first().click();
  await page.getByText('Open in the explorer').waitFor({ timeout: 10000 });
  const early = (await page.locator('.page').textContent()) ?? '';
  check('no take back before the expiry', early.includes('can claim until') && (await page.getByRole('button', { name: 'Take back (not claimed yet)' }).count()) === 0, early.slice(0, 120));
  await shot('before-expiry');

  //a send to an own account has no expiry and can be claimed by the same chain
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  const secondBefore = await balanceOf(second);
  const self = await send(`${user}:testt2`, '0.01');
  await page.waitForTimeout(blockWait);
  const selfDebit = await debitOf(self);
  check('send to an own account has no condition', !selfDebit?.conditions, selfDebit?.conditions?.slice(0, 80));
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.locator('.notice.info.clickable').waitFor({ timeout: 90000 });
  await page.locator('.notice.info.clickable').click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Claim all' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 90000 });
  await page.waitForTimeout(blockWait);
  const secondAfter = await balanceOf(second);
  check('own account claimed it', Math.round((secondAfter - secondBefore) * 100) === 1, `${secondBefore} -> ${secondAfter}`);

  //after the expiry the sender takes it back
  const left = sentAt + (expirySeconds + 30) * 1000 - Date.now();
  if (left > 0) {
    await page.waitForTimeout(left);
  }
  const firstBefore = await balanceOf(first);
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.locator('ul.activity li', { hasText: '0.04' }).first().click();
  await page.getByRole('button', { name: 'Take back (not claimed yet)' }).click();
  await page.getByLabel('Confirm with your PIN').fill('9999');
  await page.getByRole('button', { name: 'Take back', exact: true }).click();
  await page.locator('.card .notice.error').waitFor({ timeout: 60000 });
  check('wrong PIN refused at take back', ((await page.locator('.card .notice.error').textContent()) ?? '').includes('Wrong PIN'));
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Take back', exact: true }).click();
  await page.locator('.notice.ok, .card .notice.error:not(:text("Wrong PIN"))').first().waitFor({ timeout: 90000 });
  await shot('taken-back');
  check('take back accepted', await page.locator('.notice.ok').isVisible(), (await page.locator('.notice').first().textContent()) ?? '');
  await page.waitForTimeout(blockWait);
  const firstAfter = await balanceOf(first);
  check('amount back in the account', Math.round((firstAfter - firstBefore) * 100) === 4, `${firstBefore} -> ${firstAfter}`);
  const closed = await debitOf(txid);
  check('debit fully closed on chain', Number(closed?.claimed) === Number(closed?.amount), `${closed?.claimed} of ${closed?.amount}`);
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
