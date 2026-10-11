// OPI Management: an organisation's field layout for one OPI department
// (Endo, Diagnostics, or a department they added). Starts as Meril's
// template; people can remove fields (`hidden`, by key) and add their own
// (`customHeader` = filled once per OPI, `customLine` = a column per line).
// Saved when an OPI is created, so the next OPI in that department opens
// with the same fields.
//   field = { key, label, type: 'text' | 'number' | 'date' }
module.exports = (sequelize, DataTypes) => sequelize.define('OpiFormat', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' }, // org owner
  deptKey: { type: DataTypes.STRING(40), allowNull: false, field: 'dept_key' }, // endo | diagnostics | custom slug
  name: { type: DataTypes.STRING(80), allowNull: false },
  custom: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, // a department the org added
  hidden: { type: DataTypes.JSON, allowNull: true },
  customHeader: { type: DataTypes.JSON, allowNull: true, field: 'custom_header' },
  customLine: { type: DataTypes.JSON, allowNull: true, field: 'custom_line' },
  updatedByName: { type: DataTypes.STRING, allowNull: true, field: 'updated_by_name' },
}, {
  tableName: 'opi_formats',
  timestamps: true,
  underscored: true,
  indexes: [{ unique: true, fields: ['user_id', 'dept_key'] }],
});
