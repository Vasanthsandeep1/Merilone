const fs = require('fs');
const { PartnerProfile, PartnerContact, PartnerLocation, PartnerTaxRegistration, PartnerCertificate, User } = require('../models');
const { cashfreeRequest, cashfreeUploadRequest } = require('../config/cashfree');
const ORGANISATION_TYPES = require('../config/organisationTypes');

// Every handler below keys off req.user.id (the caller's own login) — a
// partner can only ever read/edit their own Setup Profile, never one
// supplied via a request body/param.

const profileInclude = [
  { model: PartnerContact, as: 'contacts' },
  { model: PartnerLocation, as: 'locations' },
  { model: PartnerTaxRegistration, as: 'taxRegistrations' },
  { model: PartnerCertificate, as: 'certificates' }
];

const getOrCreateProfile = async (userId) => {
  const [profile] = await PartnerProfile.findOrCreate({ where: { userId }, defaults: { userId } });
  return profile;
};

// Nothing here is mandatory (per explicit testing instruction) — every
// section computes "how much of this did they fill in", not "is this
// complete/valid", so completion is a rough progress indicator, not a gate.
const computeCompletion = (profile) => {
  const hasAny = (obj) => !!obj && Object.values(obj).some((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0));
  const sections = {
    contact: profile.contacts.length > 0,
    company: hasAny(profile.companyInfo),
    address: hasAny(profile.registeredAddress) || hasAny(profile.corporateAddress) || profile.locations.length > 0,
    banking: hasAny(profile.bankDetails),
    tax: profile.taxRegistrations.length > 0 || profile.certificates.length > 0
  };
  const done = Object.values(sections).filter(Boolean).length;
  const overallPercent = Math.round((done / Object.keys(sections).length) * 100);
  return { overallPercent, sections };
};

const serialize = (profile) => ({ ...profile.toJSON(), completion: computeCompletion(profile) });

// @route GET /api/partner-profile
exports.getProfile = async (req, res) => {
  try {
    await getOrCreateProfile(req.user.id);
    const full = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: profileInclude });
    res.status(200).json(serialize(full));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch profile', error: error.message });
  }
};

// @route PATCH /api/partner-profile   { section, data }
// section is one of: companyInfo, registeredAddress, corporateAddress,
// bankDetails, businessDetails, additionalInfo (JSON blobs — merged, not
// replaced, so a step can be saved partially without clobbering other
// fields already saved in that same section) or sameAsRegistered,
// currentStep, confirmedAccurate (plain scalars — replaced outright).
const JSON_SECTIONS = ['companyInfo', 'registeredAddress', 'corporateAddress', 'bankDetails', 'businessDetails', 'additionalInfo'];
const SCALAR_SECTIONS = ['sameAsRegistered', 'currentStep', 'confirmedAccurate', 'departmentDivisions', 'documentsShared'];

exports.updateSection = async (req, res) => {
  try {
    const { section, data } = req.body;
    if (!JSON_SECTIONS.includes(section) && !SCALAR_SECTIONS.includes(section)) {
      return res.status(400).json({ message: `Unknown section: ${section}` });
    }

    const profile = await getOrCreateProfile(req.user.id);

    if (JSON_SECTIONS.includes(section)) {
      profile[section] = { ...(profile[section] || {}), ...(data || {}) };
    } else {
      profile[section] = data;
    }
    await profile.save();

    const full = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: profileInclude });
    res.status(200).json(serialize(full));
  } catch (error) {
    res.status(500).json({ message: 'Failed to save section', error: error.message });
  }
};

// @route POST /api/partner-profile/logo   multipart, field "logo"
exports.uploadLogo = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const profile = await getOrCreateProfile(req.user.id);
    profile.companyInfo = { ...(profile.companyInfo || {}), logoUrl: `/uploads/${req.file.filename}` };
    await profile.save();
    res.status(200).json({ logoUrl: profile.companyInfo.logoUrl });
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload logo', error: error.message });
  }
};

// ----- Generic repeatable-section CRUD (contacts / locations / tax registrations / certificates) -----
// All four follow the same shape: list is embedded in GET /partner-profile,
// and these just add/edit/remove one row scoped to the caller's own profile
// (never trusts a profileId from the client).

