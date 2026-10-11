// AI chat history — every AI chat surface in the portal (Distributor Recommendation,
// drafting a letter in Agreement, revising one letter) saves its conversation here so
// a reload or a fresh login doesn't lose it, and a "History" list can show older
// conversations. Each row lives for 7 days after its LAST message (see
// controllers/aiChatController.js's EXPIRY_DAYS) — the point isn't to keep a
// permanent record, just to survive a refresh and let a recent chat be reopened.
module.exports = (sequelize, DataTypes) => sequelize.define('AiChatSession', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
  // Which chat this is, e.g. 'distributor_recommend', 'agreement_draft', 'agreement_revise'.
  feature: { type: DataTypes.STRING(40), allowNull: false },
  // Optional scope within the feature — e.g. a letter id for "revise this letter"'s chat,
  // so each letter keeps its own conversation instead of one shared thread.
  refId: { type: DataTypes.STRING(100), allowNull: true, field: 'ref_id' },
  title: { type: DataTypes.STRING(300), allowNull: true },
  // Feature-specific extra state to restore alongside the messages (e.g. Distributor
  // Recommendation's current filters and last result list).
  context: { type: DataTypes.JSON, allowNull: true },
  // [{ role: 'user' | 'assistant', content, ...feature-specific fields }]
  messages: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
}, {
  tableName: 'ai_chat_sessions',
  timestamps: true,
  underscored: true,
  indexes: [
    { name: 'idx_aichat_lookup', fields: ['user_id', 'feature', 'ref_id', 'updated_at'] },
  ],
});
