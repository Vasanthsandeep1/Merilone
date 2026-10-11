require('dotenv').config();
const Razorpay = require('razorpay');

// Without keys (e.g. a local setup that only runs the Meril One apps) the
// server still starts; only portal sign-up payments are unavailable.
const razorpay = process.env.RAZORPAY_KEY_ID
  ? new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET })
  : new Proxy({}, { get: () => { throw new Error('Payments are not set up: add RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to backend/.env'); } });

// ₹499 + 18% GST, billed yearly for as long as the partner account stays
// active — see create_razorpay_plan.js, which creates the Plan this amount
// belongs to (Razorpay bills against a Plan, not a raw amount).
const REGISTRATION_FEE_PAISE = 49900; // ₹499, before GST
const GST_RATE = 0.18;
const REGISTRATION_TOTAL_PAISE = Math.round(REGISTRATION_FEE_PAISE * (1 + GST_RATE)); // ₹588.82 -> 58882 paise

module.exports = { razorpay, REGISTRATION_FEE_PAISE, GST_RATE, REGISTRATION_TOTAL_PAISE };
