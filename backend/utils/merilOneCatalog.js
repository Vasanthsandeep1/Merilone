// Meril One — the starter service catalogue, created once when the tables
// are empty (see seedCatalog). Categories list the customer backgrounds
// ("segments") they're offered to; prices are the visit/inspection charge.
const ALL = ['home', 'hospital', 'lab', 'office', 'industry'];

const CATALOG = [
  {
    name: 'Home Appliances', icon: 'home', color: '#2563EB', segments: ['home'],
    services: [
      ['AC repair & service', 'Cooling issues, gas top-up, servicing', 499, 60],
      ['Refrigerator repair', 'Not cooling, noise, leakage', 399, 60],
      ['Washing machine repair', 'Not spinning, draining or starting', 399, 60],
      ['Microwave repair', 'Not heating, sparking, panel issues', 299, 45],
      ['Water purifier service', 'Filter change, leakage, low flow', 349, 45],
    ],
  },
  {
    name: 'Home Electronics', icon: 'tv', color: '#7C3AED', segments: ['home', 'office'],
    services: [
      ['TV repair', 'No display, sound or power', 399, 60],
      ['Inverter & UPS repair', 'Battery backup, charging faults', 349, 45],
      ['Home theatre & speakers', 'No sound, connectivity issues', 299, 45],
    ],
  },
  {
    name: 'Electrical', icon: 'flash', color: '#D97706', segments: ['home', 'office', 'industry'],
    services: [
      ['Wiring & switchboard', 'Faulty switches, sockets, short circuits', 249, 45],
      ['Fan & light installation', 'Install or fix fans and lights', 199, 30],
    ],
  },
  {
    name: 'Computers & Printers', icon: 'laptop', color: '#0D9488', segments: ['home', 'office', 'hospital', 'lab'],
    services: [
      ['Laptop / desktop repair', 'Slow, not booting, screen issues', 399, 60],
      ['Printer repair', 'Paper jam, print quality, not detected', 349, 45],
    ],
  },
  {
    name: 'Analyzers', icon: 'flask', color: '#DC2626', segments: ['hospital', 'lab'],
    services: [
      ['Biochemistry analyzer repair', 'Errors, calibration, QC failures', 1499, 120],
      ['Hematology analyzer repair', 'Clogging, count errors, aspiration faults', 1499, 120],
      ['Immunoassay analyzer service', 'Reagent, wash and detection issues', 1999, 120],
      ['Electrolyte analyzer service', 'Electrode, calibration, fluidics', 999, 90],
      ['Preventive maintenance (PM)', 'Scheduled PM as per manufacturer checklist', 2499, 180],
    ],
  },
  {
    name: 'Medical Equipment', icon: 'medkit', color: '#DB2777', segments: ['hospital'],
    services: [
      ['Patient monitor repair', 'Display, sensors, alarms', 999, 90],
      ['Infusion / syringe pump repair', 'Occlusion, accuracy, battery', 799, 60],
      ['Surgical equipment service', 'Electrosurgical units, endoscopy systems', 1999, 120],
      ['Installation & demo', 'New equipment installation and user training', 2999, 180],
    ],
  },
  {
    name: 'Lab Equipment', icon: 'beaker', color: '#0EA5E9', segments: ['lab', 'hospital', 'industry'],
    services: [
      ['Centrifuge repair', 'Imbalance, speed, lid lock', 799, 60],
      ['Microscope service', 'Optics cleaning, illumination', 599, 60],
      ['Incubator / refrigerator (lab)', 'Temperature control, alarms', 899, 60],
    ],
  },
  {
    name: 'Industrial Machines', icon: 'cog', color: '#4B5563', segments: ['industry'],
    services: [
      ['Machine breakdown repair', 'Motors, drives, controls', 1499, 120],
      ['Compressor & pump service', 'Pressure, leakage, overheating', 999, 90],
    ],
  },
];

async function seedCatalog({ M1Category, M1Service }) {
  if (await M1Category.count()) return;
  for (const [i, c] of CATALOG.entries()) {
    const cat = await M1Category.create({ name: c.name, icon: c.icon, color: c.color, segments: c.segments, sortOrder: i });
    await M1Service.bulkCreate(c.services.map(([name, description, price, durationMins]) => ({ categoryId: cat.id, name, description, price, durationMins })));
  }
  console.log('Meril One: seeded the service catalogue');
}

module.exports = { seedCatalog, SEGMENTS: ALL };
