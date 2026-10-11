const { QueryTypes } = require('sequelize');
const { sequelize, DistributorMaster, DistributorMapping, DistributorSelection } = require('../models');
const { normalizeCompany } = require('../utils/pricing');
const { resolveActor } = require('../utils/orgActor');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

// Dealer Management > Distributor Mapping — answers "who is our distributor for THIS
// place, THIS institute, THIS department, THIS equipment?".
//
// A distributor's coverage on each of the four dimensions is the union of
//   • home      — where the distributor itself is (master data: city / state)
//   • manual    — what this organisation has mapped by hand (DistributorMapping)
//   • contracts — what the distributor has actually sold on GeM: the states and institutes
//                 it delivered to, the equipment categories/products and the division.
//                 GeM sellers are matched to the master by normalised company name.

const DIMENSIONS = ['state', 'city', 'institute', 'department', 'equipment'];
const DEPARTMENTS = ['Endo-Surgery', 'Diagnostics', '360 Vertical', 'Cardiovascular', 'Orthopedics', 'ENT', 'Other'];
const DIV_DEPT = { endo: 'Endo-Surgery', micro: 'Endo-Surgery', diagno: 'Diagnostics' };
const CONTRACT_DEPT = { endo: 'Endo-Surgery', diagno: 'Diagnostics' };
const INDIA_STATES = ['Andaman & Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra & Nagar Haveli and Daman & Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
// Well-known institute groups, so "AIIMS" finds every AIIMS (matched by name)
const INSTITUTE_FAMILIES = [
  { name: 'AIIMS', like: ['%AIIMS%', '%All India Institute%'] }, { name: 'PGIMER', like: ['%PGIMER%', '%Post Graduate Institute of Medical Education%'] },
  { name: 'ESIC', like: ['%ESIC%', '%Employees State Insurance%', '%Employees State Insuarnce%'] }, { name: 'JIPMER', like: ['%JIPMER%'] },
  { name: 'Medical College', like: ['%Medical College%'] }, { name: 'District Hospital', like: ['%District Hospital%'] },
  { name: 'Railway', like: ['%Railway%'] }, { name: 'Armed Forces / Military', like: ['%Military%', '%Army%', '%Armed Forces%', '%Defence%'] },
  { name: 'CGHS', like: ['%CGHS%', '%Central Government Health%'] }, { name: 'ICMR', like: ['%ICMR%', '%Indian Council of Medical Research%'] },
  { name: 'NIMHANS', like: ['%NIMHANS%'] }, { name: 'Tata Memorial', like: ['%Tata Memorial%'] }, { name: 'SGPGI', like: ['%SGPGI%', '%Sanjay Gandhi%'] },
];

const lc = (s) => String(s || '').trim().toLowerCase();

// "Orissa" / "ODISHA" / "Jammu & Kashmir" / "Jammu and Kashmir" are one state — compare on a canonical key.
const STATE_ALIASES = {
  orissa: 'odisha', uttaranchal: 'uttarakhand', pondicherry: 'puducherry', 'nct of delhi': 'delhi', 'new delhi': 'delhi', chattisgarh: 'chhattisgarh',
  'andaman and nicobar': 'andaman and nicobar islands', 'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu', 'dadra nagar haveli': 'dadra and nagar haveli and daman and diu',
};
const canonState = (s) => {
  const k = lc(s).replace(/&/g, 'and').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  return STATE_ALIASES[k] || k;
};

const STATE_DISPLAY = new Map(INDIA_STATES.map((n) => [canonState(n), n]));
const actorName = async (req) => { try { return (await resolveActor(req))?.actorName || null; } catch (_) { return null; } };

// ---- caches ----------------------------------------------------------------

const TTL = 10 * 60 * 1000;
let masterCache = null;
let evidenceCache = null;
let facetCache = null;

async function getMaster() {
  if (masterCache && Date.now() - masterCache.at < TTL) return masterCache.rows;
  const rows = await DistributorMaster.findAll({ raw: true });
  masterCache = { at: Date.now(), rows };
  return rows;
}

// GeM sales history per seller (normalised name): where, to whom, what, which division.
async function getEvidence() {
  if (evidenceCache && Date.now() - evidenceCache.at < TTL) return evidenceCache.map;
  const grouped = (col) => sequelize.query(
    `SELECT seller_name AS s, ${col} AS k, COUNT(*) AS n, COALESCE(SUM(value_num), 0) AS v
       FROM contracts WHERE seller_name IS NOT NULL AND seller_name <> '' AND ${col} IS NOT NULL AND ${col} <> ''
      GROUP BY seller_name, ${col}`,
    { type: QueryTypes.SELECT },
  );
  const [states, institutes, categories, products, depts] = await Promise.all([
    grouped('hospital_state'), grouped('hospital_name'), grouped('category_name'), grouped('product'), grouped('dept'),
  ]);
  const map = new Map();
  const slot = (seller) => {
    const key = normalizeCompany(seller);
    if (!key) return null;
    if (!map.has(key)) map.set(key, { contracts: 0, value: 0, sellers: new Set(), states: new Map(), institutes: new Map(), categories: new Map(), products: new Map(), depts: new Map() });
    const e = map.get(key); e.sellers.add(seller); return e;
  };
  const add = (rows, field, label = (k) => k) => rows.forEach((r) => {
    const e = slot(r.s); if (!e) return;
    const key = label(r.k); if (!key) return;
    const cur = e[field].get(key) || { n: 0, v: 0 };
    cur.n += Number(r.n); cur.v += Number(r.v);
    e[field].set(key, cur);
    if (field === 'states') { e.contracts += Number(r.n); e.value += Number(r.v); }
  });
  add(states, 'states', (k) => String(k).trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\w)(\w*)/g, (m, a, b) => a + b.toLowerCase()));
  add(institutes, 'institutes');
  add(categories, 'categories');
  add(products, 'products');
  add(depts, 'depts', (k) => CONTRACT_DEPT[lc(k)] || null);
  const last = await sequelize.query("SELECT seller_name AS s, MAX(contract_dt) AS d FROM contracts WHERE seller_name IS NOT NULL AND seller_name <> '' GROUP BY seller_name", { type: QueryTypes.SELECT });
  last.forEach((r) => { const e = slot(r.s); if (e && r.d && (!e.lastDate || new Date(r.d) > e.lastDate)) e.lastDate = new Date(r.d); });
  evidenceCache = { at: Date.now(), map };
  return map;
}

