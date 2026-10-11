// Tender Hub > Documents tab — files the partner adds themselves, alongside
// (not replacing) the officially scraped GeM tender documents already shown
// via gem_tenders.json_data links.
module.exports = (sequelize, DataTypes) => {
  const WorkspaceDocument = sequelize.define('WorkspaceDocument', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    name: { type: DataTypes.STRING, allowNull: false },
    filePath: { type: DataTypes.STRING, allowNull: false, field: 'file_path' },
    fileSize: { type: DataTypes.BIGINT, allowNull: true, field: 'file_size' },
    mimeType: { type: DataTypes.STRING, allowNull: true, field: 'mime_type' },
    // My Docs > Merge to PDF — the client builds the combined PDF itself
    // (pdf-lib, in-browser) and uploads the result back here, flagged so
    // it shows in the "Uploaded"/merged-only filter instead of the "All"
    // source-documents view. Only one merged doc exists per tender at a
    // time — a re-merge replaces this row/file rather than accumulating.
    isMerged: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_merged' },
    pushSource: { type: DataTypes.STRING, allowNull: true, field: 'push_source' },
    // { docId, start, end }[] — which page range of the merged PDF belongs
    // to which source document, computed client-side at merge time (and
    // recomputed on every structural edit). This is what lets the
    // Checklist answer "which page is X on" without knowing PDF internals.
    pageMap: { type: DataTypes.JSON, allowNull: true, field: 'page_map' },
    // Real page count — known for a merged output (client counts it) and
    // best-effort for anything else; checklist page-range math falls back
    // to 1 when this is null.
    pages: { type: DataTypes.INTEGER, allowNull: true },
  }, {
    tableName: 'workspace_documents',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'bid_number'] }],
  });

  return WorkspaceDocument;
};
