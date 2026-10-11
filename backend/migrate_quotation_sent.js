// One-off migration: adds quotations.sent_at / sent_to (see models/Quotation.js
// and quotationController.emailQuotation — a document is marked Sent only when
// it's actually emailed, recording when and to whom). Safe to re-run. Run
// once, then restart the backend server.
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('./config/db');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('quotations');
  if (!cols.sent_at) await qi.addColumn('quotations', 'sent_at', { type: DataTypes.DATE, allowNull: true });
  if (!cols.sent_to) await qi.addColumn('quotations', 'sent_to', { type: DataTypes.STRING(500), allowNull: true });
  console.log('✅ quotations.sent_at / sent_to are in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
