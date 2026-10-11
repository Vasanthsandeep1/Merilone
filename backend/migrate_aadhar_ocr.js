// One-off migration: adds partner_contacts.aadhar_verification_data (see
// models/PartnerContact.js / ContactStep.tsx's Smart OCR upload flow).
// Run once, then restart the backend server.
require('dotenv').config();
const { sequelize } = require('./config/db');
const { PartnerContact } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  await PartnerContact.sync({ alter: true });
  console.log('✅ partner_contacts table synced — aadhar_verification_data column is in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
