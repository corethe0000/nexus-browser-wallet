//guide.html to a PDF: node build-pdf.mjs <docs/guide folder> <out.pdf>   (shots.mjs makes shots/, install/ are browser screenshots)
import { chromium } from 'playwright';
import path from 'path';
import { pathToFileURL } from 'url';

const dir = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3] || 'nexus-wallet-guide.pdf');
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(path.join(dir, 'guide.html')).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();
console.log('pdf', out);
