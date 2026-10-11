// OPI Management: "Download as Excel" — fills Meril's own OPI templates
// (config/opi-templates/*.xlsx, copied from the originals) with a saved OPI,
// so the file keeps the original layout, styles and formulas.
//   endo.xlsx        "Endo New OPI format" — one row per line from row 4
//   diagnostics.xlsx "ORDER PROCESSING INFORMATION" form (OPI Format sheet)
const path = require('path');
const ExcelJS = require('exceljs');

const TPL = (name) => path.join(__dirname, '..', 'config', 'opi-templates', `${name}.xlsx`);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const asDate = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? new Date(`${s}T00:00:00Z`) : (s || null));
const f = (formula, result) => ({ formula, result });

// The department's field layout used for this OPI (see OpiFormat).
const fmtOf = (opi) => ({ hidden: new Set(opi.header?.format?.hidden || []), customHeader: opi.header?.format?.customHeader || [], customLine: opi.header?.format?.customLine || [] });
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const extraValue = (fld, v) => (v == null || v === '' ? null : fld.type === 'number' ? (num(v) ?? v) : fld.type === 'date' ? asDate(v) : v);
// Added "details" fields, listed as Label | Value from `row` down.
function writeDetails(ws, row, col, fields, values) {
  if (!fields.length) return;
  const c = (r, k) => ws.getCell(`${colLetter(k)}${r}`);
  c(row, col).value = 'Additional details'; c(row, col).font = { bold: true };
  fields.forEach((fld, i) => {
    c(row + 1 + i, col).value = fld.label; c(row + 1 + i, col).font = { bold: true };
    c(row + 1 + i, col + 1).value = extraValue(fld, values?.[fld.key]);
    if (fld.type === 'date') c(row + 1 + i, col + 1).numFmt = 'dd.mm.yyyy';
  });
}
// Added line columns, from column `startCol`, header in `headRow`.
function writeLineColumns(ws, headRow, firstRow, startCol, fields, items, headStyleFrom) {
  fields.forEach((fld, j) => {
    const col = startCol + j;
    const h = ws.getCell(`${colLetter(col)}${headRow}`);
    h.value = fld.label;
    if (headStyleFrom) h.style = JSON.parse(JSON.stringify(ws.getCell(headStyleFrom).style || {}));
    ws.getColumn(col).width = Math.max(14, fld.label.length + 2);
    items.forEach((l, i) => {
      const cell = ws.getCell(`${colLetter(col)}${firstRow + i}`);
      cell.value = extraValue(fld, l.extra?.[fld.key]);
      if (fld.type === 'date') cell.numFmt = 'dd.mm.yyyy';
    });
  });
}
// Template columns for the Endo fields, so removed ones can be hidden.
const ENDO_COLS = { poNo: 'C', poDate: 'D', authCode: 'E', rcNo: 'F', hospitalCode: 'G', hospitalName: 'H', dealerSoldTo: 'I', dealerShipTo: 'J', dealerName: 'K', zone: 'L', salesPerson: 'M',
  productCode: 'N', poQty: 'O', packSize: 'P', section: 'Q', brandName: 'R', approvedDiscount: 'S', hp: 'T', rcRate: 'U', hospitalPoRate: 'V', applicableDiscount: 'W', applicableRate: 'X',
  dealerMargin: 'Y', superDistRate: 'Z', superDistMargin: 'AA', merilRate: 'AB', dp: 'AC', discountOnDp: 'AD', billingLocation: 'AF' };
const DIAG_LINE_COLS = { productCode: 'B', description: 'C', majorGroup: 'D', packSize: 'E', dbPrice: 'F', orderPrice: 'G', qty: 'H', freeQty: 'I', remarks: 'K' };

const ENDO_FIRST_ROW = 4;
const ENDO_TEMPLATE_ROWS = 52; // rows 4..55 in the template; row 56 holds the total

