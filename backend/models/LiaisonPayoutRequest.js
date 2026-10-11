// Liaison Management > Liaison Approvals — submitted against one liaison
// from the directory (models/Liaison.js) for a specific tender, carrying
// the commercial terms (percentage, PO, gross profit %) and supporting
// documents, and routed through a fixed four-step approval chain within
// the SAME organisation that submitted it:
//   1) Zonal Head (zonal_manager) AND Tender Admin (tender_admin) — both
//      must acknowledge/approve, normally within 24h (see slaDeadline).
//   2) Finance — reviews the percentage and sets the payment terms (days).
//   3) Head — sees the liaison's full bio-data and every uploaded document,
//      can revise the percentage in the organisation's favour, then gives
//      final approval.
// Any of the four can reject at their own stage (status -> 'rejected').
module.exports = (sequelize, DataTypes) => {
  const LiaisonPayoutRequest = sequelize.define('LiaisonPayoutRequest', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    liaisonId: { type: DataTypes.INTEGER, allowNull: false, field: 'liaison_id' },

    tenderNumber: { type: DataTypes.STRING(200), allowNull: false, field: 'tender_number' },
    liaisonPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false, field: 'liaison_percentage' },
    division: { type: DataTypes.ENUM('MEPL', 'MDPL'), allowNull: false },
    poNumber: { type: DataTypes.STRING(100), allowNull: true, field: 'po_number' },
    grossProfitPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'gross_profit_percent' },
    // [{ fileName, fileUrl, fileSize, uploadedAt }]
    documents: { type: DataTypes.JSON, allowNull: true },

    status: {
      type: DataTypes.ENUM('pending_zh_ta', 'pending_finance', 'pending_head', 'approved', 'rejected'),
      allowNull: false, defaultValue: 'pending_zh_ta',
    },
    slaDeadline: { type: DataTypes.DATE, allowNull: true, field: 'sla_deadline' },

    zhApprovedAt: { type: DataTypes.DATE, allowNull: true, field: 'zh_approved_at' },
    zhApprovedByName: { type: DataTypes.STRING, allowNull: true, field: 'zh_approved_by_name' },
    taApprovedAt: { type: DataTypes.DATE, allowNull: true, field: 'ta_approved_at' },
    taApprovedByName: { type: DataTypes.STRING, allowNull: true, field: 'ta_approved_by_name' },

    financeApprovedAt: { type: DataTypes.DATE, allowNull: true, field: 'finance_approved_at' },
    financeApprovedByName: { type: DataTypes.STRING, allowNull: true, field: 'finance_approved_by_name' },
    paymentTermsDays: { type: DataTypes.INTEGER, allowNull: true, field: 'payment_terms_days' },

    headApprovedAt: { type: DataTypes.DATE, allowNull: true, field: 'head_approved_at' },
    headApprovedByName: { type: DataTypes.STRING, allowNull: true, field: 'head_approved_by_name' },
    // The percentage actually approved, which Head can revise upward (or
    // down) in the org's favour — liaisonPercentage above stays the
    // originally-requested figure for audit purposes.
    finalPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: true, field: 'final_percentage' },

    rejectedAt: { type: DataTypes.DATE, allowNull: true, field: 'rejected_at' },
    rejectedStage: { type: DataTypes.STRING(20), allowNull: true, field: 'rejected_stage' },
    rejectedByName: { type: DataTypes.STRING, allowNull: true, field: 'rejected_by_name' },
    rejectionRemarks: { type: DataTypes.TEXT, allowNull: true, field: 'rejection_remarks' },

    createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
  }, {
    tableName: 'liaison_payout_requests',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['user_id', 'status'] }, { fields: ['liaison_id'] }],
  });

  return LiaisonPayoutRequest;
};
