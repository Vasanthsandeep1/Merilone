const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { QueryTicket, StaffUser, User, PartnerProfile, Notification } = require('../models');
const { Op } = require('sequelize');
const { resolveActor } = require('../utils/orgActor');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');

const UPLOAD_DIR = path.join(__dirname, '../uploads/queries');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${file.originalname.replace(/[^a-z0-9._-]+/gi, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024, files: 5 } });
exports.uploadMiddleware = upload.array('files', 5);

// Query Management — see models/QueryTicket.js. One register per
// organisation (OEM and Reseller each only ever see their own, via the same
// req.user.id org-scoping every other tracker uses); this file is shared by
// both portals' pages.

const CATEGORIES = ['tender', 'emd', 'contract', 'authorization', 'order', 'payment', 'distributor', 'technical', 'other'];
const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const OPEN_STATUSES = ['open', 'in_progress'];
const OVERDUE_HOURS = 72; // no activity in 3 days on an unresolved query counts as overdue

const nz = (v) => (v === '' || v === undefined ? null : v);
const now = () => new Date();

async function actor(req) {
  const a = await resolveActor(req);
  return a || { actorType: 'user', staffId: null, userId: req.user.id, actorName: 'Organization Admin' };
}

function toRow(r) {
  const j = r.toJSON();
  const overdue = OPEN_STATUSES.includes(j.status) && j.lastActivityAt
    && (Date.now() - new Date(j.lastActivityAt).getTime()) > OVERDUE_HOURS * 3600 * 1000;
  return { ...j, thread: j.thread || [], attachments: j.attachments || [], overdue };
}

async function notify(userId, { type, title, message, relatedId }) {
  try { await Notification.create({ userId, type, title, message, relatedType: 'query', relatedId }); }
  catch (err) { console.error('query notify error:', err); }
}

// @route GET /api/queries
exports.list = async (req, res) => {
  try {
    const { status, category, priority, assignedToStaffId, search } = req.query;
    const where = { userId: req.user.id };
    if (status && STATUSES.includes(status)) where.status = status;
    if (category && CATEGORIES.includes(category)) where.category = category;
    if (priority && PRIORITIES.includes(priority)) where.priority = priority;
    if (assignedToStaffId) where.assignedToStaffId = assignedToStaffId === 'unassigned' ? null : Number(assignedToStaffId);
    if (search) {
      where[Op.or] = [
        { subject: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { relatedRef: { [Op.like]: `%${search}%` } },
      ];
    }
    const all = (await QueryTicket.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })).map(toRow);
    const filtered = (await QueryTicket.findAll({ where, order: [['lastActivityAt', 'DESC'], ['createdAt', 'DESC']] })).map(toRow);

    const stats = {
      total: all.length,
      open: all.filter((r) => r.status === 'open').length,
      inProgress: all.filter((r) => r.status === 'in_progress').length,
      resolved: all.filter((r) => r.status === 'resolved').length,
      closed: all.filter((r) => r.status === 'closed').length,
      overdue: all.filter((r) => r.overdue).length,
      highPriority: all.filter((r) => r.priority === 'high' && OPEN_STATUSES.includes(r.status)).length,
    };
    res.json({ success: true, data: filtered, total: filtered.length, stats });
  } catch (err) {
    console.error('query list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load queries' });
  }
};

// @route GET /api/queries/assignees — org owner + active staff, for the assignee dropdown.
exports.assignees = async (req, res) => {
  try {
    const profile = await PartnerProfile.findOne({ where: { userId: req.user.id } });
    const owner = await User.findByPk(req.user.id, { attributes: ['id', 'name'] });
    const options = [{ staffId: null, name: owner?.name ? `${owner.name} (Owner)` : 'Organization Owner' }];
    if (profile) {
      const staff = await StaffUser.findAll({ where: { partnerProfileId: profile.id, status: 'active' }, attributes: ['id', 'name', 'role'], order: [['name', 'ASC']] });
      staff.forEach((s) => options.push({ staffId: s.id, name: s.name, role: s.role }));
    }
    res.json({ success: true, data: options });
  } catch (err) {
    console.error('query assignees error:', err);
    res.status(500).json({ success: false, message: 'Failed to load assignees' });
  }
};

