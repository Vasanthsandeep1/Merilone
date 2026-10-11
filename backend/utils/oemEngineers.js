// Meril One <-> B2G: which OEM company owns a customer's product, and which
// of that OEM's service engineers (Service Management > Service Engineers)
// cover the customer's area.
//
// Product -> OEM: the product's own oemUserId (set when it was imported from
// the customer's B2G purchases: the B2G user who sold it), else the OEM
// portal account whose company name matches the product's brand.
// Area: an engineer covers the customer if one of their districts is the
// customer's city (or appears in their address) — "district" match — or, if
// none, one of their states is the customer's state from the pincode.
const { QueryTypes } = require('sequelize');
const { sequelize, ServiceEngineer, ServiceEngineerArea, ServiceSkill, ServiceEngineerSkill, M1User, M1Category, Client } = require('../models');

const norm = (s) => String(s || '').trim().toLowerCase();

// India Post pincode ranges -> state (first 3 digits where a state shares a
// 2-digit range, else the first 2).
const PIN3 = {
  160: 'Chandigarh', 194: 'Ladakh', 403: 'Goa', 605: 'Puducherry', 737: 'Sikkim', 744: 'Andaman and Nicobar Islands',
  682: 'Kerala', 396: 'Gujarat',
  246: 'Uttarakhand', 247: 'Uttarakhand', 248: 'Uttarakhand', 249: 'Uttarakhand', 262: 'Uttarakhand', 263: 'Uttarakhand',
  790: 'Arunachal Pradesh', 791: 'Arunachal Pradesh', 792: 'Arunachal Pradesh', 793: 'Meghalaya', 794: 'Meghalaya',
  795: 'Manipur', 796: 'Mizoram', 797: 'Nagaland', 798: 'Nagaland', 799: 'Tripura',
  814: 'Jharkhand', 815: 'Jharkhand', 816: 'Jharkhand', 822: 'Jharkhand', 823: 'Jharkhand', 824: 'Jharkhand', 825: 'Jharkhand',
  826: 'Jharkhand', 827: 'Jharkhand', 828: 'Jharkhand', 829: 'Jharkhand', 831: 'Jharkhand', 832: 'Jharkhand', 833: 'Jharkhand',
  834: 'Jharkhand', 835: 'Jharkhand',
};
const PIN2 = {
  11: 'Delhi', 12: 'Haryana', 13: 'Haryana', 14: 'Punjab', 15: 'Punjab', 16: 'Punjab', 17: 'Himachal Pradesh',
  18: 'Jammu and Kashmir', 19: 'Jammu and Kashmir',
  20: 'Uttar Pradesh', 21: 'Uttar Pradesh', 22: 'Uttar Pradesh', 23: 'Uttar Pradesh', 24: 'Uttar Pradesh', 25: 'Uttar Pradesh',
  26: 'Uttar Pradesh', 27: 'Uttar Pradesh', 28: 'Uttar Pradesh',
  30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan', 34: 'Rajasthan',
  36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat',
  40: 'Maharashtra', 41: 'Maharashtra', 42: 'Maharashtra', 43: 'Maharashtra', 44: 'Maharashtra',
  45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh', 48: 'Madhya Pradesh', 49: 'Chhattisgarh',
  50: 'Telangana', 51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh',
  56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka',
  60: 'Tamil Nadu', 61: 'Tamil Nadu', 62: 'Tamil Nadu', 63: 'Tamil Nadu', 64: 'Tamil Nadu',
  67: 'Kerala', 68: 'Kerala', 69: 'Kerala',
  70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal', 73: 'West Bengal', 74: 'West Bengal',
  75: 'Odisha', 76: 'Odisha', 77: 'Odisha', 78: 'Assam',
  80: 'Bihar', 81: 'Bihar', 82: 'Bihar', 83: 'Bihar', 84: 'Bihar', 85: 'Bihar',
};
const stateForPincode = (pin) => {
  const p = String(pin || '');
  if (!/^\d{6}$/.test(p)) return null;
  return PIN3[p.slice(0, 3)] || PIN2[p.slice(0, 2)] || null;
};