const topEntries = (m, limit) => [...m.entries()].map(([value, x]) => ({ value, n: x.n, amount: Math.round(x.v) })).sort((a, b) => b.n - a.n).slice(0, limit);

// ---- coverage profile of one distributor -----------------------------------

function buildProfile(row, manual, evidence) {
  const ev = evidence.get(row.normName || '') || null;
  const dims = { state: new Map(), city: new Map(), institute: new Map(), department: new Map(), equipment: new Map() };
  const put = (dim, value0, source, n = 0, amount = 0) => {
    if (!value0) return;
    const key = dim === 'state' ? canonState(value0) : lc(value0);
    const value = dim === 'state' ? (STATE_DISPLAY.get(key) || value0) : value0;
    const prev = dims[dim].get(key);
    const rank = { manual: 3, contracts: 2, home: 1 };
    if (!prev) dims[dim].set(key, { value, source, n, amount });
    else {
      if (rank[source] > rank[prev.source]) { prev.source = source; prev.value = value; }
      prev.n += n; prev.amount += amount;
    }
  };
  put('state', row.state, 'home'); put('city', row.city, 'home'); put('city', row.district, 'home');
  put('department', DIV_DEPT[row.division], 'home');
  (manual || []).forEach((m) => put(m.dimension, m.value, 'manual'));
  if (ev) {
    ev.states.forEach((x, k) => put('state', k, 'contracts', x.n, x.v));
    ev.institutes.forEach((x, k) => put('institute', k, 'contracts', x.n, x.v));
    ev.depts.forEach((x, k) => put('department', k, 'contracts', x.n, x.v));
    ev.categories.forEach((x, k) => put('equipment', k, 'contracts', x.n, x.v));
    topEntries(ev.products, 15).forEach((x) => put('equipment', x.value, 'contracts', x.n, x.amount));
  }
  return { dims, contracts: ev ? ev.contracts : 0, value: ev ? Math.round(ev.value) : 0 };
}

const list = (map) => [...map.values()].sort((a, b) => ({ manual: 0, contracts: 1, home: 2 }[a.source] - { manual: 0, contracts: 1, home: 2 }[b.source]) || b.n - a.n);

async function manualByDistributor(userId) {
  const rows = await DistributorMapping.findAll({ where: { userId }, raw: true });
  const map = new Map();
  rows.forEach((r) => { if (!map.has(r.distributorId)) map.set(r.distributorId, []); map.get(r.distributorId).push(r); });
  return map;
}

// ---- endpoints -------------------------------------------------------------

