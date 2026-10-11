// Query Management — an internal helpdesk within each organisation's own
// portal (OEM side and Reseller side each see only their own queries, same
// userId-scoping pattern as everything else) where a staff login can raise a
// question tied to something in the system (a tender, an EMD, a contract, an
// authorization, a payment...) and the org owner / another staff member tracks
// it to resolution. `thread` is an append-only array of replies (same JSON
// "history" shape used by EmdRecord), so the whole conversation lives on one
// row without needing a join table.
module.exports = (sequelize, DataTypes) => sequelize.define('QueryTicket', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  category: {
    type: DataTypes.ENUM('tender', 'emd', 'contract', 'authorization', 'order', 'payment', 'distributor', 'technical', 'other'),
    allowNull: false, defaultValue: 'other',
  },
  subject: { type: DataTypes.STRING(300), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  // Free-text reference to whatever this is about (a bid number, contract no,
  // EMD reference...) — no FK, since a query can point at any kind of record.
  relatedRef: { type: DataTypes.STRING(200), allowNull: true, field: 'related_ref' },
  priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
  status: { type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed'), allowNull: false, defaultValue: 'open' },
  raisedByName: { type: DataTypes.STRING, allowNull: true, field: 'raised_by_name' },
  raisedByActorType: { type: DataTypes.ENUM('user', 'staff'), allowNull: true, field: 'raised_by_actor_type' },
  raisedByStaffId: { type: DataTypes.INTEGER, allowNull: true, field: 'raised_by_staff_id' },
  assignedToName: { type: DataTypes.STRING, allowNull: true, field: 'assigned_to_name' },
  assignedToStaffId: { type: DataTypes.INTEGER, allowNull: true, field: 'assigned_to_staff_id' },
  lastActivityAt: { type: DataTypes.DATE, allowNull: true, field: 'last_activity_at' },
  // [{ at, byName, byActorType, kind: 'message' | 'note', message }] — every
  // reply and every status/assignee change lands here in order.
  thread: { type: DataTypes.JSON, allowNull: true },
  // [{ fileName, filePath, size, uploadedByName, uploadedAt }] — images, PDFs or
  // other documents the raiser (or whoever replies) attaches for reference, so
  // whoever picks up the query can see the actual screenshot/document, not
  // just a text description of it.
  attachments: { type: DataTypes.JSON, allowNull: true },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: 'updated_by' },
}, {
  tableName: 'query_tickets',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'idx_query_user_status', fields: ['user_id', 'status'] },
    { name: 'idx_query_user_category', fields: ['user_id', 'category'] },
  ],
});
