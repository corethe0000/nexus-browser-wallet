//one multi-user node, two people at once in two browser profiles; new account from the extension
//node multiuser.mjs <extension dir> <screenshot dir>   env NODE_URL (multi-user node), NEW_USER
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './mu-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7081';
const erin = { user: 'erin', pass: 'erinpass1', pin: '5555' };
const frank = { user: 'frank', pass: 'frankpass1', pin: '6666' };
const newUser = process.env.NEW_USER || `gina${Date.now() % 100000}`;
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);

const errors = [];
let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
let n = 0;
async function shot(p, name) {
  n += 1;
  await p.bringToFront();
  await p.screenshot({ path: `${shots}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: true });
  console.log('shot', name);
}

const profiles = [];
async function openWallet(name, dir) {
  const profile = dir ?? fs.mkdtempSync(path.join(os.tmpdir(), `nxmu-${name}-`));
  profiles.push(profile);
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
  return { ctx, page, profile };
}

async function connect(page) {
  if (await page.getByLabel('Core address').isVisible().catch(() => false)) {
    await page.getByLabel('Core address').fill(nodeUrl);
    await page.getByLabel('API user').fill('');
    await page.getByRole('button', { name: 'Connect' }).click();
  }
  await page.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
}

async function login(page, u) {
  await page.getByLabel('Username').fill(u.user);
  await page.getByLabel('Password').fill(u.pass);
  await page.getByLabel('PIN').fill(u.pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
}

async function claimAll(page, pin) {
  await page.locator('.notice.info.clickable').waitFor({ timeout: 240000 });
  await page.locator('.notice.info.clickable').click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Claim all' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
}

const field = (page, label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);
const headerName = (page) => page.locator('.header h1').textContent();

let a;
let b;
try {
  a = await openWallet('erin');
  await connect(a.page);

  //new account with the form checks first
  await a.page.getByRole('button', { name: 'Create a new account' }).click();
  await a.page.getByLabel('Username').fill(newUser);
  await field(a.page, 'Password').fill('short');
  await field(a.page, 'PIN').fill('12');
  await a.page.getByRole('button', { name: 'Create a new account' }).click();
  const formErrors = await a.page.locator('.field-error').allTextContents();
  check('create form checks password and PIN', formErrors.length >= 3, formErrors.join(' / '));
  await shot(a.page, 'create-form');
  await field(a.page, 'Password').fill('ginapass12');
  await a.page.getByLabel('Password again').fill('ginapass12');
  await field(a.page, 'PIN').fill('7777');
  await a.page.getByLabel('PIN again').fill('7777');
  await a.page.getByRole('button', { name: 'Create a new account' }).click();
  await a.page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
  check('account created', await a.page.locator('.notice.ok').isVisible(), await a.page.locator('.notice').first().textContent());

  //erin logs in and sends to frank
  await login(a.page, erin);
  check('erin logged in on the multi-user node', (await headerName(a.page)) === 'erin');
  b = await openWallet('frank');
  await connect(b.page);
  await login(b.page, frank);
  check('frank logged in at the same time', (await headerName(b.page)) === 'frank');
  await a.page.reload();
  await a.page.locator('.balance-card').waitFor({ timeout: 60000 });
  check('erin still logged in', (await headerName(a.page)) === 'erin');
  await shot(a.page, 'erin-home');

  //erin's token payment to herself waits to be claimed on a fresh chain; the core shows it a while after login
  await a.page.locator('li.account').first().waitFor({ timeout: 60000 });
  const erntRow = (await a.page.locator('li.account', { hasText: 'ernt' }).first().textContent()) ?? '';
  if (/\b0\s*ERNT/.test(erntRow)) {
    await claimAll(a.page, erin.pin);
    await a.page.waitForTimeout(blockWait);
  }
  await a.page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  await a.page.getByLabel('From').locator('option', { hasText: 'ernt ' }).first().waitFor({ state: 'attached', timeout: 30000 });
  const fromOpts = await a.page.getByLabel('From').locator('option').allTextContents();
  const ernt = fromOpts.find((o) => o.startsWith('ernt '));
  await a.page.getByLabel('From').selectOption({ label: ernt });
  await a.page.locator('label:has(.field-label:text-is("To")) input').fill('frank:ernt');
  await a.page.getByLabel('Amount').fill('10');
  await a.page.getByRole('button', { name: 'Review' }).click();
  await a.page.getByLabel('Confirm with your PIN').fill(erin.pin);
  await a.page.getByRole('button', { name: 'Send now' }).click();
  await a.page.getByText('Sent', { exact: true }).waitFor({ timeout: 60000 });
  check('erin sent 10 ERNT to frank', true, ernt);
  await a.page.getByRole('button', { name: 'Close' }).click();

  await b.page.waitForTimeout(blockWait);
  await b.page.reload();
  await b.page.locator('.balance-card').waitFor({ timeout: 60000 });
  await claimAll(b.page, frank.pin);
  await shot(b.page, 'frank-claimed');
  check('frank claimed', (await headerName(b.page)) === 'frank');

  //erin logs out, frank stays
  await a.page.getByRole('button', { name: 'Settings' }).click();
  check('logout note says this wallet only', (await a.page.locator('form.card').textContent()).includes('session of this wallet'));
  await a.page.locator('form.card').getByLabel('PIN').fill(erin.pin);
  await a.page.getByRole('button', { name: 'Log out' }).click();
  await a.page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await b.page.reload();
  await b.page.locator('.balance-card').waitFor({ timeout: 60000 });
  check('frank still logged in after erin logged out', (await headerName(b.page)) === 'frank');

  //frank's browser restarts: same session, starts locked
  const dir = b.profile;
  await b.ctx.close();
  b = await openWallet('frank-again', dir);
  await connect(b.page);
  const wasLocked = await b.page.locator('.lock-icon').isVisible();
  await shot(b.page, 'frank-after-restart');
  await unlockIfLocked(b.page, frank.pin, frank.pass);
  check('frank comes back locked and unlocks with the PIN', wasLocked && (await headerName(b.page)) === 'frank');

  //the new account can log in after a block
  await login(a.page, { user: newUser, pass: 'ginapass12', pin: '7777' });
  check('new account logs in', (await headerName(a.page)) === newUser);

  check('no console errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  for (const [i, w] of [a, b].entries()) {
    await w?.page.screenshot({ path: `${shots}/error-${i}.png` }).catch(() => {});
  }
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await a?.ctx.close().catch(() => {});
  await b?.ctx.close().catch(() => {});
  for (const p of profiles) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}
process.exit(failures ? 1 : 0);
