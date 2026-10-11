// Manufacturing/warehouse/branch locations under a PartnerProfile (see
// SETUP_PROFILE.txt Step 3).
module.exports = (sequelize, DataTypes) => {
  const PartnerLocation = sequelize.define('PartnerLocation', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    profileId: { type: DataTypes.INTEGER, allowNull: false, field: 'profile_id' },
    name: { type: DataTypes.STRING, allowNull: true },
    locationType: {
      type: DataTypes.ENUM('head_office', 'branch', 'manufacturing_unit', 'warehouse', 'service_center', 'other'),
      allowNull: true,
      defaultValue: 'other',
      field: 'location_type'
    },
    addressLine1: { type: DataTypes.STRING, allowNull: true, field: 'address_line_1' },
    addressLine2: { type: DataTypes.STRING, allowNull: true, field: 'address_line_2' },
    country: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    pincode: { type: DataTypes.STRING, allowNull: true },
    contactPerson: { type: DataTypes.STRING, allowNull: true, field: 'contact_person' },
    phone: { type: DataTypes.STRING, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true }
  }, {
    tableName: 'partner_locations',
    timestamps: true
  });

  return PartnerLocation;
};
