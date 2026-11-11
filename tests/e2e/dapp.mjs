//website flow: test page calls window.nexus, approval windows are answered, run in nexus-dev from ~/review
//node dapp.mjs <extension dir> <test page dir> <screenshot dir>
//env NODE_URL, NODE_USER, NODE_PASS, NX_USER, NX_PASS, NX_PIN, SEND_TO, SEND_TOKEN, PAGE_PORT
import { chromium } from 'playwright';
import { unlockIfLocked } from './helpers.mjs';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const pageDir = path.resolve(process.argv[3]);
const shots = path.resolve(process.argv[4] || './dapp-shots');
fs.mkdirSync(shots, { recursive: true });

const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const apiUser = process.env.NODE_USER || '';
const apiPass = process.env.NODE_PASS || '';
const user = process.env.NX_USER || 'alice';
const pass = process.env.NX_PASS || 'alicepass1';
const pin = process.env.NX_PIN || '1111';
const sendTo = process.env.SEND_TO || 'bob:testt';
const sendToken = process.env.SEND_TOKEN || 'TESTT';
const pagePort = Number(process.env.PAGE_PORT || 3096);

//the test page, served only while the test runs
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(pageDir, 'index.html')));
});
await new Promise((r) => server.listen(pagePort, '127.0.0.1', r));
const siteUrl = `http://127.0.0.1:${pagePort}/`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxd-'));
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

let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
const extId = sw.url().split('/')[2];

//wallet set up and logged in through the popup page
const wallet = await ctx.newPage();
watch(wallet, 'popup');
await wallet.setViewportSize({ width: 360, height: 600 });
await wallet.goto(`chrome-extension://${extId}/popup.html`);
await wallet.getByLabel('Core address').fill(nodeUrl);
await wallet.getByLabel('API user').fill(apiUser);
await wallet.getByLabel('API password').fill(apiPass);
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
await site.goto(siteUrl);
await site.waitForTimeout(800);
const result = () => site.locator('#result').textContent();

async function call(buttonId) {
  await site.locator(`#${buttonId}`).click();
  await site.waitForFunction(() => !document.getElementById('result').textContent.startsWith('waiting'), null, { timeout: 60000 });
  return result();
}

//click a button that opens an approval window, return that window
async function callWithWindow(buttonId) {
  const [win] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), site.locator(`#${buttonId}`).click()]);
  watch(win, 'approve');
  await win.waitForLoadState();
  try {
    await win.locator('.site-banner').first().waitFor({ timeout: 30000 });
  } catch (e) {
    await shot(win, 'approve-stuck');
    console.log('approve url', win.url(), 'errors', errors.join(' | '));
    console.log((await win.content()).slice(0, 600));
    throw e;
  }
  return win;
}

async function waitResult() {
  await site.waitForFunction(() => !document.getElementById('result').textContent.startsWith('waiting'), null, { timeout: 90000 });
  return result();
}

check('provider injected', (await site.locator('#detect').textContent()) === 'window.nexus found');
check('isNexusWallet flag', await site.evaluate(() => window.nexus.isNexusWallet === true));
check('provider cannot be replaced', await site.evaluate(() => { try { window.nexus = 1; } catch {} return window.nexus.isNexusWallet === true; }));

let r = await call('network');
check('network without connect', r.startsWith('ok nexus_getNetwork') && r.includes('"blocks"'), r.split('\n')[0]);

r = await call('accounts');
check('accounts before connect refused', r.startsWith('error 4100'), r.split('\n')[0]);

let win = await callWithWindow('connect');
await shot(win, 'connect-request');
await win.getByRole('button', { name: 'Reject' }).click();
r = await waitResult();
check('connect rejected', r.startsWith('error 4001'), r.split('\n')[0]);

win = await callWithWindow('connect');
await win.getByRole('button', { name: 'Connect' }).click();
r = await waitResult();
check('connect approved', r.startsWith('ok nexus_connect') && r.includes(`"username": "${user}"`), r.split('\n')[0]);

r = await call('connect');
check('connect again without window', r.startsWith('ok nexus_connect'), r.split('\n')[0]);

r = await call('accounts');
check('accounts after connect', r.startsWith('ok nexus_getAccounts') && r.includes('"address"'), r.split('\n')[0]);
check('accounts carry no balance', !r.includes('"balance"'));

r = await call('balances');
check('balances', r.startsWith('ok nexus_getBalances'), r.split('\n')[0]);

