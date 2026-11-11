//lock, site requests while locked, settings export and import, wallet in a tab; run in nexus-dev from ~/review
//node lock.mjs <extension dir> <test page dir> <screenshot dir>   env NODE_URL, NODE_USER, NODE_PASS, NX_USER, NX_PASS, NX_PIN
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const pageDir = path.resolve(process.argv[3]);
const shots = path.resolve(process.argv[4] || './lock-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeUrl = env.NODE_URL || 'http://127.0.0.1:7080';
const user = env.NX_USER || 'alice';
const pass = env.NX_PASS || 'alicepass1';
const pin = env.NX_PIN || '1111';
const pagePort = 3094;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(pageDir, 'index.html')));
});
await new Promise((r) => server.listen(pagePort, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxl-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  acceptDownloads: true,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
const watch = (p, name) => {
  p.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
};
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

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  const popupUrl = `chrome-extension://${extId}/popup.html`;
  const wallet = await ctx.newPage();
  watch(wallet, 'popup');
  await wallet.setViewportSize({ width: 360, height: 640 });
  await wallet.goto(popupUrl);
  await wallet.getByLabel('Core address').fill(nodeUrl);
  await wallet.getByLabel('API user').fill(env.NODE_USER || '');
  await wallet.getByLabel('API password').fill(env.NODE_PASS || '');
  await wallet.getByRole('button', { name: 'Connect' }).click();
  await wallet.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
  const startedLocked = await wallet.locator('.lock-icon').isVisible();
  check('starts locked when the core is already logged in, or asks to log in', startedLocked || (await wallet.locator('input[autocomplete=username]').isVisible()));
  if (startedLocked) {
    await shot(wallet, 'start-locked');
    await unlockIfLocked(wallet, pin, pass);
  } else {
    await wallet.getByLabel('Username').fill(user);
    await wallet.getByLabel('Password').fill(pass);
    await wallet.getByLabel('PIN').fill(pin);
    await wallet.getByRole('button', { name: 'Log in' }).click();
    await wallet.locator('.balance-card').waitFor({ timeout: 60000 });
  }

  //connect a site while unlocked
  const site = await ctx.newPage();
  watch(site, 'site');
  await site.goto(`http://127.0.0.1:${pagePort}/`);
  await site.waitForTimeout(800);
  const waitResult = async () => {
    await site.waitForFunction(() => !document.getElementById('result').textContent.startsWith('waiting'), null, { timeout: 90000 });
    return site.locator('#result').textContent();
  };
  let [win] = await Promise.all([ctx.waitForEvent('page'), site.locator('#connect').click()]);
  await win.getByRole('button', { name: 'Connect' }).click().catch(() => {});
  let r = await waitResult();
  check('site connected', r.startsWith('ok nexus_connect'));

  //lock by hand
  await wallet.bringToFront();
  await wallet.getByRole('button', { name: 'Lock now' }).click();
  await wallet.locator('.lock-icon').waitFor({ timeout: 10000 });
  await shot(wallet, 'locked');
  check('lock now shows the lock screen', true);

  await site.bringToFront();
  await site.locator('#accounts').click();
  r = await waitResult();
  check('site reads are held back while locked', r.startsWith('error 4900') && r.includes('locked'), r.split('\n')[0] + ' ' + r.split('\n')[1]);

  //a send request while locked opens the window with the unlock first
  await site.fill('#to', env.SEND_TO || 'bob:testt');
  await site.fill('#amount', '0.1');
  await site.fill('#token', env.SEND_TOKEN || 'TESTT');
  [win] = await Promise.all([ctx.waitForEvent('page'), site.locator('#send').click()]);
  watch(win, 'approve');
  await win.locator('.lock-icon').waitFor({ timeout: 30000 });
  await shot(win, 'request-while-locked');
  check('approval window asks to unlock first', true);
  await win.getByLabel('PIN').fill('0000');
  await win.getByRole('button', { name: 'Unlock' }).click();
  await win.locator('.notice.error, input[autocomplete=current-password]').first().waitFor({ timeout: 60000 });
  if (await win.locator('input[autocomplete=current-password]').isVisible()) {
    await win.getByLabel('Password').fill(pass);
    await win.getByLabel('PIN').fill('0000');
    await win.getByRole('button', { name: 'Unlock' }).click();
    await win.locator('.notice.error').waitFor({ timeout: 60000 });
  }
  check('wrong PIN keeps it locked', await win.locator('.notice.error').isVisible(), await win.locator('.notice.error').textContent());
  await win.getByLabel('PIN').fill(pin);
  await win.getByRole('button', { name: 'Unlock' }).click();
  await win.getByText('Payment request').waitFor({ timeout: 60000 });
  check('unlocked in the window, request shown', true);
  await win.getByRole('button', { name: 'Reject' }).click().catch(() => {});
  r = await waitResult();
  check('request rejected after unlock', r.startsWith('error 4001'), r.split('\n')[0]);

  //popup follows the unlock done in the window
  await wallet.bringToFront();
  await wallet.reload();
  await wallet.locator('.balance-card').waitFor({ timeout: 60000 });
  check('popup unlocked too', true);

  //settings export and import
  await wallet.getByRole('button', { name: 'Settings' }).click();
  await wallet.getByLabel('Lock automatically').selectOption('5');
  const [download] = await Promise.all([wallet.waitForEvent('download'), wallet.getByRole('button', { name: 'Export' }).click()]);
  const file = path.join(shots, 'settings.json');
  await download.saveAs(file);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  check('export has node, lock time and sites', data.node?.url === nodeUrl && data.lockMinutes === 5 && data.sites.length === 1, JSON.stringify({ ...data, node: { ...data.node, password: data.node?.password ? '***' : undefined } }));
  check('export has no API password unless asked', data.node && data.node.password === undefined);
  await shot(wallet, 'settings');

  await wallet.getByLabel('Lock automatically').selectOption('0');
  await wallet.getByRole('button', { name: 'Remove' }).first().click();
  //a file pointing at another node: the import must not save it, only fill the form
  const other = { ...data, node: { url: 'http://127.0.0.1:9', user: 'x' }, sites: [{ origin: 'https://evil.example', genesis: 'a'.repeat(64), connectedAt: 1 }] };
  const otherFile = path.join(shots, 'settings-other.json');
  fs.writeFileSync(otherFile, JSON.stringify(other));
  await wallet.locator('input[type=file]').setInputFiles(otherFile);
  await wallet.getByText('Core settings from the imported file').waitFor({ timeout: 10000 });
  await shot(wallet, 'import-form');
  check('imported node only fills the form', (await wallet.getByLabel('Core address').inputValue()) === 'http://127.0.0.1:9');
  check('imported node comes without the saved API password', (await wallet.getByLabel('API password').inputValue()) === '');
  await wallet.getByRole('button', { name: 'Back' }).click();
  await wallet.locator('.balance-card').waitFor({ timeout: 60000 });
  check('current node still in use after leaving the form', true);
  await wallet.getByRole('button', { name: 'Settings' }).click();
  check('import restores lock time', (await wallet.getByLabel('Lock automatically').inputValue()) === '5');
  //the list loads after the page, wait for it
  const noSites = await wallet.getByText('No sites connected').waitFor({ timeout: 10000 }).then(() => true, () => false);
  check('import does not connect sites', noSites);

  //wallet in a tab
  const [tab] = await Promise.all([ctx.waitForEvent('page'), wallet.getByRole('button', { name: 'Open the wallet in a tab' }).click()]);
  watch(tab, 'tab');
  await tab.setViewportSize({ width: 1100, height: 760 });
  await tab.locator('.balance-card').waitFor({ timeout: 60000 });
  const width = await tab.locator('.app').evaluate((el) => el.getBoundingClientRect().width);
  check('tab view uses a wider column', width > 380 && width <= 460, `width ${width}`);
  await shot(tab, 'tab-view');

  check('no console errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  let i = 0;
  for (const p of ctx.pages()) {
    i += 1;
    await p.screenshot({ path: `${shots}/error-${i}.png` }).catch(() => {});
  }
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await ctx.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
