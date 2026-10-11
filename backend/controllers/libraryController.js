const fs = require('fs');
const { Op } = require('sequelize');
const { LibraryItem } = require('../models');

// Clone of the automation site's Workdesk > Library — a folder/file tree
// with two division root folders (Diagnostics/EndoSurgery), scoped per
// partner (see LibraryItem.js for why). Every query is filtered by
// ownerUserId — this is a private per-partner document library, not the
// original's shared internal tool.

const DIVISION_ROOTS = [
  { division: 'diagno', name: 'Diagnostics Division' },
  { division: 'endo', name: 'EndoSurgery Division' },
];

// Ensures both division root folders exist for this partner — created
// lazily on first Library visit rather than at signup, so existing partners
// don't need a backfill migration.
async function ensureDivisionRoots(ownerUserId) {
  for (const root of DIVISION_ROOTS) {
    const existing = await LibraryItem.findOne({ where: { ownerUserId, parentId: null, division: root.division, type: 'folder' } });
    if (!existing) {
      await LibraryItem.create({ ownerUserId, parentId: null, division: root.division, type: 'folder', name: root.name });
    }
  }
}

async function fileCountRecursive(ownerUserId, folderId) {
  const children = await LibraryItem.findAll({ where: { ownerUserId, parentId: folderId } });
  let count = 0;
  for (const child of children) {
    if (child.type === 'file') count += 1;
    else count += await fileCountRecursive(ownerUserId, child.id);
  }
  return count;
}

function expiryStatus(expiryDate) {
  if (!expiryDate) return null;
  const days = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / 8.64e7);
  if (days < 0) return { days, expired: true };
  return { days, expired: false };
}

// @route GET /api/library?parent_id=
exports.listItems = async (req, res) => {
  try {
    await ensureDivisionRoots(req.user.id);
    const parentId = req.query.parent_id ? Number(req.query.parent_id) : null;

    const items = await LibraryItem.findAll({
      where: { ownerUserId: req.user.id, parentId },
      order: [['type', 'ASC'], ['name', 'ASC']],
    });

    const data = await Promise.all(items.map(async (item) => {
      const json = item.toJSON();
      const fileCount = json.type === 'folder' ? await fileCountRecursive(req.user.id, json.id) : null;
      return { ...json, fileCount, expiry: expiryStatus(json.expiryDate) };
    }));

    // Breadcrumb trail up to root.
    const breadcrumb = [];
    let cursor = parentId;
    while (cursor) {
      const folder = await LibraryItem.findOne({ where: { id: cursor, ownerUserId: req.user.id } });
      if (!folder) break;
      breadcrumb.unshift({ id: folder.id, name: folder.name });
      cursor = folder.parentId;
    }

    res.json({ success: true, data, breadcrumb, parentId });
  } catch (err) {
    console.error('listItems error:', err);
    res.status(500).json({ success: false, message: 'Failed to list library items' });
  }
};

