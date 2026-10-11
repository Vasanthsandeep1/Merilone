'use strict';
// Builds the formal "Dealer Authorization Letter" generated automatically
// the moment an OEM approves a Request Authorization — on the OEM's own
// Endo or Diagnostics letterhead (see utils/letterheads.js), covering the
// tender (if this was a Tender Authorization), every product and its
// conditions, and the validity window. Rendered with the same pdfkit
// pipeline (utils/letterPdf.js) the Letter Generate feature already uses,
// so it's the exact same visual letterhead/signature/stamp as any other
// division letter in this app — nothing letter-specific is reinvented here.
const { normDivision, LETTERHEADS } = require('./letterheads');

const AUTH_TYPE_LABELS = {
  tender: 'Tender Authorization',
  direct_purchase: 'Direct Purchase Authorization',
  local: 'Local Authorization',
};

const esc = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A');

// Looks at every product/category name on the request for an "endo" or
// "diagno" keyword (same matching utils/letterheads.js itself uses) — a
// request can only reasonably belong to one of the OEM's divisions, so the
// first match wins. No match = no division = a plain, unbranded letter
// (compose()/renderPdf() already handle that gracefully).
function inferDivision(items) {
  for (const item of items || []) {
    const text = [item.product?.name, item.customProductName, item.category?.name].filter(Boolean).join(' ');
    const d = normDivision(text);
    if (d) return d;
  }
  return null;
}

// `division` picks the letterhead renderPdf() will stamp on the page — the
// body must name the SAME legal entity as that letterhead's signature block
// below it (e.g. "MERIL ENDO SURGERY PVT. LTD."), not whatever company name
// happens to be on the approving login's own Setup Profile; otherwise the
// letter would open "we, <some reseller test account>" and close "For MERIL
// ENDO SURGERY PVT. LTD." No division matched = a plain, unbranded letter,
// so the OEM's own real company name is used instead.
function buildLetterHtml(request, items, fromCompanyName, toCompanyName, division) {
  const letterheadCompany = division && LETTERHEADS[division] ? LETTERHEADS[division].company : null;
  const signingCompanyName = letterheadCompany || toCompanyName;
  const authTypeLabel = AUTH_TYPE_LABELS[request.authType] || 'Authorization';
  const today = fmtDate(new Date());

  const parts = [];
  parts.push(`<p style="text-align:right">Date: ${esc(today)}</p>`);
  parts.push(`<p><b>Ref:</b> ${esc(request.authCode || request.refNo)}</p>`);
  parts.push(`<p><b>To,</b><br />${esc(fromCompanyName)}</p>`);
  parts.push(`<p><b>Subject:</b> ${esc(authTypeLabel)} — ${esc(request.authCode || request.refNo)}</p>`);

  let opening = `<p>This is to confirm that we, <b>${esc(signingCompanyName)}</b>, hereby grant <b>${esc(authTypeLabel)}</b> to M/s <b>${esc(fromCompanyName)}</b>`;
  if (request.authType === 'tender' && request.tenderNumber) {
    const tt = request.tenderType === 'open' ? 'Open Tender' : 'GeM';
    opening += ` to participate in and quote on our behalf for Tender No. <b>${esc(request.tenderNumber)}</b> (${esc(tt)})`;
  }
  opening += ', for the following product(s), subject to the terms and conditions stated against each:</p>';
  parts.push(opening);

  (items || []).forEach((item, idx) => {
    const name = item.product?.name || item.customProductName || 'Product';
    const code = item.productCode ? ` (Code: ${esc(item.productCode)})` : '';
    parts.push(`<p><b>${idx + 1}. ${esc(name)}</b>${code}</p>`);
    const bullets = Array.isArray(item.conditionBullets) ? item.conditionBullets.filter(Boolean) : [];
    if (bullets.length) {
      parts.push('<ul>');
      bullets.forEach((b) => parts.push(`<li>${esc(b)}</li>`));
      parts.push('</ul>');
    }
  });

  parts.push(`<p><b>Validity:</b> From ${esc(fmtDate(request.validFrom))} to ${esc(fmtDate(request.validTo))}</p>`);
  if (request.reason) parts.push(`<p><b>Reason for Authorization:</b> ${esc(request.reason)}</p>`);
  parts.push('<p>This authorization is valid only for the above-mentioned scope and validity period, and is subject to withdrawal at our discretion.</p>');
  parts.push('<p>Yours faithfully,</p>');

  return parts.join('\n');
}

module.exports = { inferDivision, buildLetterHtml, AUTH_TYPE_LABELS };
