//click-through test of the popup against a node, run in the nexus-dev VM from ~/review (it has playwright)
//node popup.mjs <extension dir> <screenshot dir>
//env NODE_URL, NODE_USER, NODE_PASS (API login), NX_USER, NX_PASS, NX_PIN, SEND_TO, SEND_TOKEN_ACCOUNT, LOGOUT_LOGIN=1, DARK=1
import { chromium } from 'playwright';
import { unlockIfLocked } from './helpers.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './shots');
fs.mkdirSync(shots, { recursive: true });

const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const user = process.env.NX_USER || 'alice';
const pass = process.env.NX_PASS || 'alicepass1';
const pin = process.env.NX_PIN || '1111';
const sendTo = process.env.SEND_TO || 'bob:testt';
const sendFrom = process.env.SEND_TOKEN_ACCOUNT || 'testt';
const dark = process.env.DARK === '1';
const apiUser = process.env.NODE_USER || '';
const apiPass = process.env.NODE_PASS || '';
const logoutLogin = process.env.LOGOUT_LOGIN === '1';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxw-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  colorScheme: dark ? 'dark' : 'light',
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

let sw = ctx.serviceWorkers()[0];
if (!sw) {
  sw = await ctx.waitForEvent('serviceworker');
}
const extId = sw.url().split('/')[2];
const page = await ctx.newPage();
await page.setViewportSize({ width: 360, height: 600 });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(e.message));

const field = (label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);

let n = 0;
async function shot(name) {
  n += 1;
  await page.screenshot({ path: `${shots}/${String(n).padStart(2, '0')}-${name}.png` });
  console.log('shot', name);
}

const url = `chrome-extension://${extId}/popup.html`;
await page.goto(url);

//setup
await page.getByText('Connect to your Nexus core').waitFor();
await shot('setup');
await page.getByLabel('Core address').fill(nodeUrl);
await page.getByLabel('API user').fill(apiUser);
if (apiPass) {
  //a wrong API password must be refused and keep the setup page
  await page.getByLabel('API password').fill(apiPass + 'x');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 30000 });
  await shot('setup-wrong-api-password');
  console.log('wrong api password answer:', await page.locator('.notice.error').textContent());
}
await page.getByLabel('API password').fill(apiPass);
await page.getByRole('button', { name: 'Connect' }).click();

//login, or already logged in from an earlier run
await page.locator('.balance-card, input[autocomplete=username], .lock-icon, .notice.error').first().waitFor({ timeout: 30000 });
await unlockIfLocked(page, pin, pass);
if (await page.locator('.notice.error').isVisible()) {
  await shot('connect-error');
  throw new Error('connect failed: ' + (await page.locator('.notice.error').textContent()));
}
if (await page.getByRole('button', { name: 'Log in' }).isVisible()) {
  await shot('login');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
}
await page.locator('.balance-card').waitFor({ timeout: 60000 });
await page.locator('li.account, p.empty').first().waitFor({ timeout: 60000 });
//notifications come in their own call
await page.waitForTimeout(4000);
await shot('home');

//claim incoming if any
const incoming = page.locator('.notice.info.clickable');
if (await incoming.isVisible()) {
  await incoming.click();
  await page.getByRole('button', { name: 'Claim all' }).waitFor();
  await shot('claim');
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Claim all' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  console.log('claimed');
  //the claim has to be in a block before it can be sent on
  await page.waitForTimeout(Number(process.env.BLOCK_WAIT_MS || 75000));
}

//activity tab
await page.getByRole('button', { name: 'Activity' }).click();
await page.waitForTimeout(1500);
await shot('activity');
await page.getByRole('button', { name: 'Accounts' }).click();

//receive
await page.locator('.balance-card').getByRole('button', { name: 'Receive' }).click();
await page.locator('canvas.qr').waitFor();
await shot('receive');
await page.getByRole('button', { name: 'Back' }).click();

//send: validation first, then a real token send if the account has a balance
await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
await field('To').waitFor();
await page.getByRole('button', { name: 'Review' }).click();
await shot('send-errors');
const fromSelect = page.getByLabel('From');
const options = await fromSelect.locator('option').allTextContents();
const tokenOpt = options.find((o) => o.startsWith(sendFrom + ' '));
if (tokenOpt) {
  await fromSelect.selectOption({ label: tokenOpt });
}
const balanceText = (tokenOpt || '').split(' - ')[1] || '0';
const balance = Number(balanceText.split(' ')[0].replace(/,/g, ''));
await field('To').fill(sendTo);
await page.getByLabel('Amount').fill(balance >= 1 ? '1.25' : '0.01');
await page.getByLabel('Reference (optional)').fill('42');
await page.getByRole('button', { name: 'Review' }).click();
if (balance >= 1) {
  await page.getByText('Check and confirm').waitFor();
  await shot('send-review');
  await page.getByLabel('Confirm with your PIN').fill('0000');
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 30000 });
  await shot('send-wrong-pin');
  console.log('wrong pin answer:', await page.locator('.notice.error').textContent());
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.getByText('Sent', { exact: true }).waitFor({ timeout: 60000 });
  await shot('sent');
  console.log('sent txid', await page.locator('.mono.break').textContent());
  await page.getByRole('button', { name: 'Close' }).click();
} else {
  await shot('send-no-balance');
  await page.getByRole('button', { name: 'Back' }).click();
}

//settings and language
await page.locator('.balance-card').waitFor();
await page.getByRole('button', { name: 'Settings' }).click();
await page.getByLabel('Language').selectOption('hr');
await shot('settings-hr');
await page.getByLabel('Jezik').selectOption('en');

if (logoutLogin) {
  //log out of the core, then log in again from the extension
  await page.locator('form.card').getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await shot('logged-out');
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass + 'x');
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 60000 });
  console.log('wrong password answer:', await page.locator('.notice.error').textContent());
  await page.getByLabel('Password').fill(pass);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot('logged-in-again');
} else {
  await page.getByRole('button', { name: 'Back' }).click();
}

console.log('console errors:', errors.length ? errors : 'none');
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
