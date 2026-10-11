'use strict';
// Advance payments along the sales chain. A customer can pay an advance
// against a Sales Order before it's invoiced (a PaymentReceipt with
// paymentType 'advance' and salesOrderId set). When that Sales Order's
// invoice is raised, the unused part of those advances is applied to the
// invoice as PaymentAllocation rows — so the invoice shows the advance as
// already received and only the balance stays due. Shared by
// quotationController (invoice creation) and paymentReceiptController.
const { PaymentReceipt, PaymentAllocation } = require('../models');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Applies unused advances for `salesOrderId` to `invoice`, oldest advance
// first, never more than the invoice total. Returns the amount applied.
async function applyAdvancesToInvoice(invoice, salesOrderId) {
  const advances = await PaymentReceipt.findAll({
    where: { userId: invoice.userId, salesOrderId, paymentType: 'advance' },
    order: [['receiptDate', 'ASC'], ['id', 'ASC']],
  });
  let remaining = round2(invoice.grandTotal);
  let applied = 0;
  for (const adv of advances) {
    const available = round2(adv.advanceAmount);
    if (remaining <= 0 || available <= 0) continue;
    const amount = round2(Math.min(available, remaining));
    await PaymentAllocation.create({ paymentReceiptId: adv.id, invoiceId: invoice.id, amount });
    adv.totalAllocated = round2(Number(adv.totalAllocated) + amount);
    adv.advanceAmount = round2(available - amount);
    await adv.save();
    remaining = round2(remaining - amount);
    applied = round2(applied + amount);
  }
  return applied;
}

// Payment position of invoices: { [invoiceId]: amountPaidSoFar }.
async function paidByInvoice(invoiceIds) {
  if (!invoiceIds.length) return {};
  const rows = await PaymentAllocation.findAll({ where: { invoiceId: invoiceIds }, attributes: ['invoiceId', 'amount'], raw: true });
  const out = {};
  for (const r of rows) out[r.invoiceId] = round2((out[r.invoiceId] || 0) + Number(r.amount));
  return out;
}

// Advances received against Sales Orders: { [salesOrderId]: total }.
async function advancesBySalesOrder(salesOrderIds) {
  if (!salesOrderIds.length) return {};
  const rows = await PaymentReceipt.findAll({ where: { salesOrderId: salesOrderIds, paymentType: 'advance' }, attributes: ['salesOrderId', 'totalReceived'], raw: true });
  const out = {};
  for (const r of rows) out[r.salesOrderId] = round2((out[r.salesOrderId] || 0) + Number(r.totalReceived));
  return out;
}

module.exports = { applyAdvancesToInvoice, paidByInvoice, advancesBySalesOrder, round2 };
