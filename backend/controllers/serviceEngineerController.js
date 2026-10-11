const { Op } = require('sequelize');
const { sequelize, ServiceEngineer, ServiceEngineerArea, ServiceSkill, ServiceEngineerSkill, M1Category } = require('../models');

// Service Management > Service Engineers — add / list / edit / delete this
// partner's service engineers and the states + districts each one covers.
// Scoped per portal user, like clients and the trackers.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
const fail = (res, code, message) => res.status(code).json({ success: false, message });

// The company's skill list. The first time, it's filled with the Meril One
// service categories (these match customer jobs in the app).
async function ensureSkills(userId) {
  const have = await ServiceSkill.findAll({ where: { userId }, order: [['m1CategoryId', 'DESC'], ['name', 'ASC']] });
  const linked = new Set(have.map((s) => s.m1CategoryId).filter(Boolean));
  const cats = await M1Category.findAll({ attributes: ['id', 'name'], order: [['sortOrder', 'ASC']] });
  const missing = cats.filter((c) => !linked.has(c.id) && !have.some((s) => s.name.toLowerCase() === c.name.toLowerCase()));
  if (missing.length) await ServiceSkill.bulkCreate(missing.map((c) => ({ userId, name: c.name, m1CategoryId: c.id })), { ignoreDuplicates: true });
  return missing.length ? ServiceSkill.findAll({ where: { userId } }) : have;
}
const skillJson = (s) => ({ id: s.id, name: s.name, matchesAppJobs: !!s.m1CategoryId });

// Areas arrive as [{ state, districts: [..] }]; stored one row per district.
function cleanAreas(raw) {
  const rows = [];
  const seen = new Set();
  for (const a of Array.isArray(raw) ? raw : []) {
    const state = String(a?.state || '').trim().slice(0, 80);
    if (!state) continue;
    for (const d of Array.isArray(a.districts) ? a.districts : []) {
      const district = String(d || '').trim().replace(/\s+/g, ' ').slice(0, 120);
      const key = `${state.toLowerCase()}|${district.toLowerCase()}`;
      if (!district || seen.has(key)) continue;
      seen.add(key);
      rows.push({ state, district });
    }
  }
  return rows;
}

// Engineer as the page shows it: areas grouped back into states.
function toJson(e) {
  const byState = new Map();
  for (const a of e.areas || []) {
    if (!byState.has(a.state)) byState.set(a.state, []);
    byState.get(a.state).push(a.district);
  }
  return {
    id: e.id, empId: e.empId, name: e.name, phone: e.phone, email: e.email, status: e.status,
    experienceYears: e.experienceYears,
    skills: (e.skills || []).map(skillJson).sort((a, b) => a.name.localeCompare(b.name)),
    areas: [...byState.entries()].map(([state, districts]) => ({ state, districts: districts.sort() })).sort((a, b) => a.state.localeCompare(b.state)),
    createdAt: e.createdAt, updatedAt: e.updatedAt,
  };
}

