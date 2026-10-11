const { Notification } = require('../models');

// @route GET /api/notifications
exports.listNotifications = async (req, res) => {
  try {
    const rows = await Notification.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 50 });
    const unreadCount = await Notification.count({ where: { userId: req.user.id, isRead: false } });
    res.json({ success: true, data: rows.map((r) => r.toJSON()), unreadCount });
  } catch (err) {
    console.error('listNotifications error:', err);
    res.status(500).json({ success: false, message: 'Failed to load notifications' });
  }
};

// @route PATCH /api/notifications/:id/read
exports.markRead = async (req, res) => {
  try {
    const [count] = await Notification.update({ isRead: true }, { where: { id: req.params.id, userId: req.user.id } });
    if (!count) return res.status(404).json({ success: false, message: 'Notification not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('markRead error:', err);
    res.status(500).json({ success: false, message: 'Failed to update notification' });
  }
};

// @route POST /api/notifications/read-all
exports.markAllRead = async (req, res) => {
  try {
    await Notification.update({ isRead: true }, { where: { userId: req.user.id, isRead: false } });
    res.json({ success: true });
  } catch (err) {
    console.error('markAllRead error:', err);
    res.status(500).json({ success: false, message: 'Failed to update notifications' });
  }
};
