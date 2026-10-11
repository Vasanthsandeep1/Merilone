// Sales & Invoices > Our Clients — a partner's own client/prospect book.
// Scoped per user like everything else in this portal (each partner keeps
// their own client list, not shared). No invoicing/payments system exists
// in this app yet, so `lastCommunicationDate`/Invoices tab stay
// user-entered / empty rather than derived from fake transaction data.
module.exports = (sequelize, DataTypes) => {
  const Client = sequelize.define('Client', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    logoPath: { type: DataTypes.STRING, allowNull: true, field: 'logo_path' },
    businessName: { type: DataTypes.STRING, allowNull: false, field: 'business_name' },
    clientKind: { type: DataTypes.ENUM('Prospect', 'Client'), allowNull: false, defaultValue: 'Client', field: 'client_kind' },
    clientType: { type: DataTypes.ENUM('Individual', 'Company'), allowNull: false, defaultValue: 'Company', field: 'client_type' },
    industry: { type: DataTypes.STRING, allowNull: true },
    taxTreatment: { type: DataTypes.STRING, allowNull: true, field: 'tax_treatment' },
    gstin: { type: DataTypes.STRING, allowNull: true },
    pan: { type: DataTypes.STRING, allowNull: true },
    businessAlias: { type: DataTypes.STRING, allowNull: true, field: 'business_alias' },
    uniqueKey: { type: DataTypes.STRING, allowNull: false, unique: true, field: 'unique_key' },
    email: { type: DataTypes.STRING, allowNull: true },
    showEmailInInvoice: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'show_email_in_invoice' },
    phone: { type: DataTypes.STRING, allowNull: true },
    showPhoneInInvoice: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'show_phone_in_invoice' },
    defaultDueDays: { type: DataTypes.INTEGER, allowNull: true, field: 'default_due_days' },
    country: { type: DataTypes.STRING, allowNull: true },
    state: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    postalCode: { type: DataTypes.STRING, allowNull: true, field: 'postal_code' },
    streetAddress: { type: DataTypes.STRING, allowNull: true, field: 'street_address' },
    status: { type: DataTypes.ENUM('Active', 'Archived'), allowNull: false, defaultValue: 'Active' },
    // Sales person (staff_users, role sales) who handles this client; their
    // invoices count toward that person's target (salesIncentiveController).
    salesStaffId: { type: DataTypes.INTEGER, allowNull: true, field: 'sales_staff_id' },
    lastCommunicationDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'last_communication_date' },
    customFields: { type: DataTypes.JSON, allowNull: true, field: 'custom_fields' },
  }, {
    tableName: 'clients',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });

  return Client;
};
