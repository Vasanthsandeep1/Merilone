// Tender Hub > Doc Prep — remembers the last value a partner typed into
// each auto-fill field (company name, GSTIN, authorized signatory...) so
// the next annexure's Fields modal pre-fills itself instead of starting
// blank every time. Scoped per-partner (userId) rather than per-division
// like the original (OpenProcure is one internal team with an Endo/Diagno
// split; here every partner is its own tenant, so userId is the right
// scope) — flat last-value-wins cache, same as the original.
module.exports = (sequelize, DataTypes) => {
  const DocPrepFieldMemory = sequelize.define('DocPrepFieldMemory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    fieldKey: { type: DataTypes.STRING, allowNull: false, field: 'field_key' },
    fieldValue: { type: DataTypes.TEXT, allowNull: true, field: 'field_value' },
  }, {
    tableName: 'doc_prep_field_memory',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'field_key'] }],
  });

  return DocPrepFieldMemory;
};
