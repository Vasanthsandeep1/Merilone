// Workdesk > EMD Management — one row per earnest-money deposit (EMD) or performance
// bank guarantee (PBG) this organisation has put up for a tender/contract: what it is
// (DD / BG / online / FDR), how much, where it is (requested → submitted → refund due →
// refunded / forfeited), its validity, and the audit trail. Scoped by user id (staff
// tokens carry the org owner's id, so the whole organisation shares one register).
module.exports = (sequelize, DataTypes) => sequelize.define('EmdRecord', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  type: { type: DataTypes.ENUM('emd', 'pbg'), allowNull: false, defaultValue: 'emd' },
  // Tender bid number / reference (or the contract number for a PBG) — free text, optionally picked from tenders.
  reference: { type: DataTypes.STRING(200), allowNull: false },
  bidNumber: { type: DataTypes.STRING(200), allowNull: true, field: 'bid_number' },
  title: { type: DataTypes.STRING(500), allowNull: true },
  buyer: { type: DataTypes.STRING(500), allowNull: true },
  dept: { type: DataTypes.STRING(20), allowNull: true },
  amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
  instrument: { type: DataTypes.ENUM('dd', 'bg', 'online', 'fdr', 'exempt', 'other'), allowNull: false, defaultValue: 'dd' },
  instrumentNo: { type: DataTypes.STRING(200), allowNull: true, field: 'instrument_no' },
  bank: { type: DataTypes.STRING(300), allowNull: true },
  issuedOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'issued_on' },
  validUntil: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_until' },
  status: {
    type: DataTypes.ENUM('requested', 'submitted', 'refund_due', 'refunded', 'forfeited'),
    allowNull: false, defaultValue: 'requested',
  },
  refundDueOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'refund_due_on' },
  refundedOn: { type: DataTypes.DATEONLY, allowNull: true, field: 'refunded_on' },
  owner: { type: DataTypes.STRING, allowNull: true },
  remarks: { type: DataTypes.TEXT, allowNull: true },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
  updatedBy: { type: DataTypes.STRING, allowNull: true, field: 'updated_by' },
  // [{ at, by, status, note }] — append-only audit trail.
  history: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'emd_records',
  timestamps: true,
  underscored: true,
  indexes: [{ name: 'idx_emd_user_status', fields: ['user_id', 'status'] }, { name: 'idx_emd_user_bid', fields: ['user_id', 'bid_number'] }],
});
