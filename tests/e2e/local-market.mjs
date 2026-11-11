//"sign in this browser": market orders between bob (extension, no login) and alice (her core); private chain, TESTT/BOBT
//node local-market.mjs <extension dir> <screenshot dir>   env NODE_URL, BLOCK_WAIT_MS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-market-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const blockWait = Number(process.env.BLOCK_WAIT_MS || 75000);
const tag = Date.now().toString(36).slice(-5);
const pin = '2222';
const bobTestt = '8CekfnBTnqNDLZAcwVCQP9ge2jbxnAeh2MbVmpKtKtJVkNnahzM';
const aliceTestt = '8BoheBPAFeWSKKSzWuQLxVbVz8wbKW6ZVLmgLU2mmUA9xp5FHkb';
const aliceBobt = '8Bu1Zwsg6zQMezjh6HGyS61exL3ZResPHbxSsZuiMMKuhqoiznv';
//bob's BOBT account (bob:bobt), the token itself is read from it
const bobBobt = '8Bzvd26nG64c9h1UZy4nYK8R97FTSaaq5tgWUWiqTSUAieLxUT8';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
const api = async (method, params) => (await (await fetch(`${nodeUrl}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })).json());
const wait = () => new Promise((r) => setTimeout(r, blockWait));
const balance = async (address) => Number((await api('register/get/any', { address })).result?.balance);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlm-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
const errors = [];
let page;
//the same messages the wallet pages send to the background
const ask = (type, req) => page.evaluate(([t, r]) => chrome.runtime.sendMessage({ type: t, ...r }), [type, req]);
try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
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

  const bobtToken = (await api('register/get/any', { address: bobBobt })).result?.token;
  check('BOBT token found', !!bobtToken && bobtToken !== bobBobt);
  const startBobt = await balance(bobBobt);

  //bob sells 1 TESTT at 2 BOBT, alice fills with her core
  const ask1 = await ask('createOrder', { order: 'ask', market: 'TESTT/BOBT', amount: 1, price: 2, from: bobTestt, to: bobBobt, pin });
  check('bob placed an ask', ask1?.ok, JSON.stringify(ask1?.error ?? ''));
  await wait();
  const listed = await api('market/list/order', { market: 'TESTT/BOBT', limit: 100 });
  check('the core lists it', [...(listed.result?.asks ?? []), ...(listed.result?.bids ?? [])].some((o) => o.txid === ask1?.data?.txid));
  const mine = await ask('myOrders', { tokens: ['TESTT', 'BOBT'] });
  check('bob sees it among his orders', (mine?.data ?? []).some((o) => o.txid === ask1?.data?.txid), JSON.stringify(mine?.error ?? ''));
  const filled = await api('market/execute/order', { txid: ask1?.data?.txid, from: aliceBobt, to: aliceTestt, pin: '1111' });
  check('alice filled it with her core', !!filled.result?.txid, JSON.stringify(filled.error ?? ''));
  await wait();
  const claim = await ask('claimAll', { txids: [filled.result?.txid], pin });
  check('bob claimed the payment', claim?.ok, JSON.stringify(claim?.error ?? ''));
  await wait();
  check('bob got 2 BOBT', (await balance(bobBobt)) - startBobt === 2, `${startBobt} -> ${await balance(bobBobt)}`);

  //alice bids 2 BOBT for TESTT at 2, bob fills here
  const bid = await api('market/create/bid', { market: 'TESTT/BOBT', amount: 2, price: 2, from: aliceBobt, to: aliceTestt, pin: '1111' });
  check('alice placed a bid', !!bid.result?.txid, JSON.stringify(bid.error ?? ''));
  await wait();
  const before = await balance(bobBobt);
  const fill = await ask('executeOrder', { txid: bid.result?.txid, from: bobTestt, to: bobBobt, pin });
  check('bob filled alice\'s bid here', fill?.ok, JSON.stringify(fill?.error ?? ''));
  await wait();
  check('bob got the 2 BOBT of the bid', (await balance(bobBobt)) - before === 2, `${before} -> ${await balance(bobBobt)}`);

  //bob places another and cancels it
  const testtBefore = await balance(bobTestt);
  const ask2 = await ask('createOrder', { order: 'ask', market: 'TESTT/BOBT', amount: 0.5, price: 3, from: bobTestt, to: bobBobt, pin });
  check('bob placed a second ask', ask2?.ok, JSON.stringify(ask2?.error ?? ''));
  await wait();
  const cancel = await ask('cancelOrder', { txid: ask2?.data?.txid, pin });
  check('bob cancelled it', cancel?.ok, JSON.stringify(cancel?.error ?? ''));
  await wait();
  check('the TESTT is back', Math.abs((await balance(bobTestt)) - testtBefore) < 0.001, `${testtBefore} -> ${await balance(bobTestt)}`);
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
