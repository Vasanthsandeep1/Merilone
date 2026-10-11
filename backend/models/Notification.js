// In-app notifications — currently only fired by the cross-tenant
// Authorization Request workflow (request received / approved / rejected),
// but generic enough (type + relatedType/relatedId) to grow into other
// events later without a schema change.
module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    type: { type: DataTypes.STRING, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: true },
    relatedType: { type: DataTypes.STRING, allowNull: true, field: 'related_type' },
    relatedId: { type: DataTypes.INTEGER, allowNull: true, field: 'related_id' },
    isRead: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_read' },
  }, {
    tableName: 'notifications',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'is_read'] }],
  });

  return Notification;
};
