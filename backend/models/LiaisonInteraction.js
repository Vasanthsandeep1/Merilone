// Every real touchpoint with a liaison — this is the actual data the
// Recommendation/Ranking engines score from (see liaisonController.js's
// scoreForRecommendation / scoreForRanking), instead of a hand-typed rank.
// One row per stage of one tender relationship: Contacted -> Response ->
// Meeting -> Follow-up -> Outcome.
module.exports = (sequelize, DataTypes) => sequelize.define('LiaisonInteraction', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  liaisonId: { type: DataTypes.INTEGER, allowNull: false, field: 'liaison_id' },
  tenderBidNumber: { type: DataTypes.STRING(200), allowNull: true, field: 'tender_bid_number' },
  tenderTitle: { type: DataTypes.STRING(500), allowNull: true, field: 'tender_title' },
  organization: { type: DataTypes.STRING(300), allowNull: true },
  state: { type: DataTypes.STRING(100), allowNull: true },
  district: { type: DataTypes.STRING(100), allowNull: true },
  department: { type: DataTypes.STRING(200), allowNull: true },
  hospital: { type: DataTypes.STRING(300), allowNull: true },
  productCategory: { type: DataTypes.STRING(200), allowNull: true, field: 'product_category' },
  tenderCategory: { type: DataTypes.STRING(200), allowNull: true, field: 'tender_category' },
  stage: { type: DataTypes.ENUM('contacted', 'response', 'meeting', 'follow_up', 'outcome'), allowNull: false, defaultValue: 'contacted' },
  outcome: { type: DataTypes.ENUM('successful', 'unsuccessful', 'pending'), allowNull: true },
  occurredOn: { type: DataTypes.DATEONLY, allowNull: false, field: 'occurred_on' },
  note: { type: DataTypes.TEXT, allowNull: true },
  createdByName: { type: DataTypes.STRING, allowNull: true, field: 'created_by_name' },
}, {
  tableName: 'liaison_interactions',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'idx_li_user_liaison', fields: ['user_id', 'liaison_id'] },
    { name: 'idx_li_user_tender', fields: ['user_id', 'tender_bid_number'] },
  ],
});
