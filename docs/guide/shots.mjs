//screenshots for the user guide (docs/guide), taken on a private test chain, run in nexus-dev from ~/review
//node shots.mjs <extension dir> <test page dir> <out dir>   env NODE_URL (default 127.0.0.1:7080)
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const pageDir = path.resolve(process.argv[3]);
const out = path.resolve(process.argv[4] || './guide-shots');
fs.mkdirSync(out, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);
const newUser = `demo${Date.now().toString(36).slice(-5)}`;

async function open(dark = false) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxg-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    colorScheme: dark ? 'dark' : 'light',
    args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = sw.url().split('/')[2];
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 360, height: 600 });
  await page.goto(`chrome-extension://${id}/popup.html`);
  return { ctx, page, id, profile };
}

async function shot(p, name, full = false) {
  await p.bringToFront();
  //focus moves scroll the page, the guide wants every screen from its top
  await p.evaluate(() => {
    document.activeElement?.blur();
    window.scrollTo(0, 0);
  });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
  console.log('shot', name);
}

const field = (p, label) => p.locator(`label:has(.field-label:text-is("${label}")) input`);

async function connectLocal(page) {
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByText('Sign in this browser (no login on the node)').click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
}

async function login(page, user, pass, pin) {
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 90000 });
  await page.waitForTimeout(3000);
}

//1. a new user: setup without the desktop wallet, create an account, first look
{
  const { ctx, page } = await open();
  await shot(page, '01-setup');
  //a suggested public node: sign in this browser is ticked and locked for it
  await page.locator('.card li', { hasText: 'node1.nexus.io' }).getByRole('button', { name: 'Use' }).click();
  await shot(page, '02-setup-public-node');
  //the screens after it come from the private test chain
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('Sign in this browser (no login on the node)').check();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await shot(page, '03-login');
  await page.getByRole('button', { name: 'Create a new account' }).click();
  await page.getByLabel('Username').fill(newUser);
  await field(page, 'Password').fill('demopass123');
  await page.getByLabel('Password again').fill('demopass123');
  await field(page, 'PIN').fill('2468');
  await page.getByLabel('PIN again').fill('2468');
  await shot(page, '04-create-account', true);
  await page.getByRole('button', { name: 'Create a new account' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 300000 });
  await shot(page, '05-account-created');
  await page.waitForTimeout(blockWait);
  await page.getByRole('button', { name: 'Back', exact: true }).click().catch(() => {});
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await login(page, newUser, 'demopass123', '2468');
  //a private test chain gives a new profile no accounts (mainnet makes default and trust), so make one like a user would
  await page.getByRole('button', { name: '+ New account, token or name' }).click();
  await page.locator('.tabs').getByRole('button', { name: 'Account', exact: true }).click();
  await field(page, 'Name').fill('main');
  await field(page, 'Confirm with your PIN').fill('2468');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 90000 });
  await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
  await page.waitForTimeout(blockWait);
  await page.reload();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot(page, '06-new-wallet');
  await page.locator('.balance-card').getByRole('button', { name: 'Receive', exact: true }).click();
  await page.locator('canvas, .qr').first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await shot(page, '07-receive');
  await ctx.close();
}

//2. an everyday wallet: bob signs in this browser, sends, claims, looks at details
{
  const { ctx, page } = await open();
  await connectLocal(page);
  await login(page, 'bob', 'bobpass12', '2222');
  await shot(page, '10-home');
  await shot(page, '11-home-full', true);
  await page.getByRole('button', { name: 'Send', exact: true }).first().click();
  await page.locator('select').first().waitFor();
  const from = page.locator('select').first();
  const opts = await from.locator('option').allTextContents();
  const testt = opts.find((o) => o.includes('TESTT'));
  if (testt) {
    await from.selectOption({ label: testt });
  }
  await field(page, 'To').fill('alice:testt');
  await field(page, 'Amount').fill('1.5');
  await shot(page, '12-send');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
  await page.getByLabel('Confirm with your PIN').fill('2222');
  await shot(page, '13-review');
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 120000 });
  await shot(page, '14-sent');
  await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
  await page.locator('.balance-card').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Activity' }).click();
  await page.waitForTimeout(4000);
  await shot(page, '15-activity');
  const tx = page.locator('ul.activity li.clickable').first();
  if (await tx.isVisible().catch(() => false)) {
    await tx.click();
    await page.waitForTimeout(3000);
    await shot(page, '16-tx-details');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  }
  const claim = page.getByRole('button', { name: /Claim/ }).first();
  if (await claim.isVisible().catch(() => false)) {
    await claim.click();
    await page.waitForTimeout(3000);
    await shot(page, '17-claim');
  }
  await ctx.close();
}

//3. websites: connect, sign in with Nexus, a payment request (alice through the core)
{
  const port = 3097;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(pageDir, 'index.html')));
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const { ctx, page } = await open();
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
  if (await page.locator('.lock-icon').isVisible()) {
    await page.getByLabel('PIN').fill('1111');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.locator('.balance-card, input[autocomplete=current-password]').first().waitFor({ timeout: 60000 });
  }
  if (await page.locator('input[autocomplete=username]').isVisible()) {
    await login(page, 'alice', 'alicepass1', '1111');
  }
  const site = await ctx.newPage();
  await site.setViewportSize({ width: 900, height: 700 });
  await site.goto(`http://127.0.0.1:${port}/`);
  await site.waitForTimeout(800);
  const withWindow = async (id) => {
    const [win] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), site.locator(`#${id}`).click()]);
    await win.setViewportSize({ width: 380, height: 640 });
    await win.locator('.site-banner').first().waitFor({ timeout: 30000 });
    return win;
  };
  const done = () => site.waitForFunction(() => !document.getElementById('result').textContent.startsWith('waiting'), null, { timeout: 90000 });
  let win = await withWindow('connect');
  await shot(win, '20-site-connect');
  await win.getByRole('button', { name: 'Connect' }).click();
  await done();
  win = await withWindow('signin');
  await win.locator('pre.sign-text').waitFor({ timeout: 30000 });
  await win.getByLabel('Password').fill('alicepass1');
  await win.getByLabel('PIN').fill('1111');
  await shot(win, '21-site-sign-in');
  await win.getByRole('button', { name: 'Sign', exact: true }).click();
  await done();
  await shot(site, '22-site-signed');
  await site.fill('#to', 'bob:testt');
  await site.fill('#amount', '2');
  await site.fill('#token', 'TESTT');
  await site.fill('#reference', '1001');
  win = await withWindow('send');
  await win.getByLabel('Confirm with your PIN').waitFor({ timeout: 30000 });
  await shot(win, '23-site-payment');
  await win.getByRole('button', { name: 'Reject' }).click();
  await done();
  await ctx.close();
  server.close();
}

//4. the same wallet in dark mode
{
  const { ctx, page } = await open(true);
  await connectLocal(page);
  await login(page, 'bob', 'bobpass12', '2222');
  await shot(page, '30-home-dark');
  await ctx.close();
}
console.log('DONE');
