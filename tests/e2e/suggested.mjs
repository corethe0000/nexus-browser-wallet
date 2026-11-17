//setup page suggested nodes: Use fills the form (desktop core or a public node with sign in this browser), the API
//hints sit under the password field, nothing wider than the popup in any language; CONNECT=1 also connects to node1
//node suggested.mjs <extension dir> <screenshot dir>
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './suggested-shots');
fs.mkdirSync(shots, { recursive: true });
const width = 360;
const langs = ['en', 'hr', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'tr', 'id', 'fil'];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxw-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});
let sw = ctx.serviceWorkers()[0];
if (!sw) {
  sw = await ctx.waitForEvent('serviceworker');
}
const extId = sw.url().split('/')[2];
const page = await ctx.newPage();
await page.setViewportSize({ width, height: 600 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const url = `chrome-extension://${extId}/popup.html`;
const inputs = () => page.locator('form.page input');
const row = (u) => page.locator('.card li', { hasText: u });
const tooWide = () => page.evaluate((w) => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > w + 1).map((e) => e.className || e.tagName).slice(0, 5), width);

for (const lang of langs) {
  await sw.evaluate((l) => chrome.storage.local.set({ lang: l }), lang);
  await page.goto(url);
  await page.locator('.card li').first().waitFor();
  await row('node1.nexus.io').locator('button').click();
  const wide = await tooWide();
  check(`${lang}: nothing wider than the popup`, wide.length === 0, wide.join(', '));
  await page.screenshot({ path: `${shots}/setup-${lang}.png`, fullPage: true });
}

await sw.evaluate(() => chrome.storage.local.set({ lang: 'en' }));
await page.goto(url);
await page.locator('.card li').first().waitFor();
check('three suggestions', (await page.locator('.card li').count()) === 3);

await row('node1.nexus.io').getByRole('button', { name: 'Use' }).click();
check('node1 fills the address', (await inputs().nth(0).inputValue()) === 'http://node1.nexus.io:8080');
check('node1 clears the API user', (await inputs().nth(1).inputValue()) === '');
check('node1 turns on sign in this browser', await page.getByLabel('Sign in this browser (no login on the node)').isChecked());
check('public hint under the password', await page.getByText('Leave API user and password empty for a public node.').isVisible());

await row('127.0.0.1:8080').getByRole('button', { name: 'Use' }).click();
check('desktop fills the address', (await inputs().nth(0).inputValue()) === 'http://127.0.0.1:8080');
check('desktop sets user apiserver', (await inputs().nth(1).inputValue()) === 'apiserver');
check('desktop turns off sign in this browser', !(await page.getByLabel('Sign in this browser (no login on the node)').isChecked()));
check('nexus.conf hint under the password', await page.getByText('You find apiuser and apipassword in nexus.conf', { exact: false }).isVisible());
await page.screenshot({ path: `${shots}/setup-desktop-en.png`, fullPage: true });

//headless Chrome cannot answer the host permission prompt of Connect, so node1 is saved directly
if (process.env.CONNECT === '1') {
  await sw.evaluate(() => chrome.storage.local.set({ node: { url: 'http://node1.nexus.io:8080', user: '', password: '', mode: 'local' } }));
  await page.goto(url);
  const login = page.getByLabel('Username');
  const ok = await login.waitFor({ timeout: 30000 }).then(() => true, () => false);
  check('node1 in sign in this browser mode opens the login', ok);
  check('no "operator sees your login" warning when signing in this browser', !(await page.getByText('Its operator sees your username', { exact: false }).isVisible()));
  await page.screenshot({ path: `${shots}/node1-login.png`, fullPage: true });
}

check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
