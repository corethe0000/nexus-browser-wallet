//Firefox check of popup and website flow with selenium + geckodriver, run in nexus-dev from ~/review
//node firefox.mjs <extension zip> <test page dir> <screenshot dir>
//env NODE_URL, NODE_USER, NODE_PASS, NX_USER, NX_PASS, NX_PIN, SEND_TO, SEND_TOKEN, PAGE_PORT
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import fs from 'fs';
import http from 'http';
import path from 'path';

const zip = path.resolve(process.argv[2]);
const pageDir = path.resolve(process.argv[3]);
const shots = path.resolve(process.argv[4] || './ff-shots');
fs.mkdirSync(shots, { recursive: true });

const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const user = process.env.NX_USER || 'alice';
const pass = process.env.NX_PASS || 'alicepass1';
const pin = process.env.NX_PIN || '1111';
const sendTo = process.env.SEND_TO || 'bob:testt';
const sendToken = process.env.SEND_TOKEN || 'TESTT';
const pagePort = Number(process.env.PAGE_PORT || 3097);
const extUuid = '6d1a4b0e-5f0c-4c3e-9a51-2b7c1d9e4f10';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(path.join(pageDir, 'index.html')));
});
await new Promise((r) => server.listen(pagePort, '127.0.0.1', r));
const siteUrl = `http://127.0.0.1:${pagePort}/`;

const opts = new firefox.Options().addArguments('-headless');
//fixed internal id so we know the moz-extension:// address
opts.setPreference('extensions.webextensions.uuids', JSON.stringify({ 'nexus-wallet@local': extUuid }));
opts.setPreference('extensions.webextensions.ExtensionStorageIDB.enabled', true);
const service = new firefox.ServiceBuilder('/snap/bin/geckodriver').addArguments('--allow-system-access');
const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).setFirefoxService(service).build();

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}
let n = 0;
async function shot(name) {
  n += 1;
  fs.writeFileSync(`${shots}/${String(n).padStart(2, '0')}-${name}.png`, await driver.takeScreenshot(), 'base64');
  console.log('shot', name);
}
const byLabel = (text) => By.xpath(`//label[span[@class='field-label' and normalize-space()='${text}']]//*[self::input or self::select]`);
const button = (text) => By.xpath(`//button[normalize-space()='${text}']`);
async function fill(locator, value) {
  const el = await driver.wait(until.elementLocated(locator), 30000);
  await el.clear();
  await el.sendKeys(value);
}

try {
  await driver.installAddon(zip, true);
  await driver.manage().window().setRect({ width: 400, height: 700 });
  //content pages may not open moz-extension:// urls, the browser chrome may
  await driver.setContext(firefox.Context.CHROME);
  const host = await driver.executeScript(`return WebExtensionPolicy.getByID('nexus-wallet@local').mozExtensionHostname;`);
  const popupUrl = `moz-extension://${host}/popup.html`;
  await driver.executeScript(
    `const w = Services.wm.getMostRecentWindow('navigator:browser'); w.openTrustedLinkIn(arguments[0], 'current');`,
    popupUrl,
  );
  await driver.setContext(firefox.Context.CONTENT);
  await driver.wait(async () => (await driver.getCurrentUrl()).startsWith('moz-extension://'), 15000);

  //setup and login
  await fill(byLabel('Core address'), nodeUrl);
  await fill(byLabel('API user'), process.env.NODE_USER || '');
  if (process.env.NODE_PASS) {
    await fill(byLabel('API password'), process.env.NODE_PASS);
  }
  await driver.findElement(button('Connect')).click();
  const first = await driver.wait(until.elementLocated(By.css('.balance-card, input[autocomplete=username], .notice.error, .lock-icon')), 30000);
  if ((await first.getAttribute('class'))?.includes('notice')) {
    throw new Error('connect failed: ' + (await first.getText()));
  }
  //starts locked when the core is already logged in
  if ((await driver.findElements(By.css('.lock-icon'))).length) {
    await fill(byLabel('PIN'), pin);
    await driver.findElement(button('Unlock')).click();
    await driver.wait(until.elementLocated(By.css('.balance-card, input[autocomplete=current-password]')), 60000);
    if ((await driver.findElements(By.css('input[autocomplete=current-password]'))).length) {
      await fill(byLabel('Password'), pass);
      await fill(byLabel('PIN'), pin);
      await driver.findElement(button('Unlock')).click();
    }
  }
  if ((await driver.findElements(By.css('input[autocomplete=username]'))).length) {
    await fill(byLabel('Username'), user);
    await fill(byLabel('Password'), pass);
    await fill(byLabel('PIN'), pin);
    await driver.findElement(button('Log in')).click();
  }
  await driver.wait(until.elementLocated(By.css('li.account')), 60000);
  await shot('home');
  check('popup home with accounts', (await driver.findElements(By.css('li.account'))).length > 0);

  //website flow
  const popupHandle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const siteHandle = await driver.getWindowHandle();
  await driver.get(siteUrl);
  await driver.sleep(1500);
  check('provider injected', (await driver.findElement(By.id('detect')).getText()) === 'window.nexus found');

  const result = () => driver.findElement(By.id('result')).getText();
  async function waitResult() {
    await driver.wait(async () => !(await result()).startsWith('waiting'), 90000);
    return result();
  }
  async function clickAndApprove(buttonId, approve) {
    const before = await driver.getAllWindowHandles();
    await driver.findElement(By.id(buttonId)).click();
    await driver.wait(async () => (await driver.getAllWindowHandles()).length > before.length, 30000);
    const win = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
    await driver.switchTo().window(win);
    await driver.wait(until.elementLocated(By.css('.site-banner')), 30000);
    await approve();
    await driver.switchTo().window(siteHandle);
    return waitResult();
  }

  let r = await clickAndApprove('connect', async () => {
    await shot('connect-request');
    await driver.findElement(button('Connect')).click();
  });
  check('connect approved', r.startsWith('ok nexus_connect') && r.includes(`"username": "${user}"`), r.split('\n')[0]);

  await driver.findElement(By.id('balances')).click();
  r = await waitResult();
  check('balances', r.startsWith('ok nexus_getBalances'), r.split('\n')[0]);

  await fill(By.id('to'), sendTo);
  await fill(By.id('amount'), '0.25');
  await fill(By.id('token'), sendToken);
  r = await clickAndApprove('send', async () => {
    await fill(byLabel('Confirm with your PIN'), pin);
    await shot('send-request');
    await driver.findElement(button('Approve and send')).click();
  });
  check('send approved', r.startsWith('ok nexus_send') && r.includes('"txid"'), r.split('\n')[0]);

  r = await clickAndApprove('signin', async () => {
    await fill(byLabel('Password'), pass);
    await fill(byLabel('PIN'), pin);
    await driver.findElement(button('Sign')).click();
  });
  check('sign in signed', r.startsWith('ok nexus_signIn') && r.includes('"signature"'), r.split('\n')[0]);

  await driver.findElement(By.id('disconnect')).click();
  r = await waitResult();
  check('disconnect', r.startsWith('ok nexus_disconnect'), r.split('\n')[0]);
  await shot('site');

  await driver.switchTo().window(popupHandle);
  await driver.navigate().refresh();
  await driver.wait(until.elementLocated(By.css('.balance-card')), 60000);
  check('popup still fine after the flow', true);
} catch (e) {
  failures += 1;
  console.log('FAIL', e.message);
  try {
    await shot('error');
  } catch {
    //no window left
  }
} finally {
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  await driver.quit();
  server.close();
}
process.exit(failures ? 1 : 0);
