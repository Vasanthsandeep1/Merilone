// Tenders > Tender Tracker — the manual/editable tracking fields a partner
// fills in on top of the real scraped tender data (gem_tenders /
// open_tender_details). Cloned from the reference AUTOMATION SITE's
// `tender_tracker_overrides` table, but scoped per (user_id, tender_no,
// source) rather than globally — this is a multi-tenant partner portal, so
// each partner keeps their own tracking notes on the same underlying
// tender, same reasoning as ParticipatedTenderNote. The reference's
// financial-evaluation/L1-L2-L3-pricing columns and its internal
// ZH/FLSP staff-roster dropdown (backed by a `zone_data` table that has no
// real migrated data in this system) are intentionally not carried over —
// those fields are plain free-text here instead of roster-driven selects.
module.exports = (sequelize, DataTypes) => {
  const TenderTrackerOverride = sequelize.define('TenderTrackerOverride', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    tenderNo: { type: DataTypes.STRING(191), allowNull: false, field: 'tender_no' },
    source: { type: DataTypes.ENUM('gem', 'open'), allowNull: false },
    zh: { type: DataTypes.STRING, allowNull: true },
    flsp: { type: DataTypes.STRING, allowNull: true },
    dbHoDpNp: { type: DataTypes.STRING, allowNull: true, field: 'db_ho_dp_np' },
    dbName: { type: DataTypes.STRING, allowNull: true, field: 'db_name' },
    sapMaterialCode: { type: DataTypes.STRING, allowNull: true, field: 'sap_material_code' },
    emdOverride: { type: DataTypes.STRING, allowNull: true, field: 'emd_override' },
    finalRemarks: { type: DataTypes.STRING, allowNull: true, field: 'final_remarks' },
    zm: { type: DataTypes.STRING, allowNull: true },
    hoPerson: { type: DataTypes.STRING, allowNull: true, field: 'ho_person' },
    zone: { type: DataTypes.STRING, allowNull: true },
    feedbackResponse: { type: DataTypes.TEXT, allowNull: true, field: 'feedback_response' },
  }, {
    tableName: 'tender_tracker_overrides',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'tender_no', 'source'] }],
  });

  return TenderTrackerOverride;
};
