// Support > Task Management — an internal work-assignment register within
// each organisation's own portal (OEM and Reseller each only see their own,
// same userId-scoping as Query Management). The owner, or any staff login,
// can hand a task to anyone else in the org (the owner or another staff
// member) with a due date, priority and category, attach documents needed to
// do it, and track it to completion — with an email to the assignee whenever
// it's assigned/reassigned, and a shared thread (comments + status notes) the
// same shape as Query Management's, kept on the row so no join table is needed.
module.exports = (sequelize, DataTypes) => sequelize.define('TaskItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  title: { type: DataTypes.STRING(300), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  category: {
    type: DataTypes.ENUM('tender', 'emd', 'contract', 'authorization', 'order', 'payment', 'distributor', 'agreement', 'general'),
    allowNull: false, defaultValue: 'general',
  },
  priority: { type: DataTypes.ENUM('low', 'medium', 'high'), allowNull: false, defaultValue: 'medium' },
  status: { type: DataTypes.ENUM('todo', 'in_progress', 'completed', 'cancelled'), allowNull: false, defaultValue: 'todo' },
  dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'due_date' },
  // Free-text reference to whatever this task is about (a bid number, contract no...).
  relatedRef: { type: DataTypes.STRING(200), allowNull: true, field: 'related_ref' },
  // Who it's assigned to — either the org owner (kind='owner', id = User.id) or
  // a staff login (kind='staff', id = StaffUser.id). Name/email are snapshotted
  // at assignment time so the record and its email trail stay meaningful even
  // if that person is later renamed/deactivated.
  assigneeKind: { type: DataTypes.ENUM('owner', 'staff'), allowNull: true, field: 'assignee_kind' },
  assigneeId: { type: DataTypes.INTEGER, allowNull: true, field: 'assignee_id' },
  assignedToName: { type: DataTypes.STRING, allowNull: true, field: 'assigned_to_name' },
  assignedToEmail: { type: DataTypes.STRING, allowNull: true, field: 'assigned_to_email' },
  assignedByName: { type: DataTypes.STRING, allowNull: true, field: 'assigned_by_name' },
  assignedByActorType: { type: DataTypes.ENUM('user', 'staff'), allowNull: true, field: 'assigned_by_actor_type' },
  assignedByStaffId: { type: DataTypes.INTEGER, allowNull: true, field: 'assigned_by_staff_id' },
  completedAt: { type: DataTypes.DATE, allowNull: true, field: 'completed_at' },
  lastActivityAt: { type: DataTypes.DATE, allowNull: true, field: 'last_activity_at' },
  // [{ fileName, filePath, size, uploadedByName, uploadedAt }] — documents needed
  // to do the task, or produced while doing it.
  attachments: { type: DataTypes.JSON, allowNull: true },
  // [{ at, byName, byActorType, kind: 'comment' | 'note', message }].
  thread: { type: DataTypes.JSON, allowNull: true },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: 'updated_by' },
}, {
  tableName: 'task_items',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'idx_task_user_status', fields: ['user_id', 'status'] },
    { name: 'idx_task_user_assignee', fields: ['user_id', 'assignee_kind', 'assignee_id'] },
  ],
});
