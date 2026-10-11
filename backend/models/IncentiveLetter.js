// Workdesk > Incentive Letter Generation — one generated sales-target letter
// PDF for one person from the uploaded budget workbook. The PDF itself is
// stored privately on disk under backend/data/incentive-letters/<userId>/
// (never under the public /uploads folder); see incentiveLetterController.
module.exports = (sequelize, DataTypes) => {
  const IncentiveLetter = sequelize.define('IncentiveLetter', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    personKey: { type: DataTypes.STRING, allowNull: false, field: 'person_key' },
    displayName: { type: DataTypes.STRING, allowNull: false, field: 'display_name' },
    hasDiagnostics: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'has_diagnostics' },
    hasEndoSurgery: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'has_endo_surgery' },
    fileName: { type: DataTypes.STRING, allowNull: false, field: 'file_name' },
    storedName: { type: DataTypes.STRING, allowNull: false, field: 'stored_name' },
    workbookName: { type: DataTypes.STRING, allowNull: true, field: 'workbook_name' },
    // Set only by a successful email of the letter.
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    sentTo: { type: DataTypes.STRING(500), allowNull: true, field: 'sent_to' },
  }, {
    tableName: 'incentive_letters',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });
  return IncentiveLetter;
};
