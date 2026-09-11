import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoicePreview } from '../dashboard/src/utils/invoicePreview.mjs';
const input = {
  items: [{ description: 'Glass', unitCost: 45, qty: 2 }, { description: 'Fitting', unitCost: 30, qty: 1 }],
  taxId: 517, invoiceNumber: 'TEST-001', currency: 'USD', customer: { name: 'Test Customer' }, amountPaid: 0,
};
test('standard VAT, unpaid balance and no fabricated fiscal evidence', () => {
  const result = buildInvoicePreview(input);
  assert.equal(result.subtotal, 120);
  assert.equal(result.tax_amount, 18.6);
  assert.equal(result.total_amount, 138.6);
  assert.equal(result.amount_paid, 0);
  assert.equal(result.balance_due, 138.6);
  assert.deepEqual(result.payment, [{ method: 'Credit', amount: 138.6 }]);
  assert.equal(result.status, 'LOCAL_PREVIEW');
  for (const field of ['zimra_verification_url', 'receipt_number', 'fiscal_day']) assert.equal(result[field], undefined);
});
test('partial payment and ZWG are preserved', () => {
  const result = buildInvoicePreview({ ...input, currency: 'ZWG', amountPaid: 50 });
  assert.equal(result.currency, 'ZWG');
  assert.equal(result.balance_due, 88.6);
  assert.deepEqual(result.payment, [{ method: 'Cash', amount: 50 }, { method: 'Credit', amount: 88.6 }]);
});
test('zero-rated and exempt remain distinct', () => {
  const zero = buildInvoicePreview({ ...input, taxId: 2 });
  const exempt = buildInvoicePreview({ ...input, taxId: 1 });
  assert.equal(zero.tax_amount, 0);
  assert.equal(exempt.tax_amount, 0);
  assert.equal(zero.line_items[0].tax_percent, 0);
  assert.equal(exempt.line_items[0].tax_percent, null);
  assert.notEqual(zero.line_items[0].tax_id, exempt.line_items[0].tax_id);
});
test('fractional prices round at each line and totals reconcile', () => {
  const result = buildInvoicePreview({ ...input, items: [{ description: 'Glass', unitCost: 0.335, qty: 3 }] });
  assert.equal(result.subtotal, 1.01);
  assert.equal(result.tax_amount, 0.16);
  assert.equal(result.total_amount, 1.17);
});
test('invalid entries block preview', () => {
  for (const patch of [{ items: [] }, { taxId: 515 }, { amountPaid: -1 }, { amountPaid: 999 }, { currency: 'BAD' }, { invoiceNumber: '' },
    { items: [{ description: 'Glass', unitCost: NaN, qty: 1 }] }, { items: [{ description: 'Glass', unitCost: 10, qty: 0 }] }]) {
    assert.throws(() => buildInvoicePreview({ ...input, ...patch }));
  }
});
