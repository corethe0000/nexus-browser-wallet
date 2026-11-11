//"sign in this browser": a new profile made in the extension, then log in with it; private chain
//node local-create.mjs <extension dir> <screenshot dir>   env NODE_URL, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-create-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);
const user = `new${Date.now().toString(36).slice(-6)}`;
const pass = 'newpass123';
const pin = '5151';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlc-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
let page;
const field = (label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByText('Sign in this browser (no login on the node)').click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });

  await page.getByRole('button', { name: 'Create a new account' }).click();
  check('create screen explains it is made here', (await page.locator('.page').textContent()).includes('made in this extension'));
  await page.getByLabel('Username').fill(user);
  await field('Password').fill(pass);
  await page.getByLabel('Password again').fill(pass);
  await field('PIN').fill(pin);
  await page.getByLabel('PIN again').fill(pin);
  await page.getByRole('button', { name: 'Create a new account' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 300000 });
  check('profile made and sent', await page.locator('.notice.ok').isVisible(), (await page.locator('.notice').first().textContent()) ?? '');
  await page.screenshot({ path: path.join(shots, 'created.png'), fullPage: true });

  //the same username again is taken
  await page.getByRole('button', { name: 'Create a new account' }).click();
  await page.getByLabel('Username').fill(user);
  await field('Password').fill(pass);
  await page.getByLabel('Password again').fill(pass);
  await field('PIN').fill(pin);
  await page.getByLabel('PIN again').fill(pin);
  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Create a new account' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 60000 });
  check('same username refused', (await page.locator('.notice.error').textContent()).includes('taken'));
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card, .notice.error').first().waitFor({ timeout: 60000 });
  check('logs in with the new profile', await page.locator('.balance-card').isVisible(), (await page.locator('.notice.error').textContent().catch(() => '')) ?? '');
  check('header shows the new user', (await page.locator('.header h1').textContent()) === user);

  //new password and PIN, signed here: the chain must take them, the old ones must stop working
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Password, PIN and recovery' }).click();
  await field('New password').fill('newpass456');
  await field('New password again').fill('newpass456');
  await field('New PIN').fill('6161');
  await field('New PIN again').fill('6161');
  const credCard = page.locator('form.card', { has: page.locator('h2:text-is("Change password or PIN")') });
  const credPin = credCard.locator('label:has(.field-label:text-is("Current PIN")) input');
  await credPin.fill('0000');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await credCard.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
  check('wrong current PIN refused', (await credCard.locator('.notice.error').textContent()).includes('Wrong PIN'));
  await credPin.fill(pin);
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await credCard.locator('.notice.ok').waitFor({ timeout: 90000 });
  check('password and PIN changed', true);
  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('form.card', { hasText: 'Log out' }).locator('input[type=password]').fill('6161');
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 60000 });
  check('old password and PIN refused', (await page.locator('.notice.error').textContent()).includes('not right'));
  await page.getByLabel('Password').fill('newpass456');
  await page.getByLabel('PIN').fill('6161');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  check('new password and PIN log in', true);

  //recovery phrase, then a new password and PIN with it, nobody logged in
  const phrase = 'a long recovery phrase made only for this browser test run';
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Password, PIN and recovery' }).click();
  const rec = page.locator('form.card', { has: page.locator('h2:text-is("Recovery phrase")') });
  const box = (scope, label) => scope.locator(`label:has(.field-label:text-is("${label}")) input, label:has(.field-label:text-is("${label}")) textarea`);
  await box(rec, 'New recovery phrase').fill(phrase);
  await box(rec, 'New recovery phrase again').fill(phrase);
  await box(rec, 'Current PIN').fill('0000');
  await rec.getByRole('button', { name: 'Set recovery phrase' }).click();
  await rec.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 120000 });
  check('wrong PIN refused for the phrase', ((await rec.locator('.notice').first().textContent()) ?? '').includes('Wrong PIN'));
  await box(rec, 'Current PIN').fill('6161');
  await rec.getByRole('button', { name: 'Set recovery phrase' }).click();
  await rec.locator('.notice.ok').waitFor({ timeout: 120000 });
  check('recovery phrase set', true);
  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.locator('form.card', { hasText: 'Log out' }).locator('input[type=password]').fill('6161');
  await page.getByRole('button', { name: 'Log out' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Forgot password or PIN?' }).click();
  await page.getByLabel('Username').fill(user);
  await box(page, 'Recovery phrase').fill('this is not the phrase of this account at all, sorry');
  await box(page, 'New password').fill('newpass789');
  await box(page, 'New password again').fill('newpass789');
  await box(page, 'New PIN').fill('7171');
  await box(page, 'New PIN again').fill('7171');
  await page.getByRole('button', { name: 'Recover' }).click();
  await page.locator('.notice.error').waitFor({ timeout: 120000 });
  check('wrong phrase refused', (await page.locator('.notice.error').textContent()).includes('not right'));
  await box(page, 'Recovery phrase').fill(phrase);
  await page.getByRole('button', { name: 'Recover' }).click();
  await page.locator('.notice.ok').waitFor({ timeout: 120000 });
  check('recovered', true);
  await page.waitForTimeout(blockWait);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill('newpass789');
  await page.getByLabel('PIN').fill('7171');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  check('recovered password and PIN log in', true);
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
