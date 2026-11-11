//recovery phrase, PIN and password change, recover with the phrase; on frank of the multi-user node, whose
//password and PIN are the same again at the end (a new profile there cannot make a second transaction until
//the node restarts: its first login puts its first transaction on the core's rejected list)
//node account.mjs <extension dir> <screenshot dir>   env NODE_URL (multi-user node), BLOCK_WAIT_MS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './acc-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7081';
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);
const user = 'frank';
const pass = 'frankpass1';
const pin = '6666';
const pass2 = 'frankpass2';
const pin2 = '6667';
//the same phrase every run, so the next run can give it as the current one
const phrase = 'the quick brown fox jumps over the lazy dog near the river bank';

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
const input = (scope, label) => scope.locator(`label:has(.field-label:text-is("${label}")) input, label:has(.field-label:text-is("${label}")) textarea`);
const card = (title) => page.locator('form.card', { has: page.locator(`h2:text-is("${title}")`) });

async function login(p, k) {
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(p);
  await page.getByLabel('PIN').fill(k);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card, .notice.error').first().waitFor({ timeout: 60000 });
  return page.locator('.balance-card').isVisible();
}

//from home or from the settings page
async function logout(k) {
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  if (await settings.isVisible()) {
    await settings.click();
  }
  await page.locator('form.card', { hasText: 'Log out' }).locator('input[type=password]').fill(k);
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
}

async function security() {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Password, PIN and recovery' }).click();
}

//fills the credentials card, gives the notice text
async function changeCredentials(current, newPass, newPin) {
  const c = card('Change password or PIN');
  if (newPass) {
    await input(c, 'New password').fill(newPass);
    await input(c, 'New password again').fill(newPass);
  }
  if (newPin) {
    await input(c, 'New PIN').fill(newPin);
    await input(c, 'New PIN again').fill(newPin);
  }
  await input(c, 'Current PIN').fill(current);
  await c.getByRole('button', { name: 'Change', exact: true }).click();
  await c.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
  return { ok: await c.locator('.notice.ok').isVisible(), text: (await c.locator('.notice').first().textContent()) ?? '' };
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxac-'));
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
  await page.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  check('login', await login(pass, pin));

  //recovery phrase (a second run gives the same one as the current phrase)
  await security();
  const rec = card('Recovery phrase');
  await input(rec, 'New recovery phrase').fill('too short');
  await input(rec, 'Current PIN').fill(pin);
  await rec.getByRole('button', { name: 'Set recovery phrase' }).click();
  check('short phrase refused', ((await rec.textContent()) ?? '').includes('At least 40 characters'));
  await input(rec, 'New recovery phrase').fill(phrase);
  await input(rec, 'New recovery phrase again').fill('another phrase that is long enough to pass the check');
  await rec.getByRole('button', { name: 'Set recovery phrase' }).click();
  check('different phrases refused', ((await rec.textContent()) ?? '').includes('The phrases are not the same'));
  await input(rec, 'New recovery phrase again').fill(phrase);
  await input(rec, 'Current recovery phrase (only if you set one before)').fill(phrase);
  await rec.getByRole('button', { name: 'Set recovery phrase' }).click();
  await rec.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
  const recOk = await rec.locator('.notice.ok').isVisible();
  check('recovery phrase set', recOk, (await rec.locator('.notice').first().textContent()) ?? '');
  check('phrase fields cleared', (await input(rec, 'New recovery phrase').inputValue()) === '');
  await shot('recovery-set');
  await page.waitForTimeout(blockWait);

  //new PIN
  const c = card('Change password or PIN');
  await input(c, 'Current PIN').fill(pin);
  await c.getByRole('button', { name: 'Change', exact: true }).click();
  check('nothing to change refused', ((await c.textContent()) ?? '').includes('Enter a new password or a new PIN'));
  const r1 = await changeCredentials(pin, null, pin2);
  check('PIN changed', r1.ok, r1.text);
  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await logout(pin2);
  check('old PIN no longer logs in', !(await login(pass, pin)));
  check('new PIN logs in', await login(pass, pin2));

  //without a phrase only the PIN goes back, frank's password stays as it is
  if (!recOk) {
    await security();
    const back = await changeCredentials(pin2, null, pin);
    check('PIN back', back.ok, back.text);
    throw new Error('stopped: no recovery phrase, password not changed');
  }

  //new password and the old PIN again
  await security();
  const r2 = await changeCredentials(pin2, pass2, pin);
  check('password and PIN changed', r2.ok, r2.text);
  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await logout(pin);
  check('new password logs in', await login(pass2, pin));
  await logout(pin);

  //recover: back to the first password with the phrase
  await page.getByRole('button', { name: 'Forgot password or PIN?' }).click();
  await page.getByLabel('Username').fill(user);
  await input(page, 'Recovery phrase').fill(phrase);
  await input(page, 'New password').fill(pass);
  await input(page, 'New password again').fill(pass);
  await input(page, 'New PIN').fill(pin);
  await input(page, 'New PIN again').fill(pin);
  await shot('recover-form');
  await page.getByRole('button', { name: 'Recover' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
  check('recovered', ((await page.locator('.notice').first().textContent()) ?? '').includes('recovered'), (await page.locator('.notice').first().textContent()) ?? '');
  await page.waitForTimeout(blockWait);
  check('password before the recover no longer logs in', !(await login(pass2, pin)));
  check('recovered password logs in', await login(pass, pin));
  await shot('after-recover');
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
