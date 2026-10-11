const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Op } = require('sequelize');
const { TaskItem, Notification } = require('../models');
const { resolveActor } = require('../utils/orgActor');
const { listAssignees, resolveAssignee } = require('../utils/orgAssignees');
const { collectRows, sendWorkbook, safeHandler } = require('../utils/trackerExport');
const { sendMail, isMailConfigured } = require('../utils/mailer');

// Support > Task Management — see models/TaskItem.js. Shared by both the OEM
// and Reseller portals (each org only ever sees its own rows, same
// req.user.id org-scoping every other tracker in this app uses).

const CATEGORIES = ['tender', 'emd', 'contract', 'authorization', 'order', 'payment', 'distributor', 'agreement', 'general'];
const PRIORITIES = ['low', 'medium', 'high'];
const STATUSES = ['todo', 'in_progress', 'completed', 'cancelled'];
const OPEN_STATUSES = ['todo', 'in_progress'];

const UPLOAD_DIR = path.join(__dirname, '../uploads/tasks');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}_${Math.round(Math.random() * 1e9)}_${file.originalname.replace(/[^a-z0-9._-]+/gi, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024, files: 5 } });
exports.uploadMiddleware = upload.array('files', 5);

const nz = (v) => (v === '' || v === undefined ? null : v);
const now = () => new Date();
const today = () => new Date().toISOString().slice(0, 10);

async function actor(req) {
  const a = await resolveActor(req);
  return a || { actorType: 'user', staffId: null, userId: req.user.id, actorName: 'Organization Admin' };
}

function toRow(r) {
  const j = r.toJSON();
  const overdue = OPEN_STATUSES.includes(j.status) && j.dueDate && j.dueDate < today();
  const dueSoon = !overdue && OPEN_STATUSES.includes(j.status) && j.dueDate
    && new Date(j.dueDate).getTime() - Date.now() <= 2 * 86400000;
  return { ...j, thread: j.thread || [], attachments: j.attachments || [], overdue, dueSoon };
}

async function notify(userId, { type, title, message, relatedId }) {
  try { await Notification.create({ userId, type, title, message, relatedType: 'task', relatedId }); }
  catch (err) { console.error('task notify error:', err); }
}

async function mailAssignee(email, name, { title, message }) {
  if (!isMailConfigured() || !email) return;
  sendMail({ to: email, subject: title, html: `<p>Hi ${name || ''},</p><p>${message}</p>` })
    .catch((err) => console.error('task mail error:', err.message));
}

// @route GET /api/tasks
exports.list = async (req, res) => {
  try {
    const { status, category, priority, assignee, search } = req.query;
    const where = { userId: req.user.id };
    if (status && STATUSES.includes(status)) where.status = status;
    if (category && CATEGORIES.includes(category)) where.category = category;
    if (priority && PRIORITIES.includes(priority)) where.priority = priority;
    if (assignee === 'unassigned') { where.assigneeKind = null; }
    else if (assignee) { const [kind, id] = assignee.split(':'); if (kind && id) { where.assigneeKind = kind; where.assigneeId = Number(id); } }
    if (search) {
      where[Op.or] = [
        { title: { [Op.like]: `%${search}%` } },
        { description: { [Op.like]: `%${search}%` } },
        { relatedRef: { [Op.like]: `%${search}%` } },
      ];
    }
    const all = (await TaskItem.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']] })).map(toRow);
    const filtered = (await TaskItem.findAll({ where, order: [['dueDate', 'ASC'], ['createdAt', 'DESC']] })).map(toRow);

    const stats = {
      total: all.length,
      todo: all.filter((r) => r.status === 'todo').length,
      inProgress: all.filter((r) => r.status === 'in_progress').length,
      completed: all.filter((r) => r.status === 'completed').length,
      cancelled: all.filter((r) => r.status === 'cancelled').length,
      overdue: all.filter((r) => r.overdue).length,
      dueSoon: all.filter((r) => r.dueSoon).length,
    };
    res.json({ success: true, data: filtered, total: filtered.length, stats });
  } catch (err) {
    console.error('task list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load tasks' });
  }
};

// @route GET /api/tasks/assignees
exports.assignees = async (req, res) => {
  try { res.json({ success: true, data: await listAssignees(req) }); }
  catch (err) { res.status(500).json({ success: false, message: 'Failed to load assignees' }); }
};

