// Dealer Management > Best Reseller Selection — the pool of reseller
// companies an OEM can discover and pick from for a given product category
// + zone/state, ranked by rating and contract track record. Deliberately a
// standalone directory (not tied to a real login/User account, unlike
// StaffUser/PartnerProfile) — this models a marketplace of resellers the
// OEM may not have any relationship with yet, closer to Distributor.js's
// "read-only directory" shape than a real platform tenant. Seeded with
// sample data for now (see scripts/seed_reseller_candidates.js); a real
// version would populate this from actual reseller activity/reviews.
module.exports = (sequelize, DataTypes) => {
  const ResellerCandidate = sequelize.define('ResellerCandidate', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    companyName: { type: DataTypes.STRING, allowNull: false, field: 'company_name' },
    contactPerson: { type: DataTypes.STRING, allowNull: true, field: 'contact_person' },
    email: { type: DataTypes.STRING, allowNull: true },
    phone: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: false },
    zone: { type: DataTypes.STRING, allowNull: false },
    // Product categories (from CompanySubCategory names) this reseller
    // already has a track record selling — a JSON string array so one
    // reseller can match multiple categories/zones searches.
    productCategories: { type: DataTypes.JSON, allowNull: true, field: 'product_categories' },
    rating: { type: DataTypes.DECIMAL(2, 1), allowNull: false, defaultValue: 0 },
    contractsCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'contracts_count' },
    totalContractValue: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'total_contract_value' },
    yearsInBusiness: { type: DataTypes.INTEGER, allowNull: true, field: 'years_in_business' },
    gstin: { type: DataTypes.STRING, allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('Active', 'Inactive'), allowNull: false, defaultValue: 'Active' },
  }, {
    tableName: 'reseller_candidates',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['state'] }, { fields: ['zone'] }],
  });

  return ResellerCandidate;
};
