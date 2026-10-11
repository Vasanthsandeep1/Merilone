// Seed data for the Company Type -> Category -> Sub-Category -> Product
// hierarchy (SETUP_PROFILE.txt section 24). Category names MUST match
// config/companyTypes.js exactly — that's how productMasterController.js's
// getMyCategories looks up "the categories this partner selected at
// registration". Deeper hierarchies for Electricals & Electronics and
// Medical Devices & Equipment (the spec's own worked examples); the rest
// get a lighter but real hierarchy so nothing is empty. A Super Admin UI to
// manage this (add/edit/disable category/sub-category/product) is the
// natural next step — see SETUP_PROFILE.txt section 18 — but doesn't exist
// in this app yet, so this seed is the only way in for now.
module.exports = [
  {
    category: 'Electricals & Electronics',
    subCategories: {
      'Computing': ['Laptops', 'Desktop Computers', 'Monitors', 'Keyboards', 'Mouse', 'Printers', 'Scanners', 'Webcams'],
      'Mobile & Communication': ['Mobile Phones', 'Tablets', 'Smart Watches', 'Power Banks', 'Chargers', 'Adapters'],
      'Networking': ['Routers', 'Network Switches', 'Modems'],
      'Security Systems': ['CCTV Cameras', 'DVR', 'NVR'],
      'Consumer Electronics': ['Projectors', 'Televisions', 'Speakers', 'Headphones', 'Earphones', 'Microphones'],
      'Electrical Components': ['Cables', 'Connectors', 'Switches', 'Sockets', 'Electrical Panels', 'Circuit Breakers', 'MCB', 'RCCB', 'Distribution Boards', 'Transformers', 'Motors'],
      'Power & Backup': ['UPS', 'Inverters', 'Batteries', 'Power Supplies', 'Generators', 'Voltage Stabilizers'],
      'Lighting': ['LED Lights'],
      'Solar': ['Solar Panels', 'Solar Inverters']
    }
  },
  {
    category: 'Medical Devices & Equipment',
    subCategories: {
      'Diagnostic Equipment': ['Blood Analyzer', 'ECG Machine', 'Ultrasound Scanner', 'X-Ray Machine', 'Pulse Oximeter'],
      'Laboratory Equipment': ['Centrifuge', 'Microscope', 'Incubator', 'Autoclave', 'PCR Machine'],
      'Patient Monitoring': ['Vital Signs Monitor', 'ICU Monitor', 'Fetal Monitor'],
      'Surgical Equipment': ['Surgical Instruments Set', 'Electrosurgical Unit', 'Operating Table', 'Surgical Lights'],
      'Hospital Furniture': ['Hospital Bed', 'Wheelchair', 'Stretcher', 'IV Stand']
    }
  },
  {
    category: 'Medical Software / HealthTech',
    subCategories: {
      'Clinical Software': ['Hospital Management System', 'EMR/EHR Software', 'Telemedicine Platform'],
      'Diagnostic Software': ['Lab Information System', 'PACS/Imaging Software'],
      'Practice Management': ['Appointment Scheduling', 'Billing Software']
    }
  },
  {
    category: 'Pharmaceuticals',
    subCategories: {
      'Formulations': ['Tablets', 'Capsules', 'Syrups', 'Injectables'],
      'Raw Materials': ['Active Pharmaceutical Ingredients', 'Excipients'],
      'Packaging': ['Blister Packs', 'Bottles', 'Vials']
    }
  },
  {
    category: 'Biotechnology',
    subCategories: {
      'Research Reagents': ['Enzymes', 'Antibodies', 'Cell Culture Media'],
      'Lab Instruments': ['Spectrophotometer', 'Gel Electrophoresis Unit', 'Bioreactor']
    }
  },
  {
    category: 'Diagnostics & Laboratory',
    subCategories: {
      'Reagents & Kits': ['Diagnostic Test Kits', 'Reagent Kits', 'Rapid Test Kits'],
      'Lab Instruments': ['Analyzers', 'Microscopes', 'Centrifuges']
    }
  },
  {
    category: 'Hospital / Healthcare Services',
    subCategories: {
      'Clinical Services': ['Diagnostic Services', 'Consultation Services'],
      'Support Services': ['Ambulance Services', 'Home Healthcare']
    }
  },
  {
    category: 'Manufacturing & Industrial',
    subCategories: {
      'Machinery': ['CNC Machines', 'Industrial Robots', 'Conveyor Systems'],
      'Tools & Equipment': ['Hand Tools', 'Power Tools', 'Measuring Instruments'],
      'Raw Materials': ['Steel', 'Plastics', 'Composites']
    }
  },
  {
    category: 'Logistics & Supply Chain',
    subCategories: {
      'Warehousing': ['Racking Systems', 'Forklifts', 'Pallet Trucks'],
      'Transportation': ['Commercial Vehicles', 'Cold Chain Containers'],
      'Packaging': ['Shipping Boxes', 'Pallets']
    }
  },
  {
    category: 'Research & Academia',
    subCategories: {
      'Lab Equipment': ['Research Microscopes', 'Spectrometers'],
      'Educational Tools': ['Lab Kits', 'Teaching Aids']
    }
  },
  {
    category: 'Other',
    subCategories: {
      'General': ['Other Products']
    }
  }
];
