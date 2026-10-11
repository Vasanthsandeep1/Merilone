// Distributor Ranking — the distributors an OEM has shortlisted / selected (or ruled out)
// after looking at the ranking, with the context they were chosen for (department, state,
// equipment) and a note. One row per (organisation, distributor).
module.exports = (sequelize, DataTypes) => sequelize.define('DistributorSelection', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  distributorId: { type: DataTypes.INTEGER, allowNull: false, field: 'distributor_id' },
  status: { type: DataTypes.ENUM('shortlisted', 'selected', 'rejected'), allowNull: false, defaultValue: 'shortlisted' },
  department: { type: DataTypes.STRING(120), allowNull: true },
  state: { type: DataTypes.STRING(80), allowNull: true },
  equipment: { type: DataTypes.STRING(300), allowNull: true },
  note: { type: DataTypes.TEXT, allowNull: true },
  // the score / stars the distributor had when it was chosen
  scoreAtSelection: { type: DataTypes.INTEGER, allowNull: true, field: 'score_at_selection' },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
}, {
  tableName: 'distributor_selections',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'uk_dsel', unique: true, fields: ['user_id', 'distributor_id'] }],
});
