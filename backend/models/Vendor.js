// Purchases & Expenses > Our Vendors — a partner's own vendor/supplier book,
// scoped per user like Client.js (each partner keeps their own vendor list,
// not shared). Mirrors Client's shape closely since the two are the same
// kind of record (a business entity with contact/tax/address info) just on
// opposite sides of a transaction, but drops the Prospect/Client kind
// distinction (vendors have no such concept) and adds `bankAccounts` (a
// partner records where they've paid a given vendor, so multiple bank
// accounts are expected — kept as JSON rather than a side table since it's
// simple key/value data with no independent lifecycle of its own).
module.exports = (sequelize, DataTypes) => {
  const Vendor = sequelize.define('Vendor', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    logoPath: { type: DataTypes.STRING, allowNull: true, field: 'logo_path' },
    businessName: { type: DataTypes.STRING, allowNull: false, field: 'business_name' },
    vendorType: { type: DataTypes.ENUM('Individual', 'Company'), allowNull: false, defaultValue: 'Company', field: 'vendor_type' },
    industry: { type: DataTypes.STRING, allowNull: true },
    taxTreatment: { type: DataTypes.STRING, allowNull: true, field: 'tax_treatment' },
    gstin: { type: DataTypes.STRING, allowNull: true },
    pan: { type: DataTypes.STRING, allowNull: true },
    displayName: { type: DataTypes.STRING, allowNull: true, field: 'display_name' },
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
    customFields: { type: DataTypes.JSON, allowNull: true, field: 'custom_fields' },
    // [{ accountHolderName, bankName, accountNumber, ifsc, branch }]
    bankAccounts: { type: DataTypes.JSON, allowNull: true, field: 'bank_accounts' },
  }, {
    tableName: 'vendors',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });

  return Vendor;
};
