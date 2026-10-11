// Purchases > Purchases Hub — a partner's own record of purchases made from
// their vendors. Deliberately its own table (not folded into the
// Quotation/Invoice/etc. table) because the counterparty here is a Vendor,
// not a Client, and the roles are reversed: "Billed To" is the partner's
// own details, "Billed By" is the vendor's — the opposite of every sales
// document. Otherwise mirrors Quotation's shape closely (items-as-JSON,
// server-recomputed totals, source='created' vs 'uploaded').
module.exports = (sequelize, DataTypes) => {
  const Purchase = sequelize.define('Purchase', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    source: { type: DataTypes.ENUM('created', 'uploaded'), allowNull: false, defaultValue: 'created' },

    purchaseNo: { type: DataTypes.STRING, allowNull: false, field: 'purchase_no' },
    invoiceNo: { type: DataTypes.STRING, allowNull: true, field: 'invoice_no' },
    poNumber: { type: DataTypes.STRING, allowNull: true, field: 'po_number' },
    title: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Purchase' },
    subtitle: { type: DataTypes.STRING, allowNull: true },
    purchaseDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'purchase_date' },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'due_date' },
    logoPath: { type: DataTypes.STRING, allowNull: true, field: 'logo_path' },

    vendorId: { type: DataTypes.INTEGER, allowNull: true, field: 'vendor_id' },

    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INR' },

    shippingEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'shipping_enabled' },
    shippingFrom: { type: DataTypes.JSON, allowNull: true, field: 'shipping_from' },
    shippingTo: { type: DataTypes.JSON, allowNull: true, field: 'shipping_to' },

    items: { type: DataTypes.JSON, allowNull: true },
    discount: { type: DataTypes.JSON, allowNull: true },
    additionalCharges: { type: DataTypes.JSON, allowNull: true },

    subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    cgstTotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'cgst_total' },
    sgstTotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'sgst_total' },
    grandTotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'grand_total' },
    totalQuantity: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'total_quantity' },

    notes: { type: DataTypes.TEXT, allowNull: true },
    terms: { type: DataTypes.TEXT, allowNull: true },
    isRecurring: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_recurring' },

    status: { type: DataTypes.ENUM('Draft', 'Sent', 'Accepted', 'Rejected'), allowNull: false, defaultValue: 'Draft' },

    uploadedFilePath: { type: DataTypes.STRING, allowNull: true, field: 'uploaded_file_path' },
    uploadedFileName: { type: DataTypes.STRING, allowNull: true, field: 'uploaded_file_name' },
  }, {
    tableName: 'purchases',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });

  return Purchase;
};