// @route GET /api/tasks/:id
exports.get = async (req, res) => {
  try {
    const row = await TaskItem.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Task not found' });
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to load task' });
  }
};

// @route POST /api/tasks
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    if (!String(b.title || '').trim()) return res.status(400).json({ success: false, message: 'Title is required' });
    if (b.category !== undefined && !CATEGORIES.includes(b.category)) return res.status(400).json({ success: false, message: 'Invalid category' });
    if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return res.status(400).json({ success: false, message: 'Invalid priority' });

    const a = await actor(req);
    const at = now();
    const assignee = await resolveAssignee(req, b.assigneeKind, b.assigneeId);

    const row = await TaskItem.create({
      userId: req.user.id,
      title: b.title.trim(),
      description: nz(b.description),
      category: CATEGORIES.includes(b.category) ? b.category : 'general',
      priority: PRIORITIES.includes(b.priority) ? b.priority : 'medium',
      status: 'todo',
      dueDate: nz(b.dueDate),
      relatedRef: nz(b.relatedRef),
      assigneeKind: assignee?.kind || null,
      assigneeId: assignee?.id ?? null,
      assignedToName: assignee?.name || null,
      assignedToEmail: assignee?.email || null,
      assignedByName: a.actorName,
      assignedByActorType: a.actorType,
      assignedByStaffId: a.staffId,
      lastActivityAt: at,
      createdByName: a.actorName,
      updatedBy: a.actorName,
      thread: [{ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'note', message: assignee ? `Task assigned to ${assignee.name}` : 'Task created' }],
    });

    await notify(req.user.id, {
      type: 'task_created',
      title: `New task: ${row.title}`,
      message: `${a.actorName} created a ${row.priority} priority task${assignee ? ` for ${assignee.name}` : ''}${row.dueDate ? `, due ${row.dueDate}` : ''}.`,
      relatedId: row.id,
    });
    if (assignee?.email) {
      await mailAssignee(assignee.email, assignee.name, {
        title: `New task assigned: ${row.title}`,
        message: `${a.actorName} assigned you a task${row.dueDate ? ` due on ${row.dueDate}` : ''} (${row.priority} priority).<br/>${row.description ? row.description.replace(/\n/g, '<br/>') : ''}`,
      });
    }
    res.status(201).json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('task create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create task' });
  }
};

const EDITABLE = ['title', 'description', 'relatedRef', 'category', 'priority', 'dueDate'];

// @route PUT /api/tasks/:id
exports.update = async (req, res) => {
  try {
    const row = await TaskItem.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Task not found' });
    const b = req.body || {};
    if (b.category !== undefined && !CATEGORIES.includes(b.category)) return res.status(400).json({ success: false, message: 'Invalid category' });
    if (b.priority !== undefined && !PRIORITIES.includes(b.priority)) return res.status(400).json({ success: false, message: 'Invalid priority' });
    if (b.status !== undefined && !STATUSES.includes(b.status)) return res.status(400).json({ success: false, message: 'Invalid status' });

    const a = await actor(req);
    const at = now();
    const notes = [];
    const thread = Array.isArray(row.thread) ? [...row.thread] : [];

    EDITABLE.forEach((f) => { if (b[f] !== undefined) row[f] = nz(typeof b[f] === 'string' ? b[f].trim() : b[f]); });

    let newlyAssigned = null;
    if (b.assigneeKind !== undefined || b.assigneeId !== undefined) {
      const assignee = await resolveAssignee(req, b.assigneeKind, b.assigneeId);
      if ((assignee?.name || null) !== row.assignedToName) {
        notes.push(assignee ? `Reassigned to ${assignee.name}` : 'Unassigned');
        row.assigneeKind = assignee?.kind || null;
        row.assigneeId = assignee?.id ?? null;
        row.assignedToName = assignee?.name || null;
        row.assignedToEmail = assignee?.email || null;
        if (assignee) newlyAssigned = assignee;
      }
    }
    if (b.status !== undefined && b.status !== row.status) {
      notes.push(`Status changed from "${row.status}" to "${b.status}"`);
      row.status = b.status;
      row.completedAt = b.status === 'completed' ? at : null;
    }

    notes.forEach((note) => thread.push({ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'note', message: note }));
    row.thread = thread;
    row.updatedBy = a.actorName;
    row.lastActivityAt = at;
    await row.save();

    if (notes.length) {
      await notify(req.user.id, { type: 'task_updated', title: `Task updated: ${row.title}`, message: `${a.actorName}: ${notes.join('; ')}.`, relatedId: row.id });
    }
    if (newlyAssigned?.email) {
      await mailAssignee(newlyAssigned.email, newlyAssigned.name, {
        title: `Task assigned to you: ${row.title}`,
        message: `${a.actorName} assigned you a task${row.dueDate ? ` due on ${row.dueDate}` : ''} (${row.priority} priority).<br/>${row.description ? row.description.replace(/\n/g, '<br/>') : ''}`,
      });
    }
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('task update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update task' });
  }
};

