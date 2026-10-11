// Meril One — the Customer and Service Engineer mobile apps (meril-one/).
// Anyone can sign up with their mobile number. A customer picks a background
// (home, hospital, lab, office, industry) which decides the services they
// see; a request goes to engineers who cover that area (city / pincode) and
// have that skill, and the first to accept gets the job.
//
// These tables are separate from the portal's users/partners on purpose:
// app users never get portal access (see middleware/m1Auth.js).
module.exports = (sequelize, DataTypes, db) => {
  const opts = (tableName, indexes = []) => ({ tableName, timestamps: true, underscored: true, indexes });

  const M1User = sequelize.define('M1User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    phone: { type: DataTypes.STRING(15), allowNull: false },
    role: { type: DataTypes.ENUM('customer', 'engineer'), allowNull: false },
    name: { type: DataTypes.STRING, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true },
    // Customer background — which catalogue they see.
    segment: { type: DataTypes.ENUM('home', 'hospital', 'lab', 'office', 'industry'), allowNull: true },
    orgName: { type: DataTypes.STRING, allowNull: true, field: 'org_name' },
    // B2G purchase lines already copied into My Products ("<quotation id>:<item name>"),
    // so each is added once and stays deleted if the customer removes it.
    b2gImported: { type: DataTypes.JSON, allowNull: true, field: 'b2g_imported' },
    address: { type: DataTypes.TEXT, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    pincode: { type: DataTypes.STRING(10), allowNull: true },
    // Engineer: what they fix and where.
    skills: { type: DataTypes.JSON, allowNull: true }, // category ids
    servicePincodes: { type: DataTypes.JSON, allowNull: true, field: 'service_pincodes' },
    experienceYears: { type: DataTypes.INTEGER, allowNull: true, field: 'experience_years' },
    // Engineer's public profile, shown to customers choosing an engineer.
    companyName: { type: DataTypes.STRING, allowNull: true, field: 'company_name' },
    about: { type: DataTypes.TEXT, allowNull: true },
    // Their visit charge per skill: { "<categoryId>": amount }. A skill with
    // no rate uses the service's standard price.
    rates: { type: DataTypes.JSON, allowNull: true },
    isAvailable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_available' },
    ratingSum: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'rating_sum' },
    ratingCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'rating_count' },
    profileComplete: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'profile_complete' },
    // Link to the B2G portal when sign-up used details found there by mobile
    // number: a client in a partner's client book, and/or a portal user.
    b2gClientId: { type: DataTypes.INTEGER, allowNull: true, field: 'b2g_client_id' },
    b2gUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'b2g_user_id' },
    // Engineer: their B2G Service Management record(s), copied at each login:
    // { ids, empIds, companies, areas: [{ state, districts }] }.
    b2gEngineer: { type: DataTypes.JSON, allowNull: true, field: 'b2g_engineer' },
  }, opts('m1_users', [{ unique: true, fields: ['phone', 'role'] }, { fields: ['role', 'city'] }]));

  const M1Otp = sequelize.define('M1Otp', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    phone: { type: DataTypes.STRING(15), allowNull: false },
    role: { type: DataTypes.ENUM('customer', 'engineer'), allowNull: false },
    codeHash: { type: DataTypes.STRING, allowNull: false, field: 'code_hash' },
    expiresAt: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  }, opts('m1_otps', [{ fields: ['phone', 'role'] }]));

  // A service category, shown to the backgrounds listed in `segments`.
  const M1Category = sequelize.define('M1Category', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    icon: { type: DataTypes.STRING, allowNull: false, defaultValue: 'construct' }, // Ionicons name
    color: { type: DataTypes.STRING(9), allowNull: false, defaultValue: '#2563EB' },
    segments: { type: DataTypes.JSON, allowNull: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'sort_order' },
  }, opts('m1_categories'));

  const M1Service = sequelize.define('M1Service', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    categoryId: { type: DataTypes.INTEGER, allowNull: false, field: 'category_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    // Visit/inspection charge shown up front; the engineer sets the final bill.
    price: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },
    durationMins: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 60, field: 'duration_mins' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
  }, opts('m1_services', [{ fields: ['category_id'] }]));

  const M1Booking = sequelize.define('M1Booking', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    bookingNo: { type: DataTypes.STRING, allowNull: false, field: 'booking_no' },
    customerId: { type: DataTypes.INTEGER, allowNull: false, field: 'customer_id' },
    engineerId: { type: DataTypes.INTEGER, allowNull: true, field: 'engineer_id' },
    // The engineer the customer picked. Only they see the request; if they
    // decline it is cleared and the request opens to every matching engineer.
    requestedEngineerId: { type: DataTypes.INTEGER, allowNull: true, field: 'requested_engineer_id' },
    // Optional: the customer may only describe the problem (issue) and let
    // the engineer decide the work. Category then comes from the product.
    serviceId: { type: DataTypes.INTEGER, allowNull: true, field: 'service_id' },
    categoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'category_id' },
    segment: { type: DataTypes.STRING(20), allowNull: true },
    issue: { type: DataTypes.TEXT, allowNull: true },
    equipment: { type: DataTypes.JSON, allowNull: true }, // { brand, model, serialNo }
    address: { type: DataTypes.TEXT, allowNull: false },
    city: { type: DataTypes.STRING, allowNull: false },
    pincode: { type: DataTypes.STRING(10), allowNull: false },
    contactName: { type: DataTypes.STRING, allowNull: true, field: 'contact_name' },
    contactPhone: { type: DataTypes.STRING(15), allowNull: true, field: 'contact_phone' },
    scheduledDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'scheduled_date' },
    slot: { type: DataTypes.STRING(20), allowNull: false },
    status: {
      type: DataTypes.ENUM('requested', 'accepted', 'on_the_way', 'in_progress', 'completed', 'cancelled'),
      allowNull: false, defaultValue: 'requested',
    },
    // Shown to the customer; the engineer enters it to start the job.
    startOtp: { type: DataTypes.STRING(4), allowNull: false, field: 'start_otp' },
    visitCharge: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, field: 'visit_charge' },
    finalAmount: { type: DataTypes.DECIMAL(10, 2), allowNull: true, field: 'final_amount' },
    partsUsed: { type: DataTypes.JSON, allowNull: true, field: 'parts_used' }, // [{ name, qty, price }]
    workNotes: { type: DataTypes.TEXT, allowNull: true, field: 'work_notes' },
    rating: { type: DataTypes.INTEGER, allowNull: true },
    review: { type: DataTypes.TEXT, allowNull: true },
    cancelReason: { type: DataTypes.STRING, allowNull: true, field: 'cancel_reason' },
    timeline: { type: DataTypes.JSON, allowNull: true }, // [{ status, at, note }]
    declinedBy: { type: DataTypes.JSON, allowNull: true, field: 'declined_by' }, // engineer ids
    // The engineer's latest request to move the visit (e.g. an earlier job ran
    // late): { fromDate, fromSlot, date, slot, reason, status: pending |
    // accepted | rejected, at, answeredAt }. The customer accepts or rejects.
    rescheduleRequest: { type: DataTypes.JSON, allowNull: true, field: 'reschedule_request' },
    // When the engineer marked "I've reached the spot" (shown on Track order).
    arrivedAt: { type: DataTypes.DATE, allowNull: true, field: 'arrived_at' },
    // Booked from My Products, and for that product's OEM: the OEM (B2G user)
    // and the OEM's service engineer the customer picked (service_engineers).
    productId: { type: DataTypes.INTEGER, allowNull: true, field: 'product_id' },
    // Every service picked for this visit: [{ id, name, price }]. serviceId
    // is the first of them (older bookings have just serviceId).
    services: { type: DataTypes.JSON, allowNull: true },
    // Photos of the problem the customer added: ["/uploads/m1-problems/…jpg"].
    photos: { type: DataTypes.JSON, allowNull: true },
    // Photos the engineer took after finishing the job ("/uploads/m1-work/…").
    workPhotos: { type: DataTypes.JSON, allowNull: true, field: 'work_photos' },
    oemUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'oem_user_id' },
    oemEngineerId: { type: DataTypes.INTEGER, allowNull: true, field: 'oem_engineer_id' },
  }, opts('m1_bookings', [{ unique: true, fields: ['booking_no'] }, { fields: ['customer_id'] }, { fields: ['engineer_id'] }, { fields: ['status', 'city'] }]));

  // "My Products" — equipment a customer owns (a hospital's analyzers, a
  // home's AC/TV…), saved once and picked when booking a service.
  const M1Product = sequelize.define('M1Product', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    customerId: { type: DataTypes.INTEGER, allowNull: false, field: 'customer_id' },
    // Either a basic category (m1_categories) or one the customer made
    // (m1_custom_categories) — never both.
    categoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'category_id' },
    customCategoryId: { type: DataTypes.INTEGER, allowNull: true, field: 'custom_category_id' },
    // The B2G OEM / seller behind this product (portal user id), when known —
    // set when imported from the customer's B2G purchases.
    oemUserId: { type: DataTypes.INTEGER, allowNull: true, field: 'oem_user_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    brand: { type: DataTypes.STRING, allowNull: true },
    model: { type: DataTypes.STRING, allowNull: true },
    serialNo: { type: DataTypes.STRING, allowNull: true, field: 'serial_no' },
    purchaseDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'purchase_date' },
    warrantyUntil: { type: DataTypes.DATEONLY, allowNull: true, field: 'warranty_until' },
    location: { type: DataTypes.STRING, allowNull: true }, // e.g. "Lab 2, 1st floor"
    notes: { type: DataTypes.TEXT, allowNull: true },
    // Photo of the product, stored in the row itself as a base64 data URI
    // ("data:image/jpeg;base64,…"), not as a file on disk.
    imageData: { type: DataTypes.TEXT('medium'), allowNull: true, field: 'image_data' },
  }, opts('m1_products', [{ fields: ['customer_id'] }]));

  // A product category the customer added themselves ("Add category"),
  // shown next to the basic ones in My Products. Private to that customer.
  const M1CustomCategory = sequelize.define('M1CustomCategory', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    customerId: { type: DataTypes.INTEGER, allowNull: false, field: 'customer_id' },
    name: { type: DataTypes.STRING, allowNull: false },
  }, opts('m1_custom_categories', [{ fields: ['customer_id'] }]));

  M1Category.hasMany(M1Service, { foreignKey: 'categoryId', as: 'services' });
  M1Service.belongsTo(M1Category, { foreignKey: 'categoryId', as: 'category' });
  M1Booking.belongsTo(M1Service, { foreignKey: 'serviceId', as: 'service' });
  M1Booking.belongsTo(M1Category, { foreignKey: 'categoryId', as: 'category' });
  M1Booking.belongsTo(M1User, { foreignKey: 'customerId', as: 'customer' });
  M1Booking.belongsTo(M1User, { foreignKey: 'engineerId', as: 'engineer' });
  M1Booking.belongsTo(M1User, { foreignKey: 'requestedEngineerId', as: 'requestedEngineer' });

  M1Product.belongsTo(M1Category, { foreignKey: 'categoryId', as: 'category' });
  M1Product.belongsTo(M1CustomCategory, { foreignKey: 'customCategoryId', as: 'customCategory' });

  // In-app notifications (the bell): e.g. "Engineer accepted your booking".
  const M1Notification = sequelize.define('M1Notification', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    bookingId: { type: DataTypes.INTEGER, allowNull: true, field: 'booking_id' },
    kind: { type: DataTypes.STRING(30), allowNull: false }, // accepted | arrived | started | completed | reschedule | released
    title: { type: DataTypes.STRING, allowNull: false },
    body: { type: DataTypes.STRING(500), allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true, field: 'read_at' },
  }, opts('m1_notifications', [{ fields: ['user_id', 'read_at'] }]));

  // Store > Get quote: a customer asks for a price on a product from the B2G
  // catalogue (View Profile > Products, partner_division_products). The
  // portal user who owns that product sees it under Service Management >
  // Quote Requests and answers it there.
  const M1QuoteRequest = sequelize.define('M1QuoteRequest', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    requestNo: { type: DataTypes.STRING(20), allowNull: false, field: 'request_no' },
    customerId: { type: DataTypes.INTEGER, allowNull: false, field: 'customer_id' },
    productId: { type: DataTypes.INTEGER, allowNull: false, field: 'product_id' },
    ownerUserId: { type: DataTypes.INTEGER, allowNull: false, field: 'owner_user_id' },
    // Snapshot, so the request still reads right if the product is edited / removed.
    productName: { type: DataTypes.STRING(300), allowNull: false, field: 'product_name' },
    productCode: { type: DataTypes.STRING(100), allowNull: true, field: 'product_code' },
    quantity: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    message: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.ENUM('new', 'contacted', 'quoted', 'closed'), allowNull: false, defaultValue: 'new' },
    reply: { type: DataTypes.TEXT, allowNull: true }, // portal's note to the customer
  }, opts('m1_quote_requests', [{ fields: ['owner_user_id', 'status'] }, { fields: ['customer_id'] }]));
  M1QuoteRequest.belongsTo(M1User, { foreignKey: 'customerId', as: 'customer' });

  Object.assign(db, { M1User, M1Otp, M1Category, M1Service, M1Booking, M1Product, M1CustomCategory, M1Notification, M1QuoteRequest });
};
