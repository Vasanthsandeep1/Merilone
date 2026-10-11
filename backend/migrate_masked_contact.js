// One-off migration: adds partner_contacts.masked_email and
// .masked_mobile (see models/PartnerContact.js / ContactStep.tsx —
// validates the user's typed email/mobile against PAN 360's masked
// values). Run once, then restart the backend server.
require('dotenv').config();
const { sequelize } = require('./config/db');
const { PartnerContact } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  await PartnerContact.sync({ alter: true });
  console.log('✅ partner_contacts table synced — masked_email/masked_mobile columns are in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
