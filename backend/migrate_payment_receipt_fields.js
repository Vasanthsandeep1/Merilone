// One-off migration: adds payment_receipts.sales_order_id / sent_at / sent_to
// (see models/PaymentReceipt.js — an advance can be tied to the Sales Order
// it was paid for, and a receipt is marked sent only when emailed). Safe to
// re-run. Run once, then restart the backend server.
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('./config/db');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('payment_receipts');
  if (!cols.sales_order_id) await qi.addColumn('payment_receipts', 'sales_order_id', { type: DataTypes.INTEGER, allowNull: true });
  if (!cols.sent_at) await qi.addColumn('payment_receipts', 'sent_at', { type: DataTypes.DATE, allowNull: true });
  if (!cols.sent_to) await qi.addColumn('payment_receipts', 'sent_to', { type: DataTypes.STRING(500), allowNull: true });
  console.log('✅ payment_receipts.sales_order_id / sent_at / sent_to are in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
