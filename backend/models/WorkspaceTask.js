// Tender Hub > Workspace tab — a to-do item under a department, optionally
// assigned to one of the partner's own Setup-Profile contacts (see
// PartnerContact.js) standing in for the original's internal "employees".
module.exports = (sequelize, DataTypes) => {
  const WorkspaceTask = sequelize.define('WorkspaceTask', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    departmentId: { type: DataTypes.INTEGER, allowNull: true, field: 'department_id' },
    assignedContactId: { type: DataTypes.INTEGER, allowNull: true, field: 'assigned_contact_id' },
    title: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('todo', 'in_progress', 'done'), allowNull: false, defaultValue: 'todo' },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'due_date' },
  }, {
    tableName: 'workspace_tasks',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'bid_number'] }],
  });

  return WorkspaceTask;
};
