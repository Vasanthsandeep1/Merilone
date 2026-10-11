const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();

// ----- Global Middleware -----
app.use(cors());
// 15 MB: product photos are sent as base64 inside the JSON body.
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true }));

// Serves uploaded logos/certificates/tax-registration documents (see
// middleware/uploadMiddleware.js and partnerProfileController.js).
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ----- Routes -----
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/org', require('./routes/orgStaffRoutes'));
app.use('/api/partner-profile', require('./routes/partnerProfileRoutes'));
app.use('/api/tenders', require('./routes/tenderRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/orders', require('./routes/ordersRoutes'));
app.use('/api/library', require('./routes/libraryRoutes'));
app.use('/api/workspace', require('./routes/workspaceRoutes'));
app.use('/api/dealers', require('./routes/dealersRoutes'));
app.use('/api/dealer-requests', require('./routes/dealerAuthRequestRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/reseller-products', require('./routes/resellerProductRoutes'));
app.use('/api/clients', require('./routes/clientRoutes'));
app.use('/api/quotations', require('./routes/quotationRoutes'));
app.use('/api/payment-receipts', require('./routes/paymentReceiptRoutes'));
app.use('/api/pending-payments', require('./routes/pendingPaymentsRoutes'));
app.use('/api/ld-tracker', require('./routes/ldTrackerRoutes'));
app.use('/api/gp-tracker', require('./routes/gpTrackerRoutes'));
app.use('/api/ar-tracker', require('./routes/arTrackerRoutes'));
app.use('/api/service-engineers', require('./routes/serviceEngineerRoutes'));
app.use('/api/service-requests', require('./routes/serviceRequestRoutes'));
app.use('/api/m1-ads', require('./routes/m1AdRoutes'));
app.use('/api/m1-quotes', require('./routes/m1QuoteRoutes'));
app.use('/api/sales-incentive', require('./routes/salesIncentiveRoutes'));
app.use('/api/targets', require('./routes/targetRoutes'));
app.use('/api/opi', require('./routes/opiRoutes'));
app.use('/api/sales-dashboard', require('./routes/salesDashboardRoutes'));
app.use('/api/m1', require('./routes/merilOneRoutes'));
app.use('/api/incentive-letters', require('./routes/incentiveLetterRoutes'));
app.use('/api/vendors', require('./routes/vendorRoutes'));
app.use('/api/purchases', require('./routes/purchaseRoutes'));
app.use('/api/tender-tracker', require('./routes/tenderTrackerRoutes'));
app.use('/api/pricing-tracker', require('./routes/pricingTrackerRoutes'));
app.use('/api/document-tender', require('./routes/documentTenderRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/representation-tracker', require('./routes/representationTrackerRoutes'));
app.use('/api/contracts', require('./routes/contractsRoutes'));
app.use('/api/contract-tracker', require('./routes/contractTrackerRoutes'));
app.use('/api/letters', require('./routes/letterGenerateRoutes'));
app.use('/api/agreement-tracker', require('./routes/agreementTrackerRoutes'));
app.use('/api/emd', require('./routes/emdRoutes'));
app.use('/api/oem-rank', require('./routes/oemRankRoutes'));
app.use('/api/distributor-recommend', require('./routes/distributorRecommendRoutes'));
app.use('/api/ai-chats', require('./routes/aiChatRoutes'));
app.use('/api/distributor-map', require('./routes/distributorMapRoutes'));
app.use('/api/queries', require('./routes/queryRoutes'));
app.use('/api/tasks', require('./routes/taskRoutes'));
app.use('/api/team-rank', require('./routes/teamRankRoutes'));
app.use('/api/assistant', require('./routes/assistantRoutes'));
app.use('/api/partner-divisions', require('./routes/partnerDivisionRoutes'));
app.use('/api/rate-contracts', require('./routes/rateContractRoutes'));
app.use('/api/liaisons', require('./routes/liaisonRoutes'));
app.use('/api/liaison-payouts', require('./routes/liaisonPayoutRoutes'));
app.use('/api/forecast', require('./routes/forecastRoutes'));

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'API is running' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Global error handler (catches Multer errors, thrown errors, etc.)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error'
  });
});

module.exports = app;