// @route GET /api/distributor-map?state=&city=&institute=&department=&equipment=&division=&type=distributors|all&source=&q=&page=&limit=
exports.search = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { state, city, institute, department, equipment, division, type = 'distributors', source, q } = req.query;
    const anyMatch = req.query.match === 'any'; // best-match mode: rank by how many filters a distributor satisfies instead of requiring all
    const [master, evidence, manual] = await Promise.all([getMaster(), getEvidence(), manualByDistributor(req.user.id)]);

    const active = { state, city, institute, department, equipment };
    const needle = lc(q);
    const out = [];
    let considered = 0;
    for (const row of master) {
      if (type !== 'all' && !row.isDistributor) continue;
      if (division && row.division !== division) continue;
      if (needle && !`${row.name} ${row.city || ''} ${row.sapCode} ${row.gstNo || ''}`.toLowerCase().includes(needle)) continue;
      considered += 1;
      const p = buildProfile(row, manual.get(row.id), evidence);

      let ok = true; let score = 0;
      const matches = [];
      const missed = [];
      for (const dim of DIMENSIONS) {
        const f = lc(active[dim]);
        if (!f) continue;
        const hits = list(p.dims[dim]).filter((e) => (dim === 'state' ? canonState(e.value) === canonState(f) : dim === 'city' ? lc(e.value) === f : lc(e.value).includes(f)));
        const usable = source ? hits.filter((h) => h.source === source) : hits;
        if (!usable.length) { if (anyMatch) { missed.push(dim); continue; } ok = false; break; }
        matches.push({ dimension: dim, values: usable.slice(0, 4) });
        const best = usable[0];
        score += best.source === 'manual' ? 3 : best.source === 'contracts' ? 2 + Math.min(best.n, 50) / 100 : 1;
      }
      if (!ok) continue;
      if (anyMatch && !matches.length && Object.values(active).some((v) => lc(v))) continue;

      out.push({
        id: row.id, sapCode: row.sapCode, name: row.name, division: row.division, department: DIV_DEPT[row.division],
        city: row.city, state: row.state, pincode: row.pincode, phone: row.phone, email: row.email, contactPerson: row.contactPerson,
        classDescription: row.classDescription, isDistributor: !!row.isDistributor, isAuthorised: !!row.isAuthorised, gstNo: row.gstNo,
        contracts: p.contracts, contractValue: p.value, score,
        matches, missed,
        coverage: {
          states: p.dims.state.size, cities: p.dims.city.size, institutes: p.dims.institute.size,
          departments: list(p.dims.department).map((e) => e.value), equipment: p.dims.equipment.size,
          manual: (manual.get(row.id) || []).length,
        },
      });
    }
    // best-match mode ranks by how many filters were satisfied first
    if (anyMatch) out.forEach((r) => { r.score += r.matches.length * 10; });
    out.sort((a, b) => b.score - a.score || b.contracts - a.contracts || a.name.localeCompare(b.name));
    res.json({
      success: true, data: out.slice((page - 1) * limit, page * limit), total: out.length, page, limit,
      summary: { considered, mapped: out.filter((r) => r.coverage.manual > 0).length, withHistory: out.filter((r) => r.contracts > 0).length },
    });
  } catch (err) {
    console.error('distributor map search error:', err);
    res.status(500).json({ success: false, message: 'Failed to search distributors' });
  }
};

// @route GET /api/distributor-map/coverage?type=&division=
// State × department grid of how many distributors cover each — zeros are the gaps.
exports.coverage = async (req, res) => {
  try {
    const { type = 'distributors', division } = req.query;
    const [master, evidence, manual] = await Promise.all([getMaster(), getEvidence(), manualByDistributor(req.user.id)]);
    const grid = new Map(INDIA_STATES.map((s) => [s, { state: s, total: new Set(), byDept: {} }]));
    const deptsUsed = new Set(['Endo-Surgery', 'Diagnostics']);
    for (const row of master) {
      if (type !== 'all' && !row.isDistributor) continue;
      if (division && row.division !== division) continue;
      const p = buildProfile(row, manual.get(row.id), evidence);
      const states = list(p.dims.state).map((e) => e.value);
      const depts = list(p.dims.department).map((e) => e.value);
      depts.forEach((d) => deptsUsed.add(d));
      for (const s of states) {
        const g = grid.get(STATE_DISPLAY.get(canonState(s)) || s);
        if (!g) continue;
        g.total.add(row.id);
        for (const d of depts) { (g.byDept[d] = g.byDept[d] || new Set()).add(row.id); }
      }
    }
    const departments = DEPARTMENTS.filter((d) => deptsUsed.has(d)).concat([...deptsUsed].filter((d) => !DEPARTMENTS.includes(d)));
    const rows = [...grid.values()].map((g) => ({ state: g.state, total: g.total.size, byDept: Object.fromEntries(departments.map((d) => [d, g.byDept[d] ? g.byDept[d].size : 0])) }))
      .sort((a, b) => b.total - a.total || a.state.localeCompare(b.state));
    res.json({ success: true, departments, data: rows, gaps: rows.filter((r) => r.total === 0).length });
  } catch (err) {
    console.error('distributor map coverage error:', err);
    res.status(500).json({ success: false, message: 'Failed to build coverage' });
  }
};

