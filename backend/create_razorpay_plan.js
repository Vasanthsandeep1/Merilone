// One-off setup: creates the Razorpay Plan the partner registration fee
// subscription (see routes/authRoutes.js's /subscription/* endpoints) bills
// against — Razorpay subscriptions always reference a Plan, there's no
// "just charge this amount" option. Run once per Razorpay key pair (test
// vs live each need their own Plan), then paste the printed plan_id into
// backend/.env as RAZORPAY_PLAN_ID and restart the backend server.
require('dotenv').config();
const { razorpay, REGISTRATION_TOTAL_PAISE } = require('./config/razorpay');

const run = async () => {
  if (process.env.RAZORPAY_PLAN_ID) {
    console.log(`⚠️  RAZORPAY_PLAN_ID is already set (${process.env.RAZORPAY_PLAN_ID}) — delete it from .env first if you really want to create a new plan.`);
    process.exit(0);
  }

  const plan = await razorpay.plans.create({
    period: 'yearly',
    interval: 1,
    item: {
      name: 'Meril One Partner Registration Fee',
      amount: REGISTRATION_TOTAL_PAISE,
      currency: 'INR',
      description: '₹499 + 18% GST, billed yearly',
    },
  });

  console.log('✅ Plan created:', plan.id);
  console.log(`\nAdd this to backend/.env:\nRAZORPAY_PLAN_ID=${plan.id}\n\nThen restart the backend server.`);
};

run().catch((err) => {
  console.error('❌ Failed to create plan:', err?.error ?? err);
  process.exit(1);
});
