// A reseller candidate's past contract history — what the OEM sees when
// they open a candidate's profile to check "them and their contracts"
// before selecting them (see boss's brief). Sample data only for now,
// same as ResellerCandidate itself.
module.exports = (sequelize, DataTypes) => {
  const ResellerCandidateContract = sequelize.define('ResellerCandidateContract', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    resellerCandidateId: { type: DataTypes.INTEGER, allowNull: false, field: 'reseller_candidate_id' },
    clientName: { type: DataTypes.STRING, allowNull: false, field: 'client_name' },
    productCategory: { type: DataTypes.STRING, allowNull: true, field: 'product_category' },
    state: { type: DataTypes.STRING, allowNull: true },
    contractValue: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'contract_value' },
    contractDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'contract_date' },
    status: { type: DataTypes.ENUM('Completed', 'Ongoing'), allowNull: false, defaultValue: 'Completed' },
  }, {
    tableName: 'reseller_candidate_contracts',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['reseller_candidate_id'] }],
  });

  return ResellerCandidateContract;
};
