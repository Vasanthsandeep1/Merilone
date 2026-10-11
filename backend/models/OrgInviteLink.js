// One shareable, regenerable invite code per organization (PartnerProfile)
// — lets an org admin hand staff a link that pre-fills/locks the
// organization on the staff registration form instead of them having to
// search for it by name.
module.exports = (sequelize, DataTypes) => {
  const OrgInviteLink = sequelize.define('OrgInviteLink', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    partnerProfileId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: 'partner_profile_id' },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
  }, {
    tableName: 'org_invite_links',
    timestamps: true,
    underscored: true,
  });
  return OrgInviteLink;
};