// @route GET /api/distributor-map/state?name=Delhi&type=&division=
// Everything about ONE state — what the Coverage map shows when you open a state.
exports.stateDetail = async (req, res) => {
  try {
    const name = STATE_DISPLAY.get(canonState(req.query.name));
    if (!name) return res.status(404).json({ success: false, message: 'Unknown state' });
    const { type = 'distributors', division } = req.query;
    const key = canonState(name);
    const [master, evidence, manual] = await Promise.all([getMaster(), getEvidence(), manualByDistributor(req.user.id)]);

    const byDept = {}; const byDivision = { endo: 0, micro: 0, diagno: 0 }; const cities = new Map();
    const covering = [];
    const pins = [];   // distributors based in the state that have a map position
    let based = 0; let authorised = 0;
    for (const row of master) {
      if (type !== 'all' && !row.isDistributor) continue;
      if (division && row.division !== division) continue;
      const p = buildProfile(row, manual.get(row.id), evidence);
      const st = [...p.dims.state.values()].find((e) => canonState(e.value) === key);
      if (!st) continue;
      const depts = list(p.dims.department).map((e) => e.value);
      depts.forEach((d) => { byDept[d] = (byDept[d] || 0) + 1; });
      byDivision[row.division] += 1;
      if (row.isAuthorised) authorised += 1;
      const isHome = canonState(row.state) === key;
      if (isHome) { based += 1; const c = (row.city || row.district || 'Unknown').trim(); cities.set(c, (cities.get(c) || 0) + 1); }
      if (isHome && row.lat != null && row.lng != null) {
        pins.push({ id: row.id, name: row.name, sapCode: row.sapCode, division: row.division, city: row.city, lat: Number(row.lat), lng: Number(row.lng), geoLevel: row.geoLevel, departments: depts, authorised: !!row.isAuthorised, contracts: p.contracts });
      }
      covering.push({ id: row.id, name: row.name, sapCode: row.sapCode, division: row.division, city: row.city, home: isHome, source: st.source, stateContracts: st.n, stateValue: Math.round(st.amount), departments: depts, contracts: p.contracts, authorised: !!row.isAuthorised });
    }
    covering.sort((a, b) => b.stateContracts - a.stateContracts || Number(b.home) - Number(a.home) || b.contracts - a.contracts || a.name.localeCompare(b.name));

    // GeM demand in the state: institutes buying and equipment bought, with how many distributors already sell there
    const variants = (await sequelize.query("SELECT DISTINCT hospital_state AS s FROM contracts WHERE hospital_state IS NOT NULL AND hospital_state <> ''", { type: QueryTypes.SELECT }))
      .map((r) => r.s).filter((s) => canonState(s) === key);
    let institutes = []; let equipment = []; let totals = { contracts: 0, value: 0, sellers: 0 };
    if (variants.length) {
      const rep = { variants };
      [institutes, equipment, [totals]] = await Promise.all([
        sequelize.query("SELECT hospital_name AS name, COUNT(*) AS n, COUNT(DISTINCT seller_name) AS sellers, COALESCE(SUM(value_num),0) AS v FROM contracts WHERE hospital_state IN (:variants) AND hospital_name <> '' GROUP BY hospital_name ORDER BY n DESC LIMIT 12", { replacements: rep, type: QueryTypes.SELECT }),
        sequelize.query("SELECT category_name AS name, COUNT(*) AS n, COUNT(DISTINCT seller_name) AS sellers, COALESCE(SUM(value_num),0) AS v FROM contracts WHERE hospital_state IN (:variants) AND category_name <> '' GROUP BY category_name ORDER BY n DESC LIMIT 12", { replacements: rep, type: QueryTypes.SELECT }),
        sequelize.query("SELECT COUNT(*) AS contracts, COALESCE(SUM(value_num),0) AS value, COUNT(DISTINCT seller_name) AS sellers FROM contracts WHERE hospital_state IN (:variants)", { replacements: rep, type: QueryTypes.SELECT }),
      ]);
    }
    const num = (r) => ({ name: r.name, n: Number(r.n), sellers: Number(r.sellers), amount: Math.round(Number(r.v)) });
    res.json({
      success: true,
      data: {
        state: name,
        distributors: covering.length, based, authorised, byDept, byDivision,
        cities: [...cities.entries()].map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n).slice(0, 15),
        top: covering.slice(0, 12),
        pins,
        institutes: institutes.map(num), equipment: equipment.map(num),
        gem: { contracts: Number(totals.contracts || 0), value: Math.round(Number(totals.value || 0)), sellers: Number(totals.sellers || 0) },
      },
    });
  } catch (err) {
    console.error('distributor map state error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the state' });
  }
};

// @route GET /api/distributor-map/cities?state=Tamil Nadu&type=&division=
// The cities / districts where this state's distributors are based — feeds the City dropdown.
exports.cities = async (req, res) => {
  try {
    const { state, type = 'distributors', division } = req.query;
    if (!state) return res.json({ success: true, data: [] });
    const key = canonState(state);
    const master = await getMaster();
    const counts = new Map();
    for (const row of master) {
      if (canonState(row.state) !== key) continue;
      if (type !== 'all' && !row.isDistributor) continue;
      if (division && row.division !== division) continue;
      const names = new Set([row.city, row.district].map((v) => String(v || '').trim()).filter(Boolean));
      names.forEach((n) => { const k = lc(n); const cur = counts.get(k) || { name: n, n: 0 }; cur.n += 1; counts.set(k, cur); });
    }
    res.json({ success: true, data: [...counts.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)) });
  } catch (err) {
    console.error('distributor map cities error:', err);
    res.status(500).json({ success: false, message: 'Failed to load cities' });
  }
};

// @route GET /api/distributor-map/facets — dropdown values
exports.facets = async (req, res) => {
  try {
    if (!facetCache || Date.now() - facetCache.at > TTL) {
      const [cats, insts, stateCounts] = await Promise.all([
        sequelize.query("SELECT category_name AS name, COUNT(*) AS n FROM contracts WHERE category_name IS NOT NULL AND category_name <> '' GROUP BY category_name ORDER BY n DESC", { type: QueryTypes.SELECT }),
        sequelize.query("SELECT hospital_name AS name, COUNT(*) AS n FROM contracts WHERE hospital_name IS NOT NULL AND hospital_name <> '' GROUP BY hospital_name ORDER BY n DESC LIMIT 300", { type: QueryTypes.SELECT }),
        sequelize.query("SELECT state AS name, COUNT(*) AS n FROM distributor_master WHERE state IS NOT NULL AND is_distributor = 1 GROUP BY state", { type: QueryTypes.SELECT }),
      ]);
      const families = await Promise.all(INSTITUTE_FAMILIES.map(async (f) => {
        const [row] = await sequelize.query(
          `SELECT COUNT(DISTINCT hospital_name) AS n FROM contracts WHERE ${f.like.map(() => 'hospital_name LIKE ?').join(' OR ')}`,
          { replacements: f.like, type: QueryTypes.SELECT },
        );
        return { name: f.name, n: Number(row.n) };
      }));
      facetCache = { at: Date.now(), data: { categories: cats, institutes: insts, families, stateCounts } };
    }
    const { categories, institutes, families, stateCounts } = facetCache.data;
    const counts = new Map(stateCounts.map((s) => [s.name, Number(s.n)]));
    res.json({
      success: true,
      states: INDIA_STATES.map((s) => ({ name: s, distributors: counts.get(s) || 0 })),
      departments: DEPARTMENTS,
      equipment: categories.map((c) => ({ name: c.name, n: Number(c.n) })),
      institutes: [...families.filter((f) => f.n > 0).map((f) => ({ name: f.name, n: f.n, group: true })), ...institutes.map((i) => ({ name: i.name, n: Number(i.n) }))],
    });
  } catch (err) {
    console.error('distributor map facets error:', err);
    res.status(500).json({ success: false, message: 'Failed to load filter options' });
  }
};

