// Sample data for the Meril One customer app's Home / Store screens, so every
// section has something to show while testing:
//   - Store: Meril products in View Profile > Products (partner_division_products)
//   - per customer: sample products with warranty ending soon / ended,
//     completed services (rated + not rated), quote requests (with replies)
//
// Everything it adds is tagged so it can be removed again:
//   node scripts/seed_m1_sample.js            add (skips if already added)
//   node scripts/seed_m1_sample.js --remove   remove all sample rows
const { Op } = require('sequelize');
const db = require('../models');
const { sequelize, User, PartnerDivisionProduct, M1User, M1Product, M1Booking, M1QuoteRequest, M1Notification } = db;

const TAG = 'Sample data';           // partner_division_products.created_by_name
const NOTE = '[sample]';             // m1_products.notes / m1_bookings.work_notes / m1_quote_requests.message prefix
const BOOKING_PREFIX = 'M1S';        // sample booking numbers: M1S0001…
const QUOTE_PREFIX = 'QS';           // sample quote numbers: QS0001…

const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toLocaleDateString('en-CA'); };

const STORE = [
  ['Analyzers', 'MER-AUTOQUANT-200I', 'AutoQuant 200i Biochemistry Analyzer', 'Fully automated, 200 tests/hour clinical chemistry analyzer with 60 reagent positions and on-board cooling. Ideal for mid-size labs and hospitals.'],
  ['Analyzers', 'MER-AUTOQUANT-400', 'AutoQuant 400 Biochemistry Analyzer', 'High-throughput 400 tests/hour analyzer with ISE module option, STAT priority and LIS connectivity.'],
  ['Analyzers', 'MER-CELQUANT-5', 'CelQuant 5-Part Hematology Analyzer', '5-part differential hematology analyzer, 60 samples/hour, 29 parameters with histograms and scattergrams.'],
  ['Analyzers', 'MER-CELQUANT-3', 'CelQuant 3-Part Hematology Analyzer', 'Compact 3-part CBC analyzer, 60 samples/hour, 21 parameters. Low reagent consumption.'],
  ['Analyzers', 'MER-ELYTE-PRO', 'E-Lyte Pro Electrolyte Analyzer', 'Na, K, Cl, iCa, pH measurement with ion-selective electrodes. Results in under 60 seconds.'],
  ['Analyzers', 'MER-CLIAQUANT', 'CLIAQuant Immunoassay Analyzer', 'Chemiluminescence immunoassay system for thyroid, fertility, cardiac and tumour markers.'],
  ['Reagents & Kits', 'MER-BIO-REAG-KIT', 'Biochemistry Reagent Kit (Glucose, Urea, Creatinine)', 'Ready-to-use liquid reagents, calibrated for AutoQuant analyzers. 12-month shelf life.'],
  ['Reagents & Kits', 'MER-MERISCREEN-COVID', 'MeriScreen Rapid Antigen Test Kit', 'Rapid antigen test, results in 15 minutes. Pack of 25 tests.'],
  ['Reagents & Kits', 'MER-HB-CONTROL', 'Hematology Control (3 levels)', 'Tri-level control for CelQuant analyzers for daily quality control.'],
  ['Medical Devices', 'MER-MYVAL-THV', 'Myval Transcatheter Heart Valve', 'Balloon-expandable transcatheter heart valve with nitinol-free frame, available in intermediate and XL sizes.'],
  ['Medical Devices', 'MER-BIOMIME-DES', 'BioMime Sirolimus Eluting Stent', 'Ultra-thin 65 micron coronary stent with biodegradable polymer.'],
  ['Medical Devices', 'MER-FREEDOM-KNEE', 'Freedom Total Knee System', 'Total knee replacement system with high-flexion design and multiple size options.'],
  ['Lab Equipment', 'MER-CENTRI-16', 'Merispin 16 Laboratory Centrifuge', 'Benchtop centrifuge, up to 16,000 rpm, 24 x 1.5 ml rotor, digital timer.'],
  ['Lab Equipment', 'MER-INCUBATE-100', 'Meritherm 100L Laboratory Incubator', 'Microprocessor-controlled incubator, ambient +5 °C to 70 °C, 100 litre chamber.'],
];

const SAMPLE_PRODUCTS = [
  // [name, categoryId, brand, model, warrantyOffsetDays]
  ['Patient Monitor (ICU Bed 3)', 6, 'Meril', 'MeriVital M12', 18],
  ['Biochemistry Analyzer', 5, 'Meril', 'AutoQuant 200i', -40],
];

const COMPLETED = [
  // [serviceId, categoryId, serviceName, daysAgo, amount, rating, review]
  [17, 5, 'Preventive maintenance (PM)', 9, 1800, 5, 'Quick and thorough, engineer explained everything.'],
  [18, 6, 'Patient monitor repair', 23, 2450, null, null],
  [11, 4, 'Laptop / desktop repair', 41, 950, 4, 'Good service.'],
];

