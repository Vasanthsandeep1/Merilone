// SAMPLE products (public repo): the real price list is kept out of this repository.
// OPI Management > Create OPI: data for the two OPI (Order Processing
// Information) formats, from Meril's own templates:
//   Endo:  "Endo New OPI format.xlsx" (one line per PO item, with the rate chain
//          HP -> dealer -> super distributor -> Meril billing)
//   Diagnostics: "OPI_GeM_..._Trenche_6_....xlsx" ("ORDER PROCESSING INFORMATION"
//          form; products from its "Product code & Details" sheet)
module.exports = {
  diagnostics: {
    company: { name: 'Meril Diagnostics (P) Ltd.', address: ['612-B, Bonanza, Sahar Plaza, J.B.Nagar,', 'Andheri-Kurla Road, Andheri (East), Mumbai - 400059'], email: 'Reagents.OPI@merillife.com' },
    orderTypes: ['Rapid', 'RR', 'PRR', 'Key Cust.', 'Govt.'],
    gstRate: 5,
    sendTo: 'cd.opi@merillife.com',
    products: [
      { code: 'SAMPLE-HIV-01', description: 'Sample HIV Rapid Test (50 Tests)', packSize: '50 Tests', moq: '25 Kits', mix: 'Lateral Flow', dbPrice: 500, majorGroup: 'Critical Rapids' },
      { code: 'SAMPLE-HBV-01', description: 'Sample HBsAg Rapid Test (50 Tests)', packSize: '50 Tests', moq: '25 Kits', mix: 'Lateral Flow', dbPrice: 300, majorGroup: 'Critical Rapids' },
      { code: 'SAMPLE-DEN-01', description: 'Sample Dengue NS1 Rapid Test', packSize: '25 Tests', moq: '20 Kits', mix: 'Lateral Flow', dbPrice: 800, majorGroup: 'Dengue Rapid' },
      { code: 'SAMPLE-MAL-01', description: 'Sample Malaria Ag Rapid Test', packSize: '50 Tests', moq: '20 Kits', mix: 'Lateral Flow', dbPrice: 450, majorGroup: 'Malaria Rapid' },
      { code: 'SAMPLE-PIP-01', description: 'Sample Single Channel Pipette 100-1000ul', packSize: '1 Unit', moq: '', mix: 'Pipettes', dbPrice: 1200, majorGroup: 'Pipettes' },
    ],
    terms: {
      rapid: ['I am herewith confirming the kits Ordered Quantity & Price is correct', 'The email ID & Phone No. is correct and I am OK to receive updated order status through mail & SMS', 'I am herewith confirming that I have given blank cheque/s along with order. I will clear payment by Cheque / NEFT / RTGS / IMPS as per 30 days credit from the date of invoice', 'In case of order cancelled after Invoice, the order cancellation charges will be applicable @ 18% pa.', 'I am herewith confirming that no verbal commitment has been done with any person for order', 'In case of payment dispute, the case will be heard within Vapi jurisdiction'],
      supply: ['Material once billed & dispatched cannot be taken back', 'Distributor is responsible for the ordered material quantity & full payment to Meril Diagnostics', 'Distributor is responsible for supply of material and recovery of payment from market', 'Sales team member will help in liquidating the ordered material by providing leads from local market', 'Distributor is responsible for supply of material and recovery of payments against the leads provided by Meril sales person', 'The credit facility given to distributor is 30 days from the date of invoice which includes transit time', 'Quality issue in material will be approved by Meril Quality Control Dept. and replacement will be provided by Meril', 'Expired material without any quality issue will not be taken back. No credit note will be issued or adjustment will be done against due payment', 'Distributor will make invoice wise payment and will share the invoice details along with payment details. No cash payment will be accepted and accounted against the bill'],
    },
  },
  endo: {
    defaultDealerMargin: 10, // % (Y column default in the sheet)
  },
};