// @route GET /api/queries/:id
exports.get = async (req, res) => {
  try {
    const row = await QueryTicket.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Query not found' });
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load query' });
  }
};

// @route POST /api/queries
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.subject || '').trim()) return res.status(400).json({ success: false, message: 'Subject is required' });
    if (b.category !== undefined && !CATEGORIES.includes(b.category)) return res.status(400).json({ success: false, message: 'Invalid category' });
    if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return res.status(400).json({ success: false, message: 'Invalid priority' });

    const a = await actor(req);
    const at = now();
    const row = await QueryTicket.create({
      userId: req.user.id,
      category: CATEGORIES.includes(b.category) ? b.category : 'other',
      subject: b.subject.trim(),
      description: nz(b.description),
      relatedRef: nz(b.relatedRef),
      priority: PRIORITIES.includes(b.priority) ? b.priority : 'medium',
      status: 'open',
      raisedByName: a.actorName,
      raisedByActorType: a.actorType,
      raisedByStaffId: a.staffId,
      assignedToStaffId: nz(b.assignedToStaffId) === null ? null : Number(b.assignedToStaffId),
      assignedToName: nz(b.assignedToName),
      lastActivityAt: at,
      createdByName: a.actorName,
      updatedBy: a.actorName,
      thread: [{ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'note', message: 'Query raised' }],
    });
    await notify(req.user.id, {
      type: 'query_created',
      title: `New query: ${row.subject}`,
      message: `${a.actorName} raised a ${row.priority} priority query${row.assignedToName ? ` for ${row.assignedToName}` : ''}.`,
      relatedId: row.id,
    });
    res.status(201).json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('query create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create query' });
  }
};

const EDITABLE = ['subject', 'description', 'relatedRef', 'category', 'priority'];

// @route PUT /api/queries/:id — edit fields and/or change status/assignee.
exports.update = async (req, res) => {
  try {
    const row = await QueryTicket.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Query not found' });
    const b = req.body || {};
    if (b.category !== undefined && !CATEGORIES.includes(b.category)) return res.status(400).json({ success: false, message: 'Invalid category' });
    if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return res.status(400).json({ success: false, message: 'Invalid priority' });
    if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ success: false, message: 'Invalid status' });

    const a = await actor(req);
    const at = now();
    const notes = [];
    const thread = Array.isArray(row.thread) ? [...row.thread] : [];

    EDITABLE.forEach((f) => { if (b[f] !== undefined) row[f] = nz(typeof b[f] === 'string' ? b[f].trim() : b[f]); });

    if (b.status !== undefined && b.status !== row.status) {
      notes.push(`Status changed from "${row.status}" to "${b.status}"`);
      row.status = b.status;
    }
    if (b.assignedToStaffId !== undefined || b.assignedToName !== undefined) {
      const newStaffId = b.assignedToStaffId === '' || b.assignedToStaffId === undefined ? row.assignedToStaffId : (b.assignedToStaffId === null ? null : Number(b.assignedToStaffId));
      const newName = b.assignedToName !== undefined ? nz(b.assignedToName) : row.assignedToName;
      if (newName !== row.assignedToName) notes.push(`Assigned to ${newName || 'no one'}`);
      row.assignedToStaffId = newStaffId;
      row.assignedToName = newName;
    }

    notes.forEach((note) => thread.push({ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'note', message: note }));
    row.thread = thread;
    row.updatedBy = a.actorName;
    row.lastActivityAt = at;
    await row.save();

    if (notes.length) {
      await notify(req.user.id, {
        type: 'query_updated',
        title: `Query updated: ${row.subject}`,
        message: `${a.actorName}: ${notes.join('; ')}.`,
        relatedId: row.id,
      });
    }
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('query update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update query' });
  }
};