async function remove() {
  const t = await sequelize.transaction();
  try {
    const q = await M1QuoteRequest.destroy({ where: { requestNo: { [Op.like]: `${QUOTE_PREFIX}%` } }, transaction: t });
    const b = await M1Booking.findAll({ where: { bookingNo: { [Op.like]: `${BOOKING_PREFIX}%` } }, attributes: ['id'], transaction: t });
    await M1Notification.destroy({ where: { bookingId: b.map((x) => x.id) }, transaction: t });
    await M1Notification.destroy({ where: { kind: 'quote', body: { [Op.like]: `%(${QUOTE_PREFIX}%` } }, transaction: t });
    const bk = await M1Booking.destroy({ where: { bookingNo: { [Op.like]: `${BOOKING_PREFIX}%` } }, transaction: t });
    const p = await M1Product.destroy({ where: { notes: { [Op.like]: `${NOTE}%` } }, transaction: t });
    const s = await PartnerDivisionProduct.destroy({ where: { createdByName: TAG }, transaction: t });
    await t.commit();
    console.log(`Removed: ${s} store products, ${p} customer products, ${bk} bookings, ${q} quote requests`);
  } catch (e) { await t.rollback(); throw e; }
}

async function add() {
  if (await PartnerDivisionProduct.count({ where: { createdByName: TAG } })) {
    console.log('Sample data is already there. Run with --remove first to re-add.');
    return;
  }
  // Store products belong to the main portal account (lowest active user id).
  const owner = await User.findOne({ where: { isActive: true }, order: [['id', 'ASC']] });
  if (!owner) throw new Error('No active B2G user to own the store products');
  const engineers = await M1User.findAll({ where: { role: 'engineer' }, order: [['id', 'ASC']], limit: 3 });
  const customers = await M1User.findAll({ where: { role: 'customer', profileComplete: true } });

  const t = await sequelize.transaction();
  try {
    const store = await PartnerDivisionProduct.bulkCreate(STORE.map(([category, productCode, productName, description]) => ({
      userId: owner.id, division: 'meril', category, productCode, productName, description, source: 'manual', createdByName: TAG,
    })), { transaction: t });

    let bn = 0; let qn = 0;
    for (const c of customers) {
      // Products whose warranty is ending soon / has ended (Warranty watch).
      const prods = [];
      for (const [name, categoryId, brand, model, off] of SAMPLE_PRODUCTS) {
        prods.push(await M1Product.create({
          customerId: c.id, categoryId, name, brand, model, serialNo: `SN${c.id}${categoryId}${Math.abs(off)}`,
          purchaseDate: day(off - 365), warrantyUntil: day(off), location: categoryId === 6 ? 'ICU, 2nd floor' : 'Main lab',
          notes: `${NOTE} Sample product`,
        }, { transaction: t }));
      }
      // Completed services (Recent services).
      for (const [i, [serviceId, categoryId, name, ago, amount, rating, review]] of COMPLETED.entries()) {
        const eng = engineers[i % (engineers.length || 1)];
        const done = new Date(Date.now() - ago * 86400000);
        bn += 1;
        await M1Booking.create({
          bookingNo: `${BOOKING_PREFIX}${String(bn).padStart(4, '0')}`, customerId: c.id, engineerId: eng?.id || null,
          serviceId, categoryId, segment: c.segment, status: 'completed',
          issue: `${name}: routine visit`, address: c.address || 'Sample address', city: c.city || 'Chennai', pincode: c.pincode || '600001',
          contactName: c.name, contactPhone: c.phone, scheduledDate: day(-ago), slot: '10:00-11:00', startOtp: '1234',
          visitCharge: 299, finalAmount: amount, partsUsed: [], workNotes: `${NOTE} Serviced and tested OK.`,
          rating, review, productId: i === 1 ? prods[0].id : null,
          services: [{ id: serviceId, name }],
          timeline: [
            { status: 'requested', at: new Date(done.getTime() - 86400000).toISOString() },
            { status: 'accepted', at: new Date(done.getTime() - 80000000).toISOString() },
            { status: 'in_progress', at: new Date(done.getTime() - 3600000).toISOString() },
            { status: 'completed', at: done.toISOString() },
          ],
        }, { transaction: t });
      }
      // Quote requests (Store > My quotes, portal Quote Requests).
      for (const [i, [status, reply]] of [['quoted', 'Quote sent to your registered email. Valid for 30 days.'], ['new', null]].entries()) {
        const p = store[(c.id + i * 3) % store.length];
        qn += 1;
        await M1QuoteRequest.create({
          requestNo: `${QUOTE_PREFIX}${String(qn).padStart(4, '0')}`, customerId: c.id, productId: p.id, ownerUserId: owner.id,
          productName: p.productName, productCode: p.productCode, quantity: i ? 2 : 1,
          message: `${NOTE} Please share price with installation and AMC.`, status, reply,
        }, { transaction: t });
      }
    }
    await t.commit();
    console.log(`Added: ${store.length} store products (owner: user ${owner.id} ${owner.email}), for ${customers.length} customers: ${customers.length * SAMPLE_PRODUCTS.length} products, ${bn} completed services, ${qn} quote requests`);
  } catch (e) { await t.rollback(); throw e; }
}

(process.argv.includes('--remove') ? remove() : add())
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
