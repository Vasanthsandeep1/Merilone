// Tender Hub > Doc Prep — the tender's own "documents to be submitted"
// checklist, rebuilt as real rows instead of a JSON array. Each row can be
// pinned to a specific uploaded document (matchedDocumentId, matchMethod
// 'manual') or left to auto-match against whatever's currently in My
// Docs/Documents (matchMethod 'annexure' | 'fuzzy'), same two-tier logic as
// the original's recomputeChecklistRows — see
// workspaceController.js#recomputeChecklist.
module.exports = (sequelize, DataTypes) => {
  const DocPrepChecklistRow = sequelize.define('DocPrepChecklistRow', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    section: { type: DataTypes.STRING, allowNull: true },
    details: { type: DataTypes.STRING, allowNull: false },
    documentType: { type: DataTypes.STRING, allowNull: true, field: 'document_type' },
    source: { type: DataTypes.ENUM('annexure', 'tender_checklist', 'manual'), allowNull: false, defaultValue: 'manual' },
    annexureId: { type: DataTypes.INTEGER, allowNull: true, field: 'annexure_id' },
    matchedDocumentId: { type: DataTypes.INTEGER, allowNull: true, field: 'matched_document_id' },
    matchMethod: { type: DataTypes.ENUM('manual', 'annexure', 'fuzzy'), allowNull: true, field: 'match_method' },
    status: { type: DataTypes.ENUM('yes', 'no'), allowNull: false, defaultValue: 'no' },
    pageRange: { type: DataTypes.STRING, allowNull: true, field: 'page_range' },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
  }, {
    tableName: 'doc_prep_checklist_rows',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'bid_number'] }],
  });

  return DocPrepChecklistRow;
};
