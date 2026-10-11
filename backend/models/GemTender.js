// Read-only mirror of the tender-automation system's `gem_tenders` table
// (migrated wholesale — see tender_automation_with_ai.sql). This app never
// writes to it; GeM tenders are scraped/processed by that separate system.
module.exports = (sequelize, DataTypes) => {
  const GemTender = sequelize.define('GemTender', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    detailUrl: { type: DataTypes.TEXT, field: 'detail_url' },
    items: { type: DataTypes.TEXT },
    quantity: { type: DataTypes.STRING },
    department: { type: DataTypes.TEXT },
    startDate: { type: DataTypes.STRING, field: 'start_date' },
    endDate: { type: DataTypes.STRING, field: 'end_date' },
    emdAmount: { type: DataTypes.STRING, field: 'emd_amount' },
    bidValue: { type: DataTypes.STRING, field: 'bid_value' },
    dept: { type: DataTypes.STRING },
    state: { type: DataTypes.STRING },
    district: { type: DataTypes.STRING },
    pincode: { type: DataTypes.STRING },
    perfectCat: { type: DataTypes.INTEGER, field: 'perfect_cat' },
    subCat: { type: DataTypes.STRING, field: 'sub_cat' },
    raNo: { type: DataTypes.STRING, field: 'ra_no' },
    markedNotRelevant: { type: DataTypes.BOOLEAN, field: 'marked_not_relevant' },
    representationJson: { type: DataTypes.JSON, field: 'Representation_json' },
    corrigendumJson: { type: DataTypes.JSON, field: 'Corrigendum_json' },
    jsonData: { type: DataTypes.JSON, field: 'json_data' },
    consigneeDetail: { type: DataTypes.JSON, field: 'consignee_detail' },
    emdDetail: { type: DataTypes.JSON, field: 'emd_detail' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, field: 'updated_at' },
  }, {
    tableName: 'gem_tenders',
    timestamps: false,
  });

  return GemTender;
};
