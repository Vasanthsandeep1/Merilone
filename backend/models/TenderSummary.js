// Cache for the AI-generated "Tender Scrutiny" summary (see
// prompts/tenderSummaryPrompt.js) — one row per tender, keyed by the same
// underscore-normalized id used elsewhere (tenderController.js's
// toUrlId/fromUrlId). Generated on-demand; regenerated (row overwritten)
// only when the caller explicitly passes { regenerate: true }.
module.exports = (sequelize, DataTypes) => {
  const TenderSummary = sequelize.define('TenderSummary', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    tenderId: { type: DataTypes.STRING, allowNull: false, unique: true, field: 'tender_id' },
    summary: { type: DataTypes.TEXT('long'), allowNull: false },
    createdBy: { type: DataTypes.INTEGER, field: 'created_by' },
  }, {
    tableName: 'tender_summaries',
    timestamps: true,
    underscored: true,
  });
  return TenderSummary;
};
