// Target Management > Manage Target: the rows of a sales target sheet, the
// same as Meril's budget workbook ("ZH - Government Budget 2026-27.xlsx"),
// so a target typed in here looks like the target letter's tables.
//   Diagnostics (MDPL): Business -> Business Group
//   Endo Surgery (MEPL): Portfolio -> Category
// Values are in ₹ Lakhs, one per month Apr..Mar.
module.exports = {
  diagnostics: {
    title: 'SALES TARGET - DIAGNOSTICS',
    groupLabel: 'Business',
    categoryLabel: 'Business Group',
    groups: [
      { name: 'Instrument', categories: ['3PDA_Hematology', '5PDA_Hematology', 'Biochemistry', 'Coagulation', 'Diabetic Mgmt.', 'Electrolyte', 'FAA_Biochemistry', 'Haematology', 'Immunology', 'Nephelometry', 'SAA_Biochemistry'] },
      { name: 'Instrument - Others', categories: ['Spares/RM of Instrument'] },
      { name: 'Rapid & Elisa', categories: ['Blood Grouping', 'Flow Through', 'Immunology', 'Lateral Flow'] },
      { name: 'Reagent', categories: ['AriQuant', 'Biochemistry', 'Coagulation', 'Diabetic Mgmt.', 'Electrolyte', 'Haematology', 'Hematology', 'Immunology'] },
    ],
  },
  endo: {
    title: 'SALES TARGET - ENDO SURGERY',
    groupLabel: 'Portfolio',
    categoryLabel: 'Category',
    groups: [
      { name: 'P-1', categories: ['Aspiron', 'Aspiron DNLSP', 'Aspiron Sutures', 'FILAPROP', 'Filapron', 'Filasilk', 'Filaxyn', 'General MHRS', 'HIUS-Erina & Fiona', 'Hemostat', 'Hemostat - ORC', 'IUD', 'Ligation Clip & Applicator', 'Liver Transplant Kit', 'MITSU AB', 'Mericron Xl', 'Merisoft Chromic', 'Mitsu', 'Mitsu Fst', 'Pinion', 'Poly Clip & Applicator', 'Skin Stapler & Extractor', 'Suture', 'Suture - Barb', 'Suture - CG', 'Suture - CV', 'Suture - Kit', 'Suture - Non Ab', 'Suture - Plastic + Opthal', 'Suture - Raw Material', 'Suture - Synab', 'Trocar', 'UCT/BW/Ancora'] },
      { name: 'P-2', categories: ['Advance MHRS', 'Advance Tacker', 'Clutch', 'Endocutter', 'Energy-Device', 'Energy-Device(Consumable)', 'MLC, MALS & MCS', 'MPPH', 'Mesic Diode Lazer', 'Trocar'] },
    ],
  },
};
