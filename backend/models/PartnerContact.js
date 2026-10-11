// Repeatable "Additional Contact Persons" under a PartnerProfile (see
// SETUP_PROFILE.txt Step 1) — every field optional per the testing
// instruction; `isPrimary` marks the one that came from the wizard's own
// "Primary Contact" block (still just a row here, not a separate table).
module.exports = (sequelize, DataTypes) => {
  const PartnerContact = sequelize.define('PartnerContact', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    profileId: { type: DataTypes.INTEGER, allowNull: false, field: 'profile_id' },
    isPrimary: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_primary' },
    name: { type: DataTypes.STRING, allowNull: true },
    // Split out alongside `name` (kept combined for anywhere else that
    // just reads contact.name, e.g. ReviewStep) — auto-filled from PAN
    // 360's first_name/last_name, editable like any other field otherwise.
    firstName: { type: DataTypes.STRING, allowNull: true, field: 'first_name' },
    lastName: { type: DataTypes.STRING, allowNull: true, field: 'last_name' },
    designation: { type: DataTypes.STRING, allowNull: true },
    department: { type: DataTypes.STRING, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true },
    mobile: { type: DataTypes.STRING, allowNull: true },
    altMobile: { type: DataTypes.STRING, allowNull: true, field: 'alt_mobile' },
    whatsapp: { type: DataTypes.STRING, allowNull: true },
    landline: { type: DataTypes.STRING, allowNull: true },
    photoUrl: { type: DataTypes.STRING, allowNull: true, field: 'photo_url' },
    // KYC identifiers for the primary contact, collected under the User
    // Verification step (see ContactStep.tsx) — 12-digit Aadhaar and
    // 10-character PAN, validated in partnerProfileController.js.
    aadharNumber: { type: DataTypes.STRING, allowNull: true, field: 'aadhar_number' },
    panNumber: { type: DataTypes.STRING, allowNull: true, field: 'pan_number' },
    // Auto-filled from Cashfree Smart OCR, never hand-typed — see
    // ocrPan/ocrAadhaar in partnerProfileController.js.
    dob: { type: DataTypes.STRING, allowNull: true },
    gender: { type: DataTypes.STRING, allowNull: true },
    fatherName: { type: DataTypes.STRING, allowNull: true, field: 'father_name' },
    address: { type: DataTypes.TEXT, allowNull: true },
    panVerified: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'pan_verified' },
    aadharVerified: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'aadhar_verified' },
    // The uploaded card images themselves (/uploads/...), stored the same
    // way as every other Setup Profile document (logo, certificates, tax
    // registrations) — not just forwarded to Cashfree and discarded.
    panCardUrl: { type: DataTypes.STRING, allowNull: true, field: 'pan_card_url' },
    aadharCardUrl: { type: DataTypes.STRING, allowNull: true, field: 'aadhar_card_url' },
    // PAN 360's masked email/mobile (e.g. "a*c@gmail.com", "99XXXXXX99") —
    // kept so the frontend can require the user's typed email/mobile to
    // actually match the pattern Cashfree already confirmed for this PAN,
    // rather than trusting free-text entry.
    // PAN 360's "type" field, e.g. "Individual or Person" — captured so the
    // verified badge can show it, and checked server-side (see ocrPan) to
    // reject business/trust PANs for what must be a person's KYC.
    panType: { type: DataTypes.STRING, allowNull: true, field: 'pan_type' },
    maskedEmail: { type: DataTypes.STRING, allowNull: true, field: 'masked_email' },
    maskedMobile: { type: DataTypes.STRING, allowNull: true, field: 'masked_mobile' },
    // OTP verification for the typed email/mobile themselves (separate
    // from panVerified/aadharVerified, which are about the documents) —
    // see sendOtp/verifyOtp in partnerProfileController.js. Placeholder:
    // the OTP is always "123456" for now, no real SMS/email dispatch yet.
    emailVerified: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'email_verified' },
    mobileVerified: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'mobile_verified' },
    // Full raw Cashfree Smart OCR response for each uploaded document
    // (document_fields, quality_checks, fraud_checks, verification_details
    // — see verifyDocumentOcr in partnerProfileController.js) — a JSON
    // blob rather than a column each, same pattern as PartnerProfile's
    // companyInfo/etc., so the full verification summary survives a
    // reload without a sprawling column list.
    panVerificationData: { type: DataTypes.JSON, allowNull: true, field: 'pan_verification_data' },
    aadharVerificationData: { type: DataTypes.JSON, allowNull: true, field: 'aadhar_verification_data' },
    contactType: {
      type: DataTypes.ENUM('primary', 'sales', 'technical', 'finance', 'support', 'management'),
      allowNull: true,
      defaultValue: 'primary',
      field: 'contact_type'
    },
    // Comma-separated subset of ['Email','Phone','WhatsApp','SMS'].
    communicationPreferences: { type: DataTypes.STRING, allowNull: true, field: 'communication_preferences' }
  }, {
    tableName: 'partner_contacts',
    timestamps: true
  });

  return PartnerContact;
};
