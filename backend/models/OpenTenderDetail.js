// Read-only mirror of the tender-automation system's `open_tender_details`
// table — non-GEM (CPPP/state portal) tenders, the fallback source when a
// bid number isn't found in gem_tenders.
module.exports = (sequelize, DataTypes) => {
  const OpenTenderDetail = sequelize.define('OpenTenderDetail', {
    rowId: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true, field: 'row_id' },
    tenderId: { type: DataTypes.STRING, allowNull: false, field: 'tender_id' },
    state: { type: DataTypes.STRING },
    organisationName: { type: DataTypes.STRING, field: 'organisation_name' },
    ePublishedDate: { type: DataTypes.STRING, field: 'e_published_date' },
    closingDate: { type: DataTypes.STRING, field: 'closing_date' },
    openingDate: { type: DataTypes.STRING, field: 'opening_date' },
    tenderTitle: { type: DataTypes.TEXT, field: 'tender_title' },
    tenderRefno: { type: DataTypes.STRING, field: 'tender_refno' },
    organisationChain: { type: DataTypes.TEXT, field: 'organisation_chain' },
    tenderDetails: { type: DataTypes.JSON, field: 'tender_details' },
    fileLink: { type: DataTypes.JSON, field: 'file_link' },
    tenderPageLink: { type: DataTypes.TEXT, field: 'tender_page_link' },
    tenderSiteLink: { type: DataTypes.TEXT, field: 'tender_site_link' },
    relevencyChecker: { type: DataTypes.STRING, field: 'relevency_checker' },
    dept: { type: DataTypes.STRING },
    emdAmount: { type: DataTypes.STRING, field: 'emd_amount' },
    tenderValue: { type: DataTypes.STRING, field: 'tender_value' },
    productCategory: { type: DataTypes.STRING, field: 'product_category' },
    location: { type: DataTypes.STRING },
    pincode: { type: DataTypes.STRING },
    downloadedDocuments: { type: DataTypes.JSON, field: 'downloaded_documents' },
  }, {
    tableName: 'open_tender_details',
    timestamps: false,
  });

  return OpenTenderDetail;
};
