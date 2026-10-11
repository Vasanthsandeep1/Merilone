// Letter Generate — a named folder in a user's (org's) letter library.
// Staff tokens carry the org owner's user id, so a library is shared by the
// whole organisation, like every other Workdesk table in this portal.
module.exports = (sequelize, DataTypes) => sequelize.define('LetterFolder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  name: { type: DataTypes.STRING, allowNull: false },
}, {
  tableName: 'letter_folders',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['user_id', 'name'] }],
});
