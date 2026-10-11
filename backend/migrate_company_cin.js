require('dotenv').config();
const { sequelize } = require('./config/db');
const { PartnerProfile } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  await PartnerProfile.sync({ alter: true });
  console.log('✅ partner_profiles table synced — company_cin_* columns are in place');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
