// Read-only mirror of the tender-automation system's `support_tickets` table.
module.exports = (sequelize, DataTypes) => {
  const SupportTicket = sequelize.define('SupportTicket', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    title: { type: DataTypes.STRING },
    status: { type: DataTypes.ENUM('open', 'in_progress', 'resolved', 'closed') },
    priority: { type: DataTypes.ENUM('low', 'medium', 'high') },
  }, {
    tableName: 'support_tickets',
    timestamps: false,
  });

  return SupportTicket;
};