const makeCrud = (Model, allowedFields, { fileField, fileUrlField, fileNameField, fileSizeField } = {}) => ({
  create: async (req, res) => {
    try {
      const profile = await getOrCreateProfile(req.user.id);
      const payload = {};
      allowedFields.forEach((f) => { if (req.body[f] !== undefined) payload[f] = req.body[f]; });
      if (fileField && req.file) {
        payload[fileUrlField] = `/uploads/${req.file.filename}`;
        if (fileNameField) payload[fileNameField] = req.file.originalname;
        if (fileSizeField) payload[fileSizeField] = req.file.size;
      }
      const row = await Model.create({ ...payload, profileId: profile.id });
      res.status(201).json(row);
    } catch (error) {
      res.status(500).json({ message: 'Failed to add entry', error: error.message });
    }
  },
  update: async (req, res) => {
    try {
      const profile = await getOrCreateProfile(req.user.id);
      const row = await Model.findOne({ where: { id: req.params.id, profileId: profile.id } });
      if (!row) return res.status(404).json({ message: 'Not found' });
      allowedFields.forEach((f) => { if (req.body[f] !== undefined) row[f] = req.body[f]; });
      if (fileField && req.file) {
        row[fileUrlField] = `/uploads/${req.file.filename}`;
        if (fileNameField) row[fileNameField] = req.file.originalname;
        if (fileSizeField) row[fileSizeField] = req.file.size;
      }
      await row.save();
      res.status(200).json(row);
    } catch (error) {
      res.status(500).json({ message: 'Failed to update entry', error: error.message });
    }
  },
  remove: async (req, res) => {
    try {
      const profile = await getOrCreateProfile(req.user.id);
      const deleted = await Model.destroy({ where: { id: req.params.id, profileId: profile.id } });
      if (!deleted) return res.status(404).json({ message: 'Not found' });
      res.status(200).json({ message: 'Deleted' });
    } catch (error) {
      res.status(500).json({ message: 'Failed to delete entry', error: error.message });
    }
  }
});

const contactsCrud = makeCrud(PartnerContact, ['isPrimary', 'name', 'firstName', 'lastName', 'designation', 'department', 'email', 'mobile', 'altMobile', 'whatsapp', 'landline', 'photoUrl', 'contactType', 'communicationPreferences', 'aadharNumber', 'panNumber']);
const locationsCrud = makeCrud(PartnerLocation, ['name', 'locationType', 'addressLine1', 'addressLine2', 'country', 'state', 'city', 'pincode', 'contactPerson', 'phone', 'email']);
const taxRegCrud = makeCrud(PartnerTaxRegistration, ['registrationType', 'registrationNumber', 'issueDate', 'expiryDate', 'issuingAuthority', 'applicability'], { fileField: 'document', fileUrlField: 'documentUrl' });
const certificatesCrud = makeCrud(PartnerCertificate, ['certificateType', 'certificateName', 'certificateNumber', 'issuingAuthority', 'issueDate', 'expiryDate', 'remarks'], { fileField: 'document', fileUrlField: 'documentUrl', fileNameField: 'fileName', fileSizeField: 'fileSize' });

exports.createContact = contactsCrud.create;
exports.updateContact = contactsCrud.update;
exports.deleteContact = contactsCrud.remove;

exports.createLocation = locationsCrud.create;
exports.updateLocation = locationsCrud.update;
exports.deleteLocation = locationsCrud.remove;

exports.createTaxRegistration = taxRegCrud.create;
exports.updateTaxRegistration = taxRegCrud.update;
exports.deleteTaxRegistration = taxRegCrud.remove;

exports.createCertificate = certificatesCrud.create;
exports.updateCertificate = certificatesCrud.update;
exports.deleteCertificate = certificatesCrud.remove;

// ----- Identity verification (Cashfree Smart OCR) for the primary contact -----