// @route GET /api/library/search?q=
exports.searchItems = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json({ success: true, data: [] });

    const items = await LibraryItem.findAll({
      where: { ownerUserId: req.user.id, name: { [Op.like]: `%${q}%` } },
      order: [['updatedAt', 'DESC']],
      limit: 100,
    });

    // Build a readable path label for each hit (walk up to root).
    const data = await Promise.all(items.map(async (item) => {
      const parts = [];
      let cursor = item.parentId;
      while (cursor) {
        const parent = await LibraryItem.findOne({ where: { id: cursor, ownerUserId: req.user.id } });
        if (!parent) break;
        parts.unshift(parent.name);
        cursor = parent.parentId;
      }
      const json = item.toJSON();
      return { ...json, pathLabel: parts.join(' / ') || 'Root', expiry: expiryStatus(json.expiryDate) };
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('searchItems error:', err);
    res.status(500).json({ success: false, message: 'Search failed' });
  }
};

// @route POST /api/library/folder
exports.createFolder = async (req, res) => {
  try {
    const { name, parentId } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Folder name is required' });

    let division = null;
    if (parentId) {
      const parent = await LibraryItem.findOne({ where: { id: parentId, ownerUserId: req.user.id } });
      if (!parent) return res.status(404).json({ success: false, message: 'Parent folder not found' });
      division = parent.division;
    } else {
      return res.status(400).json({ success: false, message: 'New folders must be created inside a division' });
    }

    const folder = await LibraryItem.create({ ownerUserId: req.user.id, parentId: parentId || null, division, type: 'folder', name: name.trim() });
    res.json({ success: true, data: folder.toJSON() });
  } catch (err) {
    console.error('createFolder error:', err);
    res.status(500).json({ success: false, message: 'Failed to create folder' });
  }
};

// @route POST /api/library/file (multipart, field "file")
exports.uploadFile = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const { parentId } = req.body;
    if (!parentId) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'A destination folder is required' });
    }

    const parent = await LibraryItem.findOne({ where: { id: parentId, ownerUserId: req.user.id } });
    if (!parent) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Destination folder not found' });
    }

    const file = await LibraryItem.create({
      ownerUserId: req.user.id,
      parentId: Number(parentId),
      division: parent.division,
      type: 'file',
      name: req.file.originalname,
      filePath: req.file.path,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });

    res.json({ success: true, data: file.toJSON() });
  } catch (err) {
    console.error('uploadFile error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
};

// @route GET /api/library/file/:id/download
exports.downloadFile = async (req, res) => {
  try {
    const item = await LibraryItem.findOne({ where: { id: req.params.id, ownerUserId: req.user.id, type: 'file' } });
    if (!item || !item.filePath || !fs.existsSync(item.filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    res.download(item.filePath, item.name);
  } catch (err) {
    console.error('downloadFile error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};

// @route GET /api/library/file/:id/view
exports.viewFile = async (req, res) => {
  try {
    const item = await LibraryItem.findOne({ where: { id: req.params.id, ownerUserId: req.user.id, type: 'file' } });
    if (!item || !item.filePath || !fs.existsSync(item.filePath)) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }
    res.setHeader('Content-Type', item.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(item.name)}"`);
    fs.createReadStream(item.filePath).pipe(res);
  } catch (err) {
    console.error('viewFile error:', err);
    res.status(500).json({ success: false, message: 'Failed to open file' });
  }
};

// @route PATCH /api/library/:id (rename)
exports.renameItem = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
    const item = await LibraryItem.findOne({ where: { id: req.params.id, ownerUserId: req.user.id } });
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!item.parentId) return res.status(403).json({ success: false, message: 'Division folders cannot be renamed' });
    item.name = name.trim();
    await item.save();
    res.json({ success: true, data: item.toJSON() });
  } catch (err) {
    console.error('renameItem error:', err);
    res.status(500).json({ success: false, message: 'Rename failed' });
  }
};

// @route PATCH /api/library/:id/expiry
exports.updateExpiry = async (req, res) => {
  try {
    const { expiryDate } = req.body;
    const item = await LibraryItem.findOne({ where: { id: req.params.id, ownerUserId: req.user.id, type: 'file' } });
    if (!item) return res.status(404).json({ success: false, message: 'File not found' });
    item.expiryDate = expiryDate || null;
    await item.save();
    res.json({ success: true, data: { expiryDate: item.expiryDate } });
  } catch (err) {
    console.error('updateExpiry error:', err);
    res.status(500).json({ success: false, message: 'Failed to update expiry date' });
  }
};

async function deleteRecursive(ownerUserId, id) {
  const item = await LibraryItem.findOne({ where: { id, ownerUserId } });
  if (!item) return;
  if (item.type === 'folder') {
    const children = await LibraryItem.findAll({ where: { ownerUserId, parentId: id } });
    for (const child of children) await deleteRecursive(ownerUserId, child.id);
  } else if (item.filePath && fs.existsSync(item.filePath)) {
    fs.unlink(item.filePath, () => {});
  }
  await item.destroy();
}

// @route DELETE /api/library/:id
exports.deleteItem = async (req, res) => {
  try {
    const item = await LibraryItem.findOne({ where: { id: req.params.id, ownerUserId: req.user.id } });
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (!item.parentId) return res.status(403).json({ success: false, message: 'Division folders cannot be deleted' });
    await deleteRecursive(req.user.id, item.id);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteItem error:', err);
    res.status(500).json({ success: false, message: 'Delete failed' });
  }
};
