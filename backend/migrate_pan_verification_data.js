// One-off migration: adds partner_contacts.pan_verification_data (see
// models/PartnerContact.js / ContactStep.tsx's full PAN 360 detail grid).
// Run once, then restart the backend server.
require('dotenv').config();
const { sequelize } = require('./config/db');
const { PartnerContact } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  await PartnerContact.sync({ alter: true });
  console.log('✅ partner_contacts table synced — pan_verification_data column is in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