// @route POST /api/partner-profile/ocr/pan        multipart, field "file"
// @route POST /api/partner-profile/ocr/aadhaar     multipart, field "file"
// The user uploads a photo/scan of their PAN or Aadhaar card instead of
// typing numbers in — Smart OCR reads the document and (for PAN, with
// do_verification:true) cross-checks it against the government database in
// the same call, so this covers both "read the card" and "confirm it's
// real" at once. Aadhaar has no do_verification support (OCR + embedded QR
// only, per Cashfree's docs) — still enough to read name/dob/gender/UID/
// address straight off the card.
const runDocumentOcr = (documentType) => async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Upload a PDF, JPG, JPEG or PNG file' });

    // multer's disk storage already wrote this to /uploads (see
    // uploadMiddleware.js) — that's the copy we keep; read it back into a
    // buffer just to forward to Cashfree for OCR.
    const fileBuffer = fs.readFileSync(req.file.path);
    const cardUrl = `/uploads/${req.file.filename}`;

    const verificationId = `ocr-${documentType.toLowerCase()}-${req.user.id}-${Date.now()}`.slice(0, 50);
    const result = await cashfreeUploadRequest('/bharat-ocr', {
      verificationId,
      documentType,
      doVerification: documentType === 'PAN',
      fileBuffer,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    });
    if (result.status !== 'VALID') {
      return res.status(400).json({ message: 'Document could not be verified — try a clearer photo' });
    }

    const fields = result.document_fields || {};
    const profile = await getOrCreateProfile(req.user.id);
    let primary = await PartnerContact.findOne({ where: { profileId: profile.id, isPrimary: true } });

    // Smart OCR only ever returns one combined "name" field (PAN 360 used
    // to split it for us) — split on the first space so the Primary
    // Contact form's separate First/Last Name fields still auto-fill.
    const [firstName, ...rest] = (fields.name || '').trim().split(/\s+/);
    const lastName = rest.join(' ');

    // PAN 360's masked email/mobile (e.g. "a*c@gmail.com", "99XXXXXX99")
    // — Smart OCR doesn't return either, so once OCR gives us the actual
    // PAN number, chain one PAN 360 lookup just for these two masks. The
    // frontend requires whatever the user types in those fields to start
    // and end matching this pattern. Best-effort: a failure here shouldn't
    // fail the OCR verification that already succeeded.
    let maskedEmail, maskedMobile, panType;
    if (documentType === 'PAN' && fields.pan) {
      try {
        const panAdvance = await cashfreeRequest('POST', '/pan/advance', {
          body: { pan: fields.pan, verification_id: `${verificationId}-adv`.slice(0, 50) },
        });
        maskedEmail = panAdvance.email || undefined;
        maskedMobile = panAdvance.mobile_number || undefined;
        panType = panAdvance.type || undefined;
      } catch {
        // No masks this time — email/mobile just go unvalidated, not fatal.
      }
    }

    // The Primary Contact is a person, not a business — reject a PAN that
    // PAN 360 identifies as belonging to a company/trust/firm etc.
    if (documentType === 'PAN' && panType && panType !== 'Individual or Person') {
      return res.status(400).json({ message: `This PAN belongs to a ${panType}, not an individual — upload the primary contact's personal PAN card` });
    }

    const patch = documentType === 'PAN'
      ? {
          panNumber: fields.pan || undefined,
          panVerified: true,
          name: fields.name || undefined,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          dob: fields.dob || undefined,
          fatherName: fields.father || primary?.fatherName || undefined,
          panCardUrl: cardUrl,
          panVerificationData: result,
          maskedEmail,
          maskedMobile,
          panType,
        }
      : {
          aadharNumber: fields.uid || undefined,
          aadharVerified: true,
          name: fields.name || primary?.name || undefined,
          firstName: firstName || primary?.firstName || undefined,
          lastName: lastName || primary?.lastName || undefined,
          dob: fields.dob || primary?.dob || undefined,
          gender: fields.gender || undefined,
          fatherName: fields.father || primary?.fatherName || undefined,
          address: fields.address || undefined,
          aadharCardUrl: cardUrl,
          aadharVerificationData: result,
        };
    // A single "name"/"dob" shouldn't let whichever document was uploaded
    // second silently blank out what the first one already confirmed.
    Object.keys(patch).forEach((k) => patch[k] === undefined && delete patch[k]);

    if (primary) await primary.update(patch);
    else primary = await PartnerContact.create({ ...patch, profileId: profile.id, isPrimary: true });

    res.status(200).json({ contact: primary });
  } catch (error) {
    res.status(error.status === 400 ? 400 : 500).json({ message: error.cashfree?.message || error.message || 'Document verification failed' });
  }
};

