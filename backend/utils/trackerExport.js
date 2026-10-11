'use strict';
// Shared Excel export for every tracker. Each tracker's own list handler stays the
// single source of truth for what a row is and how filters work: the export just
// calls it page by page (`collectRows`) and writes the result (`sendWorkbook`).
//
//   ?mode=all       every row of the tracker — the on-screen filters are ignored
//   ?mode=filtered  (default) only the rows matching the filters currently applied
const ExcelJS = require('exceljs');

const MAX_ROWS = 200000;

/** Calls `listFn(req, res)` repeatedly (or once, when `paged` is false) and returns every row it yields. */
async function collectRows(listFn, req, { clear = [], paged = true, pageSize = 100, pick } = {}) {
  const mode = req.query.mode === 'all' ? 'all' : 'filtered';
  const base = { ...req.query };
  if (mode === 'all') clear.forEach((k) => { delete base[k]; });
  delete base.mode;

  const call = (query) => new Promise((resolve, reject) => {
    const fakeRes = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(payload) { resolve({ code: this.statusCode, payload }); return this; },
    };
    Promise.resolve(listFn({ ...req, query }, fakeRes)).catch(reject);
  });

  const rows = [];
  let payloadMeta = null;
  if (!paged) {
    const { code, payload } = await call(base);
    if (code >= 400 || !payload || payload.success === false) throw new Error((payload && payload.message) || 'list failed');
    payloadMeta = payload;
    return { rows: pick ? pick(payload) : (payload.data || []), mode, applied: appliedFilters(base, clear), meta: payloadMeta };
  }

  for (let page = 1; rows.length < MAX_ROWS; page += 1) {
    const { code, payload } = await call({ ...base, page: String(page), limit: String(pageSize) });
    if (code >= 400 || !payload || payload.success === false) throw new Error((payload && payload.message) || 'list failed');
    payloadMeta = payload;
    const chunk = payload.data || [];
    rows.push(...chunk);
    if (!chunk.length || rows.length >= Number(payload.total || 0)) break;
  }
  return { rows, mode, applied: appliedFilters(base, clear), meta: payloadMeta };
}

// Human-readable list of the filters that shaped this export (empty in "all" mode).
function appliedFilters(query, keys) {
  return keys.filter((k) => query[k] !== undefined && query[k] !== '' && query[k] !== 'all').map((k) => [k, String(query[k])]);
}

const isDateLike = (v) => v instanceof Date || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T|\s|$)/.test(v));
const toCell = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v);
  if (typeof v === 'string' && isDateLike(v)) { const d = new Date(v); return Number.isNaN(d.getTime()) ? v : d; }
  return v;
};

/**
 * columns: [{ header, key | get(row), width?, type?: 'date' | 'datetime' | 'money' | 'number' }]
 */
async function sendWorkbook(res, { title, columns, rows, mode, applied, filename }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Meril One';
  wb.created = new Date();

  const sheet = wb.addWorksheet(title.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.header, width: c.width || 16 }));
  for (const r of rows) {
    sheet.addRow(columns.map((c) => toCell(c.get ? c.get(r) : r[c.key])));
  }
  columns.forEach((c, i) => {
    const col = sheet.getColumn(i + 1);
    if (c.type === 'date') col.numFmt = 'dd-mmm-yyyy';
    else if (c.type === 'datetime') col.numFmt = 'dd-mmm-yyyy hh:mm';
    else if (c.type === 'money') col.numFmt = '#,##0.00';
    else if (c.type === 'number') col.numFmt = '#,##0';
  });
  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F1F4B' } };
  head.alignment = { vertical: 'middle' };
  head.height = 22;
  if (rows.length) sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  const info = wb.addWorksheet('Export info');
  info.columns = [{ width: 22 }, { width: 60 }];
  info.addRow(['Tracker', title]);
  info.addRow(['Exported on', new Date().toLocaleString('en-IN')]);
  info.addRow(['Rows exported', rows.length]);
  info.addRow(['Export type', mode === 'all' ? 'All data (filters ignored)' : 'Filtered data (current filters)']);
  if (mode !== 'all') {
    if (!applied.length) info.addRow(['Filters', 'None applied — every row']);
    applied.forEach(([k, v], i) => info.addRow([i === 0 ? 'Filters' : '', `${k}: ${v}`]));
  }
  info.getColumn(1).font = { bold: true };

  const stamp = new Date().toISOString().slice(0, 10);
  const safe = String(filename || title).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}_${mode === 'all' ? 'All' : 'Filtered'}_${stamp}.xlsx"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  await wb.xlsx.write(res);
  res.end();
}

/** Wraps a tracker's export handler so failures return JSON instead of hanging the download. */
const safeHandler = (name, fn) => async (req, res) => {
  try { await fn(req, res); } catch (err) {
    console.error(`${name} export error:`, err);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Export failed' });
  }
};

module.exports = { collectRows, sendWorkbook, safeHandler };
