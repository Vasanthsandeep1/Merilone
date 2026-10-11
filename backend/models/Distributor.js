// Read-only mirror of the tender-automation system's shared `distributors`
// table (id, company_name, person_name, contact_no, email, city_name,
// state, registration_date, status) — used for the dashboard's
// "Distributor Network" card (see tenderController.js's getDashboardStats,
// which actually queries it via raw SQL, not this model object directly).
module.exports = (sequelize, DataTypes) => {
  const Distributor = sequelize.define('Distributor', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    companyName: { type: DataTypes.STRING, field: 'company_name' },
    personName: { type: DataTypes.STRING, field: 'person_name' },
    contactNo: { type: DataTypes.STRING, field: 'contact_no' },
    email: { type: DataTypes.STRING },
    cityName: { type: DataTypes.STRING, field: 'city_name' },
    state: { type: DataTypes.STRING },
    registrationDate: { type: DataTypes.DATEONLY, field: 'registration_date' },
    status: { type: DataTypes.ENUM('Active', 'Inactive') },
  }, {
    tableName: 'distributors',
    timestamps: true,
    underscored: true,
  });

  return Distributor;
};