async function endoWorkbook(opi) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL('endo'));
  const ws = wb.worksheets[0];
  const items = opi.items || [];
  const extra = Math.max(0, items.length - ENDO_TEMPLATE_ROWS);
  if (extra) ws.duplicateRow(ENDO_FIRST_ROW + ENDO_TEMPLATE_ROWS - 1, extra, true);
  const lastRow = ENDO_FIRST_ROW + Math.max(items.length, ENDO_TEMPLATE_ROWS) - 1;

  items.forEach((l, i) => {
    const r = ENDO_FIRST_ROW + i;
    const set = (col, v) => { ws.getCell(`${col}${r}`).value = v; };
    set('B', i + 1);
    set('C', l.poNo || null); set('D', asDate(l.poDate)); set('E', l.authCode || null); set('F', l.rcNo || null);
    set('G', l.hospitalCode || null); set('H', l.hospitalName || null); set('I', l.dealerSoldTo || null); set('J', l.dealerShipTo || null);
    set('K', l.dealerName || null); set('L', l.zone || null); set('M', l.salesPerson || null); set('N', l.productCode || null);
    set('O', num(l.poQty)); set('P', l.packSize || null); set('Q', l.section || null); set('R', l.brandName || null);
    set('S', num(l.approvedDiscount) == null ? null : num(l.approvedDiscount) / 100); set('T', num(l.hp));
    set('Y', num(l.dealerMargin) == null ? null : num(l.dealerMargin) / 100);
    set('AA', num(l.superDistMargin) == null ? null : num(l.superDistMargin) / 100);
    set('AC', num(l.dp)); set('AF', l.billingLocation || null);
    // The template's formulas, with today's results so the file reads right before Excel recalculates.
    set('U', f(`(1-S${r})*T${r}`, l.rcRate));
    set('V', num(l.hospitalPoRate) != null ? num(l.hospitalPoRate) : f(`U${r}`, l.hospitalPoRateUsed));
    set('W', f(`IFERROR((T${r}-V${r})/T${r},0)`, (l.applicableDiscount || 0) / 100));
    set('X', f(`MAX(U${r},V${r})`, l.applicableRate));
    set('Z', f(`X${r}/(1+Y${r})`, l.superDistRate));
    set('AB', f(`Z${r}/(1+AA${r})`, l.merilRate));
    set('AD', f(`IFERROR((AC${r}-AB${r})/AC${r},0)`, (l.discountOnDp || 0) / 100));
    set('AE', f(`IFERROR(AB${r}*O${r},0)`, l.invoiceValue)); // Meril billing rate × qty on every row
  });
  // Unused template rows: keep the template's own formulas (they show 0 / blank).
  ws.getCell(`AE${lastRow + 1}`).value = f(`SUM(AE${ENDO_FIRST_ROW}:AE${lastRow})`, Number(opi.value) || 0);
  if (opi.header?.remarks) ws.getCell(`C${lastRow + 3}`).value = `Remarks: ${opi.header.remarks}`;
  // Fields removed from the department's format: hide their columns; added ones: after the last column.
  const F = fmtOf(opi);
  for (const [k, col] of Object.entries(ENDO_COLS)) if (F.hidden.has(k)) ws.getColumn(col).hidden = true;
  writeLineColumns(ws, 3, ENDO_FIRST_ROW, 33, F.customLine, items, 'AF3'); // AG onwards
  writeDetails(ws, lastRow + 5, 3, F.customHeader, opi.header?.extra);
  return wb;
}

const DIAG_FIRST_ROW = 21;
const DIAG_ROWS = 26; // Table8 rows 21..46

