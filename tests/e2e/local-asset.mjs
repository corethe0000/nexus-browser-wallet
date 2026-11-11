//"sign in this browser": claim an asset sent by alice (logged in on the node), send it back, alice claims; private chain, bob
//node local-asset.mjs <extension dir> <screenshot dir>   env NODE_URL, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-asset-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);
const tag = Date.now().toString(36).slice(-5);
const user = 'bob';
const pass = 'bobpass12';
const pin = '2222';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
const api = async (method, params) => (await (await fetch(`${nodeUrl}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })).json());
const wait = () => new Promise((r) => setTimeout(r, blockWait));

//alice makes an asset and sends it to bob with her core
const name = `gift${tag}`;
const made = await api('assets/create/asset', { name, format: 'basic', title: 'from alice', pin: '1111' });
check('alice made an asset', !!made.result?.address, JSON.stringify(made.error ?? ''));
const asset = made.result?.address;
await wait();
const sent = await api('assets/transfer/asset', { address: asset, recipient: user, pin: '1111' });
check('alice sent it to bob', !!sent.result?.txid, JSON.stringify(sent.error ?? ''));
await wait();

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxla-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
let page;
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 640 });
  const url = `chrome-extension://${sw.url().split('/')[2]}/popup.html`;
  await page.goto(url);
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByText('Sign in this browser (no login on the node)').click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });

  //the transfer shows as incoming, claim it here
  await page.locator('.notice.info.clickable').waitFor({ timeout: 120000 });
  await page.locator('.notice.info.clickable').click();
  await page.getByText(name).first().waitFor({ timeout: 30000 }).catch(() => {});
  check('incoming list shows the asset', (await page.locator('.page').textContent()).includes('Asset'));
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Claim all' }).click();
  await page.locator('.balance-card, .notice.error').first().waitFor({ timeout: 120000 });
  check('claim sent', await page.locator('.balance-card').isVisible(), (await page.locator('.notice.error').textContent().catch(() => '')) ?? '');
  await wait();
  const owned = await api('register/get/any', { address: asset });
  check('bob owns the asset', String(owned.result?.owner).startsWith('b7f85360'), String(owned.result?.owner));

  //listed under Assets, then sent back to alice
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Assets/ }).click();
  const row = page.locator('ul.list li', { hasText: name }).first();
  await row.waitFor({ timeout: 60000 });
  check('claimed asset listed', true);
  await row.click();
  await page.getByLabel('Recipient').fill('alice');
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 120000 });
  check('sent back to alice', await page.locator('.notice.ok').isVisible(), (await page.locator('.notice').first().textContent()) ?? '');
  await wait();
  const moving = await api('register/get/any', { address: asset });
  check('in transfer, waiting for alice', String(moving.result?.owner).startsWith('00'), String(moving.result?.owner));

  //alice claims it with her core
  const notes = await api('profiles/notifications/master', { limit: 100 });
  const n = (notes.result ?? []).find((x) => x.OP === 'TRANSFER' && x.address === asset);
  check('alice sees it to claim', !!n);
  const claimed = n ? await api('assets/claim/asset', { txid: n.txid, pin: '1111' }) : {};
  check('alice claimed it', !!claimed.result?.txid, JSON.stringify(claimed.error ?? ''));
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
