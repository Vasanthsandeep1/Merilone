// Tender Hub > Doc Prep — clone of the original's doc_prep_sessions table,
// scoped per (user, bidNumber). `annexures` is the AI-detected checklist of
// required documents ([{ id, name, description, status, draftContent }]),
// populated by an Ollama call over this tender's parsed spec data (see
// docPrepController.js's analyze()) — the original's much larger pipeline
// (Claude CLI drafting, docx/pdf export, company-drive integration,
// scanned-doc OCR) isn't ported; this is the checklist + AI-draft core of
// it, built so it can grow into that once a real local model is online.
module.exports = (sequelize, DataTypes) => {
  const WorkspaceDocPrepSession = sequelize.define('WorkspaceDocPrepSession', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    status: { type: DataTypes.ENUM('idle', 'processing', 'done', 'error'), allowNull: false, defaultValue: 'idle' },
    annexures: { type: DataTypes.JSON, allowNull: true },
    errorMessage: { type: DataTypes.TEXT, allowNull: true, field: 'error_message' },
    // The bid document Analyze actually reads — same "upload or import,
    // then Analyze" gate as the original's Doc Prep. Analysis still falls
    // back to the tender's own scraped jsonData when no file is uploaded,
    // but the UI mirrors the original by requiring a bid doc selection
    // first (upload from computer, or import an existing Documents-tab
    // file) before "Run Analysis" is enabled.
    bidDocPath: { type: DataTypes.STRING, allowNull: true, field: 'bid_doc_path' },
    bidDocName: { type: DataTypes.STRING, allowNull: true, field: 'bid_doc_name' },
    bidDocSourceDocumentId: { type: DataTypes.INTEGER, allowNull: true, field: 'bid_doc_source_document_id' },
    // Supporting docs alongside the main bid doc (ATC, OMPPD, corrigendum
    // etc) — [{id, name, path, label}].
    additionalDocs: { type: DataTypes.JSON, allowNull: true, field: 'additional_docs' },
    // true once the bid doc was found and fetched automatically from this
    // tender's own scraped GemTenderDoc.pdfUrl, rather than uploaded by the
    // partner — see workspaceController.js#autoResolveBidDocument.
    bidDocAutoFetched: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'bid_doc_auto_fetched' },
    // Scraped supporting links (BOQ/ATC/OMPPD/Gem Contract) found on this
    // tender, offered for one-click Accept (download into
    // additionalDocs)/Reject — [{id, label, url}]. Populated once per
    // session by autoResolveBidDocument; gemDetectedAt marks that the
    // attempt has already run so it isn't repeated on every page load.
    detectedDocs: { type: DataTypes.JSON, allowNull: true, field: 'detected_docs' },
    gemDetectedAt: { type: DataTypes.DATE, allowNull: true, field: 'gem_detected_at' },
  }, {
    tableName: 'workspace_doc_prep_sessions',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['user_id', 'bid_number'] }],
  });

  return WorkspaceDocPrepSession;
};
