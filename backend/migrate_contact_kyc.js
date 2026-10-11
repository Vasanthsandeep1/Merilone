// One-off migration: adds partner_contacts.aadhar_number, .pan_number,
// .dob, .gender, .pan_verified, .aadhar_verified, and
// partner_profiles.digilocker_verification_id / .digilocker_reference_id
// (see models/PartnerContact.js, models/PartnerProfile.js,
// ContactStep.tsx's "User Verification" step). Run once, then restart the
// backend server.
require('dotenv').config();
const { sequelize } = require('./config/db');
const { PartnerContact, PartnerProfile } = require('./models');

const run = async () => {
  await sequelize.authenticate();
  console.log('✅ Connected to database');

  await PartnerContact.sync({ alter: true });
  console.log('✅ partner_contacts table synced — aadhar_number/pan_number/dob/gender/*_verified columns are in place');

  await PartnerProfile.sync({ alter: true });
  console.log('✅ partner_profiles table synced — digilocker_verification_id/digilocker_reference_id columns are in place');

  console.log('\n🎉 Migration complete! Restart the backend server now.');
  process.exit(0);
};

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
