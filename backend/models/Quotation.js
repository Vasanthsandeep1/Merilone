// Sales & Invoices > Quotations, Invoices, Proforma Invoice, Sales Order,
// Delivery Challan, AND Credit Note — all six share this exact table/model/
// controller/UI, distinguished only by `docType`. They are otherwise
// identical in every feature (create/upload/list/search/filter/PDF/email)
// but are separate record sets: a Credit Note never shows up in the
// Quotations list or its numbering sequence, and vice versa (see the
// docType-scoped queries and per-docType numbering in quotationController).
// `linkedInvoiceId`/`reason` are only ever populated for docType='credit_note'
// (a credit note must reference the real invoice it's crediting and state
// why) but live on the shared table rather than a separate one — a single
// nullable FK/column is simpler than a one-row side table for one doc type.
// A quotation either has source='created' (built with the in-app wizard,
// and rendered to a real PDF on demand via pdfkit — see
// quotationController.downloadPdf) or source='uploaded' (the partner
// already had a PDF/doc from elsewhere and just wants it tracked in the
// list — no fabricated line items for those, `items` stays null and
// "download" just serves the uploaded file).
module.exports = (sequelize, DataTypes) => {
  const Quotation = sequelize.define('Quotation', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, allowNull: false, field: 'user_id' },
    docType: { type: DataTypes.ENUM('quotation', 'invoice', 'proforma', 'sales_order', 'delivery_challan', 'credit_note'), allowNull: false, defaultValue: 'quotation', field: 'doc_type' },
    source: { type: DataTypes.ENUM('created', 'uploaded'), allowNull: false, defaultValue: 'created' },

    quotationNo: { type: DataTypes.STRING, allowNull: false, field: 'quotation_no' },
    poNumber: { type: DataTypes.STRING, allowNull: true, field: 'po_number' },
    // Customer's PO date — quoted on a Sales Order ("your PO no. X dated Y").
    poDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'po_date' },
    // The document this one was raised from, along the sales chain
    // Quotation -> Sales Order -> Invoice (see SOURCE_DOC_TYPE in
    // quotationController). Column name predates the Invoice step.
    // Validity for a quotation / invoice due date / Sales Order delivery date
    // all live in validTillDate (label depends on docType — see DOC_DUE_LABEL).
    sourceQuotationId: { type: DataTypes.INTEGER, allowNull: true, field: 'source_quotation_id' },
    title: { type: DataTypes.STRING, allowNull: false, defaultValue: 'Quotation' },
    subtitle: { type: DataTypes.STRING, allowNull: true },
    quotationDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'quotation_date' },
    validTillDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'valid_till_date' },
    logoPath: { type: DataTypes.STRING, allowNull: true, field: 'logo_path' },

    clientId: { type: DataTypes.INTEGER, allowNull: true, field: 'client_id' },
    linkedInvoiceId: { type: DataTypes.INTEGER, allowNull: true, field: 'linked_invoice_id' },
    reason: { type: DataTypes.STRING, allowNull: true },

    currency: { type: DataTypes.STRING, allowNull: false, defaultValue: 'INR' },

    shippingEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'shipping_enabled' },
    shippingFrom: { type: DataTypes.JSON, allowNull: true, field: 'shipping_from' },
    shippingTo: { type: DataTypes.JSON, allowNull: true, field: 'shipping_to' },

    // [{ name, hsn, gstRate, qty, unit, rate, amount, cgst, sgst, total, description }]
    items: { type: DataTypes.JSON, allowNull: true },
    discount: { type: DataTypes.JSON, allowNull: true }, // { type: 'flat'|'percent', value, amount }
    additionalCharges: { type: DataTypes.JSON, allowNull: true }, // [{ label, amount }]

    subtotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0 },
    cgstTotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'cgst_total' },
    sgstTotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'sgst_total' },
    grandTotal: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'grand_total' },
    totalQuantity: { type: DataTypes.DECIMAL(14, 2), allowNull: false, defaultValue: 0, field: 'total_quantity' },

    notes: { type: DataTypes.TEXT, allowNull: true },
    terms: { type: DataTypes.TEXT, allowNull: true },
    accentColor: { type: DataTypes.STRING, allowNull: false, defaultValue: '#1E4373', field: 'accent_color' },

    status: { type: DataTypes.ENUM('Draft', 'Sent', 'Accepted', 'Rejected'), allowNull: false, defaultValue: 'Draft' },
    // Set only by a successful email send (quotationController.emailQuotation) —
    // 'Sent' is never chosen by hand, so it always means the client got it.
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    sentTo: { type: DataTypes.STRING(500), allowNull: true, field: 'sent_to' },

    uploadedFilePath: { type: DataTypes.STRING, allowNull: true, field: 'uploaded_file_path' },
    uploadedFileName: { type: DataTypes.STRING, allowNull: true, field: 'uploaded_file_name' },
  }, {
    tableName: 'quotations',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['user_id', 'doc_type'] }],
  });

  return Quotation;
};
