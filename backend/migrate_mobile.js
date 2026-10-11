// One-off migration: adds users.mobile (see models/User.js /
// PartnerRegisterPage.tsx's new Account step). Run once, then restart the
// backend server.
require('dotenv').config();
const { sequelize } = require('./config/db');
const { User } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  await User.sync({ alter: true });
  console.log('✅ users table synced — mobile column is in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
