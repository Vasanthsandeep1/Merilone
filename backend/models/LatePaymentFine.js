// Sales & Invoices > Pending Payments — a late-payment fine charged on an
// overdue invoice, and the Late Payment Notice (LPN00001…) sent for it.
// The figures are frozen at the time the notice is issued (balance due,
// days overdue, fine %, fine amount, total payable) so a notice always
// reads the same even after later payments. An invoice can collect several
// notices over time; each is Pending until the partner marks the fine Paid
// or Waives it.
module.exports = (sequelize, DataTypes) => {
  const LatePaymentFine = sequelize.define('LatePaymentFine', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    invoiceId: { type: DataTypes.INTEGER, allowNull: false, field: 'invoice_id' },
    clientId: { type: DataTypes.INTEGER, allowNull: true, field: 'client_id' },
    noticeNo: { type: DataTypes.STRING, allowNull: false, field: 'notice_no' },
    noticeDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'notice_date' },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'due_date' },
    daysOverdue: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'days_overdue' },
    balanceDue: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'balance_due' },
    finePercent: { type: DataTypes.DECIMAL(6, 2), allowNull: false, field: 'fine_percent' },
    fineAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'fine_amount' },
    // GST on the fine (a late-payment charge is taxed at the invoice's rate),
    // split equally into CGST + SGST like the invoice. totalPayable =
    // balanceDue + fineAmount + gstAmount. Added by migrate_late_fine_gst.js.
    gstPercent: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0, field: 'gst_percent' },
    gstAmount: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'gst_amount' },
    totalPayable: { type: DataTypes.DECIMAL(14, 2), allowNull: false, field: 'total_payable' },
    payBy: { type: DataTypes.DATEONLY, allowNull: true, field: 'pay_by' },
    notes: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('Pending', 'Paid', 'Waived'), allowNull: false, defaultValue: 'Pending' },
    // Set only by a successful email of the notice to the client.
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    sentTo: { type: DataTypes.STRING(500), allowNull: true, field: 'sent_to' },
  }, {
    tableName: 'late_payment_fines',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['invoice_id'] }],
  });
  return LatePaymentFine;
};
