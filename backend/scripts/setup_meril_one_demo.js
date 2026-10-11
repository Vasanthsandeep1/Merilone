// Creates demo data so the Meril One apps can be tried on a fresh database.
// Run once, after the backend has started at least once (it creates the
// tables and the service catalogue itself):
//
//   cd backend
//   node scripts/setup_meril_one_demo.js
//
// Adds (skips anything already there):
//   - a demo company account for the B2G portal   demo@merilone.test / Demo@123
//   - a B2G service engineer (Active, Chennai)     phone 9000000001  -> can log into the Engineer app
//   - a second engineer                            phone 9000000002
//   - sample Store products (Meril One customer app > Store, with specs)
// The Customer app needs no setup: log in with any 10-digit mobile (6-9...).
// In development the OTP is shown in the app and in the backend console.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../models');

const { User, PartnerProfile, ServiceEngineer, ServiceEngineerArea, ServiceSkill, ServiceEngineerSkill, PartnerDivisionProduct, M1Category } = db;

(async () => {
  await db.sequelize.authenticate();

  // 1. Demo company (owner of the engineers and the Store products).
  let owner = await User.findOne({ where: { email: 'demo@merilone.test' } });
  if (!owner) {
    owner = await User.create({
      name: 'Demo Company', email: 'demo@merilone.test', password: await bcrypt.hash('Demo@123', 10), mobile: '9000000099',
      userType: 'partner', partnerType: 'oem', isActive: true, profileSubmitted: true,
    });
    console.log('Created demo company account: demo@merilone.test / Demo@123');
  }
  if (!(await PartnerProfile.findOne({ where: { userId: owner.id } }))) {
    await PartnerProfile.create({ userId: owner.id, submitted: true, companyInfo: { tradeName: 'Demo Medical Devices', legalName: 'Demo Medical Devices Pvt Ltd' } });
  }

  // 2. Service skills = the app's service categories.
  const cats = await M1Category.findAll({ order: [['id', 'ASC']] });
  if (!cats.length) { console.log('No service categories yet: start the backend once (npm run dev), then run this again.'); process.exit(1); }
  const skills = [];
  for (const c of cats) {
    const [s] = await ServiceSkill.findOrCreate({ where: { userId: owner.id, name: c.name }, defaults: { userId: owner.id, name: c.name } });
    skills.push(s);
  }

  // 3. Engineers who can log into the Engineer app.
  for (const [phone, name, empId] of [['9000000001', 'Demo Engineer Ravi', 'DEMO-001'], ['9000000002', 'Demo Engineer Priya', 'DEMO-002']]) {
    let e = await ServiceEngineer.findOne({ where: { phone } });
    if (!e) {
      e = await ServiceEngineer.create({ userId: owner.id, empId, name, phone, email: `${empId.toLowerCase()}@merilone.test`, experienceYears: 5, status: 'Active' });
      await ServiceEngineerArea.bulkCreate([{ engineerId: e.id, state: 'Tamil Nadu', district: 'Chennai' }, { engineerId: e.id, state: 'Tamil Nadu', district: 'Chengalpattu' }]);
      await ServiceEngineerSkill.bulkCreate(skills.map((s) => ({ engineerId: e.id, skillId: s.id })));
      console.log(`Created service engineer ${name}: Engineer app login with ${phone}`);
    }
  }

  // 4. Store products (no prices shown in the app: customers ask for a quote).
  if (!(await PartnerDivisionProduct.count({ where: { userId: owner.id } }))) {
    await PartnerDivisionProduct.bulkCreate([
      ['Analyzers', 'DEMO-BIO-200', 'Demo Biochemistry Analyzer 200', 'Fully automated clinical chemistry analyzer.\nThroughput: 200 tests/hour\nReagent positions: 60 (cooled)\nInterface: LIS, bidirectional\nWarranty: 1 year'],
      ['Analyzers', 'DEMO-HEM-5', 'Demo 5-Part Hematology Analyzer', '5-part differential hematology analyzer.\nThroughput: 60 samples/hour\nParameters: 29\nSample volume: 20 µL\nWarranty: 1 year'],
      ['Lab Equipment', 'DEMO-CEN-16', 'Demo Lab Centrifuge 16', 'Benchtop centrifuge.\nMax speed: 16,000 rpm\nRotor: 24 x 1.5/2.0 mL\nWarranty: 2 years'],
      ['Reagents & Kits', 'DEMO-RAP-25', 'Demo Rapid Antigen Test Kit', 'Rapid antigen test, results in 15 minutes.\nPack size: 25 tests\nStorage: 2–30 °C\nShelf life: 18 months'],
    ].map(([category, productCode, productName, description]) => ({ userId: owner.id, division: 'meril', category, productCode, productName, description, source: 'manual', createdByName: 'Demo setup' })));
    console.log('Added 4 Store products');
  }

  console.log('\nDone. Customer app: any 10-digit mobile. Engineer app: 9000000001 or 9000000002. Portal: demo@merilone.test / Demo@123');
  process.exit(0);
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
