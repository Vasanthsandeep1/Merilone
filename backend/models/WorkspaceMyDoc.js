// Tender Hub > My Docs — a lightweight per-tender notes/draft editor
// (the original backed this with a much larger doc-prep-linked editor;
// here it's a straightforward autosaved title+content note).
module.exports = (sequelize, DataTypes) => {
  const WorkspaceMyDoc = sequelize.define('WorkspaceMyDoc', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    title: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Untitled document' },
    content: { type: DataTypes.TEXT('long'), allowNull: true },
    // Set when this doc was pushed here from a Doc Prep annexure draft — lets
    // re-pushing the same annexure update this row instead of duplicating it.
    sourceAnnexureId: { type: DataTypes.STRING, allowNull: true, field: 'source_annexure_id' },
    // Set on a "Merge Selected" result — the My Doc ids it was built from, in
    // the order they were merged, purely for reference/audit.
    mergedFromIds: { type: DataTypes.JSON, allowNull: true, field: 'merged_from_ids' },
  }, {
    tableName: 'workspace_my_docs',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'bid_number'] }],
  });

  return WorkspaceMyDoc;
};