exports.ocrPan = runDocumentOcr('PAN');
exports.ocrAadhaar = runDocumentOcr('AADHAAR');

const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// GSTIN's "constitution_of_business" is free text from the government
// record ("Public Limited Company", "Partnership", ...) — map it onto our
// own registration dropdown (config/organisationTypes.js) instead of
// dumping the raw string into a field the UI renders as a <select>.
// Substring-matching both ways covers GSTIN's shorter forms ("Partnership",
// "Proprietorship") against our longer labels ("Partnership Firm").
const mapConstitutionToOrganisationType = (constitution) => {
  if (!constitution) return undefined;
  const norm = constitution.trim().toLowerCase();
  const match = ORGANISATION_TYPES.find((t) => {
    const tNorm = t.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
    return norm.includes(tNorm) || tNorm.includes(norm);
  });
  return match || 'Other';
};

// Shared by ocrCompanyPan and ocrCompanyGstin: once a /gstin Verify
// response is in hand, both routes patch companyInfo and
// registeredAddress off it the same way.
const applyGstinResult = (profile, gstinData, companyPatch) => {
  if (gstinData.legal_name_of_business) companyPatch.legalName = gstinData.legal_name_of_business;
  if (gstinData.trade_name_of_business) companyPatch.tradeName = gstinData.trade_name_of_business;
  if (gstinData.date_of_registration) companyPatch.dateOfRegistration = gstinData.date_of_registration;
  if (gstinData.principal_place_address) companyPatch.principalPlaceAddress = gstinData.principal_place_address;
  if (gstinData.state_jurisdiction) companyPatch.stateJurisdiction = gstinData.state_jurisdiction;
  if (gstinData.center_jurisdiction) companyPatch.centreJurisdiction = gstinData.center_jurisdiction;
  // "Others" is GSTIN's catch-all filler value, not an actual activity —
  // never worth showing, so it's dropped here rather than at display time.
  const activities = (gstinData.nature_of_business_activities || []).filter((a) => a.trim().toLowerCase() !== 'others');
  if (activities.length) companyPatch.natureOfBusinessActivity = activities.join(', ');
  const constitution = mapConstitutionToOrganisationType(gstinData.constitution_of_business);
  if (constitution) companyPatch.constitutionOfBusiness = constitution;

  profile.companyInfo = { ...(profile.companyInfo || {}), ...companyPatch };
  const split = gstinData.principal_place_split_address;
  if (split) {
    profile.registeredAddress = {
      ...(profile.registeredAddress || {}),
      line1: [split.flat_number, split.building_name, split.building_number].filter(Boolean).join(', ') || undefined,
      line2: [split.street, split.location].filter(Boolean).join(', ') || undefined,
      city: split.city || undefined,
      district: split.district || undefined,
      state: split.state || undefined,
      pincode: split.pincode || undefined,
      country: 'India',
    };
  }
  profile.companyGstinVerificationData = gstinData;
};

// Best-effort PAN-to-Udyam lookup, shared by ocrCompanyPan and
// ocrCompanyGstin (a GSTIN already encodes its PAN). A missing/cancelled
// Udyam registration isn't an error — plenty of companies simply don't
// have one — so this only ever returns a value or undefined, never throws.
const fetchUdyamForPan = async (pan, baseId) => {
  try {
    const result = await cashfreeRequest('POST', '/pan-udyam', {
      body: { pan, verification_id: `${baseId}-udyam`.slice(0, 50) },
    });
    return result.status === 'SUCCESS' ? result.udyam : undefined;
  } catch {
    return undefined;
  }
};