//sign in with Nexus: wrong password first, then the right one, result saved for verify.int.test.ts
win = await callWithWindow('signin');
await win.locator('pre.sign-text').waitFor({ timeout: 30000 });
await shot(win, 'sign-request');
await win.getByLabel('Password').fill(pass + 'x');
await win.getByLabel('PIN').fill(pin);
await win.getByRole('button', { name: 'Sign', exact: true }).click();
await win.locator('.notice.error').waitFor({ timeout: 60000 });
check('sign with wrong password refused', (await win.locator('.notice.error').textContent()).includes('not right'), await win.locator('.notice.error').textContent());
await win.getByLabel('Password').fill(pass);
await win.getByRole('button', { name: 'Sign', exact: true }).click();
r = await waitResult();
check('sign in signed', r.startsWith('ok nexus_signIn') && r.includes('"signature"'), r.split('\n')[0]);
const signed = JSON.parse(r.slice(r.indexOf('\n') + 1));
check('sign in text names the site', signed.message.includes(`URI: ${siteUrl.replace(/\/$/, '')}`) && signed.message.includes('Nonce: testnonce123'));
if (process.env.SIGN_OUT) {
  fs.writeFileSync(process.env.SIGN_OUT, JSON.stringify({ ...signed, origin: siteUrl.replace(/\/$/, '') }));
}

win = await callWithWindow('signmessage');
await win.getByLabel('Password').fill(pass);
await win.getByLabel('PIN').fill(pin);
await win.getByRole('button', { name: 'Sign', exact: true }).click();
r = await waitResult();
check('message signed', r.startsWith('ok nexus_signMessage') && r.includes('hello from the test page'), r.split('\n')[0]);

await site.fill('#nonce', 'bad');
r = await call('signin');
check('bad nonce refused without window', r.startsWith('error -32602'), r.split('\n')[0]);

await site.fill('#to', sendTo);
await site.fill('#amount', 'x');
r = await call('send');
check('bad send params refused without window', r.startsWith('error -32602'), r.split('\n')[0]);

await site.fill('#amount', '0.5');
await site.fill('#token', sendToken);
await site.fill('#reference', '7');
win = await callWithWindow('send');
await win.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
await shot(win, 'send-request');
await win.getByLabel('Confirm with your PIN').fill('0000');
await win.getByRole('button', { name: 'Approve and send' }).click();
await win.locator('.notice.error').waitFor({ timeout: 30000 });
check('wrong pin in approval', (await win.locator('.notice.error').textContent()).includes('PIN'), await win.locator('.notice.error').textContent());
await shot(win, 'send-wrong-pin');
await win.getByLabel('Confirm with your PIN').fill(pin);
await win.getByRole('button', { name: 'Approve and send' }).click();
r = await waitResult();
check('send approved', r.startsWith('ok nexus_send') && r.includes('"txid"'), r.split('\n')[1] ?? r);

//a second request while one waits
win = await callWithWindow('send');
await site.evaluate(() => window.nexus.request({ method: 'nexus_send', params: { to: 'x:y', amount: 1 } }).then(() => (window.__second = 'ok'), (e) => (window.__second = e.code)));
await site.waitForFunction(() => window.__second !== undefined, null, { timeout: 10000 });
check('second request while one waits', (await site.evaluate(() => window.__second)) === -32002);
await win.close();
r = await waitResult();
check('closing the window rejects', r.startsWith('error 4001'), r.split('\n')[0]);

//remove the site in the wallet settings, the page gets an event
await wallet.bringToFront();
await wallet.reload();
await wallet.locator('.balance-card').waitFor({ timeout: 60000 });
await wallet.getByRole('button', { name: 'Settings' }).click();
await wallet.getByRole('heading', { name: 'Connected sites' }).waitFor();
await shot(wallet, 'connected-sites');
await wallet.getByRole('button', { name: 'Remove' }).first().click();
await site.waitForFunction(() => document.getElementById('events').textContent.includes('disconnect'), null, { timeout: 10000 }).catch(() => {});
check('disconnect event after remove', (await site.locator('#events').textContent()).includes('disconnect'));
await site.bringToFront();
r = await call('accounts');
check('accounts refused after remove', r.startsWith('error 4100'), r.split('\n')[0]);

await shot(site, 'site');
check('no console errors', errors.length === 0, errors.join(' | '));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');

await ctx.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