// Validates the form; returns { error } or { values, areas }.
async function validate(userId, b, exceptId = null) {
  const empId = String(b.empId || '').trim().slice(0, 50);
  const name = String(b.name || '').trim().slice(0, 255);
  const phone = cleanPhone(b.phone);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 255);
  const status = b.status === 'Inactive' ? 'Inactive' : 'Active';
  if (!empId) return { error: 'Enter the employee ID' };
  if (!name) return { error: "Enter the engineer's name" };
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: 'Enter a valid 10-digit mobile number' };
  if (email && !EMAIL_RE.test(email)) return { error: 'Enter a valid email address' };
  const areas = cleanAreas(b.areas);
  if (!areas.length) return { error: 'Add at least one state and pick the districts this engineer covers' };
  const exp = b.experienceYears === '' || b.experienceYears == null ? null : Number(b.experienceYears);
  if (exp !== null && (!Number.isInteger(exp) || exp < 0 || exp > 60)) return { error: 'Enter years of experience as a whole number (0-60)' };
  // Skills: only this company's.
  const wanted = [...new Set((Array.isArray(b.skillIds) ? b.skillIds : []).map(Number).filter(Boolean))];
  const skills = wanted.length ? await ServiceSkill.findAll({ where: { userId, id: wanted }, attributes: ['id'] }) : [];
  if (!skills.length) return { error: 'Pick at least one skill' };
  const notSelf = exceptId ? { id: { [Op.ne]: exceptId } } : {};
  if (await ServiceEngineer.findOne({ where: { userId, empId, ...notSelf }, attributes: ['id'] })) return { error: `Employee ID ${empId} is already used by another engineer` };
  if (await ServiceEngineer.findOne({ where: { userId, phone, ...notSelf }, attributes: ['id'] })) return { error: 'Another engineer already has this mobile number' };
  return { values: { empId, name, phone, email: email || null, status, experienceYears: exp }, areas, skillIds: skills.map((s) => s.id) };
}

// @route GET /api/service-engineers?search=&state=&district=&status=
exports.list = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search = '', state = '', district = '', status = '' } = req.query;
    const where = { userId };
    if (['Active', 'Inactive'].includes(status)) where.status = status;
    if (search.trim()) {
      const s = `%${search.trim()}%`;
      where[Op.or] = [{ empId: { [Op.like]: s } }, { name: { [Op.like]: s } }, { phone: { [Op.like]: s } }, { email: { [Op.like]: s } }];
    }
    // Filter by coverage: engineers with at least one matching area row.
    if (state || district) {
      const areaWhere = {};
      if (state) areaWhere.state = state;
      if (district) areaWhere.district = district;
      const ids = (await ServiceEngineerArea.findAll({ where: areaWhere, attributes: ['engineerId'], raw: true })).map((a) => a.engineerId);
      where.id = [...new Set(ids)];
    }
    const skillList = await ensureSkills(userId);
    const rows = await ServiceEngineer.findAll({ where, include: [{ model: ServiceEngineerArea, as: 'areas' }, { model: ServiceSkill, as: 'skills' }], order: [['name', 'ASC']] });

    // Stats over all of this user's engineers (not just the filtered list).
    const all = await ServiceEngineer.findAll({ where: { userId }, attributes: ['id', 'status'], include: [{ model: ServiceEngineerArea, as: 'areas', attributes: ['state', 'district'] }] });
    const areas = all.flatMap((e) => e.areas);
    res.json({
      success: true,
      data: rows.map(toJson),
      stats: {
        total: all.length,
        active: all.filter((e) => e.status === 'Active').length,
        states: new Set(areas.map((a) => a.state)).size,
        districts: new Set(areas.map((a) => `${a.state}|${a.district}`)).size,
      },
      skills: skillList.map(skillJson).sort((a, b) => Number(b.matchesAppJobs) - Number(a.matchesAppJobs) || a.name.localeCompare(b.name)),
      // States / districts in use, for the page's filters.
      coverage: [...new Set(areas.map((a) => a.state))].sort().map((s) => ({ state: s, districts: [...new Set(areas.filter((a) => a.state === s).map((a) => a.district))].sort() })),
    });
  } catch (err) {
    console.error('service engineers list error:', err);
    fail(res, 500, 'Failed to load service engineers');
  }
};

