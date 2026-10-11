// One-off migration: adds quotations.po_date / source_quotation_id (see
// models/Quotation.js — a Sales Order quotes the customer's PO date and links
// back to the quotation it confirms). Safe to re-run. Run once, then restart
// the backend server.
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('./config/db');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('quotations');
  if (!cols.po_date) await qi.addColumn('quotations', 'po_date', { type: DataTypes.DATEONLY, allowNull: true });
  if (!cols.source_quotation_id) await qi.addColumn('quotations', 'source_quotation_id', { type: DataTypes.INTEGER, allowNull: true });
  console.log('✅ quotations.po_date / source_quotation_id are in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
