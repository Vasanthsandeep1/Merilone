// Slimmed down for the new product's actual login: an OEM/Reseller partner
// account (see PartnerRegisterPage.tsx / authController.js's
// registerPartner). All of the old MerilOne ERP's user types/fields
// (customer, employee, distributor, freelancer, HR/finance/sales columns,
// etc.) were dropped along with their own tables in this cleanup.
module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true }
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false
    },
    // E.164-ish, always +91 for now (see PartnerRegisterPage.tsx's fixed
    // country-code prefix) — nullable at the DB level for the same
    // pre-existing-rows reason as organisationType below.
    mobile: {
      type: DataTypes.STRING,
      allowNull: true
    },
    userType: {
      type: DataTypes.ENUM('partner'),
      allowNull: false,
      defaultValue: 'partner',
      field: 'user_type'
    },
    // Which pricing card (see components/blocks/pricing-section.tsx) the
    // registration started from — decides whether a logged-in partner lands
    // on /oem/:name/:id or /reseller/:name/:id (see defaultRoute.ts).
    partnerType: {
      type: DataTypes.ENUM('oem', 'reseller'),
      allowNull: false,
      field: 'partner_type'
    },
    // Legal/business structure the partner registers under — collected as
    // the second Pre-requisites field alongside partnerType, before the
    // rest of the registration form (see config/organisationTypes.js).
    // Nullable at the DB level (existing accounts predate this field and an
    // ALTER TABLE ... NOT NULL would fail against their rows) — required on
    // the way in via registerPartner's own validation instead.
    organisationType: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'organisation_type'
    },
    // Which industry vertical(s) the company operates in — a
    // JSON-stringified string[] since a company can pick more than one (or
    // type a custom one via the registration form's "Other" field), which a
    // plain ENUM/STRING column can't represent.
    companyTypes: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'company_types'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      field: 'is_active'
    },
    // The Razorpay Subscription behind the ₹499+GST yearly registration
    // fee (see controllers/subscriptionController.js) — registerPartner
    // requires this and confirms its status with Razorpay before creating
    // the account at all, so every row here already has one.
    razorpaySubscriptionId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'razorpay_subscription_id'
    },
    // Denormalized off PartnerProfile.submitted — lets defaultRoute.ts decide
    // /setup-profile vs the real /oem or /reseller portal right after login
    // without an extra round trip just to check this one flag.
    profileSubmitted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      field: 'profile_submitted'
    }
  }, {
    tableName: 'users',
    timestamps: true
  });

  return User;
};
