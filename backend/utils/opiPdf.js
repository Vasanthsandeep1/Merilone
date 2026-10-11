// OPI Management: renders a saved OPI as a PDF that looks like Meril's OPI
// Excel templates (Endo: one wide table; Diagnostics: the "ORDER PROCESSING
// INFORMATION" form with its terms). Chrome (puppeteer) prints the HTML.
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const TEMPLATE = require('../config/opiTemplate');

let browserPromise = null;
async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    if (b.connected) return b;
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  return browserPromise;
}

const LOGO = (() => {
  try { return `data:image/png;base64,${fs.readFileSync(path.join(__dirname, 'incentiveLetters', 'assets', 'logo.png')).toString('base64')}`; } catch { return ''; }
})();
const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const money = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (n) => (n == null || n === '' ? '' : `${Number(n).toFixed(2)}%`);
const day = (d) => {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(`${String(d).slice(0, 10)}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? '' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });
};

const BASE_CSS = `
  * { box-sizing: border-box; } body { font-family: Calibri, Arial, sans-serif; color: #111; margin: 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #555; padding: 3px 4px; vertical-align: top; }
  th { background: #1E3A5F; color: #fff; font-weight: 700; }
  .num { text-align: right; white-space: nowrap; } .b { font-weight: 700; } .c { text-align: center; }
  .logo { height: 34px; } .muted { color: #555; }`;

// The department's field layout used for this OPI (see OpiFormat).
const fmtOf = (opi) => ({ hidden: new Set(opi.header?.format?.hidden || []), customHeader: opi.header?.format?.customHeader || [], customLine: opi.header?.format?.customLine || [] });
const extraCell = (f, v) => (f.type === 'number' ? money(v) : f.type === 'date' ? day(v) : v);
const extraDetails = (fields, values) => (fields.length
  ? `<table style="margin-top:6px"><tr><th colspan="4">Additional details</th></tr>${chunk(fields, 2).map((pair) => `<tr>${pair.map((f) => `<td class="lbl">${esc(f.label)}</td><td>${esc(extraCell(f, values?.[f.key]))}</td>`).join('')}${pair.length === 1 ? '<td></td><td></td>' : ''}</tr>`).join('')}</table>`
  : '');
const chunk = (arr, n) => arr.reduce((acc, x, i) => { if (i % n === 0) acc.push([]); acc[acc.length - 1].push(x); return acc; }, []);

function endoHtml(opi, staff) {
  const F = fmtOf(opi);
  const all = [
    ['sn', 'SN', (l, i) => i + 1, 'c'], ['poNo', 'PO / GeM No.', (l) => l.poNo], ['poDate', 'PO / GeM Date', (l) => day(l.poDate)], ['authCode', 'Authorization Code', (l) => l.authCode],
    ['rcNo', 'RC/ RQ no.', (l) => l.rcNo], ['hospitalCode', 'Hospital Code', (l) => l.hospitalCode], ['hospitalName', 'Name of Hospital', (l) => l.hospitalName],
    ['dealerSoldTo', 'Dealer Sold to', (l) => l.dealerSoldTo], ['dealerShipTo', 'Dealer Ship to', (l) => l.dealerShipTo], ['dealerName', 'Dealer Name', (l) => l.dealerName], ['zone', 'Zone', (l) => l.zone],
    ['salesPerson', 'Sales Person', (l) => l.salesPerson], ['productCode', 'Product Code', (l) => l.productCode], ['poQty', 'PO Qty', (l) => l.poQty, 'num'], ['packSize', 'Pack Size', (l) => l.packSize],
    ['section', 'Section', (l) => l.section], ['brandName', 'Brand Name', (l) => l.brandName], ['approvedDiscount', 'Approved Discount %', (l) => pct(l.approvedDiscount), 'num'], ['hp', 'HP', (l) => money(l.hp), 'num'],
    ['rcRate', 'RC Rate', (l) => money(l.rcRate), 'num', 'hp'], ['hospitalPoRate', 'Hospital PO Rate', (l) => money(l.hospitalPoRateUsed), 'num', 'hp'], ['applicableDiscount', 'Applicable Discount Rate %', (l) => pct(l.applicableDiscount), 'num', 'hp'],
    ['applicableRate', 'Applicable Rate', (l) => money(l.applicableRate), 'num', 'hp'], ['dealerMargin', 'Dealer Margin %', (l) => pct(l.dealerMargin), 'num', 'sd'], ['superDistRate', 'Rate for Super Distributor Billing', (l) => money(l.superDistRate), 'num', 'sd'],
    ['superDistMargin', 'Super Distributor Margin %', (l) => pct(l.superDistMargin), 'num', 'm'], ['merilRate', 'Rate for MERIL Billing', (l) => money(l.merilRate), 'num', 'm'], ['dp', 'DP', (l) => money(l.dp), 'num'],
    ['discountOnDp', 'Discount on DP', (l) => pct(l.discountOnDp), 'num'], ['invoiceValue', 'Invoice Value', (l) => money(l.invoiceValue), 'num b'], ['billingLocation', 'Billing Location', (l) => l.billingLocation],
  ].filter(([k]) => k === 'sn' || k === 'invoiceValue' || !F.hidden.has(k));
  const cols = [...all, ...F.customLine.map((f) => [f.key, f.label, (l) => extraCell(f, l.extra?.[f.key]), f.type === 'number' ? 'num' : ''])];
  // Group headings over the rate columns that are still there.
  const groups = []; let gi = 0;
  while (gi < cols.length) {
    const g = cols[gi][4]; let n = 1;
    while (gi + n < cols.length && cols[gi + n][4] === g) n += 1;
    groups.push(g ? `<th colspan="${n}">${{ hp: 'Dealer to HP', sd: 'Super dist to Dealer', m: 'Meril to Super Dist.' }[g]}</th>` : `<th colspan="${n}" style="background:#fff;border:none"></th>`);
    gi += n;
  }
  const valueIdx = cols.findIndex(([k]) => k === 'invoiceValue');
  const rows = opi.items.map((l, i) => `<tr>${cols.map(([, , f, cls]) => `<td class="${cls || ''}">${esc(f(l, i))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    @page { size: A3 landscape; margin: 8mm; } body { font-size: 7.5px; }
    th { font-size: 7px; } .grp th { background: #2C4A72; } .lbl { background: #F1F5F9; font-weight: 700; }
    .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    h1 { font-size: 15px; margin: 0; color: #1E3A5F; } .meta { font-size: 9px; }
    .total td { background: #FFF3C4; font-weight: 700; } .sign { margin-top: 28px; display: flex; justify-content: flex-end; font-size: 10px; }
    .sign div { border-top: 1px solid #333; padding-top: 3px; width: 200px; text-align: center; }</style></head><body>
    <div class="top">
      <div><h1>ENDO OPI · ${esc(opi.opiNo)}</h1><div class="meta">Sales person: <b>${esc(staff.name)}</b> · Created ${day(opi.createdAt)} · ${opi.items.length} line${opi.items.length === 1 ? '' : 's'}</div></div>
      ${LOGO ? `<img class="logo" src="${LOGO}">` : ''}
    </div>
    <table><thead>
      <tr class="grp">${groups.join('')}</tr>
      <tr>${cols.map(([, h]) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}<tr class="total"><td colspan="${valueIdx}" class="num">TOTAL INVOICE VALUE</td><td class="num">${money(opi.value)}</td>${cols.length - valueIdx - 1 ? `<td colspan="${cols.length - valueIdx - 1}"></td>` : ''}</tr></tbody></table>
    ${extraDetails(F.customHeader, opi.header?.extra)}
    ${opi.header?.remarks ? `<p class="meta"><b>Remarks:</b> ${esc(opi.header.remarks)}</p>` : ''}
    <div class="sign"><div>Approved by Finance</div></div>
  </body></html>`;
}

// A department the organisation added: details + lines + total.
function genericHtml(opi, staff) {
  const F = fmtOf(opi); const h = opi.header || {};
  const head = [['customerName', 'Customer / Hospital', h.customerName], ['poNo', 'PO No.', h.poNo], ['poDate', 'PO Date', day(h.poDate)]].filter(([k]) => !F.hidden.has(k));
  const cols = [
    ['item', 'Item / Product', (l) => l.item], ['description', 'Description', (l) => l.description], ['qty', 'Qty', (l) => l.qty, 'num'], ['rate', 'Rate', (l) => money(l.rate), 'num'], ['value', 'Value', (l) => money(l.value), 'num b'],
  ].filter(([k]) => k === 'value' || !F.hidden.has(k));
  const all = [...cols.slice(0, -1), ...F.customLine.map((f) => [f.key, f.label, (l) => extraCell(f, l.extra?.[f.key]), f.type === 'number' ? 'num' : '']), cols[cols.length - 1]];
  const rows = opi.items.map((l) => `<tr>${all.map(([, , f, cls]) => `<td class="${cls || ''}">${esc(f(l))}</td>`).join('')}</tr>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    @page { size: A4 landscape; margin: 10mm; } body { font-size: 10px; } .lbl { background: #F1F5F9; font-weight: 700; width: 18%; }
    .top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; } h1 { font-size: 16px; margin: 0; color: #1E3A5F; }
    .total td { background: #FFF3C4; font-weight: 700; }</style></head><body>
    <div class="top"><div><h1>${esc(String(opi.deptName || 'OPI').toUpperCase())} OPI · ${esc(opi.opiNo)}</h1><div>Sales person: <b>${esc(staff.name)}</b> · Created ${day(opi.createdAt)}</div></div>${LOGO ? `<img class="logo" src="${LOGO}">` : ''}</div>
    ${head.length ? `<table>${chunk(head, 2).map((pair) => `<tr>${pair.map(([, l, v]) => `<td class="lbl">${esc(l)}</td><td>${esc(v)}</td>`).join('')}${pair.length === 1 ? '<td></td><td></td>' : ''}</tr>`).join('')}</table>` : ''}
    ${extraDetails(F.customHeader, h.extra)}
    <table style="margin-top:8px"><tr>${all.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr>${rows}
      <tr class="total"><td colspan="${all.length - 1}" class="num">TOTAL</td><td class="num">${money(opi.value)}</td></tr></table>
    ${h.remarks ? `<p><b>Remarks:</b> ${esc(h.remarks)}</p>` : ''}
  </body></html>`;
}

function diagnosticsHtml(opi, staff) {
  const h = opi.header || {}; const ch = h.charges || {};
  const D = TEMPLATE.diagnostics;
  const F = fmtOf(opi); const show = (k) => !F.hidden.has(k);
  const kyc = [['pan', 'Pancard holder Name/No.'], ['authName', 'Name of Authorized person'], ['gst', 'GST No. &amp; Validity Period'], ['authMobile', 'Mobile No of Authorized person'],
    ['drugLicence', 'Drug LC No &amp; Expiry date'], ['authEmail', 'E Mail ID of Authorized person'], ['aadhar', 'Aadhar Card Number'], ['paymentTerms', 'Payment Terms']].filter(([k]) => show(k));
  const pcols = [['productCode', 'Product Code', (l) => esc(l.productCode)], ['description', 'Product Description', (l) => esc(l.description)], ['majorGroup', 'Major Group', (l) => esc(l.majorGroup)],
    ['packSize', 'Pack Size', (l) => esc(l.packSize)], ['dbPrice', 'DB Price', (l) => money(l.dbPrice), 'num'], ['orderPrice', 'Order price', (l) => money(l.orderPrice), 'num'],
    ['qty', 'Qty', (l) => esc(l.qty), 'num'], ['freeQty', 'Free Qty', (l) => esc(l.freeQty || ''), 'num'], ['value', 'Value', (l) => money(l.value), 'num b'], ['remarks', 'Remarks', (l) => esc(l.remarks)]]
    .filter(([k]) => k === 'value' || show(k))
    .concat(F.customLine.map((f) => [f.key, esc(f.label), (l) => esc(extraCell(f, l.extra?.[f.key])), f.type === 'number' ? 'num' : '']));
  const vIdx = pcols.findIndex(([k]) => k === 'value'); const after = pcols.length - vIdx - 1;
  const lead = Math.min(4, vIdx); const mid = vIdx - lead;
  const tick = (t) => `<span class="box">${h.orderType === t ? '✔' : ''}</span> ${esc(t)}`;
  const rows = opi.items.map((l) => `<tr>${pcols.map(([, , f, cls]) => `<td class="${cls || ''}">${f(l)}</td>`).join('')}</tr>`).join('');
  const tail = after ? `<td colspan="${after}"></td>` : '';
  const sumRow = (label, v, b) => `<td colspan="${mid || 1}"${b ? ' class="b"' : ''}>${label}</td><td class="num${b ? ' b' : ''}">${money(v)}</td>${tail}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
    @page { size: A4; margin: 10mm; } body { font-size: 10px; }
    .title { text-align: center; font-size: 15px; font-weight: 800; color: #1E3A5F; } .sub { text-align: center; font-weight: 700; }
    .lbl { background: #F1F5F9; font-weight: 700; width: 22%; } .yellow { background: #FFF9C4; }
    .box { display: inline-block; width: 12px; height: 12px; border: 1px solid #333; text-align: center; line-height: 11px; font-size: 10px; }
    .types span.t { margin-right: 12px; white-space: nowrap; } h3 { font-size: 11px; margin: 10px 0 4px; } ol { margin: 0; padding-left: 16px; } li { margin: 1px 0; }
    .page2 { page-break-before: always; }</style></head><body>
    <table>
      <tr><td rowspan="2" style="width:22%;border-right:none">${LOGO ? `<img class="logo" src="${LOGO}">` : ''}</td>
        <td colspan="2" class="title" style="border-left:none">ORDER PROCESSING INFORMATION</td><td class="lbl">Customer Code</td><td>${esc(h.customerCode)}</td></tr>
      <tr><td colspan="2" class="sub">${esc(h.orderType || '').toUpperCase()} · ${esc(opi.opiNo)}</td><td class="lbl">PO No.</td><td class="b">${esc(h.poNo)}</td></tr>
      <tr><td colspan="3" rowspan="2"><b>${esc(D.company.name)}</b><br>${D.company.address.map(esc).join('<br>')}<br>E Mail: ${esc(D.company.email)}</td><td class="lbl">PO Date</td><td class="b">${day(h.poDate)}</td></tr>
      <tr><td class="lbl">Order Type</td><td class="types">${D.orderTypes.map((t) => `<span class="t">${tick(t)}</span>`).join(' ')}</td></tr>
    </table>
    <table style="margin-top:6px">
      <tr><th colspan="2">Distributor Billing Name &amp; Postal Address with Pincode</th><th colspan="2">Distributor Shipping Name &amp; Postal Address with Pincode</th></tr>
      <tr><td colspan="2" style="height:60px"><b>${esc(h.billName)}</b><br>${esc(h.billAddress).replace(/\n/g, '<br>')}</td>
          <td colspan="2"><b>${esc(h.shipName)}</b><br>${esc(h.shipAddress).replace(/\n/g, '<br>')}${h.shipLandmark ? `<br>Landmark: ${esc(h.shipLandmark)}` : ''}</td></tr>
      <tr><td colspan="2">City: ${esc(h.billCity)} &nbsp; State: ${esc(h.billState)} &nbsp; Pin Code: ${esc(h.billPin)}</td><td colspan="2">City: ${esc(h.shipCity)} &nbsp; State: ${esc(h.shipState)} &nbsp; Pin Code: ${esc(h.shipPin)}</td></tr>
      ${chunk(kyc, 2).map((pair) => `<tr>${pair.map(([k, l]) => `<td class="lbl">${l}</td><td>${esc(h[k])}</td>`).join('')}${pair.length === 1 ? '<td></td><td></td>' : ''}</tr>`).join('')}
    </table>
    ${extraDetails(F.customHeader, h.extra)}
    <table style="margin-top:6px">
      <tr>${pcols.map(([, l]) => `<th>${l}</th>`).join('')}</tr>
      ${rows}
      <tr><td colspan="${lead || 1}" rowspan="6" style="vertical-align:top"><b>Other Comments or Special Instructions:</b><br>${esc(h.comments).replace(/\n/g, '<br>')}
        <br><br><b>Terms &amp; Condition:</b><br>1. Original Order Copy<br>2. Adv. Payment Details<br>3. Blank Cheq. No. &amp; Dt.<br>4. Scheme/Dis. If applied</td>
        ${sumRow('TOTAL', opi.value, true)}</tr>
      <tr>${sumRow(`GST @ ${esc(ch.gstRate)}%`, ch.gst)}</tr>
      <tr>${sumRow('Special freight charges', ch.freight)}</tr>
      <tr>${sumRow('Additional levi (if any)', ch.levy)}</tr>
      <tr>${sumRow('Any recovery Amount', ch.recovery)}</tr>
      <tr>${sumRow('Total Value', opi.totalValue, true)}</tr>
    </table>
    <table style="margin-top:6px" class="yellow">
      <tr><td class="lbl yellow">FLSP Name:</td><td>${esc(h.flspName || staff.name)}</td><td class="lbl yellow">EMP Code:</td><td>${esc(h.empCode)}</td><td class="lbl yellow">FLSP Email ID:</td><td>${esc(h.flspEmail || staff.email)}</td></tr>
      <tr><td class="lbl yellow">ASM/RSM Name:</td><td colspan="2">${esc(h.rsmName)}</td><td class="lbl yellow">ZSM Name:</td><td colspan="2">${esc(h.zsmName)}</td></tr>
      <tr><td colspan="6" class="b">Remarks: All details mentioned above are mandatory. Need to send duly filled OPI to : ${esc(D.sendTo)}</td></tr>
    </table>
    <div class="page2">
      <h3>Rapid Order Terms &amp; Conditions</h3>
      <p>Dear Channel Partner,<br>Thank you very much for choosing Meril brand kits. We are pleased to inform you that we have processed your order in the SAP system. Your ordered kits is getting invoiced and dispatched shortly. You are kindly requested to go through below order terms and give us your confirmation:-</p>
      <ol>${D.terms.rapid.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <h3>MDPL Supply Terms &amp; Conditions</h3>
      <ol>${D.terms.supply.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    </div>
  </body></html>`;
}

async function renderOpiPdf(opi, staff) {
  const html = opi.division === 'endo' ? endoHtml(opi, staff) : opi.division === 'diagnostics' ? diagnosticsHtml(opi, staff) : genericHtml(opi, staff);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'networkidle0' });
        return await page.pdf({ printBackground: true, preferCSSPageSize: true });
      } finally { await page.close().catch(() => {}); }
    } catch (err) {
      browserPromise = null;
      if (attempt) throw err;
    }
  }
  return null;
}

module.exports = { renderOpiPdf };
