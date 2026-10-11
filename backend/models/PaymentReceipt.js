// Sales & Invoices > Payment Receipts — a partner's own record of money
// received from a client, scoped by user_id like every other per-partner
// table. Two flavors selected at creation time (paymentType): 'receipt'
// walks the user through settling it against that client's real unpaid
// invoices (see paymentReceiptController.getUnpaidInvoices, which computes
// "unpaid" honestly from actual Invoice grandTotal minus what's already
// been allocated via PaymentAllocation — never a fabricated balance);
// 'advance' skips that step and books the whole amount as an advance.
// `paymentRecords` holds the one-or-more individual payment entries
// (method/account/ledger/amount/TDS/charges) as JSON, mirroring the
// items-as-JSON pattern used by Quotation.
module.exports = (sequelize, DataTypes) => {
  const PaymentReceipt = sequelize.define('PaymentReceipt', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    receiptNo: { type: DataTypes.STRING, allowNull: false, field: 'receipt_no' },
    paymentType: { type: DataTypes.ENUM('receipt', 'advance'), allowNull: false, defaultValue: 'receipt', field: 'payment_type' },
    clientId: { type: DataTypes.INTEGER, allowNull: true, field: 'client_id' },
    // An advance paid against a Sales Order (before it's invoiced). When that
    // SO's invoice is raised, the advance is applied to it automatically —
    // see paymentReceiptController.applyAdvancesToInvoice.
    salesOrderId: { type: DataTypes.INTEGER, allowNull: true, field: 'sales_order_id' },
    receivedFrom: { type: DataTypes.STRING, allowNull: true, field: 'received_from' },
    receiptDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'receipt_date' },
    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INR' },

    // [{ paymentMethod, depositedTo, ledger, amountReceived, tdsPercent, tdsAmount, transactionCharge, referenceId, notes, netAmount }]
    paymentRecords: { type: DataTypes.JSON, allowNull: true, field: 'payment_records' },

    totalReceived: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'total_received' },
    totalAllocated: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'total_allocated' },
    advanceAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'advance_amount' },

    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('Draft', 'Saved'), allowNull: false, defaultValue: 'Draft' },
    // Set only by a successful email of the receipt to the client.
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    sentTo: { type: DataTypes.STRING(500), allowNull: true, field: 'sent_to' },
  }, {
    tableName: 'payment_receipts',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }],
  });

  return PaymentReceipt;
};
