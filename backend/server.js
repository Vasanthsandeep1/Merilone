require('dotenv').config();
const http = require('http');
const app = require('./app');
const { sequelize, testConnection } = require('./config/db');
require('./models'); // ensures the User model is registered

const PORT = process.env.PORT || 5002;

const startServer = async () => {
  await testConnection();

  // Sync models — creates the users table if it doesn't exist yet.
  await sequelize.sync();
  await require('./utils/merilOneCatalog').seedCatalog(require('./models')).catch((e) => console.error('Meril One seed failed:', e.message));
  console.log('✅ Models synced with the database.');

  const server = http.createServer(app);

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Please stop the other process and try again.`);
      process.exit(1);
    } else {
      throw err;
    }
  });

  server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });

  // Rate Contract Tracker's expiry alerts (email + in-app) — checked once
  // shortly after boot, then every 12 hours for as long as the process runs.
  // See rateContractController.runExpiryCheck: it only ever notifies a given
  // 90/30/7/0-day milestone once per contract, so re-running this often is safe.
  const { runExpiryCheck } = require('./controllers/rateContractController');
  const RATE_CONTRACT_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
  setTimeout(() => { runExpiryCheck().catch((err) => console.error('rate contract expiry check failed:', err.message)); }, 30000);
  setInterval(() => { runExpiryCheck().catch((err) => console.error('rate contract expiry check failed:', err.message)); }, RATE_CONTRACT_CHECK_INTERVAL_MS);
};

startServer();
