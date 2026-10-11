// One-off migration: adds late_payment_fines.gst_percent / gst_amount (see
// models/LatePaymentFine.js — GST charged on a late-payment fine). Fines
// issued before this get 0% GST, so their totals don't change. Safe to
// re-run. Run once, then restart the backend server.
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('./config/db');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('late_payment_fines');
  if (!cols.gst_percent) await qi.addColumn('late_payment_fines', 'gst_percent', { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 });
  if (!cols.gst_amount) await qi.addColumn('late_payment_fines', 'gst_amount', { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 });
  console.log('✅ late_payment_fines.gst_percent / gst_amount are in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
