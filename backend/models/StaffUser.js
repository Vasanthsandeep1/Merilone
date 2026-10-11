// Org-scoped staff login (Sales / Zonal Manager / FLSP) — distinct from the
// top-level `User` table (one OEM/Reseller company account each). Every
// StaffUser belongs to exactly one PartnerProfile (the organization that
// owns them); that PartnerProfile's own User is this org's implicit admin.
// New registrations start `pending` and can't log in until the org admin
// approves them (see orgStaffController.js) — unlike the OLD system's
// flat, always-immediately-active staff directory.
module.exports = (sequelize, DataTypes) => {
  const StaffUser = sequelize.define('StaffUser', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false, unique: true, validate: { isEmail: true } },
    password: { type: DataTypes.STRING, allowNull: false },
    // rsm = Regional Sales Manager (RSM / Dy. ZSM): looks after a team of FLSP / Sales people.
    role: { type: DataTypes.ENUM('sales', 'zonal_manager', 'flsp', 'tender_admin', 'finance', 'head', 'rsm'), allowNull: false },
    partnerProfileId: { type: DataTypes.INTEGER, allowNull: false, field: 'partner_profile_id' },
    // Only meaningful for role = sales|zonal_manager (see registerStaff's
    // isScopedRole check) — null/empty for flsp.
    departments: { type: DataTypes.JSON, allowNull: true },
    tenderFields: { type: DataTypes.JSON, allowNull: true, field: 'tender_fields' },
    statesCovered: { type: DataTypes.JSON, allowNull: true, field: 'states_covered' },
    status: { type: DataTypes.ENUM('pending', 'active', 'rejected', 'inactive'), allowNull: false, defaultValue: 'pending' },
    invitedViaCode: { type: DataTypes.STRING, allowNull: true, field: 'invited_via_code' },
  }, {
    tableName: 'staff_users',
    timestamps: true,
    underscored: true,
  });
  return StaffUser;
};