// @route GET /api/distributor-map/suggest?dimension=institute|equipment&q=
exports.suggest = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ success: true, data: [] });
    const like = `%${q}%`;
    const rows = req.query.dimension === 'equipment'
      ? await sequelize.query(
        `SELECT name, SUM(n) n FROM (
           SELECT category_name AS name, COUNT(*) n FROM contracts WHERE category_name LIKE :like GROUP BY category_name
           UNION ALL SELECT product AS name, COUNT(*) n FROM contracts WHERE product LIKE :like GROUP BY product) x
         WHERE name IS NOT NULL AND name <> '' GROUP BY name ORDER BY n DESC LIMIT 15`,
        { replacements: { like }, type: QueryTypes.SELECT })
      : await sequelize.query(
        "SELECT hospital_name AS name, COUNT(*) AS n FROM contracts WHERE hospital_name LIKE :like GROUP BY hospital_name ORDER BY n DESC LIMIT 15",
        { replacements: { like }, type: QueryTypes.SELECT });
    res.json({ success: true, data: rows.map((r) => ({ name: r.name, n: Number(r.n) })) });
  } catch (err) {
    console.error('distributor map suggest error:', err);
    res.status(500).json({ success: false, message: 'Failed to load suggestions' });
  }
};

// @route GET /api/distributor-map/:id — profile + everything the mapping is built from
exports.detail = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const row = await DistributorMaster.findByPk(id, { raw: true });
    if (!row) return res.status(404).json({ success: false, message: 'Distributor not found' });
    const [evidence, manual] = await Promise.all([getEvidence(), DistributorMapping.findAll({ where: { userId: req.user.id, distributorId: id }, raw: true })]);
    const ev = evidence.get(row.normName || '');

    const manualBy = Object.fromEntries(DIMENSIONS.map((d) => [d, manual.filter((m) => m.dimension === d).map((m) => m.value)]));
    let recent = [];
    if (ev && ev.sellers.size) {
      recent = await sequelize.query(
        `SELECT id, contract_no AS contractNo, hospital_name AS institute, hospital_state AS state, product, category_name AS category, seller_name AS seller, dept, contract_date AS contractDate, value_num AS value
           FROM contracts WHERE seller_name IN (:sellers) ORDER BY contract_dt DESC LIMIT 12`,
        { replacements: { sellers: [...ev.sellers] }, type: QueryTypes.SELECT });
    }
    res.json({
      success: true,
      data: {
        distributor: {
          ...row, department: DIV_DEPT[row.division],
        },
        manual: manualBy,
        evidence: ev ? {
          contracts: ev.contracts, value: Math.round(ev.value), sellerNames: [...ev.sellers],
          states: topEntries(ev.states, 40), institutes: topEntries(ev.institutes, 40), categories: topEntries(ev.categories, 40),
          products: topEntries(ev.products, 30), departments: topEntries(ev.depts, 10),
        } : null,
        recentContracts: recent,
        departmentOptions: DEPARTMENTS,
      },
    });
  } catch (err) {
    console.error('distributor map detail error:', err);
    res.status(500).json({ success: false, message: 'Failed to load distributor' });
  }
};

// @route PUT /api/distributor-map/:id/mappings   { state: [], city: [], institute: [], department: [], equipment: [] }
// Replaces this organisation's hand-kept mapping for every dimension present in the body.
exports.saveMappings = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!(await DistributorMaster.findByPk(id, { attributes: ['id'] }))) return res.status(404).json({ success: false, message: 'Distributor not found' });
    const by = await actorName(req);
    const userId = req.user.id;
    let changed = 0;
    for (const dim of DIMENSIONS) {
      if (!Array.isArray(req.body[dim])) continue;
      const wanted = [...new Map(req.body[dim].map((v) => String(v || '').trim().slice(0, 300)).filter(Boolean).map((v) => [lc(v), v])).values()];
      const existing = await DistributorMapping.findAll({ where: { userId, distributorId: id, dimension: dim } });
      const keep = new Set(wanted.map(lc));
      for (const e of existing) if (!keep.has(lc(e.value))) { await e.destroy(); changed += 1; }
      const have = new Set(existing.map((e) => lc(e.value)));
      for (const v of wanted) if (!have.has(lc(v))) { await DistributorMapping.create({ userId, distributorId: id, dimension: dim, value: v, createdByName: by }); changed += 1; }
    }
    res.json({ success: true, changed });
  } catch (err) {
    console.error('distributor map save error:', err);
    res.status(500).json({ success: false, message: 'Failed to save mapping' });
  }
};

