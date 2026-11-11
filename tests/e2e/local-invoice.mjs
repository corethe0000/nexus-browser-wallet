//"sign in this browser": invoices with bob signing in the extension and alice on her core; private chain
//node local-invoice.mjs <extension dir> <screenshot dir>   env NODE_URL, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-invoice-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);
const tag = Date.now().toString(36).slice(-5);
const bob = 'b7f85360a1d1c8d5bdb34bf401f163c3e70c10fef33ddaacb77ea3c87fc7ea19';
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
const status = async (address) => (await api('register/get/any', { address })).result;
const coreInvoice = async (description) => (await api('invoices/create/invoice', { to: 'testt', recipient: 'bob', items: [{ amount: 0.05, units: 2, description }], pin: '1111' })).result?.address;

//two invoices from alice's core to bob: one to pay, one to reject
const toPay = await coreInvoice(`pay${tag}`);
const toReject = await coreInvoice(`rej${tag}`);
check('alice sent two invoices', !!toPay && !!toReject);
await wait();

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxli-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
let page;
let url;
const field = (label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);
const invoicesTab = async () => {
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Invoices/ }).click();
};
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 640 });
  url = `chrome-extension://${sw.url().split('/')[2]}/popup.html`;
  await page.goto(url);
  await page.getByLabel('Core address').fill(nodeUrl);
  await page.getByLabel('API user').fill('');
  await page.getByText('Sign in this browser (no login on the node)').click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
  await page.getByLabel('Username').fill('bob');
  await page.getByLabel('Password').fill('bobpass12');
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });

  //pay the first one here
  await invoicesTab();
  await page.locator('ul.list li', { hasText: `pay${tag}` }).waitFor({ timeout: 120000 });
  check('invoices from the core listed', (await page.locator('ul.list li', { hasText: `rej${tag}` }).count()) === 1);
  await page.locator('ul.list li', { hasText: `pay${tag}` }).click();
  await page.getByLabel('Pay from').locator('option', { hasText: 'testt' }).first().waitFor({ state: 'attached', timeout: 30000 });
  await page.getByLabel('Pay from').selectOption({ label: (await page.getByLabel('Pay from').locator('option').allTextContents()).find((o) => o.startsWith('testt')) });
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 120000 });
  check('paid here', await page.locator('.notice.ok').isVisible(), (await page.locator('.notice').first().textContent()) ?? '');
  await wait();
  check('core sees it paid by bob', (await status(toPay))?.owner === bob, (await status(toPay))?.owner);

  //reject the second one: it leaves bob's list
  await invoicesTab();
  await page.locator('ul.list li', { hasText: `rej${tag}` }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Reject invoice' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
  await invoicesTab();
  await page.waitForTimeout(3000);
  check('rejected one gone from the list', (await page.locator('ul.list li', { hasText: `rej${tag}` }).count()) === 0);

  //bob sends two: alice pays one with her core, bob cancels the other
  const sendInvoice = async (description) => {
    await invoicesTab();
    await page.getByRole('button', { name: '+ New invoice' }).click();
    await field('Payer (username)').fill('alice');
    await page.getByLabel('Paid into').selectOption({ index: (await page.getByLabel('Paid into').locator('option').allTextContents()).findIndex((o) => o.startsWith('testt ')) });
    await page.getByLabel('description 1').fill(description);
    await page.getByLabel('price 1').fill('0.5');
    await page.getByLabel('qty 1').fill('3');
    await field('Confirm with your PIN').fill(pin);
    await page.getByRole('button', { name: 'Send invoice' }).click();
    await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 120000 });
    const ok = await page.locator('.notice.ok').isVisible();
    check(`invoice ${description} sent`, ok, ok ? '' : await page.locator('.notice.error').textContent());
    const address = ok ? ((await page.locator('.mono.break').textContent()) ?? '').trim() : '';
    await wait();
    return address;
  };
  await sendInvoice(`ext${tag}`);
  const notes = await api('invoices/list/outstanding', { limit: 100 });
  const mine = (notes.result ?? []).find((x) => x.json?.items?.[0]?.description === `ext${tag}`);
  check('alice sees the invoice from the extension', !!mine);
  if (mine) {
    const paid = await api('invoices/pay/invoice', { address: mine.address, from: 'testt', pin: '1111' });
    check('alice paid it with her core', !!paid.result?.txid, JSON.stringify(paid.error ?? ''));
    await wait();
    check('paid by alice', (await status(mine.address))?.owner?.startsWith('b79ead'), (await status(mine.address))?.owner);
  }
  await sendInvoice(`can${tag}`);
  await invoicesTab();
  await page.locator('ul.list li', { hasText: `can${tag}` }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Cancel invoice' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 120000 });
  check('cancelled here', (await page.locator('.notice').first().textContent())?.includes('cancelled'), (await page.locator('.notice').first().textContent()) ?? '');
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
