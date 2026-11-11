//"sign in this browser" with an explorer index: registers sent to bob come from /explorer/incoming (genesis=),
//the same as the block scan finds; an index that lists nothing must give nothing (no block scan behind it)
//node local-index.mjs <extension dir> <screenshot dir>   env NODE_URL, INDEX_URL (backend with the recipient column)
import { chromium } from 'playwright';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './local-index-shots');
fs.mkdirSync(shots, { recursive: true });
const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const indexUrl = process.env.INDEX_URL || 'http://127.0.0.1:5011';
const emptyPort = 5019;
const emptyUrl = `http://127.0.0.1:${emptyPort}`;

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}

//an index that has recipients but nothing for anyone
const empty = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({ result: [], next: null, transfers: true }));
});
await new Promise((r) => empty.listen(emptyPort, '127.0.0.1', r));

//bob logged in with this index ('' = none), the lists the wallet pages ask for
async function listsWith(index) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxlx-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  try {
    const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto(`chrome-extension://${sw.url().split('/')[2]}/popup.html`);
    await page.getByLabel('Core address').fill(nodeUrl);
    await page.getByLabel('API user').fill('');
    await page.getByText('Sign in this browser (no login on the node)').click();
    if (index) {
      await page.getByLabel('Index for incoming payments (optional)').fill(index);
    }
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.locator('input[autocomplete=username]').waitFor({ timeout: 30000 });
    await page.getByLabel('Username').fill('bob');
    await page.getByLabel('Password').fill('bobpass12');
    await page.getByLabel('PIN').fill('2222');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.locator('.balance-card').waitFor({ timeout: 60000 });
    const ask = async (type) => {
      const started = Date.now();
      const r = await page.evaluate((t) => chrome.runtime.sendMessage({ type: t }), type);
      if (!r?.ok) {
        throw new Error(`${type}: ${JSON.stringify(r?.error)}`);
      }
      return { data: r.data, ms: Date.now() - started };
    };
    const invoices = await ask('invoices');
    const notes = await ask('notifications');
    return {
      received: invoices.data.filter((i) => i.recipient === 'b7f85360a1d1c8d5bdb34bf401f163c3e70c10fef33ddaacb77ea3c87fc7ea19').map((i) => i.address).sort(),
      notes: notes.data.map((n) => `${n.txid}:${n.id}`).sort(),
      ms: invoices.ms + notes.ms,
    };
  } finally {
    await ctx.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

try {
  const scan = await listsWith('');
  const indexed = await listsWith(indexUrl);
  const none = await listsWith(emptyUrl);
  console.log(`block scan ${scan.ms} ms, index ${indexed.ms} ms; ${scan.received.length} invoices to bob, ${scan.notes.length} to claim`);
  check('the block scan finds invoices sent to bob', scan.received.length > 0);
  check('the index gives the same invoices', JSON.stringify(indexed.received) === JSON.stringify(scan.received), `${indexed.received.length} vs ${scan.received.length}`);
  check('the index gives the same things to claim', JSON.stringify(indexed.notes) === JSON.stringify(scan.notes), `${indexed.notes.length} vs ${scan.notes.length}`);
  check('an index listing nothing gives no invoices (no scan behind it)', none.received.length === 0, `${none.received.length}`);
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
} finally {
  empty.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
}
process.exit(failures ? 1 : 0);
