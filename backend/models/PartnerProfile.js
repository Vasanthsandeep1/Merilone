// One row per partner (OEM/Reseller) User — the OEM/Reseller Setup Profile
// wizard (see SETUP_PROFILE.txt). Single-instance sections (company info,
// addresses, bank details, business/additional info) are stored as JSON
// blobs here rather than one column each — the spec has ~40 loosely-related
// scalar fields per section and every one of them is optional (per explicit
// testing instruction), so a flexible JSON blob per section avoids a
// sprawling column list while still keeping each section independently
// PATCH-able. Repeatable sections (contacts, locations, tax registrations,
// certificates, product selections) get their own tables below instead,
// since those genuinely need add/edit/delete-one-of-many semantics.
module.exports = (sequelize, DataTypes) => {
  const PartnerProfile = sequelize.define('PartnerProfile', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, unique: true, field: 'user_id' },

    // ----- Step: Company Information -----
    // legalName, tradeName, logoUrl, shortName, description, dateOfRegistration,
    // employeeCount, website, officialEmail, altEmail, officialPhone,
    // altPhone, registrationNumber, cin, pan, gstin, tin,
    // principalPlaceAddress, stateJurisdiction, centreJurisdiction,
    // constitutionOfBusiness, natureOfBusinessActivity — the last five are
    // GSTIN Verify fields (see applyGstinResult in partnerProfileController.js).
    // udyamId is also auto-fetched from the PAN (see fetchUdyamForPan).
    // dpiitRegistered, msmeRegistered are plain yes/no booleans.
    companyInfo: { type: DataTypes.JSON, allowNull: true, field: 'company_info' },

    // ----- Step: Registered & Business Address -----
    // { line1, line2, country, state, city, district, pincode, landmark }
    registeredAddress: { type: DataTypes.JSON, allowNull: true, field: 'registered_address' },
    sameAsRegistered: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true, field: 'same_as_registered' },
    corporateAddress: { type: DataTypes.JSON, allowNull: true, field: 'corporate_address' },

    // ----- Step: Bank & Payment Details -----
    // { accountHolderName, bankName, branchName, accountNumber, ifsc, swift,
    //   accountType, bankAddress, preferredPaymentMethod, paymentTerms,
    //   currency, creditPeriod, upiId }
    bankDetails: { type: DataTypes.JSON, allowNull: true, field: 'bank_details' },

    // ----- Step: Business / OEM Details -----
    // { manufacturerStatus, brandName, productBrands, manufacturingTypes[],
    //   manufacturingLocations, distributionNetwork, authorizedDistributorStatus,
    //   authorizedDealerNetwork, serviceCenters, technicalSupportAvailability,
    //   warrantySupport, amcSupport, productSupportContact, salesSupportContact,
    //   technicalSupportContact }
    businessDetails: { type: DataTypes.JSON, allowNull: true, field: 'business_details' },

    // ----- Step: Additional Business Information -----
    // { missionAbout, keyProducts, keyMarkets, countriesServed, branchCount,
    //   warehouseCount, annualTurnoverRange, customerSegments[], businessModel }
    additionalInfo: { type: DataTypes.JSON, allowNull: true, field: 'additional_info' },

    // Which wizard step the partner last left off on — drives "Continue
    // Setting Up Your Profile" on return (see SETUP_PROFILE.txt section 21).
    currentStep: { type: DataTypes.STRING, allowNull: true, defaultValue: 'welcome', field: 'current_step' },
    confirmedAccurate: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'confirmed_accurate' },
    submitted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    submittedAt: { type: DataTypes.DATE, allowNull: true, field: 'submitted_at' },

    // In-flight DigiLocker verification session for the primary contact
    // (see controllers/partnerProfileController.js's startDigilocker /
    // getDigilockerStatus) — one session per profile at a time; a new
    // "Verify with DigiLocker" click just overwrites these.
    digilockerVerificationId: { type: DataTypes.STRING, allowNull: true, field: 'digilocker_verification_id' },
    digilockerReferenceId: { type: DataTypes.STRING, allowNull: true, field: 'digilocker_reference_id' },

    // Company PAN card upload (Company Information step) — mirrors the
    // Primary Contact's PAN/Aadhaar flow: Smart OCR reads the uploaded PAN,
    // then Cashfree's PAN-to-GSTIN + GSTIN Verify APIs are chained to
    // auto-fill companyInfo.gstin/legalName/tradeName and registeredAddress
    // (see ocrCompanyPan in partnerProfileController.js).
    companyPanCardUrl: { type: DataTypes.STRING, allowNull: true, field: 'company_pan_card_url' },
    companyPanVerified: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'company_pan_verified' },
    companyPanVerificationData: { type: DataTypes.JSON, allowNull: true, field: 'company_pan_verification_data' },
    companyGstinVerificationData: { type: DataTypes.JSON, allowNull: true, field: 'company_gstin_verification_data' },

    // Corporate Identity Verification (Company Registration Number, i.e.
    // CIN) — same idea as the PAN/GSTIN flows above, via Cashfree's CIN
    // Verify API (see ocrCompanyCin in partnerProfileController.js).
    companyCinVerified: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'company_cin_verified' },
    companyCinVerificationData: { type: DataTypes.JSON, allowNull: true, field: 'company_cin_verification_data' },

    // GeM Seller ID verification — not a Cashfree API, GeM has none public;
    // instead we submit the same form the government's own seller-lookup
    // page (gem.gov.in/landing/gem_seller_id) uses and read its response
    // (see verifyGemSellerId in partnerProfileController.js).
    gemSellerIdVerified: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: false, field: 'gem_seller_id_verified' },

    // ----- Department Divisions (see config/departmentDivisions.js) -----
    // Which of Meril's divisions this partner operates under — declared once
    // during Setup Profile (Company Information step), then drives View
    // Profile's Products and Document Format sections (one set of each per
    // division declared here), plus the reusable DIVISION_LABEL chips used
    // across Dealer/Product Management. Array of division keys, e.g. ['diagno','endo'].
    departmentDivisions: { type: DataTypes.JSON, allowNull: true, field: 'department_divisions' },
    // When true, Document Format keeps one shared letterhead/signature/footer/
    // watermark set (division key '__common__') instead of one per division —
    // some partners' branding is identical company-wide, others differ by division.
    documentsShared: { type: DataTypes.BOOLEAN, allowNull: true, defaultValue: true, field: 'documents_shared' }
  }, {
    tableName: 'partner_profiles',
    timestamps: true
  });

  return PartnerProfile;
};
