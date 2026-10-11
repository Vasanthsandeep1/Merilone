// OPI calculations — the same formulas as Meril's OPI Excel templates, run
// on the server so the saved figures and the PDF never depend on the browser.
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (n) => Math.round(num(n) * 100) / 100;
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

// Values of the fields people added to a department's OPI (see OpiFormat):
// { key: value }, keys like "x_bank_name", values kept as text.
const extra = (raw) => {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw).slice(0, 60)) {
    if (/^x_[a-z0-9_]{1,40}$/.test(k) && v !== '' && v != null) out[k] = str(v, 500);
  }
  return out;
};

// Endo New OPI format, per line (percent inputs are given as e.g. 10 for 10%):
//   RC Rate               U = (1 − Approved Discount) × HP
//   Hospital PO Rate      V = typed, else = RC Rate
//   Applicable Discount   W = (HP − V) ÷ HP
//   Applicable Rate       X = max(U, V)
//   Super Distributor     Z = X ÷ (1 + Dealer Margin)
//   Meril Billing         AB = Z ÷ (1 + Super Distributor Margin)
//   Discount on DP        AD = (DP − AB) ÷ DP
//   Invoice Value         AE = AB × PO Qty
const ENDO_TEXT = ['poNo', 'poDate', 'authCode', 'rcNo', 'hospitalCode', 'hospitalName', 'dealerSoldTo', 'dealerShipTo', 'dealerName', 'zone', 'salesPerson', 'productCode', 'packSize', 'section', 'brandName', 'billingLocation'];
const ENDO_NUM = ['poQty', 'approvedDiscount', 'hp', 'hospitalPoRate', 'dealerMargin', 'superDistMargin', 'dp'];

function endoLine(raw) {
  const l = {};
  for (const k of ENDO_TEXT) l[k] = str(raw?.[k]);
  for (const k of ENDO_NUM) l[k] = raw?.[k] === '' || raw?.[k] == null ? null : num(raw[k]);
  const hp = num(l.hp);
  const rcRate = (1 - num(l.approvedDiscount) / 100) * hp;
  const poRate = l.hospitalPoRate != null ? num(l.hospitalPoRate) : rcRate;
  const applicableRate = Math.max(rcRate, poRate);
  const superDistRate = applicableRate / (1 + num(l.dealerMargin) / 100);
  const merilRate = superDistRate / (1 + num(l.superDistMargin) / 100);
  return {
    ...l,
    extra: extra(raw?.extra),
    rcRate: r2(rcRate),
    hospitalPoRateUsed: r2(poRate),
    applicableDiscount: hp ? r2(((hp - poRate) / hp) * 100) : 0,
    applicableRate: r2(applicableRate),
    superDistRate: r2(superDistRate),
    merilRate: r2(merilRate),
    discountOnDp: num(l.dp) ? r2(((num(l.dp) - merilRate) / num(l.dp)) * 100) : 0,
    invoiceValue: r2(merilRate * num(l.poQty)),
  };
}
const endoFilled = (l) => !!(l.productCode || l.hospitalName || num(l.poQty) || num(l.hp) || Object.keys(l.extra || {}).length);

function endo(body) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map(endoLine).filter(endoFilled);
  const value = r2(items.reduce((s, l) => s + l.invoiceValue, 0));
  return { header: { remarks: str(body.header?.remarks, 2000), extra: extra(body.header?.extra) }, items, value, totalValue: value };
}

// Diagnostics OPI form: Value = Qty × Order price; TOTAL = Σ Value;
// GST = TOTAL × rate; Total Value = TOTAL + GST + freight + levy + recovery.
const DIAG_HEADER = ['customerCode', 'poNo', 'poDate', 'orderType', 'billName', 'billAddress', 'billCity', 'billState', 'billPin', 'shipName', 'shipAddress', 'shipLandmark', 'shipCity', 'shipState', 'shipPin',
  'pan', 'gst', 'drugLicence', 'aadhar', 'authName', 'authMobile', 'authEmail', 'paymentTerms', 'comments', 'flspName', 'empCode', 'flspEmail', 'rsmName', 'zsmName'];

function diagnostics(body, products) {
  const h = {};
  for (const k of DIAG_HEADER) h[k] = str(body.header?.[k], k === 'comments' || k.endsWith('Address') ? 2000 : 300);
  const byCode = new Map(products.map((p) => [p.code, p]));
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 100).map((raw) => {
    const p = byCode.get(str(raw?.productCode));
    const qty = num(raw?.qty); const price = num(raw?.orderPrice);
    return {
      productCode: str(raw?.productCode), description: str(raw?.description) || p?.description || '',
      majorGroup: str(raw?.majorGroup) || p?.majorGroup || '', packSize: str(raw?.packSize) || p?.packSize || '',
      dbPrice: raw?.dbPrice === '' || raw?.dbPrice == null ? (p?.dbPrice ?? null) : num(raw.dbPrice),
      orderPrice: price, qty, freeQty: num(raw?.freeQty), value: r2(qty * price), remarks: str(raw?.remarks),
      extra: extra(raw?.extra),
    };
  }).filter((l) => l.productCode || l.description || l.qty || Object.keys(l.extra).length);
  const total = r2(items.reduce((s, l) => s + l.value, 0));
  const gstRate = body.charges?.gstRate === '' || body.charges?.gstRate == null ? 5 : num(body.charges.gstRate);
  const charges = {
    gstRate, gst: r2((total * gstRate) / 100),
    freight: r2(body.charges?.freight), levy: r2(body.charges?.levy), recovery: r2(body.charges?.recovery),
  };
  const totalValue = r2(total + charges.gst + charges.freight + charges.levy + charges.recovery);
  return { header: { ...h, extra: extra(body.header?.extra), charges }, items, value: total, totalValue };
}

// A department the organisation added: details filled once + a table of
// lines; Value = Qty × Rate; total = Σ Value.
function generic(body) {
  const h = {};
  for (const k of ['customerName', 'poNo', 'poDate', 'remarks']) h[k] = str(body.header?.[k], k === 'remarks' ? 2000 : 300);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map((raw) => {
    const qty = num(raw?.qty); const rate = num(raw?.rate);
    return { item: str(raw?.item), description: str(raw?.description, 500), qty, rate, value: r2(qty * rate), extra: extra(raw?.extra) };
  }).filter((l) => l.item || l.description || l.qty || Object.keys(l.extra).length);
  const value = r2(items.reduce((s, l) => s + l.value, 0));
  return { header: { ...h, extra: extra(body.header?.extra) }, items, value, totalValue: value };
}

module.exports = { endo, diagnostics, generic, endoLine };