// @route POST /api/partner-profile/ocr/company-pan
// Company Information's PAN flow, either way in: upload the company's PAN
// card (multipart, field "file" — Smart OCR reads the PAN off it) or just
// type the PAN number (JSON body { pan }). Either way, PAN-to-GSTIN looks
// up the GSTIN(s) registered against that PAN, then GSTIN Verify pulls the
// rest (legal name, trade name, registered address, date of registration)
// straight from the government record.
exports.ocrCompanyPan = async (req, res) => {
  try {
    let pan, ocrResult, cardUrl;

    if (req.file) {
      const fileBuffer = fs.readFileSync(req.file.path);
      cardUrl = `/uploads/${req.file.filename}`;
      const baseId = `ocr-cpan-${req.user.id}-${Date.now()}`.slice(0, 50);

      ocrResult = await cashfreeUploadRequest('/bharat-ocr', {
        verificationId: baseId,
        documentType: 'PAN',
        doVerification: false,
        fileBuffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
      });
      if (ocrResult.status !== 'VALID') {
        return res.status(400).json({ message: 'PAN card could not be verified — try a clearer photo' });
      }
      pan = ocrResult.document_fields?.pan;
      if (!pan) return res.status(400).json({ message: "Couldn't read a PAN number off that upload — try a clearer photo" });
    } else {
      pan = (req.body.pan || '').trim().toUpperCase();
      if (!PAN_REGEX.test(pan)) return res.status(400).json({ message: 'Enter a valid 10-character PAN, e.g. ABCDE1234F' });
    }

    const baseId = `pan-${req.user.id}-${Date.now()}`.slice(0, 50);
    const profile = await getOrCreateProfile(req.user.id);
    const companyPatch = { pan };
    let gstinData;

    try {
      const panGstin = await cashfreeRequest('POST', '/pan-gstin', {
        body: { pan, verification_id: `${baseId}-gst`.slice(0, 50) },
      });
      // Active GSTINs first, but try every one returned — a PAN can have
      // several (one per state it's registered in), and in sandbox testing
      // the dummy PAN→GSTIN and GSTIN-verify datasets aren't cross-linked,
      // so the first candidate can 404 while a later one succeeds.
      const candidates = [...(panGstin.gstin_list || [])].sort((a, b) => (b.status === 'ACTIVE' ? 1 : 0) - (a.status === 'ACTIVE' ? 1 : 0));
      for (const candidate of candidates) {
        try {
          gstinData = await cashfreeRequest('POST', '/gstin', { body: { GSTIN: candidate.gstin } });
          companyPatch.gstin = candidate.gstin;
          break;
        } catch {
          // This GSTIN didn't verify — try the next one, if any.
        }
      }
      // Every GSTIN failed to verify (or none were found) — still record
      // the PAN's first known GSTIN so it's not lost, even without the
      // enriched details.
      if (!gstinData && candidates[0]) companyPatch.gstin = candidates[0].gstin;
    } catch {
      // No GSTIN on file for this PAN, or the pan-gstin lookup itself
      // failed — PAN alone still gets saved below, the rest is manual entry.
    }

    const udyam = await fetchUdyamForPan(pan, baseId);
    if (udyam) companyPatch.udyamId = udyam;

    // GSTIN's own registered legal name is the authoritative company name —
    // it supersedes whatever name Smart OCR read off the PAN.
    if (gstinData) applyGstinResult(profile, gstinData, companyPatch);
    else profile.companyInfo = { ...(profile.companyInfo || {}), ...companyPatch };

    if (cardUrl) profile.companyPanCardUrl = cardUrl;
    profile.companyPanVerified = true;
    if (ocrResult) profile.companyPanVerificationData = ocrResult;
    await profile.save();

    const full = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: profileInclude });
    res.status(200).json(serialize(full));
  } catch (error) {
    res.status(error.status === 400 ? 400 : 500).json({ message: error.cashfree?.message || error.message || 'PAN verification failed' });
  }
};