// @route POST /api/tasks/:id/reply
exports.reply = async (req, res) => {
  try {
    const row = await TaskItem.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Task not found' });
    const message = String((req.body || {}).message || '').trim();
    if (!message) return res.status(400).json({ success: false, message: 'Comment is required' });

    const a = await actor(req);
    const at = now();
    const thread = Array.isArray(row.thread) ? [...row.thread] : [];
    thread.push({ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'comment', message });
    row.thread = thread;
    row.lastActivityAt = at;
    row.updatedBy = a.actorName;
    if (row.status === 'todo') row.status = 'in_progress';
    await row.save();

    await notify(req.user.id, { type: 'task_comment', title: `New comment on: ${row.title}`, message: `${a.actorName}: ${message.slice(0, 140)}`, relatedId: row.id });
    res.json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('task reply error:', err);
    res.status(500).json({ success: false, message: 'Failed to post comment' });
  }
};

// @route POST /api/tasks/:id/attachments  multipart: files[]
exports.addAttachments = async (req, res) => {
  try {
    const row = await TaskItem.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Task not found' });
    if (!req.files || !req.files.length) return res.status(400).json({ success: false, message: 'No files uploaded' });

    const a = await actor(req);
    const at = now();
    const added = req.files.map((f) => ({
      fileName: f.originalname, filePath: `/uploads/tasks/${path.basename(f.path)}`, size: f.size,
      uploadedByName: a.actorName, uploadedAt: at.toISOString(),
    }));
    row.attachments = [...(row.attachments || []), ...added];
    const thread = Array.isArray(row.thread) ? [...row.thread] : [];
    thread.push({ at: at.toISOString(), byName: a.actorName, byActorType: a.actorType, kind: 'note', message: `Uploaded ${added.map((f) => f.fileName).join(', ')}` });
    row.thread = thread;
    row.lastActivityAt = at;
    await row.save();
    res.status(201).json({ success: true, data: toRow(row) });
  } catch (err) {
    console.error('task addAttachments error:', err);
    res.status(500).json({ success: false, message: 'Failed to upload attachment' });
  }
};

// @route DELETE /api/tasks/:id/attachments/:index
exports.removeAttachment = async (req, res) => {
  try {
    const row = await TaskItem.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Task not found' });
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

// @route DELETE /api/tasks/:id
exports.remove = async (req, res) => {
  try {
    const row = await TaskItem.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Task not found' });
    (row.attachments || []).forEach((f) => { if (f.filePath) fs.unlink(path.join(__dirname, '..', f.filePath), () => {}); });
    await row.destroy();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete task' });
  }
};

// @route GET /api/tasks/export
exports.exportExcel = safeHandler('task export', async (req, res) => {
  const { rows, mode, applied } = await collectRows(exports.list, req, { clear: ['status', 'category', 'priority', 'assignee', 'search'], paged: false });
  await sendWorkbook(res, {
    title: 'Task Management',
    filename: 'Task_Management',
    mode, applied,
    columns: [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Title', key: 'title', width: 40 },
      { header: 'Category', key: 'category', width: 16 },
      { header: 'Priority', key: 'priority', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'Due Date', key: 'dueDate', width: 14, type: 'date' },
      { header: 'Related Ref', key: 'relatedRef', width: 20 },
      { header: 'Assigned By', key: 'assignedByName', width: 20 },
      { header: 'Assigned To', key: 'assignedToName', width: 20 },
      { header: 'Description', key: 'description', width: 50 },
      { header: 'Created', key: 'createdAt', width: 18, type: 'datetime' },
      { header: 'Completed', key: 'completedAt', width: 18, type: 'datetime' },
    ],
    rows,
  });
});

exports.CATEGORIES = CATEGORIES;
exports.PRIORITIES = PRIORITIES;
exports.STATUSES = STATUSES;
