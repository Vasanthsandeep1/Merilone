const express = require('express');
const router = express.Router();
const c = require('../controllers/merilOneController');
const { m1Protect } = require('../middleware/m1Auth');

// Meril One mobile apps. Separate login from the portal (see middleware/m1Auth.js).
router.post('/auth/send-otp', c.sendOtp);
router.post('/auth/verify-otp', c.verifyOtp);

router.get('/me', m1Protect(), c.me);
router.get('/notifications', m1Protect(), c.notifications);
router.post('/notifications/read', m1Protect(), c.readNotifications);
router.put('/me', m1Protect(), c.updateMe);
router.get('/catalog', m1Protect(), c.catalog);
router.get('/ads', m1Protect('customer'), require('../controllers/m1AdController').appAds);
// Store (B2G product catalogue, no prices) + Get quote.
const store = require('../controllers/m1StoreController');
router.get('/store/products', m1Protect('customer'), store.storeProducts);
router.get('/quote-requests', m1Protect('customer'), store.myQuoteRequests);
router.post('/quote-requests', m1Protect('customer'), store.createQuoteRequest);
router.get('/b2g-profile', m1Protect('customer'), c.b2gProfile);

const customer = m1Protect('customer');
router.post('/uploads/problem-photo', customer, c.uploadProblemPhoto);
router.post('/uploads/product-photo', customer, c.uploadProductPhoto);
router.post('/bookings', customer, c.createBooking);
router.get('/bookings', customer, c.myBookings);
router.get('/bookings/:id', customer, c.getBooking);
router.post('/bookings/:id/cancel', customer, c.cancelBooking);
router.post('/bookings/:id/rate', customer, c.rateBooking);
router.post('/bookings/:id/reschedule', customer, c.answerReschedule);
router.get('/engineers', customer, c.listEngineers);
router.get('/engineers/:id', customer, c.engineerProfile);
router.get('/engineers/:id/busy', customer, c.engineerBusy);
router.get('/product-categories', customer, c.productCategories);
router.post('/product-categories', customer, c.createProductCategory);
router.delete('/product-categories/:id', customer, c.deleteProductCategory);
router.get('/products', customer, c.myProducts);
router.get('/products/:id/oem-engineers', customer, c.productOemEngineers);
router.get('/oem-engineers/:id/busy', customer, c.oemEngineerBusy);
router.post('/products', customer, c.createProduct);
router.put('/products/:id', customer, c.updateProduct);
router.delete('/products/:id', customer, c.deleteProduct);

const engineer = m1Protect('engineer');
router.post('/engineer/uploads/work-photo', engineer, c.uploadWorkPhoto);
router.put('/engineer/availability', engineer, c.setAvailability);
router.get('/engineer/jobs/available', engineer, c.availableJobs);
router.get('/engineer/jobs/mine', engineer, c.myJobs);
router.get('/engineer/jobs/:id', engineer, c.getJob);
router.post('/engineer/jobs/:id/accept', engineer, c.acceptJob);
router.post('/engineer/jobs/:id/decline', engineer, c.declineJob);
router.post('/engineer/jobs/:id/status', engineer, c.updateJob);
router.post('/engineer/jobs/:id/reschedule', engineer, c.requestReschedule);
router.get('/engineer/busy', engineer, c.myBusy);

module.exports = router;
