//read only check against a real mainnet node, no login: network and a public NXS order book through window.nexus
//node mainnet-readonly.mjs <extension dir> <test page dir>   env NODE_URL, NODE_USER, NODE_PASS, MARKET (default CARBON/NXS)
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const pageDir = path.resolve(process.argv[3]);
const env = process.env;
const market = env.MARKET || 'CARBON/NXS';
const pagePort = 3093;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(pageDir, 'index.html')));
});
await new Promise((r) => server.listen(pagePort, '127.0.0.1', r));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxmain-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}

try {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const wallet = await ctx.newPage();
  await wallet.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
  await wallet.getByLabel('Core address').fill(env.NODE_URL || 'http://127.0.0.1:8080');
  await wallet.getByLabel('API user').fill(env.NODE_USER || '');
  await wallet.getByLabel('API password').fill(env.NODE_PASS || '');
  await wallet.getByRole('button', { name: 'Connect' }).click();
  await wallet.locator('input[autocomplete=username], .balance-card, .lock-icon').first().waitFor({ timeout: 60000 });
  check('popup shows mainnet', (await wallet.locator('.net-row').textContent()).includes('Mainnet'), await wallet.locator('.net-row').textContent());

  const site = await ctx.newPage();
  await site.goto(`http://127.0.0.1:${pagePort}/`);
  await site.waitForTimeout(800);
  const call = (method, params) => site.evaluate(([m, p]) => window.nexus.request({ method: m, params: p }).then((r) => ({ r }), (e) => ({ e: { code: e.code, message: e.message } })), [method, params]);

  const net = await call('nexus_getNetwork');
  check('network is mainnet', net.r?.network === 'mainnet', JSON.stringify(net));

  const book = await call('nexus_getOrders', { market });
  check('order book read', !!book.r, JSON.stringify(book.e ?? {}));
  const orders = [...(book.r?.bids ?? []), ...(book.r?.asks ?? [])];
  const withNxs = orders.filter((o) => o.give.token === '0' || o.want.token === '0');
  check('orders with NXS on this pair', withNxs.length > 0, `${orders.length} orders`);
  for (const o of withNxs.slice(0, 5)) {
    const nxs = o.give.token === '0' ? o.give : o.want;
    const other = o.give.token === '0' ? o.want : o.give;
    //base units would show as millions of NXS for a few tokens
    console.log(`  ${o.type} ${nxs.amount} NXS for ${other.amount} ${other.ticker}, ${(nxs.amount / other.amount).toFixed(6)} NXS each`);
    check('NXS amount is in whole NXS, not base units', nxs.amount < 1000000, `${nxs.amount}`);
  }

  const mine = await call('nexus_getMyOrders', { market });
  check('my orders refused without connect', mine.e?.code === 4100, JSON.stringify(mine.e));
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await ctx.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failures ? 1 : 0);
