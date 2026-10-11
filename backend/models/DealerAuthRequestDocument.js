// Verification Documents attached to a DealerAuthRequest at submission time
// (Dealer/Distributor License, Product-Specific License, OEM Authorization
// Certificate, Govt Tender Experience Certificate, Regulatory/Compliance
// Certificate — plus any number of free-form "other supporting documents").
// `docType` holds the fixed slug for the five standard types, or 'other'
// for anything added via the "+ Add" button, in which case `label` carries
// the reseller's own name for it.
module.exports = (sequelize, DataTypes) => {
  const DealerAuthRequestDocument = sequelize.define('DealerAuthRequestDocument', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    dealerAuthRequestId: { type: DataTypes.INTEGER, allowNull: false, field: 'dealer_auth_request_id' },
    docType: {
      type: DataTypes.ENUM('dealer_license', 'product_license', 'oem_authorization', 'tender_experience', 'regulatory_certificate', 'other'),
      allowNull: false, field: 'doc_type',
    },
    label: { type: DataTypes.STRING, allowNull: true },
    fileUrl: { type: DataTypes.STRING, allowNull: false, field: 'file_url' },
    fileName: { type: DataTypes.STRING, allowNull: true, field: 'file_name' },
    fileSize: { type: DataTypes.INTEGER, allowNull: true, field: 'file_size' },
  }, {
    tableName: 'dealer_auth_request_documents',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['dealer_auth_request_id'] }],
  });

  return DealerAuthRequestDocument;
};
