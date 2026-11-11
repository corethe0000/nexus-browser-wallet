//website market flow: order book, fill an order, place and cancel own order, all through approval windows
//node dappmarket.mjs <extension dir> <test page dir> <screenshot dir>
//env NODE_URL, NODE_USER, NODE_PASS, NX_USER, NX_PASS, NX_PIN, MARKET, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import { unlockIfLocked } from './helpers.mjs';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const pageDir = path.resolve(process.argv[3]);
const shots = path.resolve(process.argv[4] || './dm-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeUrl = env.NODE_URL || 'http://127.0.0.1:7080';
const user = env.NX_USER || 'alice';
const pass = env.NX_PASS || 'alicepass1';
const pin = env.NX_PIN || '1111';
const market = env.MARKET || 'TESTT/BOBT';
const blockWait = Number(env.BLOCK_WAIT_MS || 75000);
const pagePort = 3095;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(pageDir, 'index.html')));
});
await new Promise((r) => server.listen(pagePort, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxdm-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  colorScheme: process.env.DARK === '1' ? 'dark' : 'light',
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
  await p.screenshot({ path: `${shots}/${String(n).padStart(2, '0')}-${name}.png` });
  console.log('shot', name);
}

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  const wallet = await ctx.newPage();
  watch(wallet, 'popup');
  await wallet.goto(`chrome-extension://${extId}/popup.html`);
  await wallet.getByLabel('Core address').fill(nodeUrl);
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
  watch(site, 'site');
  await site.goto(`http://127.0.0.1:${pagePort}/`);
  await site.waitForTimeout(800);
  const result = () => site.locator('#result').textContent();
  const waitResult = async () => {
    await site.waitForFunction(() => !document.getElementById('result').textContent.startsWith('waiting'), null, { timeout: 90000 });
    return result();
  };
  const call = async (id) => {
    await site.bringToFront();
    await site.locator(`#${id}`).click();
    return waitResult();
  };
  const withWindow = async (id) => {
    await site.bringToFront();
    const [win] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), site.locator(`#${id}`).click()]);
    watch(win, 'approve');
    await win.locator('.site-banner').first().waitFor({ timeout: 30000 });
    return win;
  };
  const clickClosing = (loc) => loc.click().catch((e) => {
    if (!String(e.message).includes('closed')) {
      throw e;
    }
  });
  const json = (r) => JSON.parse(r.slice(r.indexOf('\n') + 1));

  await site.fill('#market', market);
  let r = await call('orders');
  check('order book without connect', r.startsWith('ok nexus_getOrders'), r.split('\n')[0]);
  const book = json(r);
  const other = [...book.bids, ...book.asks][0];
  check('order book has an order to fill', !!other, `${book.bids.length} bids, ${book.asks.length} asks`);

  r = await call('myorders');
  check('my orders before connect refused', r.startsWith('error 4100'), r.split('\n')[0]);

  let win = await withWindow('connect');
  await clickClosing(win.getByRole('button', { name: 'Connect' }));
  r = await waitResult();
  check('connect', r.startsWith('ok nexus_connect'));

  await site.fill('#ordertxid', 'ab'.repeat(64));
  r = await call('fillorder');
  check('unknown order refused without window', r.startsWith('error -32602'), r.split('\n')[0]);

  if (other) {
    await site.fill('#ordertxid', other.txid);
    win = await withWindow('fillorder');
    await win.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
    await shot(win, 'fill-request');
    await win.getByLabel('Confirm with your PIN').fill(pin);
    await clickClosing(win.getByRole('button', { name: 'Confirm' }));
    r = await waitResult();
    check('site filled the order', r.startsWith('ok nexus_fillOrder') && r.includes('"txid"'), r.split('\n')[0]);
  }

  await site.fill('#side', 'sell');
  await site.fill('#oamount', '4');
  await site.fill('#oprice', '2.5');
  win = await withWindow('placeorder');
  await win.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
  check('place values locked', (await win.locator('input[readonly]').count()) === 2);
  await shot(win, 'place-request');
  const summary = await win.locator('dl.review').textContent();
  check('place summary', summary.includes('You pay4') && summary.includes('You get10'), summary);
  await win.getByLabel('Confirm with your PIN').fill(pin);
  await clickClosing(win.getByRole('button', { name: 'Confirm' }));
  r = await waitResult();
  check('site placed the order', r.startsWith('ok nexus_placeOrder') && r.includes('"txid"'), r.split('\n')[0]);
  const placed = json(r).txid;

  await site.waitForTimeout(blockWait);
  r = await call('myorders');
  const mine = json(r);
  check('my orders lists the new order', r.startsWith('ok nexus_getMyOrders') && mine.some((o) => o.txid === placed), `${mine.length} orders`);

  await site.fill('#ordertxid', placed);
  win = await withWindow('cancelorder');
  await win.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
  await shot(win, 'cancel-request');
  await win.getByLabel('Confirm with your PIN').fill(pin);
  await clickClosing(win.getByRole('button', { name: 'Confirm' }));
  r = await waitResult();
  check('site cancelled the order', r.startsWith('ok nexus_cancelOrder'), r.split('\n')[0]);

  //reject path
  await site.fill('#oamount', '1');
  win = await withWindow('placeorder');
  await clickClosing(win.getByRole('button', { name: 'Reject' }));
  r = await waitResult();
  check('rejected place request', r.startsWith('error 4001'), r.split('\n')[0]);

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
