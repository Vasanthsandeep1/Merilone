// Read-only mirror of the tender-automation system's `tender_processing_results`
// table — used for the dashboard's "Recent Activity" feed.
module.exports = (sequelize, DataTypes) => {
  const TenderProcessingResult = sequelize.define('TenderProcessingResult', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    bidNo: { type: DataTypes.STRING, field: 'bid_no' },
    result: { type: DataTypes.ENUM('yes', 'no') },
    processingDate: { type: DataTypes.DATE, field: 'processing_date' },
    status: { type: DataTypes.STRING },
    dept: { type: DataTypes.STRING },
    itemCategory: { type: DataTypes.STRING, field: 'item_category' },
    suggestedProducts: { type: DataTypes.JSON, field: 'suggested_products' },
    deviationTables: { type: DataTypes.JSON, field: 'deviation_tables' },
    // Deviation Representation Letter — bolted onto this same table rather
    // than a dedicated one, mirroring OLD's own approach (see
    // deviationController.js). Ollama-generated fresh on every "Generate";
    // these columns are just the explicit "Save Draft" cache.
    representationLetter: { type: DataTypes.TEXT('long'), field: 'representation_letter' },
    representationData: { type: DataTypes.JSON, field: 'representation_data' },
    representationGeneratedAt: { type: DataTypes.DATE, field: 'representation_generated_at' },
    representationGeneratedBy: { type: DataTypes.STRING, field: 'representation_generated_by' },
  }, {
    tableName: 'tender_processing_results',
    timestamps: false,
  });

  return TenderProcessingResult;
};