// @route POST /api/partner-profile/ocr/company-gstin   JSON body { gstin }
// The other way in to the same result: type the GSTIN directly and skip
// straight to GSTIN Verify — a GSTIN already encodes its PAN (characters
// 3–12), so that comes along for free too.
exports.ocrCompanyGstin = async (req, res) => {
  try {
    const gstin = (req.body.gstin || '').trim().toUpperCase();
    if (!GSTIN_REGEX.test(gstin)) return res.status(400).json({ message: 'Enter a valid 15-character GSTIN' });

    const gstinData = await cashfreeRequest('POST', '/gstin', { body: { GSTIN: gstin } });
    if (gstinData.valid === false) return res.status(400).json({ message: gstinData.message || "This GSTIN doesn't exist" });

    const profile = await getOrCreateProfile(req.user.id);
    const pan = gstin.slice(2, 12);
    const companyPatch = { gstin, pan };
    const udyam = await fetchUdyamForPan(pan, `gstin-${req.user.id}-${Date.now()}`.slice(0, 50));
    if (udyam) companyPatch.udyamId = udyam;
    applyGstinResult(profile, gstinData, companyPatch);
    profile.companyPanVerified = true;
    await profile.save();

    const full = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: profileInclude });
    res.status(200).json(serialize(full));
  } catch (error) {
    res.status(error.status === 400 ? 400 : 500).json({ message: error.cashfree?.message || error.message || 'GSTIN verification failed' });
  }
};

const CIN_REGEX = /^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;

// @route POST /api/partner-profile/ocr/company-cin   JSON body { cin }
// Corporate Identity Verification for "Company Registration Number" — once
// the user types a CIN, Cashfree's CIN Verify API confirms it against the
// Ministry of Corporate Affairs registry and fills in the company name and
// incorporation date straight from that record.
exports.ocrCompanyCin = async (req, res) => {
  try {
    const cin = (req.body.cin || '').trim().toUpperCase();
    if (!CIN_REGEX.test(cin)) return res.status(400).json({ message: 'Enter a valid 21-character CIN, e.g. U72900KA2015PTC082989' });

    const verificationId = `cin-${req.user.id}-${Date.now()}`.slice(0, 50);
    const cinData = await cashfreeRequest('POST', '/cin', { body: { cin, verification_id: verificationId } });
    if (cinData.status !== 'VALID') return res.status(400).json({ message: "This CIN doesn't exist or couldn't be verified" });

    const profile = await getOrCreateProfile(req.user.id);
    const companyPatch = { registrationNumber: cin };
    if (cinData.company_name) companyPatch.legalName = cinData.company_name;
    if (cinData.incorporation_date) companyPatch.dateOfRegistration = cinData.incorporation_date;
    profile.companyInfo = { ...(profile.companyInfo || {}), ...companyPatch };
    profile.companyCinVerified = true;
    profile.companyCinVerificationData = cinData;
    await profile.save();

    const full = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: profileInclude });
    res.status(200).json(serialize(full));
  } catch (error) {
    res.status(error.status === 400 ? 400 : 500).json({ message: error.cashfree?.message || error.message || 'CIN verification failed' });
  }
};

// @route POST /api/partner-profile/verify-gem-seller-id   JSON body { gemSellerId }
// GeM has no public verification API, so this submits the same form the
// government's own seller-lookup page uses (gem.gov.in/landing/gem_seller_id
// — <form id="step1" method="post"> with a single "gemSellerId" field,
// posting back to the same URL) and reads the rendered response: an
// invalid ID re-renders the page with the "Please Enter valid GeM Seller
// ID" warning; anything else means GeM accepted it.
const GEM_SELLER_LOOKUP_URL = 'https://gem.gov.in/landing/gem_seller_id/';
const GEM_INVALID_MESSAGE = 'Please Enter valid GeM Seller ID';

exports.verifyGemSellerId = async (req, res) => {
  try {
    const gemSellerId = (req.body.gemSellerId || '').trim();
    if (!gemSellerId) return res.status(400).json({ message: 'Enter a GeM Seller ID first' });

    let html;
    try {
      const response = await fetch(GEM_SELLER_LOOKUP_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
        body: `gemSellerId=${encodeURIComponent(gemSellerId)}`,
      });
      html = await response.text();
    } catch {
      return res.status(502).json({ message: 'Could not reach the GeM portal right now — try again in a moment' });
    }

    const verified = !html.includes(GEM_INVALID_MESSAGE);
    const profile = await getOrCreateProfile(req.user.id);
    profile.companyInfo = { ...(profile.companyInfo || {}), gemSellerId };
    profile.gemSellerIdVerified = verified;
    await profile.save();

    if (!verified) return res.status(400).json({ message: 'Please enter a valid GeM Seller ID' });

    const full = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: profileInclude });
    res.status(200).json(serialize(full));
  } catch (error) {
    res.status(500).json({ message: 'GeM Seller ID verification failed', error: error.message });
  }
};

