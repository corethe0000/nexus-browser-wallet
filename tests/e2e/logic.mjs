//button logic: disabled states, no double submits, lists refreshed after an action; run in nexus-dev from ~/review
//node logic.mjs <extension dir> <screenshot dir>   env NODE_URL, NX_USER, NX_PASS, NX_PIN, SEND_TO, SEND_TOKEN_ACCOUNT
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './logic-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeUrl = env.NODE_URL || 'http://127.0.0.1:7080';
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
const field = (page, label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);

//counts the requests the page sends to the background, by type
async function countMessages(page) {
  await page.evaluate(() => {
    const w = window;
    if (w.__counted) {
      return;
    }
    w.__counted = {};
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (msg, ...rest) => {
      w.__counted[msg?.type] = (w.__counted[msg?.type] ?? 0) + 1;
      return orig(msg, ...rest);
    };
  });
}
const counted = (page, type) => page.evaluate((t) => window.__counted?.[t] ?? 0, type);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlg-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);

  //setup: Connect is a real submit, double click connects once
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill(env.NODE_USER || '');
  await page.getByLabel('API password').fill(env.NODE_PASS || '');
  await countMessages(page);
  await page.getByRole('button', { name: 'Connect' }).dblclick();
  await page.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
  check('connect sent once on double click', (await counted(page, 'saveNode')) === 1, `${await counted(page, 'saveNode')}`);

  //log out first if the core is logged in, so the login form can be tested
  await unlockIfLocked(page, pin, pass);
  if (await page.locator('.balance-card').isVisible()) {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.locator('form.card').getByLabel('PIN').fill(pin);
    await page.getByRole('button', { name: 'Log out' }).click();
    await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  }
  await countMessages(page);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  //Enter three times fast plus a click
  await page.getByLabel('PIN').press('Enter');
  await page.getByLabel('PIN').press('Enter').catch(() => {});
  await page.getByRole('button', { name: /Log in|Logging in/ }).first().click({ timeout: 2000 }).catch(() => {});
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  check('login sent once on Enter twice and a click', (await counted(page, 'login')) === 1, `${await counted(page, 'login')}`);

  //send form: review is a step, Send now needs the PIN and is sent once
  await page.locator('li.account').first().waitFor({ timeout: 60000 });
  await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  //the account list loads after the page
  await page.getByLabel('From').locator('option', { hasText: sendFrom + ' ' }).first().waitFor({ state: 'attached', timeout: 30000 });
  const fromOpts = await page.getByLabel('From').locator('option').allTextContents();
  const opt = fromOpts.find((o) => o.startsWith(sendFrom + ' '));
  await page.getByLabel('From').selectOption({ label: opt });
  await field(page, 'To').fill(sendTo);
  await page.getByLabel('Amount').fill('0.01');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByText('Check and confirm').waitFor();
  check('Send now disabled without PIN', await page.getByRole('button', { name: 'Send now' }).isDisabled());
  await page.getByLabel('Confirm with your PIN').fill(pin);
  check('Send now enabled with PIN', await page.getByRole('button', { name: 'Send now' }).isEnabled());
  await countMessages(page);
  await page.getByLabel('Confirm with your PIN').press('Enter');
  await page.getByLabel('Confirm with your PIN').press('Enter').catch(() => {});
  await page.getByRole('button', { name: /Send now|Sending/ }).click({ timeout: 1500 }).catch(() => {});
  const backHidden = !(await page.getByRole('button', { name: 'Back' }).isVisible().catch(() => false));
  await page.getByText('Sent', { exact: true }).waitFor({ timeout: 60000 });
  check('send went to the core once', (await counted(page, 'send')) === 1, `${await counted(page, 'send')}`);
  check('back button hidden while sending', backHidden);
  const txid = (await page.locator('.mono.break').textContent())?.trim() ?? '';
  await page.getByRole('button', { name: 'Close' }).click();

  //home refreshes on return; activity shows the new send
  await page.locator('.balance-card').waitFor();
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.locator('ul.activity li').first().waitFor({ timeout: 30000 });
  const firstLine = (await page.locator('ul.activity li').first().textContent()) ?? '';
  //to another user it is "sent To ...", between own accounts "moved a > b"
  check('activity shows the send at the top', firstLine.includes('0.01') && ((firstLine.includes('sent') && firstLine.includes('To ')) || firstLine.includes('moved')), firstLine);
  await page.screenshot({ path: path.join(shots, 'activity-after-send.png'), fullPage: true });
  check('send has a txid', /^[0-9a-f]{128}$/.test(txid), txid.slice(0, 20));

  //logout button needs the PIN
  await page.getByRole('button', { name: 'Settings' }).click();
  check('Log out disabled without PIN', await page.getByRole('button', { name: 'Log out' }).isDisabled());

  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  for (const [i, p] of ctx.pages().entries()) {
    await p.screenshot({ path: path.join(shots, `error-${i}.png`) }).catch(() => {});
  }
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