// @route GET /api/distributor-map/export?mode=all|filtered&<same filters as the search>
exports.exportExcel = safeHandler('distributor mapping', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.search, req, { clear: ['state', 'city', 'institute', 'department', 'equipment', 'division', 'source', 'q'] });
  const cell = (r, dim) => (r.matches.find((m) => m.dimension === dim)?.values || []).map((v) => `${v.value}${v.source === 'contracts' ? ` (${v.n} contracts)` : v.source === 'manual' ? ' (mapped)' : ''}`).join('; ');
  const DIV = { endo: 'Endo-Surgery', micro: 'Endo micro-distributor', diagno: 'Diagnostics' };
  await sendWorkbook(res, {
    title: 'Distributor Mapping', rows, mode, applied,
    columns: [
      { header: 'SAP Code', key: 'sapCode', width: 12 },
      { header: 'Distributor', key: 'name', width: 40 },
      { header: 'Division', get: (r) => DIV[r.division], width: 22 },
      { header: 'Classification', key: 'classDescription', width: 24 },
      { header: 'Authorised', get: (r) => (r.isAuthorised ? 'Yes' : 'No'), width: 11 },
      { header: 'City', key: 'city', width: 18 },
      { header: 'State', key: 'state', width: 18 },
      { header: 'PIN', key: 'pincode', width: 10 },
      { header: 'Contact Person', key: 'contactPerson', width: 20 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'GST No', key: 'gstNo', width: 18 },
      { header: 'Departments Covered', get: (r) => r.coverage.departments.join('; '), width: 30 },
      { header: 'States Covered', key: 'coverage', get: (r) => r.coverage.states, width: 14, type: 'number' },
      { header: 'Institutes Covered', get: (r) => r.coverage.institutes, width: 16, type: 'number' },
      { header: 'Equipment Types', get: (r) => r.coverage.equipment, width: 15, type: 'number' },
      { header: 'GeM Contracts Won', key: 'contracts', width: 16, type: 'number' },
      { header: 'GeM Contract Value', key: 'contractValue', width: 18, type: 'money' },
      { header: 'Matched State', get: (r) => cell(r, 'state'), width: 22 },
      { header: 'Matched City', get: (r) => cell(r, 'city'), width: 22 },
      { header: 'Matched Institute', get: (r) => cell(r, 'institute'), width: 40 },
      { header: 'Matched Department', get: (r) => cell(r, 'department'), width: 24 },
      { header: 'Matched Equipment', get: (r) => cell(r, 'equipment'), width: 40 },
    ],
  });
});

// ---- ranking ----------------------------------------------------------------
// Score out of 100, built only from what is on record:
//   track record  40  GeM contracts won and their value (log-scaled, so one huge order does not dominate)
//   coverage      20  how many states, institutes and equipment types it has actually supplied
//   recency       15  when its last GeM contract was
//   standing      15  authorised by the company, valid drug licence, years as a customer
//   fit           10  (only when filters are set) how well it matches the state / institute / department / equipment asked for
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const monthsSince = (d) => (d ? (Date.now() - d.getTime()) / (30.44 * 86400000) : null);

function scoreDistributor(row, profile, ev, fitPoints, fitOn) {
  const contracts = ev ? ev.contracts : 0;
  const value = ev ? ev.value : 0;
  const track = clamp(12 * Math.log10(1 + contracts) + 6 * Math.log10(1 + value / 1e5), 0, 40);
  const states = ev ? ev.states.size : 0; const insts = ev ? ev.institutes.size : 0; const equip = ev ? ev.categories.size : 0;
  const coverage = (Math.min(states, 10) / 10) * 8 + (Math.min(insts, 20) / 20) * 6 + (Math.min(equip, 15) / 15) * 6;
  const m = ev ? monthsSince(ev.lastDate) : null;
  const recency = m === null ? 0 : m <= 6 ? 15 : m <= 12 ? 11 : m <= 24 ? 6 : 2;
  const licenceOk = row.drugLicenseExpiry ? new Date(row.drugLicenseExpiry) >= new Date() : false;
  const tenureYears = row.registeredOn ? (Date.now() - new Date(row.registeredOn).getTime()) / (365.25 * 86400000) : 0;
  const standing = (row.isAuthorised ? 8 : 0) + (licenceOk ? 4 : 0) + clamp(tenureYears, 0, 3);
  const fit = fitOn ? clamp(fitPoints, 0, 10) : 0;
  const max = fitOn ? 100 : 90;
  const raw = track + coverage + recency + standing + fit;
  const score = Math.round((raw / max) * 100);
  return {
    score,
    breakdown: {
      track: Math.round(track), coverage: Math.round(coverage), recency, standing: Math.round(standing), fit: Math.round(fit),
      max: { track: 40, coverage: 20, recency: 15, standing: 15, fit: fitOn ? 10 : 0 },
    },
    facts: { contracts, value: Math.round(value), states, institutes: insts, equipmentTypes: equip, lastContract: ev && ev.lastDate ? ev.lastDate.toISOString().slice(0, 10) : null, licenceOk, tenureYears: Math.round(tenureYears * 10) / 10 },
  };
}
const tierOf = (score, hasHistory, authorised) => (!hasHistory && !authorised ? 'New' : score >= 75 ? 'Platinum' : score >= 55 ? 'Gold' : score >= 35 ? 'Silver' : 'Bronze');
const starsOf = (score, hasHistory) => (hasHistory ? clamp(Math.round((score / 20) * 2) / 2, 1, 5) : clamp(Math.round((score / 20) * 2) / 2, 0.5, 2.5));

