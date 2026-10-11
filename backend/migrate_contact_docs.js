// One-off migration: adds partner_contacts.father_name, .address,
// .pan_card_url, .aadhar_card_url (see models/PartnerContact.js /
// ContactStep.tsx's Smart OCR upload flow — stores the uploaded card
// images, not just their extracted fields). Run once, then restart the
// backend server.
require('dotenv').config();
const { sequelize } = require('./config/db');
const { PartnerContact } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  await PartnerContact.sync({ alter: true });
  console.log('✅ partner_contacts table synced — father_name/address/pan_card_url/aadhar_card_url columns are in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