// B2G company name of a portal user (trade name, else legal name, else user name).
async function companyName(userId) {
  const [row] = await sequelize.query(
    `SELECT u.name, JSON_UNQUOTE(JSON_EXTRACT(p.company_info, '$.tradeName')) AS trade, JSON_UNQUOTE(JSON_EXTRACT(p.company_info, '$.legalName')) AS legal
       FROM users u LEFT JOIN partner_profiles p ON p.user_id = u.id WHERE u.id = :userId`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  if (!row) return null;
  return (row.trade && row.trade !== 'null' ? row.trade : null) || (row.legal && row.legal !== 'null' ? row.legal : null) || row.name;
}

// The OEM portal account behind a product, or null.
async function resolveOem(product, customer) {
  let userId = product.oemUserId || null;
  // Imported from the customer's B2G purchases before oemUserId existed.
  if (!userId && customer?.b2gClientId && /^Bought through Meril B2G/.test(product.notes || '')) {
    const c = await Client.findByPk(customer.b2gClientId, { attributes: ['userId'] });
    userId = c?.userId || null;
  }
  // By brand: an OEM whose company name contains the brand (or vice versa).
  if (!userId && product.brand && norm(product.brand).length >= 3) {
    const oems = await sequelize.query(
      `SELECT u.id, u.name, JSON_UNQUOTE(JSON_EXTRACT(p.company_info, '$.tradeName')) AS trade, JSON_UNQUOTE(JSON_EXTRACT(p.company_info, '$.legalName')) AS legal
         FROM users u LEFT JOIN partner_profiles p ON p.user_id = u.id WHERE u.partner_type = 'oem' AND u.is_active = 1`,
      { type: QueryTypes.SELECT },
    );
    const brand = norm(product.brand);
    const hit = oems.find((o) => [o.trade, o.legal].filter((n) => n && n !== 'null').some((n) => {
      const c = norm(n);
      return c.includes(brand) || brand.includes(c.split(/\s+/)[0]);
    }));
    userId = hit?.id || null;
  }
  if (!userId) return null;
  return { userId, name: await companyName(userId) };
}

// The OEM's active engineers who cover this place, best match first, each
// with how they match and whether they use the Partner app (same mobile).
async function engineersFor(oemUserId, { city, pincode, address }) {
  const list = await ServiceEngineer.findAll({
    where: { userId: oemUserId, status: 'Active' },
    include: [{ model: ServiceEngineerArea, as: 'areas' }],
    order: [['name', 'ASC']],
  });
  const state = stateForPincode(pincode);
  const where = `${norm(city)} ${norm(address)}`;
  const out = [];
  for (const e of list) {
    const district = e.areas.find((a) => norm(a.district) === norm(city) || (norm(a.district).length > 3 && where.includes(norm(a.district))));
    const inState = !district && state && e.areas.find((a) => norm(a.state) === norm(state));
    if (!district && !inState) continue;
    out.push({ engineer: e, match: district ? 'district' : 'state', matchedArea: district || inState });
  }
  const app = out.length ? await M1User.findAll({ where: { role: 'engineer', phone: out.map((o) => o.engineer.phone) } }) : [];
  for (const o of out) o.appUser = app.find((u) => u.phone === o.engineer.phone && u.profileComplete) || null;
  return { state, list: out.sort((a, b) => (a.match === b.match ? 0 : a.match === 'district' ? -1 : 1)) };
}

// Service-engineer ids (any OEM) registered with this mobile number — how a
// Partner-app engineer is recognised as an OEM's engineer.
async function oemIdsForPhone(phone) {
  if (!phone) return [];
  const rows = await ServiceEngineer.findAll({ where: { phone: String(phone).slice(-10), status: 'Active' }, attributes: ['id'], raw: true });
  return rows.map((r) => r.id);
}

// The Partner-app login source of truth: Active service engineers in B2G
// (Service Management) with this mobile number — usually one, but the same
// person can be registered by more than one OEM. Returns null if none.
async function b2gEngineerByPhone(phone) {
  const rows = await ServiceEngineer.findAll({
    where: { phone: String(phone || '').slice(-10), status: 'Active' },
    include: [{ model: ServiceEngineerArea, as: 'areas' }, { model: ServiceSkill, as: 'skills' }],
    order: [['updatedAt', 'DESC']],
  });
  if (!rows.length) return null;
  const allSkills = rows.flatMap((r) => r.skills || []);
  const byState = new Map();
  for (const a of rows.flatMap((r) => r.areas)) {
    if (!byState.has(a.state)) byState.set(a.state, new Set());
    byState.get(a.state).add(a.district);
  }
  const companies = [];
  for (const r of rows) { const n = await companyName(r.userId); if (n && !companies.includes(n)) companies.push(n); }
  return {
    ids: rows.map((r) => r.id),
    name: rows[0].name,
    email: rows[0].email,
    empIds: rows.map((r) => r.empId),
    companies,
    experienceYears: rows.find((r) => r.experienceYears != null)?.experienceYears ?? null,
    // Skills: Meril One category ids (these match jobs), plus every skill name
    // (company-added ones included) for display.
    categoryIds: [...new Set(allSkills.map((s) => s.m1CategoryId).filter(Boolean))],
    skillNames: [...new Set(allSkills.map((s) => s.name))].sort(),
    areas: [...byState.entries()].map(([state, d]) => ({ state, districts: [...d].sort() })).sort((a, b) => a.state.localeCompare(b.state)),
  };
}

// Copies the B2G details onto the app engineer (on every login / profile
// load), so the app always shows what B2G says. Edits made in the app are
// written back to B2G first (saveToB2g), so the two never disagree.
function applyB2gEngineer(user, b2g) {
  user.name = b2g.name;
  if (b2g.email) user.email = b2g.email;
  user.companyName = b2g.companies.join(' / ') || null;
  if (b2g.experienceYears != null) user.experienceYears = b2g.experienceYears;
  if (b2g.categoryIds.length) user.skills = b2g.categoryIds;
  user.b2gEngineer = { ids: b2g.ids, empIds: b2g.empIds, companies: b2g.companies, areas: b2g.areas, skillNames: b2g.skillNames };
  // City: their first district, until they set their own.
  if (!user.city && b2g.areas[0]) user.city = b2g.areas[0].districts[0];
}

// Writes the engineer's own corrections from the app back to B2G, on every
// company record with their number: name, email, experience, area (states /
// districts), and the skills that match app jobs (Meril One categories).
// Company-added skills stay.
async function saveToB2g(phone, { name, email, experienceYears, categoryIds, areas }) {
  const rows = await ServiceEngineer.findAll({ where: { phone: String(phone).slice(-10), status: 'Active' } });
  const cats = await M1Category.findAll({ attributes: ['id', 'name'] });
  await sequelize.transaction(async (t) => {
    for (const r of rows) {
      await r.update({ name, ...(email !== undefined ? { email: email || null } : {}), experienceYears }, { transaction: t });
      // Area corrected in the app: replaces their districts on this record.
      if (areas && areas.length) {
        await ServiceEngineerArea.destroy({ where: { engineerId: r.id }, transaction: t });
        await ServiceEngineerArea.bulkCreate(areas.flatMap((a) => a.districts.map((district) => ({ engineerId: r.id, state: a.state, district }))), { transaction: t });
      }
      if (!categoryIds) continue;
      // This company's skill for each picked category (created if missing).
      const skillIds = [];
      for (const catId of categoryIds) {
        let sk = await ServiceSkill.findOne({ where: { userId: r.userId, m1CategoryId: catId }, transaction: t });
        const cat = cats.find((c) => c.id === catId);
        if (!sk && cat) {
          sk = await ServiceSkill.findOne({ where: { userId: r.userId, name: cat.name }, transaction: t });
          if (sk) await sk.update({ m1CategoryId: catId }, { transaction: t });
          else sk = await ServiceSkill.create({ userId: r.userId, name: cat.name, m1CategoryId: catId }, { transaction: t });
        }
        if (sk) skillIds.push(sk.id);
      }
      const linked = await ServiceSkill.findAll({ where: { userId: r.userId, m1CategoryId: { [require('sequelize').Op.ne]: null } }, attributes: ['id'], transaction: t });
      await ServiceEngineerSkill.destroy({ where: { engineerId: r.id, skillId: linked.map((s) => s.id) }, transaction: t });
      if (skillIds.length) await ServiceEngineerSkill.bulkCreate(skillIds.map((skillId) => ({ engineerId: r.id, skillId })), { transaction: t, ignoreDuplicates: true });
    }
  });
}

// The B2G companies (portal user ids) this mobile number is an Active
// service engineer for.
async function oemUserIdsForPhone(phone) {
  if (!phone) return [];
  const rows = await ServiceEngineer.findAll({ where: { phone: String(phone).slice(-10), status: 'Active' }, attributes: ['userId'], raw: true });
  return [...new Set(rows.map((r) => r.userId))];
}

module.exports = { oemUserIdsForPhone, stateForPincode, resolveOem, engineersFor, oemIdsForPhone, companyName, b2gEngineerByPhone, applyB2gEngineer, saveToB2g };
