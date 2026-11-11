//saved cores: connect two, switch with one click, remove one
//node nodes.mjs <extension dir> <screenshot dir>   env NODE_A (single-user, logged in), NODE_B (multi-user), NX_PIN, NX_PASS
import { chromium } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const shots = path.resolve(process.argv[3] || './nodes-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const nodeA = env.NODE_A || 'http://127.0.0.1:7080';
const nodeB = env.NODE_B || 'http://127.0.0.1:7081';
const pin = env.NX_PIN || '1111';
const pass = env.NX_PASS || 'alicepass1';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nxnd-'));
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
  const connect = async (node) => {
    await page.getByLabel('Core address').fill(node);
    await page.getByLabel('API user').fill('');
    await page.getByRole('button', { name: 'Connect' }).click();
    await page.locator('.balance-card, input[autocomplete=username], .lock-icon').first().waitFor({ timeout: 30000 });
    await unlockIfLocked(page, pin, pass);
  };
  await connect(nodeA);
  check('first core: logged in profile', await page.locator('.balance-card').isVisible());

  //second core from the login or settings screen
  if (await page.locator('.balance-card').isVisible()) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Core settings' }).first().click();
  check('one core: no saved list yet', (await page.getByText('Saved cores').count()) === 0);
  await connect(nodeB);
  check('second core: login screen', await page.locator('input[autocomplete=username]').isVisible());

  //saved list on the core settings page
  await page.getByRole('button', { name: 'Core settings' }).click();
  await page.getByText('Saved cores').waitFor({ timeout: 10000 });
  await page.screenshot({ path: path.join(shots, 'saved-cores.png'), fullPage: true });
  const rows = await page.locator('section.card', { hasText: 'Saved cores' }).locator('li').allTextContents();
  check('both cores listed', rows.length === 2 && rows[0].includes(nodeB) && rows[0].includes('in use') && rows[1].includes(nodeA), rows.join(' | '));
  check('the one in use cannot be removed', (await page.getByRole('button', { name: `Remove ${nodeB}` }).count()) === 0);

  //switch back with one click
  await page.locator('section.card li', { hasText: nodeA }).getByRole('button', { name: 'Use' }).click();
  await page.locator('.balance-card, .lock-icon').first().waitFor({ timeout: 30000 });
  await unlockIfLocked(page, pin, pass);
  check('switched back to the first core', await page.locator('.balance-card').isVisible());

  //remove the other one
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Core settings' }).first().click();
  await page.getByRole('button', { name: `Remove ${nodeB}` }).click();
  await page.getByText('Saved cores').waitFor({ state: 'detached', timeout: 10000 });
  check('removed, list hidden with one core left', true);
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
