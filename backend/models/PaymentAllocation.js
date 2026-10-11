// How much of a given PaymentReceipt was applied against a specific real
// Invoice (a Quotation row with docType='invoice'). Kept as its own table
// (rather than JSON inside PaymentReceipt) specifically so "how much of
// invoice X has been paid so far" can be computed with a plain SUM query
// across every receipt that ever touched it — see
// paymentReceiptController.getUnpaidInvoices.
module.exports = (sequelize, DataTypes) => {
  const PaymentAllocation = sequelize.define('PaymentAllocation', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    paymentReceiptId: { type: DataTypes.INTEGER, allowNull: false, field: 'payment_receipt_id' },
    invoiceId: { type: DataTypes.INTEGER, allowNull: false, field: 'invoice_id' },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'payment_allocations',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['payment_receipt_id'] }, { fields: ['invoice_id'] }],
  });

  return PaymentAllocation;
};
