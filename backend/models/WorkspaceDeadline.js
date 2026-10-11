// Tender Hub > Settings > Time Management — freeform reminders the partner
// sets themselves (submission deadline, sample dispatch date, etc.),
// distinct from the tender's own scraped bid-end-date.
module.exports = (sequelize, DataTypes) => {
  const WorkspaceDeadline = sequelize.define('WorkspaceDeadline', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    title: { type: DataTypes.STRING, allowNull: false },
    dueDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'due_date' },
  }, {
    tableName: 'workspace_deadlines',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'bid_number'] }],
  });

  return WorkspaceDeadline;
};
