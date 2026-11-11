//"Connect wallet" of the explorer (local branch wallet-connect of nexus-explorer-next) with this extension
//node explorer.mjs <extension dir> <screenshot dir>   env EXPLORER_URL, NODE_URL, NX_USER, NX_PASS, NX_PIN
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './explorer-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const explorer = (env.EXPLORER_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const user = env.NX_USER || 'alice';
const pass = env.NX_PASS || 'alicepass1';
const pin = env.NX_PIN || '1111';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
let n = 0;
const shot = async (p, name) => {
  n += 1;
  await p.screenshot({ path: path.join(shots, `${String(n).padStart(2, '0')}-${name}.png`) });
};

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxex-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const wallet = await ctx.newPage();
  await wallet.setViewportSize({ width: 360, height: 640 });
  await wallet.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
  await wallet.getByLabel('Core address').fill(env.NODE_URL || 'http://127.0.0.1:7080');
  await wallet.getByLabel('API user').fill(env.NODE_USER || '');
  await wallet.getByLabel('API password').fill(env.NODE_PASS || '');
  await wallet.getByRole('button', { name: 'Connect' }).click();
  await wallet.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
  await unlockIfLocked(wallet, pin, pass);
  if (await wallet.locator('input[autocomplete=username]').isVisible()) {
    await wallet.getByLabel('Username').fill(user);
    await wallet.getByLabel('Password').fill(pass);
    await wallet.getByLabel('PIN').fill(pin);
    await wallet.getByRole('button', { name: 'Log in' }).click();
    await wallet.locator('.balance-card').waitFor({ timeout: 60000 });
  }

  const site = await ctx.newPage();
  site.on('pageerror', (e) => errors.push(e.message));
  await site.setViewportSize({ width: 1280, height: 800 });
  await site.goto(`${explorer}/richlist`);
  const connect = site.getByRole('button', { name: 'Connect wallet' });
  await connect.waitFor({ timeout: 60000 });
  check('connect button shown with the extension', true);
  await shot(site, 'header');

  //the wallet's approval window
  const [win] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), connect.click()]);
  await win.waitForLoadState();
  await win.getByRole('button', { name: 'Connect' }).click();
  const named = site.getByRole('button', { name: user });
  await named.waitFor({ timeout: 30000 });
  check('header shows the account', true, user);
  await named.click();
  await site.getByRole('menu').waitFor();
  await shot(site, 'menu');
  const menu = (await site.getByRole('menu').textContent()) ?? '';
  check('network difference shown', menu.includes('The wallet is on private'), menu);
  const profileHref = await site.getByRole('menuitem', { name: 'My profile and transactions' }).getAttribute('href');
  check('profile link', profileHref?.startsWith('/scan/') && profileHref.includes(`user=${user}`), profileHref ?? '');
  await site.keyboard.press('Escape');

  //an account page offers to pay into it; the form only, no send to mainnet
  await site.locator('table a[href^="/scan/8"]').first().click();
  const sendBtn = site.getByRole('button', { name: 'Send with wallet' });
  await sendBtn.waitFor({ timeout: 60000 });
  await sendBtn.click();
  check('send form waits for an amount', await site.getByRole('button', { name: 'Send', exact: true }).isDisabled());
  await site.getByLabel('Amount').fill('1.5');
  check('send enabled with an amount', !(await site.getByRole('button', { name: 'Send', exact: true }).isDisabled()));
  await shot(site, 'account-send');
  await site.getByRole('button', { name: 'Close' }).click();

  //stays connected after a reload, without a window
  await site.reload();
  await site.getByRole('button', { name: user }).waitFor({ timeout: 30000 });
  check('connection kept after reload', true);

  //disconnect
  await site.getByRole('button', { name: user }).click();
  await site.getByRole('menuitem', { name: 'Disconnect' }).click();
  await site.getByRole('button', { name: 'Connect wallet' }).waitFor({ timeout: 15000 });
  check('disconnected', true);
  await site.reload();
  await site.getByRole('button', { name: 'Connect wallet' }).waitFor({ timeout: 30000 });
  check('stays disconnected after reload', true);
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
