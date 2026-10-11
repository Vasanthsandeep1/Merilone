// Tender Hub > Doc Prep — one row per discovered annexure/supporting
// document, normalized out of the original OpenProcure design (which kept
// the entire list as a single JSON blob column on one session row with no
// transaction safety). Scoped to (userId, bidNumber) like every other
// per-partner Tender Hub table.
module.exports = (sequelize, DataTypes) => {
  const DocPrepAnnexure = sequelize.define('DocPrepAnnexure', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bidNumber: { type: DataTypes.STRING, allowNull: false, field: 'bid_number' },
    // Stable across re-analysis runs (matched on annexureRef+title) so a
    // recheck can tell "same requirement, re-discovered" apart from "brand
    // new requirement" without destroying existing drafts — unlike the
    // original, which fully replaced the list and wiped all drafts on every
    // re-analyze.
    annexureRef: { type: DataTypes.STRING, allowNull: true, field: 'annexure_ref' },
    title: { type: DataTypes.STRING, allowNull: false },
    type: {
      type: DataTypes.ENUM(
        'affidavit', 'declaration', 'undertaking', 'authorization', 'agreement',
        'checklist', 'financial', 'technical', 'sample_submission', 'tender_checklist', 'other',
      ),
      allowNull: false,
      defaultValue: 'other',
    },
    category: { type: DataTypes.ENUM('letter', 'certificate'), allowNull: false, defaultValue: 'letter' },
    deptTag: {
      type: DataTypes.ENUM('financial', 'tender_admin', 'technical', 'legal', 'hr', 'other'),
      allowNull: false,
      defaultValue: 'other',
      field: 'dept_tag',
    },
    docGroup: { type: DataTypes.ENUM('annexure', 'license', 'certificate'), allowNull: false, defaultValue: 'annexure', field: 'doc_group' },
    mandatory: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    hasPrescribedFormat: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'has_prescribed_format' },
    pageHint: { type: DataTypes.STRING, allowNull: true, field: 'page_hint' },
    // The REAL text lifted from the bid document's own printed page(s) for
    // this annexure (located via the document's own index/table of
    // contents — see workspaceController.js#parseAnnexureIndexEntries).
    // Drafting is instructed to reproduce THIS exact layout/wording,
    // filling in blanks, rather than composing the document from scratch —
    // the fix for annexures being invented instead of extracted.
    sourceText: { type: DataTypes.TEXT('long'), allowNull: true, field: 'source_text' },
    // Resolved physical PDF page indices (0-based, into the bid doc's own
    // page array) for this annexure's real location — set once by
    // index-driven discovery so vision extraction can re-render exactly
    // the right pages on demand without re-parsing the index every time.
    sourcePageStart: { type: DataTypes.INTEGER, allowNull: true, field: 'source_page_start' },
    sourcePageEnd: { type: DataTypes.INTEGER, allowNull: true, field: 'source_page_end' },
    // The VERBATIM template — real HTML with [FILL:field_name] spans,
    // extracted from the rendered page image(s) by a vision-capable model
    // (falls back to the deterministic sourceText conversion when vision
    // extraction isn't available/fails). Kept separate from draftContent
    // (the post-fill result) so re-generating from new field values never
    // needs to re-extract the template — same formats/filled_templates
    // split as the reference implementation.
    formatHtml: { type: DataTypes.TEXT('long'), allowNull: true, field: 'format_html' },
    requiresStampPaper: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'requires_stamp_paper' },
    stampStatus: { type: DataTypes.ENUM('pending', 'uploaded'), allowNull: true, field: 'stamp_status' },
    // Points at a WorkspaceDocument row carrying the signed/stamped scan.
    stampDocumentId: { type: DataTypes.INTEGER, allowNull: true, field: 'stamp_document_id' },
    status: { type: DataTypes.ENUM('pending', 'drafted', 'pushed', 'done'), allowNull: false, defaultValue: 'pending' },
    draftContent: { type: DataTypes.TEXT('long'), allowNull: true, field: 'draft_content' },
    // AI Library match — one Ollama call per annexure without a prescribed
    // format, judged against this partner's own Library documents (same
    // idea as the original's "AI Drive" matching, scoped to this portal's
    // existing per-partner Library instead of a shared company drive).
    libraryMatchItemId: { type: DataTypes.INTEGER, allowNull: true, field: 'library_match_item_id' },
    libraryMatchReason: { type: DataTypes.STRING, allowNull: true, field: 'library_match_reason' },
    // Points at a WorkspaceDocument row once a library file (or the signed
    // stamp copy) has actually been imported/pushed for this annexure.
    // Re-importing/re-pushing replaces this row's file rather than stacking
    // duplicates — the normalized equivalent of the original's loose
    // annexure_id/push_source filter-then-replace logic.
    importedDocumentId: { type: DataTypes.INTEGER, allowNull: true, field: 'imported_document_id' },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
  }, {
    tableName: 'doc_prep_annexures',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id', 'bid_number'] }],
  });

  return DocPrepAnnexure;
};
