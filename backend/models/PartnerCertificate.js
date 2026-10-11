// Certificates & compliance documents under a PartnerProfile (see
// SETUP_PROFILE.txt Step 7) — ISO, CE, BIS, GST Certificate, MSME
// Certificate, etc. `certificateType` is a free STRING for the same reason
// as PartnerTaxRegistration.registrationType.
module.exports = (sequelize, DataTypes) => {
  const PartnerCertificate = sequelize.define('PartnerCertificate', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    profileId: { type: DataTypes.INTEGER, allowNull: false, field: 'profile_id' },
    certificateType: { type: DataTypes.STRING, allowNull: true, field: 'certificate_type' },
    certificateName: { type: DataTypes.STRING, allowNull: true, field: 'certificate_name' },
    certificateNumber: { type: DataTypes.STRING, allowNull: true, field: 'certificate_number' },
    issuingAuthority: { type: DataTypes.STRING, allowNull: true, field: 'issuing_authority' },
    issueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'issue_date' },
    expiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'expiry_date' },
    documentUrl: { type: DataTypes.STRING, allowNull: true, field: 'document_url' },
    fileName: { type: DataTypes.STRING, allowNull: true, field: 'file_name' },
    fileSize: { type: DataTypes.INTEGER, allowNull: true, field: 'file_size' },
    remarks: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'partner_certificates',
    timestamps: true
  });

  return PartnerCertificate;
};