async function diagnosticsWorkbook(opi) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TPL('diagnostics'));
  // The template carried one order's delivery list ("Trench 6") and a scratch sheet — not part of a new OPI.
  for (const name of ['Trench 6', 'Sheet2']) { const s = wb.getWorksheet(name); if (s) wb.removeWorksheet(s.id); }
  const ws = wb.getWorksheet('OPI Format');
  const h = opi.header || {}; const ch = h.charges || {};
  const put = (addr, v) => { ws.getCell(addr).value = v === '' ? null : v; };

  put('C2', (h.orderType || '').toUpperCase() || null);
  put('I1', h.customerCode || null);
  put('I2', h.poNo || null);
  put('I3', h.poDate ? asDate(h.poDate) : null);
  ws.getCell('I3').numFmt = 'dd.mm.yyyy';
  // Order type: tick under the chosen box (row 6, under the labels in row 5).
  const typeCols = { Rapid: 'E', RR: 'F', PRR: 'G', 'Key Cust.': 'H', 'Govt.': 'I' };
  for (const [t, col] of Object.entries(typeCols)) put(`${col}6`, h.orderType === t ? '✔' : null);

  put('B11', h.billName || null);
  put('B12', h.billAddress || null);
  put('B13', null);
  put('E11', [h.shipName, h.shipAddress].filter(Boolean).join('\n') || null);
  put('E14', `Landmark If Any: ${h.shipLandmark || ''}`);
  put('B15', `City: ${h.billCity || ''}`); put('C15', `State: ${h.billState || ''}`); put('D15', `Pin Code: ${h.billPin || ''}`);
  put('E15', `City: ${h.shipCity || ''}`); put('F15', `State: ${h.shipState || ''}`); put('I15', `Pin Code: ${h.shipPin || ''}`);
  put('C16', h.pan || null); put('G16', h.authName || null);
  put('C17', h.gst || null); put('G17', h.authMobile || null);
  put('C18', h.drugLicence || null); put('G18', h.authEmail || null);
  put('C19', h.aadhar || null); put('G19', h.paymentTerms || null);

  const items = (opi.items || []).slice(0, DIAG_ROWS);
  for (let i = 0; i < DIAG_ROWS; i += 1) {
    const r = DIAG_FIRST_ROW + i; const l = items[i];
    const row = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
    if (!l) { for (const c of row) put(`${c}${r}`, null); put(`J${r}`, f(`H${r}*G${r}`, 0)); continue; }
    put(`B${r}`, l.productCode || null); put(`C${r}`, l.description || null); put(`D${r}`, l.majorGroup || null); put(`E${r}`, l.packSize || null);
    put(`F${r}`, num(l.dbPrice)); put(`G${r}`, num(l.orderPrice)); put(`H${r}`, num(l.qty)); put(`I${r}`, num(l.freeQty) || null);
    put(`J${r}`, f(`H${r}*G${r}`, Number(l.value) || 0)); put(`K${r}`, l.remarks || null);
  }
  put('J47', f(`SUM(J${DIAG_FIRST_ROW}:J${DIAG_FIRST_ROW + DIAG_ROWS - 1})`, Number(opi.value) || 0));
  put('H49', `GST @ ${ch.gstRate ?? 5}%`);
  put('J49', f(`J47*${(Number(ch.gstRate ?? 5) || 0) / 100}`, Number(ch.gst) || 0));
  put('J50', num(ch.freight)); put('J51', num(ch.levy)); put('J52', num(ch.recovery));
  put('J53', f('J47+J49+J50+J51+J52', Number(opi.totalValue) || 0));
  put('B48', h.comments || null);
  put('C54', h.flspName || null);
  put('D54', `EMP Code: ${h.empCode || ''}`);
  put('F54', h.flspEmail || null);
  put('C55', h.rsmName || null);
  put('C56', h.zsmName || null);
  // Department format: removed fields left blank / their product columns hidden; added ones written in.
  const F = fmtOf(opi);
  for (const [k, col] of Object.entries(DIAG_LINE_COLS)) if (F.hidden.has(k)) ws.getColumn(col).hidden = true;
  writeLineColumns(ws, 20, DIAG_FIRST_ROW, 13, F.customLine, items, 'K20'); // M onwards (outside the template's table)
  writeDetails(ws, 59, 2, F.customHeader, h.extra);
  return wb;
}

