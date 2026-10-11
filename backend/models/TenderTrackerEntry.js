// Tenders > Tender Tracker — one row per tracked tender, mirroring the
// partner's own master tracking sheet ("Tracker Gem 26-27.xlsx") column for
// column, rather than being computed on the fly from gem_tenders/
// open_tender_details + a thin overrides table (the earlier design). Scoped
// per partner (userId) like every other tracker in this app. Most fields
// are kept as free text even where the source sheet is numeric/date
// (EMD amount, rates, dates, etc.) because the real sheet mixes real values
// with "-", "NA" and formula-error placeholders in the same column — a
// strict numeric/date type would reject real rows on import.
module.exports = (sequelize, DataTypes) => {
  const TenderTrackerEntry = sequelize.define('TenderTrackerEntry', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },

    srNo: { type: DataTypes.INTEGER, allowNull: true, field: 'sr_no' },
    vertical: { type: DataTypes.STRING, allowNull: true },
    ra: { type: DataTypes.STRING(8), allowNull: true },
    entryDate: { type: DataTypes.STRING, allowNull: true, field: 'entry_date' },
    merilRefNo: { type: DataTypes.STRING, allowNull: true, field: 'meril_ref_no' },
    gtCode: { type: DataTypes.STRING, allowNull: true, field: 'gt_code' },
    typeOfAccount: { type: DataTypes.STRING, allowNull: true, field: 'type_of_account' },
    flsp: { type: DataTypes.STRING, allowNull: true },
    zm: { type: DataTypes.STRING, allowNull: true },
    hoPerson: { type: DataTypes.STRING, allowNull: true, field: 'ho_person' },
    organizationName: { type: DataTypes.STRING(500), allowNull: true, field: 'organization_name' },
    location: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    tenderId: { type: DataTypes.STRING, allowNull: true, field: 'tender_id' },
    tenderNo: { type: DataTypes.STRING(191), allowNull: true, field: 'tender_no' },
    preBidEndDate: { type: DataTypes.STRING, allowNull: true, field: 'pre_bid_end_date' },
    representationSubmitted: { type: DataTypes.STRING(8), allowNull: true, field: 'representation_submitted' },
    tenderDueDate: { type: DataTypes.STRING, allowNull: true, field: 'tender_due_date' },
    dbHoNp: { type: DataTypes.STRING, allowNull: true, field: 'db_ho_np' },
    distributorName: { type: DataTypes.STRING, allowNull: true, field: 'distributor_name' },
    productCode: { type: DataTypes.STRING, allowNull: true, field: 'product_code' },
    brandDescription: { type: DataTypes.STRING(500), allowNull: true, field: 'brand_description' },
    lob: { type: DataTypes.STRING, allowNull: true },
    category: { type: DataTypes.STRING, allowNull: true },
    tenderQty: { type: DataTypes.STRING, allowNull: true, field: 'tender_qty' },
    uom: { type: DataTypes.STRING, allowNull: true },
    unitRate: { type: DataTypes.STRING, allowNull: true, field: 'unit_rate' },
    totalValue: { type: DataTypes.STRING, allowNull: true, field: 'total_value' },
    emdAmount: { type: DataTypes.STRING, allowNull: true, field: 'emd_amount' },
    openClose: { type: DataTypes.STRING(16), allowNull: true, field: 'open_close' },
    finalRemarks: { type: DataTypes.STRING(500), allowNull: true, field: 'final_remarks' },
    otherRemarks: { type: DataTypes.STRING(500), allowNull: true, field: 'other_remarks' },
    l1UnitRate: { type: DataTypes.STRING, allowNull: true, field: 'l1_unit_rate' },
    l1CompanyName: { type: DataTypes.STRING, allowNull: true, field: 'l1_company_name' },
    l1CompanyModel: { type: DataTypes.STRING, allowNull: true, field: 'l1_company_model' },
    l2UnitRate: { type: DataTypes.STRING, allowNull: true, field: 'l2_unit_rate' },
    l2CompanyName: { type: DataTypes.STRING, allowNull: true, field: 'l2_company_name' },
    l2CompanyModel: { type: DataTypes.STRING, allowNull: true, field: 'l2_company_model' },
    l3UnitRate: { type: DataTypes.STRING, allowNull: true, field: 'l3_unit_rate' },
    l3CompanyName: { type: DataTypes.STRING, allowNull: true, field: 'l3_company_name' },
    l3CompanyModel: { type: DataTypes.STRING, allowNull: true, field: 'l3_company_model' },
    businessValue: { type: DataTypes.STRING, allowNull: true, field: 'business_value' },
    lastUpdated: { type: DataTypes.STRING, allowNull: true, field: 'last_updated' },
  }, {
    tableName: 'tender_tracker_entries',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['user_id'] },
      { fields: ['user_id', 'tender_no'] },
    ],
  });

  return TenderTrackerEntry;
};
