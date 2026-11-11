//screens of the popup for review: every view, light and dark, English and Croatian, with the fixture node's
//scenarios (staking, on hold, not staking, layout edge cases, errors); also checks nothing is wider than the popup
//node uiaudit.mjs <extension dir> <fixture-node.mjs> <screenshot dir>   env TARGET (real core), NX_USER, NX_PASS, NX_PIN
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { unlockIfLocked } from './helpers.mjs';

const extDir = path.resolve(process.argv[2]);
const fixture = path.resolve(process.argv[3]);
const shots = path.resolve(process.argv[4] || './ui-shots');
fs.mkdirSync(shots, { recursive: true });
const env = process.env;
const user = env.NX_USER || 'alice';
const pass = env.NX_PASS || 'alicepass1';
const pin = env.NX_PIN || '1111';
const fixturePort = 7090;
const width = 360;

const node = spawn(process.execPath, [fixture, String(fixturePort), env.TARGET || 'http://127.0.0.1:7080', 'staking'], { stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1000));
const scenario = (name) => fetch(`http://127.0.0.1:${fixturePort}/__scenario/${name}`);

let failures = 0;
const notes = [];
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}

//elements reaching past the popup width, or the page scrolling sideways
async function overflow(page) {
  return page.evaluate((w) => {
    const out = [];
    if (document.documentElement.scrollWidth > w + 1) {
      out.push(`page ${document.documentElement.scrollWidth}px wide`);
    }
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 1) {
        out.push(`${el.tagName.toLowerCase()}.${el.className || ''} right ${Math.round(r.right)}`);
      }
    }
    return out.slice(0, 5);
  }, width);
}

async function run(theme) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `nxui-${theme}-`));
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: false,
    colorScheme: theme,
    args: ['--headless=new', `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const errors = [];
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewportSize({ width, height: 640 });
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

  let n = 0;
  const shot = async (name) => {
    n += 1;
    const file = `${theme}-${String(n).padStart(2, '0')}-${name}.png`;
    await page.screenshot({ path: path.join(shots, file), fullPage: true });
    const o = await overflow(page);
    check(`${theme} ${name} fits ${width}px`, o.length === 0, o.join(', '));
  };
  const home = async () => {
    await page.goto(url);
    await page.locator('.balance-card, .notice.error').first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(2500);
  };

  for (const sc of ['staking', 'onhold', 'notstaking', 'edge']) {
    await scenario(sc);
    await home();
    await shot(`home-${sc}`);
    if (sc === 'staking') {
      const card = (await page.locator('.stake-card').textContent()) ?? '';
      check('staking card numbers', card.includes('15,000 NXS') && card.includes('1.81 %') && card.includes('53.44 %') && card.includes('49.63 %') && card.includes('12.345678'), card);
      check('total includes the stake', ((await page.locator('.balance-big').textContent()) ?? '').includes('16,250.5'), (await page.locator('.balance-big').textContent()) ?? '');
    }
    if (sc === 'onhold') {
      const card = (await page.locator('.stake-card').textContent()) ?? '';
      check('on hold shows time and change', card.includes('90 minutes') && card.includes('750 NXS') && !card.includes('Trust weight'), card);
    }
    if (sc === 'notstaking') {
      const card = (await page.locator('.stake-card').textContent()) ?? '';
      check('not staking shows the hint', card.includes('not staking') && card.includes('desktop wallet'), card);
    }
  }

  //all views with the layout edge cases
  await scenario('edge');
  await home();
  for (const tab of ['Assets', 'Invoices', 'Activity', 'Accounts']) {
    await page.getByRole('button', { name: new RegExp(`^${tab}`) }).click();
    await page.waitForTimeout(1500);
    await shot(`tab-${tab.toLowerCase()}`);
  }
  await page.locator('.balance-card').getByRole('button', { name: 'Send' }).click();
  await page.getByRole('button', { name: 'Review' }).waitFor();
  await page.getByRole('button', { name: 'Review' }).click();
  await shot('send-errors');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.locator('.balance-card').getByRole('button', { name: 'Receive' }).click();
  await page.locator('canvas.qr').waitFor();
  await shot('receive');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.locator('.balance-card').getByRole('button', { name: 'Market' }).click();
  await page.waitForTimeout(2500);
  await shot('market');
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(1000);
  await shot('settings');
  //every language pack: home and settings must fit too (the first select of settings is the language)
  for (const lang of ['hr', 'de', 'fr', 'it', 'es', 'pt', 'nl', 'pl', 'tr', 'id', 'fil']) {
    await page.locator('.page select').first().selectOption(lang);
    await home();
    await shot(`home-${lang}`);
    await page.locator('.header-right .icon-btn').last().click();
    await page.locator('.page select').first().waitFor();
    await page.waitForTimeout(800);
    await shot(`settings-${lang}`);
  }
  await page.locator('.page select').first().selectOption('en');

  //errors from the core
  await scenario('errors');
  await home();
  await shot('home-errors');
  check('core error shown', await page.locator('.notice.error').isVisible());

  check(`${theme} no page errors`, errors.length === 0, errors.join(' | '));
  await ctx.close();
  fs.rmSync(profile, { recursive: true, force: true });
}

try {
  await run('light');
  await run('dark');
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
} finally {
  node.kill();
  console.log(notes.join('\n'));
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
}
process.exit(failures ? 1 : 0);
