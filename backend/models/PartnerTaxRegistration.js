// Government/tax registrations under a PartnerProfile (see
// SETUP_PROFILE.txt Step 6) — PAN, GSTIN, CIN, TAN, MSME, Udyam, IEC, etc.
// `registrationType` is a free STRING (not an ENUM) so new registration
// types can be added without a migration, matching the spec's "support
// country-specific requirements" / "add more industries later" architecture
// requirement.
module.exports = (sequelize, DataTypes) => {
  const PartnerTaxRegistration = sequelize.define('PartnerTaxRegistration', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    profileId: { type: DataTypes.INTEGER, allowNull: false, field: 'profile_id' },
    registrationType: { type: DataTypes.STRING, allowNull: true, field: 'registration_type' },
    registrationNumber: { type: DataTypes.STRING, allowNull: true, field: 'registration_number' },
    issueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'issue_date' },
    expiryDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'expiry_date' },
    issuingAuthority: { type: DataTypes.STRING, allowNull: true, field: 'issuing_authority' },
    documentUrl: { type: DataTypes.STRING, allowNull: true, field: 'document_url' },
    // Whether the Super Admin (or the OEM themselves, for now) considers
    // this registration required/optional/not applicable to their business.
    applicability: {
      type: DataTypes.ENUM('required', 'optional', 'not_applicable'),
      allowNull: true,
      defaultValue: 'optional'
    }
  }, {
    tableName: 'partner_tax_registrations',
    timestamps: true
  });

  return PartnerTaxRegistration;
};
