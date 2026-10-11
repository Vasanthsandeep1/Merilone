// Agreement Tracker — this organisation's follow-up on an agreement/letter from
// the Agreement section (sent to whom, response, signed, validity). The letter
// itself lives in letter_documents; "draft" (not yet sent) is derived from there
// being no row here, never stored. Scoped per (user, letter) like the other
// trackers; staff tokens carry the org owner's id so the whole org shares it.
module.exports = (sequelize, DataTypes) => sequelize.define('AgreementTracking', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  letterId: { type: DataTypes.INTEGER, allowNull: false, field: 'letter_id' },
  status: {
    type: DataTypes.ENUM('sent', 'under_review', 'signed', 'rejected', 'expired'),
    allowNull: false, defaultValue: 'sent',
  },
  counterparty: { type: DataTypes.STRING(300), allowNull: true },
  sentOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'sent_on' },
  responseDueBy: { type: DataTypes.DATEONLY, allowNull: true, field: 'response_due_by' },
  signedOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'signed_on' },
  validUntil: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_until' },
  owner: { type: DataTypes.STRING, allowNull: true },
  remarks: { type: DataTypes.TEXT, allowNull: true },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: 'updated_by' },
  // [{ at, by, status, note }] — append-only audit trail of every change.
  history: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'agreement_tracking',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'uk_agreement_tracking', unique: true, fields: ['user_id', 'letter_id'] }],
});
