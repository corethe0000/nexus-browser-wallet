//"sign in this browser": no login on the node, sends and claims signed in the extension; private chain, bob
//node local.mjs <extension dir> <screenshot dir>   env NODE_URL, NX_USER, NX_PASS, NX_PIN, PAYER_PIN (alice on the node)
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeUrl = env.NODE_URL || 'http://127.0.0.1:7080';
const user = env.NX_USER || 'bob';
const pass = env.NX_PASS || 'bobpass12';
const pin = env.NX_PIN || '2222';
const blockWait = Number(env.BLOCK_WAIT_MS || 75000);

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
const balanceOf = async (address) => Number((await api('register/get/any', { address })).result.balance);
const bobTestt = '8CekfnBTnqNDLZAcwVCQP9ge2jbxnAeh2MbVmpKtKtJVkNnahzM';

//a payment from alice (logged in on the node) for bob to claim
const pay = await api('finance/debit/account', { from: 'testt', to: 'bob:testt', amount: 0.03, pin: env.PAYER_PIN || '1111' });
check('payment from alice made', !!pay.result?.txid, JSON.stringify(pay.error ?? ''));
await new Promise((r) => setTimeout(r, blockWait));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlo-'));
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
  const url = `chrome-extension://${sw.url().split('/')[2]}/popup.html`;
  await page.goto(url);
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByText('Sign in this browser (no login on the node)').click();
  await shot('setup');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  check('login screen says signing here, can create', (await page.locator('.page').textContent()).includes('Signing in this browser') && (await page.getByRole('button', { name: 'Create a new account' }).count()) === 1);

  //wrong password first
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill('wrongpass1');
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 60000 });
  check('wrong password refused', (await page.locator('.notice.error').textContent()).includes('not right'));
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  check('logged in without the node', true);
  await page.locator('li.account').first().waitFor({ timeout: 60000 });
  const accText = (await page.locator('ul.list').allTextContents()).join(' ');
  check('accounts from the own chain', accText.includes('testt'), accText.slice(0, 120));
  await shot('home');

  //claim: the payment from alice shows as incoming
  const before = await balanceOf(bobTestt);
  await page.locator('.notice.info.clickable').waitFor({ timeout: 90000 });
  await page.locator('.notice.info.clickable').click();
  await page.getByLabel('Confirm with your PIN').fill('9999');
  await page.getByRole('button', { name: 'Claim all' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 60000 });
  check('wrong PIN refused at claim', (await page.locator('.notice.error').textContent()).includes('Wrong PIN'));
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Claim all' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 90000 });
  check('claimed', true);
  await page.waitForTimeout(blockWait);
  const after = await balanceOf(bobTestt);
  check('balance went up by the claim', Math.round((after - before) * 100) >= 3, `${before} -> ${after}`);

  //send back to alice by name
  await page.reload();
  await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  await page.getByLabel('From').locator('option', { hasText: 'testt ' }).first().waitFor({ state: 'attached', timeout: 30000 });
  const opt = (await page.getByLabel('From').locator('option').allTextContents()).find((o) => o.startsWith('testt '));
  await page.getByLabel('From').selectOption({ label: opt });
  check('expiry choice shown', (await page.getByLabel('If not claimed').count()) === 1);
  await field('To').fill('alice:testt');
  await page.getByLabel('Amount').fill('0.02');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.getByText('Sent', { exact: true }).waitFor({ timeout: 90000 });
  const txid = ((await page.locator('.mono.break').textContent()) ?? '').trim();
  check('sent, signed in the browser', /^01[0-9a-f]{126}$/.test(txid), txid.slice(0, 20));
  await shot('sent');
  await page.getByRole('button', { name: 'Close' }).click();

  //a second send before the block is held back
  await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  await page.getByLabel('From').locator('option', { hasText: 'testt ' }).first().waitFor({ state: 'attached', timeout: 30000 });
  await page.getByLabel('From').selectOption({ label: (await page.getByLabel('From').locator('option').allTextContents()).find((o) => o.startsWith('testt ')) });
  await field('To').fill('alice:testt');
  await page.getByLabel('Amount').fill('0.01');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 60000 });
  check('next send waits for the block', (await page.locator('.notice.error').textContent()).includes('waits for the next block'));

  await page.waitForTimeout(blockWait);
  const tx = await api('ledger/get/transaction', { hash: txid });
  check('send confirmed on chain', tx.result?.confirmations > 0, JSON.stringify(tx.error ?? ''));

  //activity shows it
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.locator('ul.activity li').first().waitFor({ timeout: 30000 });
  const act = (await page.locator('ul.activity').textContent()) ?? '';
  check('activity lists the send', act.includes('0.02'), act.slice(0, 160));
  await shot('activity');

  //lock and unlock with the PIN
  await sw.evaluate(() => chrome.storage.session.set({ lastActive: 0 }));
  await page.goto(url);
  await page.locator('.lock-icon').waitFor({ timeout: 30000 });
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  check('unlocked with the PIN', true);

  //a new named account, signed here
  const label = 'acc' + Date.now().toString(36).slice(-5);
  await page.getByRole('button', { name: /^Accounts/ }).click();
  await page.getByRole('button', { name: '+ New account, token or name' }).click();
  check('accounts, tokens, names and assets can be made', (await page.locator('.tabs button').count()) === 4);
  await field('Name').fill(label);
  await field('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 90000 });
  check('account created', await page.locator('.notice.ok').isVisible(), (await page.locator('.notice').first().textContent()) ?? '');
  await page.waitForTimeout(blockWait);
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Accounts/ }).click();
  await page.locator('li.account', { hasText: label }).waitFor({ timeout: 60000 });
  check('new account listed', true, label);
  const named = await api('names/get/name', { name: user + ':' + label });
  check('its name resolves on chain', !!named.result?.register, JSON.stringify(named.error ?? ''));
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
