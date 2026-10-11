// OPI Management: an OPI (Order Processing Information) a sales person
// submits for an order — Endo (line items with the HP -> dealer -> super
// distributor -> Meril billing rate chain) or Diagnostics (the "ORDER
// PROCESSING INFORMATION" form). `header` / `items` hold the form exactly as
// filled; `value` is the order value Meril bills (Endo: total invoice value,
// Diagnostics: total before GST) — used to see how much each person has sold.
module.exports = (sequelize, DataTypes) => sequelize.define('Opi', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  opiNo: { type: DataTypes.STRING(30), allowNull: false, field: 'opi_no' },
  userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' }, // org owner
  staffId: { type: DataTypes.INTEGER, allowNull: false, field: 'staff_id' },
  // endo | diagnostics | a department the org added (OpiFormat.deptKey)
  division: { type: DataTypes.STRING(40), allowNull: false },
  deptName: { type: DataTypes.STRING(80), allowNull: true, field: 'dept_name' },
  customerName: { type: DataTypes.STRING, allowNull: true, field: 'customer_name' }, // hospital / distributor, for lists
  poNo: { type: DataTypes.STRING, allowNull: true, field: 'po_no' },
  poDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'po_date' },
  header: { type: DataTypes.JSON, allowNull: true },
  items: { type: DataTypes.JSON, allowNull: false },
  value: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0 },
  totalValue: { type: DataTypes.DECIMAL(16, 2), allowNull: false, defaultValue: 0, field: 'total_value' }, // with GST / charges
  pdfAt: { type: DataTypes.DATE, allowNull: true, field: 'pdf_at' },
  sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
  sentTo: { type: DataTypes.STRING(500), allowNull: true, field: 'sent_to' },
}, {
  tableName: 'opis',
  timestamps: true,
  underscored: true,
  indexes: [{ fields: ['staff_id'] }, { fields: ['user_id', 'division'] }, { unique: true, fields: ['opi_no'] }],
});
