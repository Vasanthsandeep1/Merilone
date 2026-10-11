// Workdesk > Incentive Letter Generation — renders one person's target letter
// to PDF with headless Chrome (puppeteer), shrinking each target table's font
// until it fits a single A4 landscape page. Ported from the standalone
// targeting-system tool.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { renderLetterHtml, renderBusinessTableHtml, wrapDocument } = require('./pdfTemplate');

const LETTER_DATE = '01st April 2026';
const FY_LABEL = '26-27';

let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.connected) return existing;
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  return browserPromise;
}

// A4 landscape minus 10mm top/bottom margins, in CSS px at 96dpi, with a small buffer.
const PAGE_HEIGHT_PX = Math.floor((210 - 20) * (96 / 25.4) * 0.97);
const MIN_TABLE_FONT_PX = 3.5;
const MAX_TABLE_FONT_PX = 8;

async function shrinkToFit(page, sectionId) {
  if (!(await page.$(`#${sectionId}`))) return;
  let fontSize = MAX_TABLE_FONT_PX;
  for (let i = 0; i < 20; i++) {
    const height = await page.evaluate((id) => document.getElementById(id)?.scrollHeight ?? 0, sectionId);
    if (height <= PAGE_HEIGHT_PX || fontSize <= MIN_TABLE_FONT_PX) break;
    fontSize = Math.max(MIN_TABLE_FONT_PX, fontSize - 0.25);
    await page.evaluate((id, size) => { document.getElementById(id).style.setProperty('--tfs', `${size}px`); }, sectionId, fontSize);
  }
}

const imageDataUriCache = {};
function getImageDataUri(fileName) {
  if (!imageDataUriCache[fileName]) {
    const b64 = fs.readFileSync(path.join(__dirname, 'assets', fileName)).toString('base64');
    imageDataUriCache[fileName] = `data:image/png;base64,${b64}`;
  }
  return imageDataUriCache[fileName];
}

// fyLabel / dateStr: optional (Target Management passes the sheet's year).
async function generatePersonPdf({ personKey, mdpl, mepl, fyLabel = FY_LABEL, dateStr = LETTER_DATE }) {
  const dMdpl = mdpl.byName[personKey];
  const dMepl = mepl.byName[personKey];
  const person = dMdpl || dMepl;
  if (!person) throw new Error('Person not found');

  let html = renderLetterHtml(person, {
    fyLabel,
    dateStr,
    logoDataUri: getImageDataUri('logo.png'),
    anjulSignUri: getImageDataUri('anjulsign.png'),
    shailSignUri: getImageDataUri('shalsign.png'),
    anandSignUri: getImageDataUri('anandsign.png'),
  });

  const table = (id, title, nameLabel, d, businessLabel, categoryLabel) => renderBusinessTableHtml({
    id, title, nameLabel,
    personName: person.displayName,
    target: d.total,
    rsm: d.rsm,
    zonalHead: d.zonalHead,
    groupOrder: Object.keys(d.groups).sort(),
    groups: d.groups,
    footerRoles: ['FLSP/ASM', 'RSM / Dy. ZSM', 'ZSM / ZH', 'Business Head'],
    businessLabel, categoryLabel,
    logoDataUri: getImageDataUri('logo.png'),
    businessHeadSignUri: getImageDataUri('buisnessheadsign.png'),
  });
  if (dMdpl) html += table('table-page-diagnostics', 'SALES TARGET - DIAGNOSTICS', 'Name :', dMdpl, 'Business', 'Business Group');
  if (dMepl) html += table('table-page-endosurgery', 'SALES TARGET - ENDO SURGERY', 'Employee Name :', dMepl, 'Portfolio', 'Category');

  return renderPdfWithRetry(wrapDocument(html));
}

async function renderPdfWithRetry(doc, attempt = 0) {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(doc, { waitUntil: 'networkidle0' });
      await shrinkToFit(page, 'table-page-diagnostics');
      await shrinkToFit(page, 'table-page-endosurgery');
      return Buffer.from(await page.pdf({
        format: 'A4',
        landscape: true,
        printBackground: true,
        margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
      }));
    } finally {
      await page.close().catch(() => {});
    }
  } catch (err) {
    if (attempt === 0) {
      browserPromise = null; // relaunch Chrome once and retry
      return renderPdfWithRetry(doc, attempt + 1);
    }
    throw err;
  }
}

module.exports = { generatePersonPdf };
