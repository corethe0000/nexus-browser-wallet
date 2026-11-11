//create accounts, tokens, names and assets, change stake and switch staking (stake parts through the fixture node)
//node manage.mjs <extension dir> <fixture-node.mjs> <screenshot dir>   env TARGET (real core), NX_USER, NX_PASS, NX_PIN
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const fixture = path.resolve(process.argv[3]);
const shots = path.resolve(process.argv[4] || './manage-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const user = env.NX_USER || 'alice';
const pass = env.NX_PASS || 'alicepass1';
const pin = env.NX_PIN || '1111';
const fixturePort = 7091;
const tag = Date.now().toString(36).slice(-5);
const sendTokenAccount = env.SEND_TOKEN_ACCOUNT || 'testt';

const node = spawn(process.execPath, [fixture, String(fixturePort), env.TARGET || 'http://127.0.0.1:7080', 'notstaking'], { stdio: 'inherit', env: { ...env, FIXTURE_PIN: pin } });
await new Promise((r) => setTimeout(r, 1000));

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
let n = 0;
let page;
const shot = async (name) => {
  n += 1;
  await page.screenshot({ path: path.join(shots, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: true });
};
const field = (label) => page.locator(`label:has(.field-label:text-is("${label}")) input`);
const text = async () => (await page.locator('.page').textContent()) ?? '';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxmg-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width: 360, height: 640 });
  const url = `chrome-extension://${sw.url().split('/')[2]}/popup.html`;
  await page.goto(url);
  await page.getByLabel('Core address').fill(`http://127.0.0.1:${fixturePort}`);
  await page.getByLabel('API user').fill('');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
  await unlockIfLocked(page, pin, pass);
  if (await page.locator('input[autocomplete=username]').isVisible()) {
    await page.getByLabel('Username').fill(user);
    await page.getByLabel('Password').fill(pass);
    await page.getByLabel('PIN').fill(pin);
    await page.getByRole('button', { name: 'Log in' }).click();
  }
  await page.locator('.balance-card').waitFor({ timeout: 60000 });

  //stake: fixture says 2000 staked, 3 on the trust account, not staking
  await page.getByRole('button', { name: 'Change stake or start staking' }).click();
  await field('New stake (total)').waitFor();
  await shot('stake');
  check('stake screen shows stake and trust balance', (await text()).includes('2,000') || (await text()).includes('2000'), (await text()).slice(0, 120));
  check('stake buttons wait for the PIN', (await page.getByRole('button', { name: 'Change stake' }).isDisabled()) && (await page.getByRole('button', { name: 'Start staking' }).isDisabled()));
  await field('New stake (total)').fill('2100');
  await field('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Change stake' }).click();
  check('more than stake plus trust balance refused', (await text()).includes('More than staked plus'));
  await field('New stake (total)').fill('2000');
  await page.getByRole('button', { name: 'Change stake' }).click();
  check('same stake refused', (await text()).includes('That is the stake you have now'));
  await field('New stake (total)').fill('2002');
  await page.getByRole('button', { name: 'Change stake' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 15000 });
  check('stake change asked', (await text()).includes('Stake change asked for'), (await text()).slice(0, 200));
  //the pending change comes with the stake info read again after the change
  const pending = await page.getByText(/Stake change to 2,?002/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('pending change shown', pending, (await text()).slice(0, 300));
  check('PIN cleared after the change', (await field('Confirm with your PIN').inputValue()) === '');
  await field('Confirm with your PIN').fill('9999');
  await page.getByRole('button', { name: 'Start staking' }).click();
  await page.locator('.notice.error').first().waitFor({ timeout: 15000 });
  check('wrong PIN shown', (await text()).includes('Invalid credentials'));
  await field('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Start staking' }).click();
  await page.getByRole('button', { name: 'Stop staking' }).waitFor({ timeout: 15000 });
  await shot('staking-on');
  check('staking started', (await text()).includes('The core stakes for this profile now'));
  await field('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Stop staking' }).click();
  await page.getByRole('button', { name: 'Start staking' }).waitFor({ timeout: 15000 });
  check('staking stopped', true);
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  //create: checks first, then one of each on the real chain
  await page.locator('.balance-card').waitFor();
  await page.getByRole('button', { name: /^Accounts/ }).click();
  await page.getByRole('button', { name: '+ New account, token or name' }).click();
  await page.getByRole('button', { name: 'Create', exact: true }).waitFor();
  check('create waits for the PIN', await page.getByRole('button', { name: 'Create', exact: true }).isDisabled());
  await field('Confirm with your PIN').fill(pin);
  await field('Name').fill('has space');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  check('bad name refused', (await text()).includes('A name without spaces'));
  await page.locator('.tabs').getByRole('button', { name: 'Token' }).click();
  await field('Decimals').fill('9');
  await field('Total supply').fill('0');
  await field('Name').fill('ok');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  check('bad supply and decimals refused', (await text()).includes('A whole number from 0 to 8') && (await text()).includes('Enter a valid amount'));
  await shot('create-errors');

  const made = {};
  async function create(kind, fill) {
    await page.goto(url);
    await page.locator('.balance-card').waitFor({ timeout: 60000 });
    if (kind === 'Asset') {
      await page.getByRole('button', { name: /^Assets/ }).click();
      await page.getByRole('button', { name: '+ New asset' }).click();
    } else {
      await page.getByRole('button', { name: /^Accounts/ }).click();
      await page.getByRole('button', { name: '+ New account, token or name' }).click();
      await page.locator('.tabs').getByRole('button', { name: kind, exact: true }).click();
    }
    await fill();
    await field('Confirm with your PIN').fill(pin);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
    await shot(`created-${kind.toLowerCase()}`);
    const ok = await page.locator('.notice.ok').isVisible();
    const addr = ok ? ((await page.locator('.mono.break').textContent()) ?? '') : '';
    check(`create ${kind}`, ok && addr.startsWith('8'), ok ? addr : await page.locator('.notice.error').textContent());
    made[kind] = ok;
  }
  await create('Account', async () => field('Name').fill(`acc${tag}`));
  await create('Token', async () => {
    await field('Name').fill(`tok${tag}`);
    await field('Total supply').fill('1000');
    await field('Decimals').fill('2');
  });
  await create('Name', async () => {
    await field('Name').fill(`nm${tag}`);
    //first own register from the suggestions
    const first = await page.locator('#name-targets option').first().getAttribute('value');
    await field('Points to').fill(first ?? '');
  });
  await create('Asset', async () => {
    await page.getByLabel('field 1').fill('title');
    await page.getByLabel('value 1').fill('Test asset');
    await page.getByRole('button', { name: '+ field' }).click();
    await page.getByLabel('field 2').fill('maker');
    await page.getByLabel('value 2').fill('me');
    await field('Name').fill(`ast${tag}`);
  });

  //invoice to the other test user, form checks first
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Invoices/ }).click();
  await page.getByRole('button', { name: '+ New invoice' }).click();
  await field('Payer (username)').waitFor();
  await field('Confirm with your PIN').fill(pin);
  await page.getByRole('button', { name: 'Send invoice' }).click();
  check('invoice form checks payer and items', (await text()).includes('Enter the username of the payer') && (await text()).includes('Every item needs'));
  await field('Payer (username)').fill(env.INVOICE_PAYER || 'bob');
  await page.getByLabel('Paid into').selectOption({ index: Math.max(0, (await page.getByLabel('Paid into').locator('option').allTextContents()).findIndex((o) => o.startsWith(`${sendTokenAccount} `))) });
  await page.getByLabel('description 1').fill('Work');
  await page.getByLabel('price 1').fill('0.5');
  await page.getByLabel('qty 1').fill('3');
  await page.getByRole('button', { name: '+ item' }).click();
  await page.getByLabel('description 2').fill('Extra');
  await page.getByLabel('price 2').fill('0.25');
  check('invoice total', (await page.locator('.review-total').textContent())?.includes('1.75'), await page.locator('.review-total').textContent());
  await field('Note or order number (optional)').fill(`order ${tag}`);
  await shot('invoice-form');
  await page.getByRole('button', { name: 'Send invoice' }).click();
  await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
  const invOk = await page.locator('.notice.ok').isVisible();
  check('invoice sent', invOk, invOk ? '' : await page.locator('.notice.error').textContent());

  //after the next block they are in the lists
  await page.waitForTimeout(Number(env.BLOCK_WAIT_MS || 75000));
  await page.goto(url);
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: /^Accounts/ }).click();
  await page.locator('li.account').first().waitFor({ timeout: 30000 });
  const accounts = (await page.locator('ul.list').allTextContents()).join(' ');
  if (made.Account) {
    check('new account listed', accounts.includes(`acc${tag}`));
  }
  if (made.Asset) {
    await page.getByRole('button', { name: /^Assets/ }).click();
    await page.getByRole('button', { name: '+ New asset' }).waitFor({ timeout: 30000 });
    check('new asset listed', (await page.locator('ul.list').allTextContents()).join(' ').includes(`ast${tag}`));
  }
  //the sent invoice is under Sent, can be cancelled, not paid
  if (invOk) {
    await page.getByRole('button', { name: /^Invoices/ }).click();
    await page.getByText('Sent, not paid yet').waitFor({ timeout: 30000 });
    await page.locator('ul.list li', { hasText: 'Work' }).first().click();
    await page.getByText('You sent this invoice').waitFor({ timeout: 30000 });
    await shot('invoice-mine');
    check('no pay button on own invoice', (await page.getByRole('button', { name: 'Pay', exact: true }).count()) === 0);
    check('invoice note shown', (await text()).includes(`order ${tag}`));
    await field('Confirm with your PIN').fill(pin);
    await page.getByRole('button', { name: 'Cancel invoice' }).click();
    await page.locator('.notice.ok, .notice.error').first().waitFor({ timeout: 60000 });
    check('invoice cancelled', (await text()).includes('The invoice is cancelled'), await page.locator('.notice').first().textContent());
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  await page?.screenshot({ path: path.join(shots, 'error.png') }).catch(() => {});
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await ctx.close();
  node.kill();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
