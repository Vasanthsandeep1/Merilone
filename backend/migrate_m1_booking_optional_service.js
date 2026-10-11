// One-off migration: lets a Meril One booking have no service picked
// (m1_bookings.service_id / category_id may be NULL). The customer describes
// the problem and the engineer decides the work. Only relaxes the columns;
// no data changes. Safe to re-run. Run once, then restart the backend.
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize } = require('./config/db');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');
  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('m1_bookings');
  for (const col of ['service_id', 'category_id']) {
    if (cols[col] && cols[col].allowNull === false) {
      await qi.changeColumn('m1_bookings', col, { type: DataTypes.INTEGER, allowNull: true });
      console.log(`✅ m1_bookings.${col} can now be empty`);
    } else {
      console.log(`✓ m1_bookings.${col} already allows empty`);
    }
  }
  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => { console.error('❌ Migration failed:', err); process.exit(1); });