const BANK_ACCOUNT_REGEX = /^[A-Za-z0-9]{6,40}$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

// @route POST /api/partner-profile/verify-bank-account   JSON body { bankAccount, ifsc, name? }
// Cashfree's synchronous Bank Account Verification — confirms the account
// number/IFSC pair is real and returns the bank's own name-on-record, so
// the Bank Accounts panel (Bank & Payment Details step) can flag a mismatch
// before payments ever get sent to the wrong account. Stateless: this just
// proxies Cashfree and hands the raw result back — the caller decides what
// to do with it (BankingStep folds it into the account entry it's
// creating/editing before saving that to bankDetails as usual).
exports.verifyBankAccount = async (req, res) => {
  try {
    const bankAccount = (req.body.bankAccount || '').trim();
    const ifsc = (req.body.ifsc || '').trim().toUpperCase();
    const name = (req.body.name || '').trim();

    if (!BANK_ACCOUNT_REGEX.test(bankAccount)) return res.status(400).json({ message: 'Enter a valid account number (6-40 characters)' });
    if (!IFSC_REGEX.test(ifsc)) return res.status(400).json({ message: 'Enter a valid 11-character IFSC code' });

    const result = await cashfreeRequest('POST', '/bank-account/sync', {
      body: { bank_account: bankAccount, ifsc, ...(name ? { name } : {}) },
    });
    if (result.account_status !== 'VALID') {
      return res.status(400).json({ message: `Bank account could not be verified (${result.account_status_code || result.account_status})`, verificationData: result });
    }
    res.status(200).json({ verified: true, verificationData: result });
  } catch (error) {
    res.status(error.status >= 400 && error.status < 500 ? 400 : 500).json({ message: error.cashfree?.message || error.message || 'Bank account verification failed' });
  }
};

// ----- DigiLocker: optional alternative to manually uploading a PAN in the
// Tax & Government Registration checklist -----
// Cashfree's DigiLocker product only covers AADHAAR/PAN/DRIVING_LICENSE
// (not GSTIN/CIN/MSME/IEC/TAN — those stay upload-only), and even for PAN
// it returns structured fields only, never a downloadable certificate file
// — so this fills in the PAN row's registration number, not its document.
// Reuses PartnerProfile's digilockerVerificationId/digilockerReferenceId
// columns (left over from an earlier, now-removed Aadhaar-via-DigiLocker
// attempt on the Contact step) since only one DigiLocker session is ever
// in flight per profile at a time.

// @route POST /api/partner-profile/digilocker/start
// Creates a 10-minute DigiLocker consent URL scoped to PAN only.
exports.startTaxDigilocker = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    const verificationId = `dgl-${req.user.id}-${Date.now()}`.slice(0, 50);
    const result = await cashfreeRequest('POST', '/digilocker', {
      body: {
        verification_id: verificationId,
        document_requested: ['PAN'],
        redirect_url: `${process.env.FRONTEND_URL}/setup-profile`,
        user_flow: 'signin',
      },
    });
    profile.digilockerVerificationId = verificationId;
    profile.digilockerReferenceId = String(result.reference_id);
    await profile.save();
    res.status(200).json({ url: result.url });
  } catch (error) {
    res.status(error.status === 400 ? 400 : 500).json({ message: error.cashfree?.message || error.message || 'Could not start DigiLocker verification' });
  }
};

