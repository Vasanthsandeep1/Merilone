const crypto = require('crypto');
const { razorpay, REGISTRATION_TOTAL_PAISE } = require('../config/razorpay');

// @route  POST /api/auth/subscription/create
// Public — called from the registration wizard's payment step, before the
// partner account exists. Starts a Razorpay Subscription (not a one-time
// Order) so the ₹499+GST registration fee auto-renews yearly via
// UPI Autopay / card mandate, per how this was asked for.
exports.createSubscription = async (req, res) => {
  try {
    const { name, email, mobile } = req.body;
    if (!name || !email || !mobile) {
      return res.status(400).json({ message: 'Name, email and mobile are required' });
    }
    if (!process.env.RAZORPAY_PLAN_ID) {
      return res.status(500).json({ message: 'Payments are not configured yet — RAZORPAY_PLAN_ID is missing on the server' });
    }

    // Razorpay subscriptions always need a fixed total_count (no "forever"
    // option) — 15 yearly cycles reads as "renews until cancelled" for any
    // realistic partner relationship, while staying safely under UPI
    // Autopay's own stricter cap (mandates can't run longer than 30 years,
    // separate from — and tighter than — Razorpay's general ~2121 end_time
    // ceiling on subscriptions).
    const subscription = await razorpay.subscriptions.create({
      plan_id: process.env.RAZORPAY_PLAN_ID,
      customer_notify: 1,
      total_count: 15,
      notes: { name, email, mobile },
    });

    res.status(201).json({
      subscriptionId: subscription.id,
      keyId: process.env.RAZORPAY_KEY_ID,
      amount: REGISTRATION_TOTAL_PAISE,
    });
  } catch (error) {
    res.status(500).json({ message: 'Could not start payment', error: error?.error?.description ?? error.message });
  }
};

// @route  POST /api/auth/subscription/verify
// Public — verifies the checkout callback's signature (per Razorpay's
// subscription docs: HMAC-SHA256 of "payment_id|subscription_id" using the
// key secret) so a client can't just invent a subscriptionId to skip
// payment. registerPartner re-checks the subscription's actual status
// against the Razorpay API before creating the account, since a valid
// signature alone doesn't confirm the mandate was authorized.
exports.verifySubscription = async (req, res) => {
  try {
    const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Missing payment verification fields' });
    }

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return res.status(400).json({ message: 'Payment verification failed' });
    }

    res.status(200).json({ verified: true, subscriptionId: razorpay_subscription_id });
  } catch (error) {
    res.status(500).json({ message: 'Verification failed', error: error.message });
  }
};