// A department the organisation added: a clean sheet (details, lines, total).
async function genericWorkbook(opi) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('OPI');
  const F = fmtOf(opi); const h = opi.header || {};
  const navy = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  ws.getCell('A1').value = `${String(opi.deptName || 'OPI').toUpperCase()} OPI · ${opi.opiNo}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1E3A5F' } };
  let r = 3;
  for (const [k, label, v] of [['customerName', 'Customer / Hospital', h.customerName], ['poNo', 'PO No.', h.poNo], ['poDate', 'PO Date', h.poDate ? asDate(h.poDate) : null]]) {
    if (F.hidden.has(k)) continue;
    ws.getCell(`A${r}`).value = label; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = v; if (k === 'poDate') ws.getCell(`B${r}`).numFmt = 'dd.mm.yyyy';
    r += 1;
  }
  for (const fld of F.customHeader) {
    ws.getCell(`A${r}`).value = fld.label; ws.getCell(`A${r}`).font = { bold: true };
    ws.getCell(`B${r}`).value = extraValue(fld, h.extra?.[fld.key]); if (fld.type === 'date') ws.getCell(`B${r}`).numFmt = 'dd.mm.yyyy';
    r += 1;
  }
  r += 1;
  const base = [['item', 'Item / Product'], ['description', 'Description'], ['qty', 'Qty'], ['rate', 'Rate']].filter(([k]) => !F.hidden.has(k));
  const cols = [...base.map(([k, label]) => ({ k, label })), ...F.customLine.map((fld) => ({ k: fld.key, label: fld.label, fld })), { k: 'value', label: 'Value' }];
  const headRow = r;
  cols.forEach((c, i) => {
    const cell = ws.getCell(`${colLetter(i + 1)}${headRow}`);
    cell.value = c.label; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = navy;
    ws.getColumn(i + 1).width = Math.max(14, c.label.length + 4);
  });
  (opi.items || []).forEach((l, i) => {
    const row = headRow + 1 + i;
    cols.forEach((c, j) => {
      const cell = ws.getCell(`${colLetter(j + 1)}${row}`);
      if (c.fld) { cell.value = extraValue(c.fld, l.extra?.[c.k]); if (c.fld.type === 'date') cell.numFmt = 'dd.mm.yyyy'; } else cell.value = l[c.k] === '' ? null : l[c.k];
      if (['qty', 'rate', 'value'].includes(c.k)) cell.numFmt = c.k === 'qty' ? '0' : '#,##0.00';
    });
    const qi = cols.findIndex((c) => c.k === 'qty'); const ri = cols.findIndex((c) => c.k === 'rate');
    if (qi >= 0 && ri >= 0) ws.getCell(`${colLetter(cols.length)}${row}`).value = f(`${colLetter(qi + 1)}${row}*${colLetter(ri + 1)}${row}`, l.value);
  });
  const totalRow = headRow + 1 + (opi.items || []).length;
  ws.getCell(`${colLetter(cols.length - 1)}${totalRow}`).value = 'TOTAL';
  ws.getCell(`${colLetter(cols.length - 1)}${totalRow}`).font = { bold: true };
  const tc = ws.getCell(`${colLetter(cols.length)}${totalRow}`);
  tc.value = f(`SUM(${colLetter(cols.length)}${headRow + 1}:${colLetter(cols.length)}${totalRow - 1})`, Number(opi.value) || 0);
  tc.font = { bold: true }; tc.numFmt = '#,##0.00';
  if (h.remarks) ws.getCell(`A${totalRow + 2}`).value = `Remarks: ${h.remarks}`;
  return wb;
}

async function renderOpiExcel(opi) {
  const wb = opi.division === 'endo' ? await endoWorkbook(opi) : opi.division === 'diagnostics' ? await diagnosticsWorkbook(opi) : await genericWorkbook(opi);
  return wb.xlsx.writeBuffer();
}

module.exports = { renderOpiExcel, DIAG_ROWS };
