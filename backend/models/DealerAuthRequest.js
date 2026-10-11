// Dealer Management > Request Authorization — a reseller requests
// permission from a specific OEM (both real partner accounts on this same
// platform) to sell one or more of that OEM's products (see
// DealerAuthRequestItem — one request can now cover multiple product lines,
// each with its own condition bullet list), for a stated validity window
// and reason. The OEM reviews and approves/rejects. Cross-tenant by design:
// fromUserId (reseller) and toUserId (OEM) are two different partner
// accounts, unlike every other per-partner table in this app which is
// scoped to a single user.
// `authCode` (MDPL/XXXX/YYYY) is the user-facing authorization code shown
// in listings — distinct from `refNo` (the internal YYYY_auth_NNNN key
// already used to link ResellerProduct rows etc.), kept alongside it
// rather than replacing it to avoid touching every existing reference.
module.exports = (sequelize, DataTypes) => {
  const DealerAuthRequest = sequelize.define('DealerAuthRequest', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    refNo: { type: DataTypes.STRING, allowNull: false, unique: true, field: 'ref_no' },
    authCode: { type: DataTypes.STRING, allowNull: true, unique: true, field: 'auth_code' },
    // What the reseller is actually asking for — captured before OEM/product
    // selection on the New Request wizard's first step. 'tender' additionally
    // carries which specific tender this authorization is needed for.
    authType: { type: DataTypes.ENUM('tender', 'direct_purchase', 'local'), allowNull: false, defaultValue: 'tender', field: 'auth_type' },
    tenderNumber: { type: DataTypes.STRING, allowNull: true, field: 'tender_number' },
    tenderType: { type: DataTypes.ENUM('gem', 'open'), allowNull: true, field: 'tender_type' },
    fromUserId: { type: DataTypes.INTEGER, allowNull: false, field: 'from_user_id' },
    toUserId: { type: DataTypes.INTEGER, allowNull: false, field: 'to_user_id' },
    validFrom: { type: DataTypes.DATEONLY, allowNull: false, field: 'valid_from' },
    validTo: { type: DataTypes.DATEONLY, allowNull: false, field: 'valid_to' },
    reason: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'approved', 'rejected'), allowNull: false, defaultValue: 'pending' },
    rejectionRemarks: { type: DataTypes.TEXT, allowNull: true, field: 'rejection_remarks' },
    decidedAt: { type: DataTypes.DATE, allowNull: true, field: 'decided_at' },
  }, {
    tableName: 'dealer_auth_requests',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['from_user_id'] }, { fields: ['to_user_id'] }],
  });

  return DealerAuthRequest;
};
