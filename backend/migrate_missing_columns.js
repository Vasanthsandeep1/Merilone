// One-off migration: adds every column that a model defines but the database
// table doesn't have yet (sequelize.sync only creates missing TABLES, never
// new columns on existing ones). Only ADDS columns, using the model's own type,
// null rule and default — never changes or drops anything. Prints what it adds.
// Safe to re-run. Run once after pulling model changes, then restart the backend.
require('dotenv').config();
const db = require('./models');

const run = async () => {
  await db.sequelize.authenticate();
  console.log('✅ Connected to database');

  const qi = db.sequelize.getQueryInterface();
  let added = 0;
  for (const model of Object.values(db)) {
    if (!model || !model.rawAttributes || typeof model.getTableName !== 'function') continue;
    const table = model.getTableName();
    let cols;
    try { cols = await qi.describeTable(table); } catch { continue; } // table not created yet — sync makes it
    for (const attr of Object.values(model.rawAttributes)) {
      if (cols[attr.field]) continue;
      const { type, allowNull, defaultValue } = attr;
      await qi.addColumn(table, attr.field, { type, allowNull: allowNull !== false, defaultValue });
      console.log(`  + ${table}.${attr.field}`);
      added += 1;
    }
  }
  console.log(added ? `✅ Added ${added} column(s)` : '✅ Nothing missing — database matches the models');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
