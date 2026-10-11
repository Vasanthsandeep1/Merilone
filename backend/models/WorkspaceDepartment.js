// Tender Hub > Workspace/Settings — a partner-defined grouping ("Sales",
// "Documentation", "Logistics"...) used to organize that tender's tasks.
// Per (user, bidNumber) like everything else in this workspace — each
// partner's hub for a given tender is theirs alone.
module.exports = (sequelize, DataTypes) => {
  const WorkspaceDepartment = sequelize.define('WorkspaceDepartment', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    name: { type: DataTypes.STRING, allowNull: false },
  }, {
    tableName: 'workspace_departments',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'bid_number'] }],
  });

  return WorkspaceDepartment;
};
