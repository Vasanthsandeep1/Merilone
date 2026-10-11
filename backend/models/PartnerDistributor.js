// Dealer Management > Distributors — a partner's own network of
// sub-dealers/distributors. Same column shape as the automation site's
// real (shared, staff-only, no CRUD UI) `distributors` table — see
// Distributor.js — but scoped per partner and with a full CRUD/import
// screen, since here each OEM/Reseller manages their own dealer network
// rather than one shared internal Meril master.
module.exports = (sequelize, DataTypes) => {
  const PartnerDistributor = sequelize.define('PartnerDistributor', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    companyName: { type: DataTypes.STRING, allowNull: false, field: 'company_name' },
    personName: { type: DataTypes.STRING, allowNull: true, field: 'person_name' },
    contactNo: { type: DataTypes.STRING, allowNull: true, field: 'contact_no' },
    email: { type: DataTypes.STRING, allowNull: true },
    cityName: { type: DataTypes.STRING, allowNull: true, field: 'city_name' },
    state: { type: DataTypes.STRING, allowNull: true },
    registrationDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'registration_date' },
    status: { type: DataTypes.ENUM('Active', 'Inactive'), allowNull: false, defaultValue: 'Active' },
  }, {
    tableName: 'partner_distributors',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });

  return PartnerDistributor;
};
