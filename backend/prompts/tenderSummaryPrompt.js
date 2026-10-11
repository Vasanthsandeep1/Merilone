'use strict';

// Ported verbatim from the OLD tender-automation site's
// (Openprocure 2.0/AUTOMATION SITE/openprocure_2.0) tenders.controller.js
// getTenderSummary handler (lines 1751-2311) -- a long, decision-oriented
// 'TENDER SCRUTINY FOR PARTICIPATION' prompt covering eligibility, dates,
// document requirements, rejection/blacklisting risk, and a final Go/No-Go
// verdict. Kept in its own module (not inline in the controller) purely
// because of its size.
const SYSTEM_PROMPT = `Act as a Senior Tender Manager and Government Tender Scrutiny Expert with extensive experience in Indian Government and PSU tenders, working for Meril Life Sciences, a medical device company.`;

function buildUserPrompt(docText) {
  return `I am uploading a tender document along with any related documents such as Tender Notice/NIT, Tender Schedule/BOQ, Technical Specifications, Corrigendum/Addendum, Annexures, General Terms & Conditions, or Bidder Documents.

Tender document text:
${docText}

Your task is to READ ALL UPLOADED DOCUMENTS CAREFULLY and provide a COMPLETE TENDER SCRUTINY FROM THE PARTICIPATION PERSPECTIVE.

IMPORTANT INSTRUCTIONS:

1. Review ALL pages and ALL uploaded tender-related documents before giving the final conclusion.
2. Do not skip annexures, schedules, checklists, footnotes, notes, corrigenda, or addenda.
3. If multiple documents are uploaded, cross-check them against each other.
4. If there is a corrigendum/addendum, clearly identify which original clause has been amended and consider the latest amendment as applicable.
5. Do not assume any information that is not mentioned in the tender.
6. Do not use general knowledge or external information unless specifically asked.
7. If any information is missing, unclear, contradictory, or not available in the uploaded documents, clearly mention:
   "NOT CLEAR FROM TENDER DOCUMENT – VERIFICATION REQUIRED."
8. Distinguish clearly between:
   - Mandatory requirement
   - Conditional requirement
   - Applicable only for specific bidder/product/category
   - Recommended but not mandatory
9. Do not simply repeat tender clauses. Convert the tender conditions into a practical scrutiny from a bidder's participation perspective.
10. Identify the exact rejection, disqualification, EMD forfeiture, penalty, risk purchase, blacklisting, and debarment risks.
11. Wherever possible, mention the relevant clause number, annexure number, page number, or document name.
12. If the tender schedule contains multiple items, identify whether the bidder can quote item-wise or whether all items must be quoted together.
13. Do not prepare a generic summary. Give a decision-oriented scrutiny that helps the bidder decide whether to participate.

========================================================
START THE ANSWER WITH:
========================================================

# TENDER SCRUTINY FOR PARTICIPATION

## 1. TENDER AT A GLANCE

Provide:

- Tendering Authority
- Tender Number
- Tender Title / Scope
- Tender Type
- Contract Type (Rate Contract / Purchase / Framework / Supply / etc.)
- Contract Validity
- Number of Items / Product Categories
- Estimated Tender Value / Bid Value, if available
- Tender Fee
- EMD / Bid Security
- Performance Security / Security Deposit
- Bid Validity
- Procurement Portal
- Physical Submission Requirement
- Sample Submission Requirement
- Important Geographical / Delivery Scope
- Any special condition affecting participation

Also provide a short:
### "Participation Complexity"
Rate the tender as LOW / MEDIUM / HIGH complexity and explain why.

========================================================

## 2. IMPORTANT DATES & DEADLINES

Prepare a table:

| Activity | Date & Time | Mandatory / Optional | Action Required |
|---|---|---|---|

Include:

- Tender publication date
- Pre-bid meeting
- Last date for pre-bid queries
- Technical bid submission deadline
- Commercial/price bid submission deadline
- Physical document submission deadline
- Tender fee submission deadline
- EMD submission deadline
- Sample submission deadline
- Technical bid opening
- Price bid opening, if available
- Any other critical deadline

Clearly highlight:

### CRITICAL DEADLINE ALERTS
Mention all deadlines where missing the deadline may result in rejection.

========================================================

## 3. BIDDER ELIGIBILITY CRITERIA

Explain clearly:

### Who is eligible to participate?
Check whether participation is allowed for:

- Manufacturer
- OEM
- Importer
- Direct Importer
- Authorized Distributor
- Dealer
- Agent
- Trader
- Consortium / JV
- Startup
- MSME
- Any other bidder category

Clearly mention:

### NOT ELIGIBLE TO PARTICIPATE
List all bidder categories expressly prohibited by the tender.

Also scrutinize:

- Minimum experience
- Manufacturing experience
- Marketing experience
- Past supply experience
- Similar work experience
- Minimum turnover
- Financial capacity
- Net worth, if applicable
- Production capacity
- Minimum quantity supplied
- Geographical restrictions
- Local content requirements
- Make in India requirements — **IMPORTANT: If the tender document mentions "Make in India", "MII", "Class 1/Class 2 local supplier", "local content", "minimum local content", or requires a Make in India certificate / MII certificate / local content certificate, explicitly state under a dedicated "MII Certificate Required" heading under Certificates: what MII class is required, the minimum local content percentage, whether a self-declaration or third-party certificate is needed, and whether foreign manufacturers are barred from participation.**
- State-specific registration requirements
- GST / PAN requirements
- Licences / statutory registrations
- Quality certifications

========================================================

## 4. PRODUCT / TECHNICAL ELIGIBILITY SCRUTINY

For every quoted item/product, check whether the tender requires:

- Exact technical specification
- Exact composition
- Size / dimension
- Material
- Standard
- Packing
- Shelf life
- Model
- Brand
- Product approval / permission
- Manufacturing licence
- Import licence
- CE certificate
- ISO certificate
- BIS / ISI certificate
- CDSCO registration
- WHO-GMP
- COPP
- Test reports
- NABL certificates
- **Make in India (MII) Certificate — Check specifically if the tender asks for a Make In India certificate, local content certificate, or MII declaration. If yes, clearly state: "MII CERTIFICATE REQUIRED" along with the class (Class 1 / Class 2), minimum local content %, and whether self-declaration is accepted.**
- Any other product-specific certificate

Clearly identify:

### ZERO-DEVIATION REQUIREMENTS
List all requirements where even a minor deviation may result in technical rejection.

### PRODUCT-WISE PARTICIPATION CHECK
If multiple items are present, prepare a table:

| Item Code / Sr. No. | Item Name | Key Mandatory Specification | Packing / Unit | Eligibility Condition | EMD | Sample Required | Participation Risk |
|---|---|---|---|---|---|---|---|

If all items cannot be fully listed due to excessive length, provide:
1. A concise product-wise table, and
2. A separate list of high-risk items.

========================================================

## 5. DOCUMENTS REQUIRED FOR PARTICIPATION

Prepare a complete practical checklist in the following format:

### A. COMPANY / BIDDER DOCUMENTS

| Document | Mandatory / Conditional | Applicable To | Required Format | Validity Requirement | Submission Mode |
|---|---|---|---|---|---|

### B. TECHNICAL / PRODUCT DOCUMENTS

Include:

- Product permission
- Licence
- Technical datasheet
- Catalogue
- Certificate
- Test report
- Product compliance statement
- **Make in India (MII) Certificate / Local Content Certificate / MII Self-Declaration — include if required by the tender**
- Any product-specific documents

### C. EXPERIENCE / PERFORMANCE DOCUMENTS

Include:

- Experience certificate
- Past purchase order
- Supply order
- Completion certificate
- Performance certificate
- Market standing certificate
- Manufacturing/marketing data
- Any other required proof

### D. FINANCIAL DOCUMENTS

Include:

- Turnover certificate
- CA certificate
- Audited balance sheet
- Profit & loss account
- Net worth certificate
- Production capacity certificate
- Any other financial proof

### E. STATUTORY DOCUMENTS

Include:

- PAN
- GST
- Manufacturing licence
- Import licence
- Udyam/MSME
- Startup certificate
- Other registrations

### F. DECLARATIONS / UNDERTAKINGS / ANNEXURES

List every mandatory annexure separately.

========================================================

## 6. DOCUMENT ATTESTATION / NOTARIZATION / AUTHENTICATION CHECK

Specifically identify:

### Documents requiring:
- Self-attestation
- Company stamp
- Authorized signatory signature
- Notarization
- Original signature
- Affidavit
- CA certification
- Cost Accountant certification
- Government authority certification
- FDCA/CDSCO certification
- First Class Magistrate / Notary certification
- Apostille/legalization, if applicable

Prepare a table:

| Document | Required Authentication | Who Must Sign/Certify | Mandatory? | Risk if Not Complied |
|---|---|---|---|---|

Do not assume notarization. If the tender does not specifically require notarization, clearly state:
"Not specifically required in tender document."

========================================================

## 7. SUBMISSION MODE SCRUTINY

Clearly explain what must be submitted:

### ONLINE ONLY
### PHYSICAL ONLY
### BOTH ONLINE AND PHYSICAL

Also identify:

- Separate envelopes/covers
- Document fee cover
- EMD cover
- Technical document cover
- Sample cover
- Document ordering requirement
- File naming requirement
- Digital signature requirement
- Original document requirement

Prepare a clear table:

| Document / Requirement | Online | Physical | Both | Submission Deadline |
|---|---|---|---|---|

========================================================

## 8. TENDER FEE & EMD SCRUTINY

Clearly provide:

### Tender Fee
- Amount
- GST applicability
- Payment mode
- Refundable / non-refundable
- Exemption available?
- Who can claim exemption?
- Documents required for exemption

### EMD
- Item-wise / total amount
- Payment modes
- BG allowed?
- BG validity
- Exemption available?
- Who can claim exemption?
- Documents required

### EMD FORFEITURE RISKS
List every situation where EMD may be forfeited.

========================================================

## 9. SAMPLE SUBMISSION SCRUTINY

If samples are required, clearly mention:

- Which items require samples
- Quantity
- Sample specification
- Sample packing
- Labelling requirement
- Deadline
- Submission address
- Sample evaluation criteria
- Whether sample is returnable
- Risk of rejection

If sample quantity/details are not clearly mentioned, write:
"NOT CLEAR FROM TENDER DOCUMENT – VERIFICATION REQUIRED."

========================================================

## 10. COMMERCIAL / PRICE BID SCRUTINY

Explain clearly:

### How to quote the rate

Check:

- Unit of quotation
- Packing unit
- Per piece / per pack / per box / per kit / per unit
- GST inclusive/exclusive
- Whether GST must be shown separately
- Freight inclusion
- Insurance inclusion
- F.O.R. destination
- Loading/unloading
- Installation/commissioning, if applicable
- Price escalation restriction
- Ceiling price, if any
- MRP restriction, if any
- Price preference
- L1 evaluation methodology
- Item-wise / group-wise / total package evaluation
- Reverse auction, if applicable

### CRITICAL RATE QUOTATION WARNING
Clearly mention any error that can result in:

- Technical rejection
- Commercial rejection
- EMD forfeiture
- Blacklisting/debarment

========================================================

## 11. TECHNICAL REJECTION CRITERIA

List ALL conditions that can result in technical bid rejection.

Separate them into:

### Immediate Rejection Risks
### Document Deficiency Risks
### Product Specification Deviation Risks
### Eligibility Failure Risks
### Submission Failure Risks
### Certificate Validity Risks
**Also check: If Make in India / MII certificate is required — is the certificate valid, issued by the right authority, and does the product meet the stated local content percentage? Flag as a Certificate Validity Risk if unclear.**

========================================================

## 12. BLACKLISTING / DEBARMENT / LEGAL ELIGIBILITY SCRUTINY

Check:

- Existing debarment
- Blacklisting
- Non-conviction requirement
- Pending cases
- Product quality issues
- Spurious/adulterated product restrictions
- False declaration consequences
- Disclosure requirements
- Land border restriction
- Conflict of interest, if applicable

Clearly highlight:

### HIGH-RISK DECLARATIONS
List every declaration where incorrect information may lead to debarment/blacklisting.

========================================================

## 13. POST-AWARD OBLIGATIONS & COMMERCIAL RISKS

Provide:

- Agreement execution timeline
- Security deposit
- Performance bank guarantee
- Contract period
- Delivery period
- Delivery locations
- Penalty for delay
- Maximum penalty
- Liquidated damages
- Risk purchase
- Replacement obligation
- Quality testing
- Batch testing
- Payment terms
- Payment holding conditions
- Warranty, if applicable
- Contract termination
- Debarment risks

Clearly identify:

### MAJOR POST-AWARD BUSINESS RISKS

========================================================

## 14. COMPLETE REJECTION / PENALTY MATRIX

Prepare this table:

| Default / Error | Consequence | Severity | Tender Reference |
|---|---|---|---|

Cover:

- Tender rejection
- Technical disqualification
- EMD forfeiture
- Security deposit forfeiture
- Penalty
- Risk purchase
- Blacklisting
- Debarment
- Contract termination

========================================================

## 15. PRE-BID REPRESENTATION / CLARIFICATION POINTS

Identify any clause that is:

- Ambiguous
- Contradictory
- Commercially unreasonable
- Technically restrictive
- Impossible to comply with
- Unclear regarding documents
- Unclear regarding samples
- Unclear regarding EMD
- Inconsistent between NIT, tender document, schedule and annexures

For each point, provide:

| Clause / Issue | Tender Position | Concern | Recommended Clarification / Representation |
|---|---|---|---|

Do not create unnecessary representation points.

========================================================

## 16. FINAL PARTICIPATION VERDICT

Give a clear decision:

### PARTICIPATE / PARTICIPATE AFTER DOCUMENT CONFIRMATION / HIGH RISK / DO NOT PARTICIPATE

Then provide:

### MANDATORY BEFORE PARTICIPATION
List the exact documents/conditions that must be confirmed.

### HIGH-RISK AREAS
List the top risks.

### GO / NO-GO CHECKLIST

Use:

- [ ] Eligible bidder category confirmed
- [ ] Product specification exactly matched
- [ ] Product permission available
- [ ] All mandatory licences valid
- [ ] Experience criteria met
- [ ] Turnover/financial criteria met
- [ ] EMD/tender fee arranged or exemption confirmed
- [ ] All mandatory documents available
- [ ] All annexures completed
- [ ] **Make in India (MII) Certificate requirement checked — if required, MII certificate / local content declaration available**
- [ ] Sample requirement confirmed
- [ ] No debarment/blacklisting issue
- [ ] Rate quotation methodology confirmed
- [ ] Submission mode confirmed
- [ ] All deadlines confirmed

========================================================

## FINAL MANAGEMENT SUMMARY

End with this short, practical summary:

### CAN WE PARTICIPATE?
[Clear YES / NO / CONDITIONAL]

### WHAT IS THE BIGGEST PARTICIPATION RISK?
[Maximum 3 points]

### WHAT MUST BE ARRANGED BEFORE BID SUBMISSION?
[Prioritized list]

### WHAT CAN CAUSE DIRECT REJECTION?
[Prioritized list]

### MANAGEMENT RECOMMENDATION
Provide a short 5-10 point action plan.

IMPORTANT:
The final output must be practical, decision-oriented and written in simple professional language. Do not give a generic clause-by-clause summary.

If any required information is not available or unclear, clearly write:
"NOT CLEAR FROM TENDER DOCUMENT – VERIFICATION REQUIRED."

Do not omit any important participation condition simply because it appears in an annexure, schedule, checklist, note, corrigendum or footnote.

SEE THESE SECTIONS ARE NOT COMPULSORY BUT YOU HAVE TO CLEARLY SEE ALL THE DOCUMENTS FOR THE CONTENT FOR THAT PARTICULAR SECTION IF NOT FIND THEN IGNORE THAT SECTION`;
}

module.exports = { SYSTEM_PROMPT, buildUserPrompt };
