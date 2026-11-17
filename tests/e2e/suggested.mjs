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
check('sign in this browser cannot be turned off for node1', await page.getByLabel('Sign in this browser (no login on the node)').isDisabled());
check('says why', await page.getByText('without an API login is always used with Sign in this browser', { exact: false }).isVisible());

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

  //a wallet that saved node1 for a core login before this rule: it now signs in this browser too
  await sw.evaluate(() => chrome.storage.local.set({ node: { url: 'http://node1.nexus.io:8080', user: '', password: '' } }));
  await page.goto(url);
  await page.getByLabel('Username').waitFor({ timeout: 30000 });
  check('old core-login node1 setting signs in this browser', !(await page.getByText('Its operator sees your username', { exact: false }).isVisible()) && (await page.getByText('Signing in this browser', { exact: false }).isVisible()));
}

//a remote node with its own API login keeps the core login, with a warning and a switch
//env REMOTE_URL, REMOTE_USER, REMOTE_PASS
if (process.env.REMOTE_URL) {
  const remote = { url: process.env.REMOTE_URL, user: process.env.REMOTE_USER, password: process.env.REMOTE_PASS };
  await sw.evaluate((n) => chrome.storage.local.set({ node: n }), remote);
  await page.goto(url);
  await page.getByLabel('Username').waitFor({ timeout: 30000 });
  const warning = page.getByText('Its operator sees your username', { exact: false });
  check('remote node with API login warns before a core login', await warning.isVisible());
  await page.screenshot({ path: `${shots}/remote-warning.png`, fullPage: true });
  await page.getByRole('button', { name: 'Sign in this browser instead' }).click();
  await page.getByText('Signing in this browser', { exact: false }).waitFor({ timeout: 30000 }).catch(() => {});
  const saved = await sw.evaluate(() => chrome.storage.local.get('node'));
  check('the switch keeps node and API login and signs in this browser', saved.node?.mode === 'local' && saved.node?.url === remote.url && saved.node?.user === remote.user && saved.node?.password === remote.password);
  check('no warning after the switch', !(await warning.isVisible()));
  await page.screenshot({ path: `${shots}/remote-switched.png`, fullPage: true });
}

check('no page errors', errors.length === 0, errors.join(' | '));
await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
