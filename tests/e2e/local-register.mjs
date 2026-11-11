//"sign in this browser": new token, an account for it, send from its supply, claim, new name and asset; private chain, bob
//node local-register.mjs <extension dir> <screenshot dir>   env NODE_URL, NX_USER, NX_PASS, NX_PIN, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-reg-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeUrl = env.NODE_URL || 'http://127.0.0.1:7080';
const user = env.NX_USER || 'bob';
const pass = env.NX_PASS || 'bobpass12';
const pin = env.NX_PIN || '2222';
const blockWait = Number(env.BLOCK_WAIT_MS || 75000);
const tag = Date.now().toString(36).slice(-5);

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
const api = async (method, params) => (await (await fetch(`${nodeUrl}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })).json());
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlr-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
let page;
let url;
const field = (label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);
const home = async () => {
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
};
//opens Create on a tab, fills, creates, gives the new address
async function create(tab, fill) {
  await home();
  await page.getByRole('button', { name: /^Accounts/ }).click();
  await page.getByRole('button', { name: '+ New account, token or name' }).click();
  await page.locator('.tabs').getByRole('button', { name: tab, exact: true }).click();
  await fill();
  await field('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 90000 });
  const ok = await page.locator('.notice.ok').isVisible();
  check(`create ${tab}`, ok, ok ? '' : await page.locator('.notice.error').textContent());
  await page.waitForTimeout(blockWait);
  return ok;
}
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
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(pass);
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 60000 });

  //token with a global name
  const token = `tk${tag}`;
  await create('Token', async () => {
    await field('Name').fill(token);
    await field('Total supply').fill('1000');
    await field('Decimals').fill('2');
    check('free on this network says so', (await page.locator('.page').textContent()).includes('No fee for this'));
  });
  const named = await api('names/get/name', { name: token });
  const tokenAddr = named.result?.register;
  check('token name is global', !!tokenAddr, JSON.stringify(named.error ?? ''));
  const reg = await api('register/get/any', { address: tokenAddr });
  check('token supply on chain', Number(reg.result?.maxsupply) === 1000 && reg.result?.decimals === 2, JSON.stringify(reg.result ?? {}).slice(0, 120));

  //an account for it
  const holder = `ha${tag}`;
  await create('Account', async () => {
    await field('Name').fill(holder);
    await page.getByLabel('Holds').locator(`option[value="${tokenAddr}"]`).waitFor({ state: 'attached', timeout: 30000 });
    await page.getByLabel('Holds').selectOption(tokenAddr);
  });

  //send from the token's own register
  await home();
  await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  await page.getByLabel('From').locator('option', { hasText: `${token} ` }).first().waitFor({ state: 'attached', timeout: 30000 });
  const opt = (await page.getByLabel('From').locator('option').allTextContents()).find((o) => o.startsWith(`${token} `));
  await page.getByLabel('From').selectOption({ label: opt });
  await field('To').fill(`${user}:${holder}`);
  await page.getByLabel('Amount').fill('100');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Send now' }).click();
  await page.locator('.notice.error, .mono.break').first().waitFor({ timeout: 90000 });
  check('sent from the token supply', !(await page.locator('.notice.error').isVisible().catch(() => false)), (await page.locator('.notice.error').textContent().catch(() => '')) ?? '');
  await page.waitForTimeout(blockWait);

  //claim it
  await home();
  await page.locator('.notice.info.clickable').waitFor({ timeout: 90000 });
  await page.locator('.notice.info.clickable').click();
  await page.getByLabel('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Claim all' }).click();
  await page.locator('.balance-card').waitFor({ timeout: 90000 });
  await page.waitForTimeout(blockWait);
  const holderName = await api('names/get/name', { name: `${user}:${holder}` });
  const held = await api('register/get/any', { address: holderName.result?.register });
  check('account holds the token', Number(held.result?.balance) === 100, String(held.result?.balance));

  //a local name for that account
  const label = `nm${tag}`;
  await create('Name', async () => {
    await field('Name').fill(label);
    await field('Points to').fill(holderName.result.register);
  });
  const n = await api('names/get/name', { name: `${user}:${label}` });
  check('name points to the account', n.result?.register === holderName.result.register, JSON.stringify(n.error ?? ''));

  //asset
  const asset = `as${tag}`;
  await create('Asset', async () => {
    await page.getByLabel('field 1').fill('title');
    await page.getByLabel('value 1').fill('Browser made');
    await page.getByRole('button', { name: '+ field' }).click();
    await page.getByLabel('field 2').fill('maker');
    await page.getByLabel('value 2').fill('const:me');
    await field('Name').fill(asset);
  });
  const a = await api('names/get/name', { name: `${user}:${asset}` });
  const obj = await api('register/get/any', { address: a.result?.register });
  check('asset fields on chain', String(obj.result?.title).startsWith('Browser made') && obj.result?.maker === 'me', JSON.stringify(obj.result ?? {}).slice(0, 200));
  await home();
  await page.getByRole('button', { name: /^Assets/ }).click();
  await page.locator('ul.list li', { hasText: asset }).waitFor({ timeout: 30000 });
  check('asset listed', true);
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
