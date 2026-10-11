// Read-only mirror of the tender-automation system's `user_sessions` table
// — internal staff sessions (not this app's own OEM/Reseller users), used
// only for the dashboard's "Active Now" / avg session length stats.
module.exports = (sequelize, DataTypes) => {
  const UserSession = sequelize.define('UserSession', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    lastHeartbeatAt: { type: DataTypes.DATE, field: 'last_heartbeat_at' },
    totalActiveSeconds: { type: DataTypes.INTEGER, field: 'total_active_seconds' },
    isActive: { type: DataTypes.BOOLEAN, field: 'is_active' },
  }, {
    tableName: 'user_sessions',
    timestamps: false,
  });

  return UserSession;
};
