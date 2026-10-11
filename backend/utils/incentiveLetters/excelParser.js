// Workdesk > Incentive Letter Generation — reads the Zonal budget workbook
// ("ZH - Government Budget 2026-27.xlsx"). The per-person targets live in
// the workbook's two pivot caches, which are streamed straight out of the
// .xlsx zip (the file is ~26 MB; loading it with a spreadsheet library would
// take far longer and far more memory):
//   pivotCache 1 = Meril Endo Surgery (MEPL): FLSP Name / Portfolio / Category
//   pivotCache 2 = Meril Diagnostics (MDPL):  FLSP / Business / Business Group
// Ported from the standalone targeting-system tool.
const yauzl = require('yauzl');
const sax = require('sax');

const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];

function readZipEntry(zipPath, entryName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let found = false;
      zip.on('entry', (entry) => {
        if (entry.fileName === entryName) {
          found = true;
          zip.openReadStream(entry, (err2, stream) => {
            if (err2) return reject(err2);
            resolve(stream);
          });
        } else {
          zip.readEntry();
        }
      });
      zip.on('end', () => {
        if (!found) reject(new Error(`This doesn't look like the budget workbook (missing ${entryName})`));
      });
      zip.readEntry();
    });
  });
}

// pivotCacheDefinitionN.xml -> { fieldNames, sharedItems: [items per field, or null] }
async function parseCacheDefinition(zipPath, entryName) {
  const stream = await readZipEntry(zipPath, entryName);
  const parser = sax.createStream(true, { trim: false });
  const fieldNames = [];
  const sharedItems = [];
  let currentField = -1;
  let inSharedItems = false;

  return new Promise((resolve, reject) => {
    parser.on('opentag', (node) => {
      if (node.name === 'cacheField') {
        fieldNames.push(node.attributes.name);
        sharedItems.push(null);
        currentField = fieldNames.length - 1;
      } else if (node.name === 'sharedItems') {
        inSharedItems = true;
        if (sharedItems[currentField] === null) sharedItems[currentField] = [];
      } else if (inSharedItems && node.name === 's') {
        sharedItems[currentField].push(node.attributes.v);
      } else if (inSharedItems && node.name === 'n') {
        sharedItems[currentField].push(Number(node.attributes.v));
      } else if (inSharedItems && node.name === 'm') {
        sharedItems[currentField].push(null);
      }
    });
    parser.on('closetag', (name) => { if (name === 'sharedItems') inSharedItems = false; });
    parser.on('end', () => resolve({ fieldNames, sharedItems }));
    parser.on('error', reject);
    stream.pipe(parser);
  });
}

// Streams pivotCacheRecordsN.xml, calling onRecord(fields) for each <r>.
async function streamCacheRecords(zipPath, entryName, sharedItems, onRecord) {
  const stream = await readZipEntry(zipPath, entryName);
  const parser = sax.createStream(true, { trim: false });
  let record = null;
  let fieldIdx = -1;

  return new Promise((resolve, reject) => {
    parser.on('opentag', (node) => {
      if (node.name === 'r') {
        record = [];
        fieldIdx = -1;
      } else if (record !== null) {
        fieldIdx++;
        const attrs = node.attributes;
        if (node.name === 'x') {
          const items = sharedItems[fieldIdx];
          record.push(items ? items[Number(attrs.v)] : null);
        } else if (node.name === 'n') {
          record.push(Number(attrs.v));
        } else if (node.name === 's') {
          record.push(attrs.v);
        } else {
          record.push(null);
        }
      }
    });
    parser.on('closetag', (name) => {
      if (name === 'r' && record !== null) {
        onRecord(record);
        record = null;
      }
    });
    parser.on('end', resolve);
    parser.on('error', reject);
    stream.pipe(parser);
  });
}

function normalizeNameKey(name) {
  if (!name) return '';
  return String(name).replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function cleanDisplayName(name) {
  const cleaned = String(name).replace(/\([^)]*\)/g, '').trim().replace(/\s+/g, ' ');
  return cleaned.split(' ').map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join(' ');
}

// Aggregates one pivot cache by person.
// fieldMap: { name, group, category, months: [12 field names Apr..Mar], total }
async function aggregateBusiness(zipPath, defEntry, recEntry, fieldMap) {
  const { fieldNames, sharedItems } = await parseCacheDefinition(zipPath, defEntry);
  const idx = (f) => fieldNames.indexOf(f);
  const nameIdx = idx(fieldMap.name);
  const groupIdx = idx(fieldMap.group);
  const catIdx = idx(fieldMap.category);
  const rsmIdx = idx('RSM');
  const zhIdx = idx('Zonal Head');
  const monthIdxs = fieldMap.months.map((m) => idx(m));
  const totalIdx = idx(fieldMap.total);
  if (nameIdx < 0) throw new Error(`This doesn't look like the budget workbook (no "${fieldMap.name}" column)`);

  const byName = {};
  await streamCacheRecords(zipPath, recEntry, sharedItems, (rec) => {
    const rawName = rec[nameIdx];
    if (!rawName) return;
    const key = normalizeNameKey(rawName);
    const group = rec[groupIdx] || 'Other';
    const category = rec[catIdx] || 'Other';
    const months = monthIdxs.map((i) => Number(rec[i]) || 0);
    const total = Number(rec[totalIdx]) || 0;

    if (!byName[key]) {
      byName[key] = { displayName: cleanDisplayName(rawName), rsm: rec[rsmIdx] || '', zonalHead: rec[zhIdx] || '', groups: {}, total: 0 };
    }
    const person = byName[key];
    if (!person.groups[group]) person.groups[group] = { categories: {} };
    if (!person.groups[group].categories[category]) person.groups[group].categories[category] = { months: new Array(12).fill(0), total: 0 };
    const cell = person.groups[group].categories[category];
    for (let i = 0; i < 12; i++) cell.months[i] += months[i];
    cell.total += total;
    person.total += total;
  });

  return { months: MONTHS, byName };
}

// "Apr-26".."Mar-27"/"Total" hold quantity; the "…2" suffixed fields hold
// value in lakhs, which is what the sheet (and the letter) shows.
const VALUE_MONTHS = ['Apr-262', 'May-262', 'Jun-262', 'Jul-262', 'Aug-262', 'Sep-262', 'Oct-262', 'Nov-262', 'Dec-262', 'Jan-272', 'Feb-272', 'Mar-272'];

async function parseWorkbook(zipPath) {
  const [mepl, mdpl] = await Promise.all([
    aggregateBusiness(zipPath, 'xl/pivotCache/pivotCacheDefinition1.xml', 'xl/pivotCache/pivotCacheRecords1.xml', {
      name: 'FLSP Name', group: 'Portfolio', category: 'Category', months: VALUE_MONTHS, total: 'Total2',
    }),
    aggregateBusiness(zipPath, 'xl/pivotCache/pivotCacheDefinition2.xml', 'xl/pivotCache/pivotCacheRecords2.xml', {
      name: 'FLSP', group: 'Business', category: 'Business Group', months: VALUE_MONTHS, total: 'Total2',
    }),
  ]);

  const allKeys = new Set([...Object.keys(mepl.byName), ...Object.keys(mdpl.byName)]);
  const names = [...allKeys]
    .map((key) => ({
      key,
      displayName: mdpl.byName[key]?.displayName || mepl.byName[key]?.displayName,
      hasDiagnostics: !!mdpl.byName[key],
      hasEndoSurgery: !!mepl.byName[key],
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  return { mepl, mdpl, names };
}

module.exports = { parseWorkbook, normalizeNameKey };