// Core of the ranking, shared by the /rank route and the chat-driven Distributor
// Recommendation page: given a set of filters, returns every matching distributor
// scored and sorted (unpaged) plus whether any filter narrowed the results ("fitOn").
async function computeRanking(userId, query) {
  const { state, city, institute, department, equipment, division, tier, authorised, q, sort = 'score' } = query;
  const active = { state, city, institute, department, equipment };
  const fitOn = Object.values(active).some((v) => lc(v));
  const needle = lc(q);
  const [master, evidence, manual, selRows] = await Promise.all([getMaster(), getEvidence(), manualByDistributor(userId), DistributorSelection.findAll({ where: { userId }, raw: true })]);
  const selBy = new Map(selRows.map((r) => [r.distributorId, r]));

  const out = [];
  for (const row of master) {
    if (!row.isDistributor) continue;
    if (division && row.division !== division) continue;
    if (authorised === '1' && !row.isAuthorised) continue;
    if (needle && !`${row.name} ${row.city || ''} ${row.sapCode} ${row.gstNo || ''}`.toLowerCase().includes(needle)) continue;
    const p = buildProfile(row, manual.get(row.id), evidence);
    let ok = true; let fitPoints = 0; const matches = [];
    for (const dim of DIMENSIONS) {
      const f = lc(active[dim]);
      if (!f) continue;
      const hits = list(p.dims[dim]).filter((e) => (dim === 'state' ? canonState(e.value) === canonState(f) : dim === 'city' ? lc(e.value) === f : lc(e.value).includes(f)));
      if (!hits.length) { ok = false; break; }
      matches.push({ dimension: dim, values: hits.slice(0, 3) });
      const best = hits[0];
      fitPoints += best.source === 'contracts' ? 2 + Math.min(best.n, 30) / 30 * 0.5 : best.source === 'manual' ? 2.5 : 1;
    }
    if (!ok) continue;
    const ev = evidence.get(row.normName || '') || null;
    const sc = scoreDistributor(row, p, ev, fitPoints * (10 / (Object.values(active).filter((v) => lc(v)).length * 2.5 || 1)), fitOn);
    const hasHistory = (ev ? ev.contracts : 0) > 0;
    const t = tierOf(sc.score, hasHistory, !!row.isAuthorised);
    if (tier && t !== tier) continue;
    const sel = selBy.get(row.id);
    out.push({
      id: row.id, sapCode: row.sapCode, name: row.name, division: row.division, department: DIV_DEPT[row.division],
      city: row.city, state: row.state, pincode: row.pincode, phone: row.phone, email: row.email, contactPerson: row.contactPerson,
      isAuthorised: !!row.isAuthorised, classDescription: row.classDescription,
      score: sc.score, stars: starsOf(sc.score, hasHistory), tier: t, breakdown: sc.breakdown, facts: sc.facts, matches,
      departments: list(p.dims.department).map((e) => e.value),
      selection: sel ? { status: sel.status, department: sel.department, state: sel.state, equipment: sel.equipment, note: sel.note, updatedAt: sel.updatedAt } : null,
    });
  }
  const key = { score: (r) => r.score, contracts: (r) => r.facts.contracts, value: (r) => r.facts.value, recent: (r) => (r.facts.lastContract ? new Date(r.facts.lastContract).getTime() : 0) }[sort] || ((r) => r.score);
  out.sort((a, b) => key(b) - key(a) || b.score - a.score || b.facts.contracts - a.facts.contracts || a.name.localeCompare(b.name));
  out.forEach((r, i) => { r.rank = i + 1; });
  return { out, fitOn };
}
exports.computeRanking = computeRanking;

// @route GET /api/distributor-map/rank?state=&city=&institute=&department=&equipment=&division=&tier=&authorised=&q=&sort=score|contracts|value|recent&page=&limit=
exports.rank = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const { out, fitOn } = await computeRanking(req.user.id, req.query);
    const tiers = { Platinum: 0, Gold: 0, Silver: 0, Bronze: 0, New: 0 };
    out.forEach((r) => { tiers[r.tier] += 1; });
    res.json({
      success: true, data: out.slice((page - 1) * limit, page * limit), total: out.length, page, limit, fitOn,
      summary: { tiers, selected: out.filter((r) => r.selection && r.selection.status === 'selected').length, shortlisted: out.filter((r) => r.selection && r.selection.status === 'shortlisted').length },
    });
  } catch (err) {
    console.error('distributor rank error:', err);
    res.status(500).json({ success: false, message: 'Failed to rank distributors' });
  }
};

