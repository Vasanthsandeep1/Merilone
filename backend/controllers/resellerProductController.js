const fs = require('fs');
const { Op } = require('sequelize');
const { ResellerProduct, DealerAuthRequest } = require('../models');

// Product Management > Our Products — see ResellerProduct.js. "Link to
// Approved Authorization" lets the frontend prefill Auth Serial No.,
// Product Name, OEM By, and validity from one of this reseller's own
// approved DealerAuthRequest rows, but every field stays independently
// editable since a product's real-world tech spec/decode isn't part of the
// authorization request itself.

// @route GET /api/reseller-products
exports.listProducts = async (req, res) => {
  try {
    const { search, oemBy, status } = req.query;
    const where = { userId: req.user.id };
    if (search) where.productName = { [Op.like]: `%${search}%` };
    if (oemBy) where.oemBy = oemBy;

    let rows = await ResellerProduct.findAll({ where, order: [['createdAt', 'DESC']] });

    if (status === 'active' || status === 'expired') {
      const now = new Date();
      rows = rows.filter((r) => {
        if (!r.validTo) return status === 'active';
        const expired = new Date(r.validTo) < now;
        return status === 'expired' ? expired : !expired;
      });
    }

    res.json({ success: true, data: rows.map((r) => r.toJSON()) });
  } catch (err) {
    console.error('listProducts error:', err);
    res.status(500).json({ success: false, message: 'Failed to load products' });
  }
};

// @route GET /api/reseller-products/oems — distinct OEM-By values for the filter dropdown
exports.listProductOems = async (req, res) => {
  try {
    const rows = await ResellerProduct.findAll({
      where: { userId: req.user.id, oemBy: { [Op.ne]: null } },
      attributes: ['oemBy'], group: ['oemBy'], order: [['oemBy', 'ASC']],
    });
    res.json({ success: true, data: rows.map((r) => r.oemBy).filter(Boolean) });
  } catch (err) {
    console.error('listProductOems error:', err);
    res.status(500).json({ success: false, message: 'Failed to load OEM list' });
  }
};

// @route GET /api/reseller-products/approved-authorizations
// Feeds the "link to an approved authorization" picker in the Add Product form.
exports.listApprovedAuthorizations = async (req, res) => {
  try {
    const rows = await DealerAuthRequest.findAll({
      where: { fromUserId: req.user.id, status: 'approved' },
      include: [{ association: 'toUser', attributes: ['id', 'name'] }, { association: 'product' }],
      order: [['decidedAt', 'DESC']],
    });
    res.json({
      success: true,
      data: rows.map((r) => ({
        id: r.id, refNo: r.refNo, productName: r.product?.name || r.customProductName,
        oemBy: r.toUser?.name, validFrom: r.validFrom, validTo: r.validTo,
      })),
    });
  } catch (err) {
    console.error('listApprovedAuthorizations error:', err);
    res.status(500).json({ success: false, message: 'Failed to load approved authorizations' });
  }
};

// @route POST /api/reseller-products
exports.createProduct = async (req, res) => {
  try {
    const {
      dealerAuthRequestId, authSerialNo, productName, decode, technicalSpecification, oemBy, validFrom, validTo,
    } = req.body;
    if (!productName?.trim()) return res.status(400).json({ success: false, message: 'Product name is required' });

    if (dealerAuthRequestId) {
      const owns = await DealerAuthRequest.findOne({ where: { id: dealerAuthRequestId, fromUserId: req.user.id, status: 'approved' } });
      if (!owns) return res.status(403).json({ success: false, message: 'That authorization is not yours or is not approved' });
    }

    const product = await ResellerProduct.create({
      userId: req.user.id,
      dealerAuthRequestId: dealerAuthRequestId || null,
      authSerialNo: authSerialNo || null,
      productName: productName.trim(),
      decode: decode || null,
      technicalSpecification: technicalSpecification || null,
      oemBy: oemBy || null,
      validFrom: validFrom || null,
      validTo: validTo || null,
    });
    res.json({ success: true, data: product.toJSON() });
  } catch (err) {
    console.error('createProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to add product' });
  }
};

// @route PATCH /api/reseller-products/:id
exports.updateProduct = async (req, res) => {
  try {
    const product = await ResellerProduct.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    const fields = ['authSerialNo', 'productName', 'decode', 'technicalSpecification', 'oemBy', 'validFrom', 'validTo'];
    for (const f of fields) if (req.body[f] !== undefined) product[f] = req.body[f] || null;
    await product.save();
    res.json({ success: true, data: product.toJSON() });
  } catch (err) {
    console.error('updateProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to update product' });
  }
};

// @route DELETE /api/reseller-products/:id
exports.deleteProduct = async (req, res) => {
  try {
    const product = await ResellerProduct.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    if (product.catalogFilePath && fs.existsSync(product.catalogFilePath)) fs.unlink(product.catalogFilePath, () => {});
    await product.destroy();
    res.json({ success: true });
  } catch (err) {
    console.error('deleteProduct error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete product' });
  }
};

// @route POST /api/reseller-products/:id/catalog  (multipart, field "file")
// Stores the uploaded catalog document against the product row. AI
// extraction of products/specs from it is a future step, not implemented
// here — same local-Ollama dependency flagged elsewhere in this app
// (Suggested Products, Doc Prep).
exports.uploadCatalog = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const product = await ResellerProduct.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!product) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (product.catalogFilePath && fs.existsSync(product.catalogFilePath)) fs.unlink(product.catalogFilePath, () => {});
    product.catalogFilePath = req.file.path;
    product.catalogFileName = req.file.originalname;
    await product.save();
    res.json({ success: true, data: product.toJSON() });
  } catch (err) {
    console.error('uploadCatalog error:', err);
    res.status(500).json({ success: false, message: 'Catalog upload failed' });
  }
};

// @route GET /api/reseller-products/:id/catalog/download
exports.downloadCatalog = async (req, res) => {
  try {
    const product = await ResellerProduct.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!product?.catalogFilePath || !fs.existsSync(product.catalogFilePath)) {
      return res.status(404).json({ success: false, message: 'No catalog uploaded for this product' });
    }
    res.download(product.catalogFilePath, product.catalogFileName || 'catalog');
  } catch (err) {
    console.error('downloadCatalog error:', err);
    res.status(500).json({ success: false, message: 'Download failed' });
  }
};
