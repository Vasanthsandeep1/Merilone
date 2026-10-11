// Distributor Mapping — what a distributor (a DistributorMaster row) covers, as decided by
// this organisation: territories (state / city), the institutes it serves (AIIMS, PGIMER…),
// the departments / divisions it handles (Endo-Surgery, Diagnostics, 360 Vertical…) and
// the equipment it can supply. Rows here are the confirmed, hand-kept mappings; the data
// the system can see on its own (home state, GeM contract history) is added on top when
// reading (see controllers/distributorMapController.js).
module.exports = (sequelize, DataTypes) => sequelize.define('DistributorMapping', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  distributorId: { type: DataTypes.INTEGER, allowNull: false, field: 'distributor_id' },
  dimension: { type: DataTypes.ENUM('state', 'city', 'institute', 'department', 'equipment'), allowNull: false },
  value: { type: DataTypes.STRING(300), allowNull: false },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
}, {
  tableName: 'distributor_mappings',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'uk_dmap', unique: true, fields: ['user_id', 'distributor_id', 'dimension', 'value'] },
    { name: 'idx_dmap_dim', fields: ['user_id', 'dimension', 'value'] },
  ],
});