// @route GET /api/distributor-map/selections — everything this organisation has shortlisted / selected / rejected
exports.listSelections = async (req, res) => {
  try {
    const rows = await DistributorSelection.findAll({ where: { userId: req.user.id }, order: [['updatedAt', 'DESC']], raw: true });
    const master = await getMaster();
    const byId = new Map(master.map((m) => [m.id, m]));
    res.json({
      success: true,
      data: rows.map((r) => {
        const m = byId.get(r.distributorId) || {};
        return { ...r, name: m.name || `#${r.distributorId}`, sapCode: m.sapCode, city: m.city, state: m.state, division: m.division, department: r.department, isAuthorised: !!m.isAuthorised, contactPerson: m.contactPerson, phone: m.phone, email: m.email };
      }),
    });
  } catch (err) {
    console.error('distributor selections error:', err);
    res.status(500).json({ success: false, message: 'Failed to load selections' });
  }
};

// @route PUT /api/distributor-map/selections/:distributorId  { status, department, state, equipment, note, score }
exports.saveSelection = async (req, res) => {
  try {
    const distributorId = parseInt(req.params.distributorId, 10);
    if (!(await DistributorMaster.findByPk(distributorId, { attributes: ['id'] }))) return res.status(404).json({ success: false, message: 'Distributor not found' });
    const b = req.body || {};
    if (!['shortlisted', 'selected', 'rejected'].includes(b.status)) return res.status(400).json({ success: false, message: 'Status must be shortlisted, selected or rejected' });
    const nz = (v) => (v === '' || v === undefined ? null : String(v).trim().slice(0, 300));
    const [row] = await DistributorSelection.findOrCreate({ where: { userId: req.user.id, distributorId }, defaults: { userId: req.user.id, distributorId, status: b.status } });
    Object.assign(row, { status: b.status, department: nz(b.department), state: nz(b.state), equipment: nz(b.equipment), note: nz(b.note), scoreAtSelection: Number.isFinite(Number(b.score)) ? Number(b.score) : row.scoreAtSelection, createdByName: (await actorName(req)) || row.createdByName });
    await row.save();
    res.json({ success: true, data: row.toJSON() });
  } catch (err) {
    console.error('distributor selection save error:', err);
    res.status(500).json({ success: false, message: 'Failed to save the selection' });
  }
};

// @route DELETE /api/distributor-map/selections/:distributorId
exports.removeSelection = async (req, res) => {
  try {
    await DistributorSelection.destroy({ where: { userId: req.user.id, distributorId: parseInt(req.params.distributorId, 10) } });
    res.json({ success: true });
  } catch (err) {
    console.error('distributor selection delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to remove the selection' });
  }
};

// @route GET /api/distributor-map/rank/export?mode=all|filtered&<same filters as rank>
exports.exportRanking = safeHandler('distributor ranking', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.rank, req, { clear: ['state', 'city', 'institute', 'department', 'equipment', 'division', 'tier', 'authorised', 'q'] });
  const DIV = { endo: 'Endo-Surgery', micro: 'Endo micro-distributor', diagno: 'Diagnostics' };
  await sendWorkbook(res, {
    title: 'Distributor Ranking', rows, mode, applied,
    columns: [
      { header: 'Rank', key: 'rank', width: 7, type: 'number' },
      { header: 'Distributor', key: 'name', width: 40 },
      { header: 'SAP Code', key: 'sapCode', width: 12 },
      { header: 'Division', get: (r) => DIV[r.division], width: 22 },
      { header: 'Score (0-100)', key: 'score', width: 12, type: 'number' },
      { header: 'Stars', key: 'stars', width: 8 },
      { header: 'Tier', key: 'tier', width: 10 },
      { header: 'Authorised', get: (r) => (r.isAuthorised ? 'Yes' : 'No'), width: 11 },
      { header: 'City', key: 'city', width: 18 },
      { header: 'State', key: 'state', width: 18 },
      { header: 'GeM Contracts', get: (r) => r.facts.contracts, width: 14, type: 'number' },
      { header: 'GeM Value', get: (r) => r.facts.value, width: 16, type: 'money' },
      { header: 'States Supplied', get: (r) => r.facts.states, width: 14, type: 'number' },
      { header: 'Institutes Supplied', get: (r) => r.facts.institutes, width: 17, type: 'number' },
      { header: 'Equipment Types', get: (r) => r.facts.equipmentTypes, width: 15, type: 'number' },
      { header: 'Last GeM Contract', get: (r) => r.facts.lastContract, width: 16, type: 'date' },
      { header: 'Track Record (of 40)', get: (r) => r.breakdown.track, width: 18, type: 'number' },
      { header: 'Coverage (of 20)', get: (r) => r.breakdown.coverage, width: 16, type: 'number' },
      { header: 'Recency (of 15)', get: (r) => r.breakdown.recency, width: 15, type: 'number' },
      { header: 'Standing (of 15)', get: (r) => r.breakdown.standing, width: 15, type: 'number' },
      { header: 'Fit (of 10)', get: (r) => r.breakdown.fit, width: 11, type: 'number' },
      { header: 'Your Decision', get: (r) => (r.selection ? r.selection.status : ''), width: 14 },
      { header: 'Contact Person', key: 'contactPerson', width: 20 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Email', key: 'email', width: 28 },
    ],
  });
});

exports.constants = { DEPARTMENTS, INDIA_STATES, INSTITUTE_FAMILIES, DIMENSIONS };
exports.canonState = canonState;

exports.invalidateCaches = () => { masterCache = null; evidenceCache = null; facetCache = null; };
