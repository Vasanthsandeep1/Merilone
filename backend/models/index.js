const { Sequelize, DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.User = require('./User')(sequelize, DataTypes);

// ----- OEM/Reseller Setup Profile (see SETUP_PROFILE.txt) -----
db.PartnerProfile = require('./PartnerProfile')(sequelize, DataTypes);
db.PartnerContact = require('./PartnerContact')(sequelize, DataTypes);
db.PartnerLocation = require('./PartnerLocation')(sequelize, DataTypes);
db.PartnerTaxRegistration = require('./PartnerTaxRegistration')(sequelize, DataTypes);
db.PartnerCertificate = require('./PartnerCertificate')(sequelize, DataTypes);
// Org-scoped staff logins (Sales/Zonal Manager/FLSP) under a partner org,
// and that org's shareable staff-invite link — see StaffUser.js.
db.StaffUser = require('./StaffUser')(sequelize, DataTypes);
db.OrgInviteLink = require('./OrgInviteLink')(sequelize, DataTypes);
db.ProcessDecodeRequest = require('./ProcessDecodeRequest')(sequelize, DataTypes);
db.CompanyCategory = require('./CompanyCategory')(sequelize, DataTypes);
db.CompanySubCategory = require('./CompanySubCategory')(sequelize, DataTypes);
db.ProductMasterItem = require('./ProductMasterItem')(sequelize, DataTypes);
db.PartnerProductSelection = require('./PartnerProductSelection')(sequelize, DataTypes);

// ----- Tenders (read-only mirror of the tender-automation system's DB —
// see backend/models/GemTender.js for why) -----
db.GemTender = require('./GemTender')(sequelize, DataTypes);
db.GemTenderDoc = require('./GemTenderDoc')(sequelize, DataTypes);
db.OpenTenderDetail = require('./OpenTenderDetail')(sequelize, DataTypes);
db.Contract = require('./Contract')(sequelize, DataTypes);
db.Incident = require('./Incident')(sequelize, DataTypes);
db.SupportTicket = require('./SupportTicket')(sequelize, DataTypes);
db.Distributor = require('./Distributor')(sequelize, DataTypes);
// Dealer Management > Best Reseller Selection — see ResellerCandidate.js.
db.ResellerCandidate = require('./ResellerCandidate')(sequelize, DataTypes);
db.ResellerCandidateContract = require('./ResellerCandidateContract')(sequelize, DataTypes);
db.ResellerSelection = require('./ResellerSelection')(sequelize, DataTypes);
db.ResellerCandidate.hasMany(db.ResellerCandidateContract, { foreignKey: 'resellerCandidateId', as: 'contracts' });
db.ResellerCandidateContract.belongsTo(db.ResellerCandidate, { foreignKey: 'resellerCandidateId', as: 'candidate' });
db.ResellerSelection.belongsTo(db.ResellerCandidate, { foreignKey: 'resellerCandidateId', as: 'candidate' });
db.TenderProcessingResult = require('./TenderProcessingResult')(sequelize, DataTypes);
db.TenderSummary = require('./TenderSummary')(sequelize, DataTypes);
db.UserLoginHistory = require('./UserLoginHistory')(sequelize, DataTypes);
db.UserSession = require('./UserSession')(sequelize, DataTypes);

// Per-partner tender interaction state — lives in our own schema (not
// migrated), see model files for why this can't just be columns on the
// shared gem_tenders table.
db.TenderPartnerState = require('./TenderPartnerState')(sequelize, DataTypes);
db.TenderStatusEntry = require('./TenderStatusEntry')(sequelize, DataTypes);
db.TenderProductSelection = require('./TenderProductSelection')(sequelize, DataTypes);
db.ParticipatedTenderNote = require('./ParticipatedTenderNote')(sequelize, DataTypes);
db.TenderTrackerOverride = require('./TenderTrackerOverride')(sequelize, DataTypes);
db.TenderTrackerEntry = require('./TenderTrackerEntry')(sequelize, DataTypes);
db.LibraryItem = require('./LibraryItem')(sequelize, DataTypes);
db.RepresentationTracking = require('./RepresentationTracking')(sequelize, DataTypes);
db.ContractTracking = require('./ContractTracking')(sequelize, DataTypes);
db.LetterFolder = require('./LetterFolder')(sequelize, DataTypes);
db.LetterDocument = require('./LetterDocument')(sequelize, DataTypes);
db.AgreementTracking = require('./AgreementTracking')(sequelize, DataTypes);
db.EmdRecord = require('./EmdRecord')(sequelize, DataTypes);
db.DistributorMaster = require('./DistributorMaster')(sequelize, DataTypes);
db.DistributorMapping = require('./DistributorMapping')(sequelize, DataTypes);
db.DistributorSelection = require('./DistributorSelection')(sequelize, DataTypes);
db.AiChatSession = require('./AiChatSession')(sequelize, DataTypes);
db.QueryTicket = require('./QueryTicket')(sequelize, DataTypes);
db.TaskItem = require('./TaskItem')(sequelize, DataTypes);

// ----- Tender Hub / Workspace (see WorkspaceDepartment.js for why these are
// per-partner rather than the original's shared internal-staff tables) -----
db.WorkspaceDepartment = require('./WorkspaceDepartment')(sequelize, DataTypes);
db.WorkspaceTask = require('./WorkspaceTask')(sequelize, DataTypes);
db.WorkspaceDeadline = require('./WorkspaceDeadline')(sequelize, DataTypes);
db.WorkspaceDocument = require('./WorkspaceDocument')(sequelize, DataTypes);
db.WorkspaceMyDoc = require('./WorkspaceMyDoc')(sequelize, DataTypes);
db.WorkspaceDocPrepSession = require('./WorkspaceDocPrepSession')(sequelize, DataTypes);
db.DocPrepAnnexure = require('./DocPrepAnnexure')(sequelize, DataTypes);
db.DocPrepFieldMemory = require('./DocPrepFieldMemory')(sequelize, DataTypes);
db.DocPrepChecklistRow = require('./DocPrepChecklistRow')(sequelize, DataTypes);

// ----- Dealer Management -----
db.PartnerDistributor = require('./PartnerDistributor')(sequelize, DataTypes);
db.PartnerDivisionProduct = require('./PartnerDivisionProduct')(sequelize, DataTypes);
db.PartnerDivisionDocument = require('./PartnerDivisionDocument')(sequelize, DataTypes);
db.RateContract = require('./RateContract')(sequelize, DataTypes);
db.Liaison = require('./Liaison')(sequelize, DataTypes);
db.LiaisonInteraction = require('./LiaisonInteraction')(sequelize, DataTypes);
db.LiaisonPayoutRequest = require('./LiaisonPayoutRequest')(sequelize, DataTypes);
db.Liaison.hasMany(db.LiaisonPayoutRequest, { foreignKey: 'liaisonId', as: 'payoutRequests', onDelete: 'CASCADE' });
db.LiaisonPayoutRequest.belongsTo(db.Liaison, { foreignKey: 'liaisonId', as: 'liaison' });
// Cross-tenant Authorization Request workflow (reseller -> OEM) — see
// DealerAuthRequest.js. Replaces the earlier single-tenant "generate my own
// letter" version of this feature.
db.DealerAuthRequest = require('./DealerAuthRequest')(sequelize, DataTypes);
db.DealerAuthRequestItem = require('./DealerAuthRequestItem')(sequelize, DataTypes);
db.DealerAuthRequestDocument = require('./DealerAuthRequestDocument')(sequelize, DataTypes);
db.Notification = require('./Notification')(sequelize, DataTypes);
db.DealerAuthRequest.belongsTo(db.User, { foreignKey: 'fromUserId', as: 'fromUser' });
db.DealerAuthRequest.belongsTo(db.User, { foreignKey: 'toUserId', as: 'toUser' });
db.DealerAuthRequest.hasMany(db.DealerAuthRequestItem, { foreignKey: 'dealerAuthRequestId', as: 'items', onDelete: 'CASCADE' });
db.DealerAuthRequestItem.belongsTo(db.DealerAuthRequest, { foreignKey: 'dealerAuthRequestId', as: 'request' });
db.DealerAuthRequestItem.belongsTo(db.CompanyCategory, { foreignKey: 'categoryId', as: 'category' });
db.DealerAuthRequestItem.belongsTo(db.CompanySubCategory, { foreignKey: 'subCategoryId', as: 'subCategory' });
db.DealerAuthRequestItem.belongsTo(db.ProductMasterItem, { foreignKey: 'productId', as: 'product' });
db.DealerAuthRequest.hasMany(db.DealerAuthRequestDocument, { foreignKey: 'dealerAuthRequestId', as: 'documents', onDelete: 'CASCADE' });
db.DealerAuthRequestDocument.belongsTo(db.DealerAuthRequest, { foreignKey: 'dealerAuthRequestId', as: 'request' });

// Product Management > Our Products (reseller-only) — see ResellerProduct.js.
db.ResellerProduct = require('./ResellerProduct')(sequelize, DataTypes);
db.ResellerProduct.belongsTo(db.DealerAuthRequest, { foreignKey: 'dealerAuthRequestId', as: 'authRequest' });
db.ResellerProduct.belongsTo(db.DealerAuthRequestItem, { foreignKey: 'dealerAuthRequestItemId', as: 'authRequestItem' });

db.User.hasOne(db.PartnerProfile, { foreignKey: 'userId', as: 'partnerProfile' });
db.PartnerProfile.belongsTo(db.User, { foreignKey: 'userId', as: 'user' });

db.PartnerProfile.hasMany(db.StaffUser, { foreignKey: 'partnerProfileId', as: 'staffUsers', onDelete: 'CASCADE' });
db.StaffUser.belongsTo(db.PartnerProfile, { foreignKey: 'partnerProfileId', as: 'partnerProfile' });
db.PartnerProfile.hasOne(db.OrgInviteLink, { foreignKey: 'partnerProfileId', as: 'inviteLink', onDelete: 'CASCADE' });
db.OrgInviteLink.belongsTo(db.PartnerProfile, { foreignKey: 'partnerProfileId', as: 'partnerProfile' });

db.PartnerProfile.hasMany(db.PartnerContact, { foreignKey: 'profileId', as: 'contacts', onDelete: 'CASCADE' });
db.PartnerContact.belongsTo(db.PartnerProfile, { foreignKey: 'profileId', as: 'profile' });

db.PartnerProfile.hasMany(db.PartnerLocation, { foreignKey: 'profileId', as: 'locations', onDelete: 'CASCADE' });
db.PartnerLocation.belongsTo(db.PartnerProfile, { foreignKey: 'profileId', as: 'profile' });

db.PartnerProfile.hasMany(db.PartnerTaxRegistration, { foreignKey: 'profileId', as: 'taxRegistrations', onDelete: 'CASCADE' });
db.PartnerTaxRegistration.belongsTo(db.PartnerProfile, { foreignKey: 'profileId', as: 'profile' });

db.PartnerProfile.hasMany(db.PartnerCertificate, { foreignKey: 'profileId', as: 'certificates', onDelete: 'CASCADE' });
db.PartnerCertificate.belongsTo(db.PartnerProfile, { foreignKey: 'profileId', as: 'profile' });

db.CompanyCategory.hasMany(db.CompanySubCategory, { foreignKey: 'categoryId', as: 'subCategories' });
db.CompanySubCategory.belongsTo(db.CompanyCategory, { foreignKey: 'categoryId', as: 'category' });

db.CompanySubCategory.hasMany(db.ProductMasterItem, { foreignKey: 'subCategoryId', as: 'products' });
db.ProductMasterItem.belongsTo(db.CompanySubCategory, { foreignKey: 'subCategoryId', as: 'subCategory' });

db.PartnerProfile.hasMany(db.PartnerProductSelection, { foreignKey: 'profileId', as: 'productSelections', onDelete: 'CASCADE' });
db.PartnerProductSelection.belongsTo(db.PartnerProfile, { foreignKey: 'profileId', as: 'profile' });
db.PartnerProductSelection.belongsTo(db.ProductMasterItem, { foreignKey: 'productId', as: 'product' });
db.PartnerProductSelection.belongsTo(db.CompanyCategory, { foreignKey: 'categoryId', as: 'category' });
db.PartnerProductSelection.belongsTo(db.CompanySubCategory, { foreignKey: 'subCategoryId', as: 'subCategory' });

// ----- Sales & Invoices > Our Clients (see Client.js) -----
db.Client = require('./Client')(sequelize, DataTypes);
db.ClientShippingDetail = require('./ClientShippingDetail')(sequelize, DataTypes);
db.ClientContactLink = require('./ClientContactLink')(sequelize, DataTypes);
db.ClientAttachment = require('./ClientAttachment')(sequelize, DataTypes);

db.Client.hasMany(db.ClientShippingDetail, { foreignKey: 'clientId', as: 'shippingDetails', onDelete: 'CASCADE' });
db.ClientShippingDetail.belongsTo(db.Client, { foreignKey: 'clientId', as: 'client' });

db.Client.hasMany(db.ClientContactLink, { foreignKey: 'clientId', as: 'contactLinks', onDelete: 'CASCADE' });
db.ClientContactLink.belongsTo(db.Client, { foreignKey: 'clientId', as: 'client' });
db.ClientContactLink.belongsTo(db.PartnerContact, { foreignKey: 'partnerContactId', as: 'contact' });

db.Client.hasMany(db.ClientAttachment, { foreignKey: 'clientId', as: 'attachments', onDelete: 'CASCADE' });
db.ClientAttachment.belongsTo(db.Client, { foreignKey: 'clientId', as: 'client' });

db.Quotation = require('./Quotation')(sequelize, DataTypes);
db.Quotation.belongsTo(db.Client, { foreignKey: 'clientId', as: 'client' });
db.Client.hasMany(db.Quotation, { foreignKey: 'clientId', as: 'quotations' });
db.Quotation.belongsTo(db.Quotation, { foreignKey: 'linkedInvoiceId', as: 'linkedInvoice' });
db.Quotation.belongsTo(db.Quotation, { foreignKey: 'sourceQuotationId', as: 'sourceQuotation' });
// The next document raised from this one (Quotation -> its Sales Order,
// Sales Order -> its Invoice) — at most one each.
db.Quotation.hasOne(db.Quotation, { foreignKey: 'sourceQuotationId', as: 'nextDocument' });

db.Vendor = require('./Vendor')(sequelize, DataTypes);
db.VendorContactLink = require('./VendorContactLink')(sequelize, DataTypes);
db.VendorAttachment = require('./VendorAttachment')(sequelize, DataTypes);
db.Vendor.hasMany(db.VendorContactLink, { foreignKey: 'vendorId', as: 'contactLinks', onDelete: 'CASCADE' });
db.VendorContactLink.belongsTo(db.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
db.VendorContactLink.belongsTo(db.PartnerContact, { foreignKey: 'partnerContactId', as: 'contact' });
db.Vendor.hasMany(db.VendorAttachment, { foreignKey: 'vendorId', as: 'attachments', onDelete: 'CASCADE' });
db.VendorAttachment.belongsTo(db.Vendor, { foreignKey: 'vendorId', as: 'vendor' });

db.Purchase = require('./Purchase')(sequelize, DataTypes);
db.Purchase.belongsTo(db.Vendor, { foreignKey: 'vendorId', as: 'vendor' });
db.Vendor.hasMany(db.Purchase, { foreignKey: 'vendorId', as: 'purchases' });

db.PaymentReceipt = require('./PaymentReceipt')(sequelize, DataTypes);
db.PaymentAllocation = require('./PaymentAllocation')(sequelize, DataTypes);
db.PaymentReceipt.belongsTo(db.Client, { foreignKey: 'clientId', as: 'client' });
db.PaymentReceipt.belongsTo(db.Quotation, { foreignKey: 'salesOrderId', as: 'salesOrder' });
db.PaymentReceipt.hasMany(db.PaymentAllocation, { foreignKey: 'paymentReceiptId', as: 'allocations', onDelete: 'CASCADE' });
db.PaymentAllocation.belongsTo(db.PaymentReceipt, { foreignKey: 'paymentReceiptId', as: 'paymentReceipt' });
db.PaymentAllocation.belongsTo(db.Quotation, { foreignKey: 'invoiceId', as: 'invoice' });

// Late-payment fines / notices on overdue invoices (Pending Payments).
db.LatePaymentFine = require('./LatePaymentFine')(sequelize, DataTypes);
db.LatePaymentFine.belongsTo(db.Quotation, { foreignKey: 'invoiceId', as: 'invoice' });
db.LatePaymentFine.belongsTo(db.Client, { foreignKey: 'clientId', as: 'client' });

// Manually entered product cost prices (GP Tracker).
db.GpProductCost = require('./GpProductCost')(sequelize, DataTypes);

// Generated sales-target / incentive letters (Workdesk).
db.IncentiveLetter = require('./IncentiveLetter')(sequelize, DataTypes);

// Liquidated Damages terms/outcome per order (LD Tracker).
db.LdRecord = require('./LdRecord')(sequelize, DataTypes);

// Meril One mobile apps (Customer + Service Engineer).
require('./MerilOne')(sequelize, DataTypes, db);
// Service Management > Service Engineers (+ their states / districts).
Object.assign(db, require('./ServiceEngineer')(sequelize, DataTypes));
db.M1Booking.belongsTo(db.ServiceEngineer, { foreignKey: 'oemEngineerId', as: 'oemEngineer' });
// Service Management > Post Ads (the app's ad carousel).
db.M1Ad = require('./M1Ad')(sequelize, DataTypes);
// Sales & Invoices > Sales Targets (per sales person, per financial year).
db.SalesTarget = require('./SalesTarget')(sequelize, DataTypes);
// Target Management > Manage Target (yearly target sheet per person & division).
db.FlspTarget = require('./FlspTarget')(sequelize, DataTypes);
// OPI Management (Endo / Diagnostics order processing information).
db.Opi = require('./Opi')(sequelize, DataTypes);
// OPI Management: each department's field layout per organisation.
db.OpiFormat = require('./OpiFormat')(sequelize, DataTypes);

module.exports = db;
