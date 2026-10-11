const { Notification } = require('../models');

// Shared helper so every feature that needs to notify a user does it the
// same way — currently only the Authorization Request workflow, but built
// generic (type + relatedType/relatedId) so it isn't a rewrite next time.
async function notify(userId, { type, title, message, relatedType, relatedId }) {
  return Notification.create({ userId, type, title, message: message || null, relatedType: relatedType || null, relatedId: relatedId || null });
}

module.exports = { notify };
