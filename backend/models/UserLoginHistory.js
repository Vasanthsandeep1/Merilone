// Read-only mirror of the tender-automation system's `user_login_history`
// table — internal staff logins (not this app's own OEM/Reseller users),
// used only for the dashboard's "User Activity" login-trend chart.
module.exports = (sequelize, DataTypes) => {
  const UserLoginHistory = sequelize.define('UserLoginHistory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    loggedInAt: { type: DataTypes.DATE, field: 'logged_in_at' },
  }, {
    tableName: 'user_login_history',
    timestamps: false,
  });

  return UserLoginHistory;
};