// @route GET /api/partner-profile/digilocker/status
// Polled by the frontend after the DigiLocker tab is opened. Once
// AUTHENTICATED, immediately fetches the PAN document and folds it into
// the Tax step's mandatory PAN row — the same place a manual upload lands.
exports.getTaxDigilockerStatus = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    if (!profile.digilockerVerificationId) return res.status(400).json({ message: 'No DigiLocker session in progress' });

    const statusResult = await cashfreeRequest('GET', '/digilocker', { query: { verification_id: profile.digilockerVerificationId } });
    if (statusResult.status !== 'AUTHENTICATED') return res.status(200).json({ status: statusResult.status });

    const doc = await cashfreeRequest('GET', '/digilocker/document/PAN', {
      query: { reference_id: profile.digilockerReferenceId, verification_id: profile.digilockerVerificationId },
    });
    if (doc.status !== 'SUCCESS' || !doc.pan) {
      return res.status(200).json({ status: 'PAN_UNAVAILABLE', message: "PAN wasn't among the documents shared" });
    }

    const [reg] = await PartnerTaxRegistration.findOrCreate({ where: { profileId: profile.id, registrationType: 'PAN' }, defaults: { profileId: profile.id, registrationType: 'PAN' } });
    reg.registrationNumber = doc.pan;
    reg.issuingAuthority = 'Income Tax Department (via DigiLocker)';
    await reg.save();

    profile.digilockerVerificationId = null;
    profile.digilockerReferenceId = null;
    await profile.save();

    res.status(200).json({ status: 'SUCCESS', taxRegistration: reg });
  } catch (error) {
    res.status(error.status === 400 ? 400 : 500).json({ message: error.cashfree?.message || error.message || 'Could not check DigiLocker status' });
  }
};

// ----- OTP verification for the typed email/mobile (placeholder — no real dispatch yet) -----

// Fixed for now, per how this was asked for ("as of now... set the
// default otp is 123456") — swap for a real SMS/email OTP provider later
// without touching the endpoints themselves, just this constant.
const PLACEHOLDER_OTP = '123456';

// @route POST /api/partner-profile/send-otp   { type: 'email' | 'mobile' }
// No actual SMS/email is sent yet — this just confirms there's something
// to verify (the field has a value) so the frontend can show the OTP
// input. The "sent" code is always PLACEHOLDER_OTP.
exports.sendOtp = async (req, res) => {
  try {
    const { type } = req.body;
    if (!['email', 'mobile'].includes(type)) {
      return res.status(400).json({ message: 'type must be email or mobile' });
    }
    const profile = await getOrCreateProfile(req.user.id);
    const primary = await PartnerContact.findOne({ where: { profileId: profile.id, isPrimary: true } });
    const value = type === 'email' ? primary?.email : primary?.mobile;
    if (!value) {
      return res.status(400).json({ message: `Enter and save a ${type} first` });
    }
    res.status(200).json({ message: `Verification code sent to your ${type}.` });
  } catch (error) {
    res.status(500).json({ message: 'Could not send verification code', error: error.message });
  }
};

// @route POST /api/partner-profile/verify-otp   { type: 'email' | 'mobile', otp }
exports.verifyOtp = async (req, res) => {
  try {
    const { type, otp } = req.body;
    if (!['email', 'mobile'].includes(type)) {
      return res.status(400).json({ message: 'type must be email or mobile' });
    }
    if (otp !== PLACEHOLDER_OTP) {
      return res.status(400).json({ message: 'Incorrect verification code' });
    }
    const profile = await getOrCreateProfile(req.user.id);
    const primary = await PartnerContact.findOne({ where: { profileId: profile.id, isPrimary: true } });
    if (!primary) return res.status(400).json({ message: 'No contact to verify yet' });

    primary[type === 'email' ? 'emailVerified' : 'mobileVerified'] = true;
    await primary.save();

    res.status(200).json({ contact: primary });
  } catch (error) {
    res.status(500).json({ message: 'Could not verify code', error: error.message });
  }
};

// @route POST /api/partner-profile/submit   { confirmedAccurate }
exports.submitProfile = async (req, res) => {
  try {
    const profile = await getOrCreateProfile(req.user.id);
    profile.confirmedAccurate = !!req.body.confirmedAccurate;
    profile.submitted = true;
    profile.submittedAt = new Date();
    await profile.save();

    await User.update({ profileSubmitted: true }, { where: { id: req.user.id } });

    const full = await PartnerProfile.findOne({ where: { userId: req.user.id }, include: profileInclude });
    res.status(200).json(serialize(full));
  } catch (error) {
    res.status(500).json({ message: 'Failed to submit profile', error: error.message });
  }
};
