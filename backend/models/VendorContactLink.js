// Links one of the partner's own Setup-Profile contacts (PartnerContact) to
// a vendor as the internal point of contact responsible for that vendor —
// same pattern as ClientContactLink.
module.exports = (sequelize, DataTypes) => {
  const VendorContactLink = sequelize.define('VendorContactLink', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    vendorId: { type: DataTypes.INTEGER, allowNull: false, field: 'vendor_id' },
    partnerContactId: { type: DataTypes.INTEGER, allowNull: false, field: 'partner_contact_id' },
  }, {
    tableName: 'vendor_contact_links',
    timestamps: true,
    underscored: true,
  });

  return VendorContactLink;
};
