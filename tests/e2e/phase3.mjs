//assets, invoices and staking card: popup and website, run in nexus-dev from ~/review
//node phase3.mjs <extension dir> <test page dir> <screenshot dir>
//env NODE_URL, NX_USER, NX_PASS, NX_PIN, INVOICE_PAY (paid through the site), INVOICE_REJECT (rejected in the popup), ASSET_NAME
import { chromium } from 'playwright';
import { unlockIfLocked } from './helpers.mjs';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const pageDir = path.resolve(process.argv[3]);
const shots = path.resolve(process.argv[4] || './p3-shots');
fs.mkdirSync(shots, { recursive: true });

const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const user = process.env.NX_USER || 'alice';
const pass = process.env.NX_PASS || 'alicepass1';
const pin = process.env.NX_PIN || '1111';
const invoicePay = process.env.INVOICE_PAY;
const invoiceReject = process.env.INVOICE_REJECT;
const assetName = process.env.ASSET_NAME || 'painting';
const pagePort = 3098;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(pageDir, 'index.html')));
});
await new Promise((r) => server.listen(pagePort, '127.0.0.1', r));

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nx3-'));
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
let n = 0;
async function shot(p, name) {
  n += 1;
  await p.bringToFront();
  await p.screenshot({ path: `${shots}/${String(n).padStart(2, '0')}-${name}.png` });
  console.log('shot', name);
}
let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const extId = sw.url().split('/')[2];
  const wallet = await ctx.newPage();
  watch(wallet, 'popup');
  await wallet.setViewportSize({ width: 360, height: 640 });
  await wallet.goto(`chrome-extension://${extId}/popup.html`);
  await wallet.getByLabel('Core address').fill(nodeUrl);
  await wallet.getByLabel('API user').fill(process.env.NODE_USER || '');
  await wallet.getByLabel('API password').fill(process.env.NODE_PASS || '');
  await wallet.getByRole('button', { name: 'Connect' }).click();
  await wallet.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
  await unlockIfLocked(wallet, pin, pass);
  if (await wallet.locator('input[autocomplete=username]').isVisible()) {
    await wallet.getByLabel('Username').fill(user);
    await wallet.getByLabel('Password').fill(pass);
    await wallet.getByLabel('PIN').fill(pin);
    await wallet.getByRole('button', { name: 'Log in' }).click();
  }
  await wallet.locator('li.account').first().waitFor({ timeout: 60000 });
  await wallet.waitForTimeout(3000);
  const badge = await wallet.locator('.tabs .badge').textContent().catch(() => '0');
  check('invoices badge', Number(badge) >= 1, `badge ${badge}`);

  await wallet.getByRole('button', { name: /^Assets/ }).click();
  await wallet.locator('li.clickable').first().waitFor({ timeout: 30000 });
  await shot(wallet, 'assets');
  check('asset listed', (await wallet.locator('ul.list:not(.tokens)').textContent()).includes(assetName));
  await wallet.locator('li.clickable', { hasText: assetName }).click();
  await wallet.getByText('Transfer to another user').waitFor();
  await shot(wallet, 'asset-detail');
  check('asset fields shown', (await wallet.locator('dl.review').textContent()).includes('title'));
  await wallet.getByRole('button', { name: 'Back' }).click();

  await wallet.getByRole('button', { name: /^Invoices/ }).click();
  await wallet.locator('li.clickable').first().waitFor({ timeout: 30000 });
  await shot(wallet, 'invoices');

  //site pays one invoice
  const site = await ctx.newPage();
  watch(site, 'site');
  await site.goto(`http://127.0.0.1:${pagePort}/`);
  await site.waitForTimeout(800);
  const result = () => site.locator('#result').textContent();
  const waitResult = async () => {
    await site.waitForFunction(() => !document.getElementById('result').textContent.startsWith('waiting'), null, { timeout: 90000 });
    return result();
  };
  const withWindow = async (id) => {
    const [win] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), site.locator(`#${id}`).click()]);
    watch(win, 'approve');
    await win.locator('.site-banner').first().waitFor({ timeout: 30000 });
    return win;
  };

  //the window closes itself after the answer, a click may see it go
  const clickClosing = (loc) => loc.click().catch((e) => { if (!String(e.message).includes('closed')) throw e; });

  let win = await withWindow('connect');
  await clickClosing(win.getByRole('button', { name: 'Connect' }));
  let r = await waitResult();
  check('connect', r.startsWith('ok nexus_connect'), r.split('\n')[0]);

  await site.bringToFront();
  await site.locator('#assets').click();
  r = await waitResult();
  check('site gets assets', r.startsWith('ok nexus_getAssets') && r.includes(assetName), r.split('\n')[0]);

  await site.fill('#invoice', 'nonsense');
  await site.locator('#payinvoice').click();
  r = await waitResult();
  check('bad invoice address refused', r.startsWith('error -32602'), r.split('\n')[0]);

  if (invoicePay) {
    await site.fill('#invoice', invoicePay);
    win = await withWindow('payinvoice');
    await win.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
    await shot(win, 'invoice-request');
    await win.getByLabel('Confirm with your PIN').fill(pin);
    await clickClosing(win.getByRole('button', { name: 'Pay', exact: true }));
    r = await waitResult();
    check('site invoice paid', r.startsWith('ok nexus_payInvoice') && r.includes('"txid"'), r.split('\n')[0]);
  }

  //popup rejects the other
  if (invoiceReject) {
    await wallet.bringToFront();
    await wallet.reload();
    await wallet.locator('li.account').first().waitFor({ timeout: 60000 });
    await wallet.getByRole('button', { name: /^Invoices/ }).click();
    const item = wallet.locator('li.clickable', { hasText: 'Second item' });
    await item.waitFor({ timeout: 30000 });
    await item.click();
    await wallet.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
    await shot(wallet, 'invoice-detail');
    await wallet.getByLabel('Confirm with your PIN').fill(pin);
    await wallet.getByRole('button', { name: 'Reject invoice' }).click();
    await wallet.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
    const answer = await wallet.locator('.notice.ok, .notice.error').first().textContent();
    //cores before 5.1.6 have no invoices/reject, the wallet has to say so plainly
    check('popup invoice rejected (or core too old)', answer.includes('rejected') || answer.includes('does not support'), answer);
  }

  check('no console errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  let i = 0;
  for (const p of ctx.pages()) {
    i += 1;
    await p.screenshot({ path: `${shots}/error-${i}.png`, fullPage: true }).catch(() => {});
  }
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await ctx.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