// @route POST /api/queries/:id/reply
exports.reply = async (req, res) => {
  try {
    const row = await QueryTicket.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Query not found' });
    const message = String((req.body || {}).message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'Reply message is required' });

    const a = await actor(req);
    const at = now();
    const thread = Array.isArray(row.thread) ? [...row.thread] : [];
    thread.push({ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'message', message });
    row.thread = thread;
    row.lastActivityAt = at;
    row.updatedBy = a.actorName;
    if (row.status === 'open') row.status = 'in_progress';
    await row.save();

    await notify(req.user.id, {
      type: 'query_reply',
      title: `New reply on: ${row.subject}`,
      message: `${a.actorName}: ${message.slice(0, 140)}`,
      relatedId: row.id,
    });
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('query reply error:', err);
    res.status(500).json({ success: false, message: 'Failed to post reply' });
  }
};

// @route POST /api/queries/:id/attachments  multipart: files[]
exports.addAttachments = async (req, res) => {
  try {
    const row = await QueryTicket.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Query not found' });
    if (!req.files || !req.files.length) return res.status(400).json({ success: false, message: 'No files uploaded' });

    const a = await actor(req);
    const at = now();
    const added = req.files.map((f) => ({
      fileName: f.originalname, filePath: `/uploads/queries/${path.basename(f.path)}`, size: f.size,
      uploadedByName: a.actorName, uploadedAt: at.toISOString(),
    }));
    row.attachments = [...(row.attachments || []), ...added];
    const thread = Array.isArray(row.thread) ? [...row.thread] : [];
    thread.push({ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'note', message: `Attached ${added.map((f) => f.fileName).join(', ')}` });
    row.thread = thread;
    row.lastActivityAt = at;
    await row.save();
    res.status(201).json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('query addAttachments error:', err);
    res.status(500).json({ success: false, message: 'Failed to upload attachment' });
  }
};

// @route DELETE /api/queries/:id/attachments/:index
exports.removeAttachment = async (req, res) => {
  try {
    const row = await QueryTicket.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Query not found' });
    const idx = Number(req.params.index);
    const list = row.attachments || [];
    if (!list[idx]) return res.status(404).json({ success: false, message: 'Attachment not found' });
    const [removed] = list.splice(idx, 1);
    row.attachments = list;
    await row.save();
    if (removed?.filePath) fs.unlink(path.join(__dirname, '..', removed.filePath), () => {});
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to remove attachment' });
  }
};

// @route DELETE /api/queries/:id
exports.remove = async (req, res) => {
  try {
    const row = await QueryTicket.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Query not found' });
    (row.attachments || []).forEach((f) => { if (f.filePath) fs.unlink(path.join(__dirname, '..', f.filePath), () => {}); });
    await row.destroy();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete query' });
  }
};

// @route GET /api/queries/export
exports.exportExcel = safeHandler('query export', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['status', 'category', 'priority', 'assignedToStaffId', 'search'], paged: false });
  await sendWorkbook(res, {
    title: 'Query Management',
    filename: 'Query_Management',
    mode, applied,
    columns: [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Subject', key: 'subject', width: 40 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Related Ref', key: 'relatedRef', width: 20 },
      { header: 'Raised By', key: 'raisedByName', width: 20 },
      { header: 'Assigned To', key: 'assignedToName', width: 20 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Created', key: 'createdAt', width: 18, type: 'datetime' },
      { header: 'Last Activity', key: 'lastActivityAt', width: 18, type: 'datetime' },
    ],
    rows,
  });
});

exports.CATEGORIES = CATEGORIES;
exports.PRIORITIES = PRIORITIES;
exports.STATUSES = STATUSES;