// @route POST /api/service-engineers  { empId, name, phone, email, status, areas: [{ state, districts }] }
exports.create = async (req, res) => {
  try {
    await ensureSkills(req.user.id);
    const { error, values, areas, skillIds } = await validate(req.user.id, req.body || {});
    if (error) return fail(res, 400, error);
    const e = await sequelize.transaction(async (t) => {
      const row = await ServiceEngineer.create({ ...values, userId: req.user.id }, { transaction: t });
      await ServiceEngineerArea.bulkCreate(areas.map((a) => ({ ...a, engineerId: row.id })), { transaction: t });
      await ServiceEngineerSkill.bulkCreate(skillIds.map((skillId) => ({ engineerId: row.id, skillId })), { transaction: t });
      return row;
    });
    const full = await ServiceEngineer.findByPk(e.id, { include: [{ model: ServiceEngineerArea, as: 'areas' }, { model: ServiceSkill, as: 'skills' }] });
    res.json({ success: true, data: toJson(full) });
  } catch (err) {
    console.error('service engineer create error:', err);
    fail(res, 500, 'Failed to add the engineer');
  }
};

// @route PUT /api/service-engineers/:id  (same body as create)
exports.update = async (req, res) => {
  try {
    const e = await ServiceEngineer.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!e) return fail(res, 404, 'Engineer not found');
    const { error, values, areas, skillIds } = await validate(req.user.id, req.body || {}, e.id);
    if (error) return fail(res, 400, error);
    await sequelize.transaction(async (t) => {
      await e.update(values, { transaction: t });
      await ServiceEngineerArea.destroy({ where: { engineerId: e.id }, transaction: t });
      await ServiceEngineerArea.bulkCreate(areas.map((a) => ({ ...a, engineerId: e.id })), { transaction: t });
      await ServiceEngineerSkill.destroy({ where: { engineerId: e.id }, transaction: t });
      await ServiceEngineerSkill.bulkCreate(skillIds.map((skillId) => ({ engineerId: e.id, skillId })), { transaction: t });
    });
    const full = await ServiceEngineer.findByPk(e.id, { include: [{ model: ServiceEngineerArea, as: 'areas' }, { model: ServiceSkill, as: 'skills' }] });
    res.json({ success: true, data: toJson(full) });
  } catch (err) {
    console.error('service engineer update error:', err);
    fail(res, 500, 'Failed to save the engineer');
  }
};

// @route DELETE /api/service-engineers/:id
exports.remove = async (req, res) => {
  try {
    const e = await ServiceEngineer.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!e) return fail(res, 404, 'Engineer not found');
    await sequelize.transaction(async (t) => {
      await ServiceEngineerArea.destroy({ where: { engineerId: e.id }, transaction: t });
      await ServiceEngineerSkill.destroy({ where: { engineerId: e.id }, transaction: t });
      await e.destroy({ transaction: t });
    });
    res.json({ success: true });
  } catch (err) {
    console.error('service engineer delete error:', err);
    fail(res, 500, 'Failed to delete the engineer');
  }
};

// @route GET /api/service-engineers/skills — this company's skill list.
exports.listSkills = async (req, res) => {
  try {
    const skills = await ensureSkills(req.user.id);
    res.json({ success: true, data: skills.map(skillJson).sort((a, b) => Number(b.matchesAppJobs) - Number(a.matchesAppJobs) || a.name.localeCompare(b.name)) });
  } catch (err) {
    console.error('service skills list error:', err);
    fail(res, 500, 'Failed to load skills');
  }
};

// @route POST /api/service-engineers/skills  { name } — "Add a skill".
// If it's one of the Meril One service categories, it's linked to it so it
// matches customer jobs in the app.
exports.addSkill = async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name) return fail(res, 400, 'Enter the skill name');
    const skills = await ensureSkills(req.user.id);
    const same = skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
    if (same) return fail(res, 400, `"${same.name}" is already in your skills`);
    const cat = (await M1Category.findAll({ attributes: ['id', 'name'] })).find((c) => c.name.toLowerCase() === name.toLowerCase());
    const skill = await ServiceSkill.create({ userId: req.user.id, name, m1CategoryId: cat ? cat.id : null });
    res.json({ success: true, data: skillJson(skill) });
  } catch (err) {
    console.error('service skill add error:', err);
    fail(res, 500, 'Failed to add the skill');
  }
};
