require('dotenv').config();
const { sequelize } = require('./config/db');
const { PartnerContact } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  await PartnerContact.sync({ alter: true });
  console.log('✅ partner_contacts table synced — pan_type column is in place');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
