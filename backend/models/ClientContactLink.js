// Links a client to one of this partner's own Setup-Profile contacts
// (PartnerContact.js) — "Linked Contacts" on the Add/Edit Client form.
module.exports = (sequelize, DataTypes) => {
  const ClientContactLink = sequelize.define('ClientContactLink', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clientId: { type: DataTypes.INTEGER, allowNull: false, field: 'client_id' },
    partnerContactId: { type: DataTypes.INTEGER, allowNull: false, field: 'partner_contact_id' },
  }, {
    tableName: 'client_contact_links',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['client_id', 'partner_contact_id'] }],
  });

  return ClientContactLink;
};
