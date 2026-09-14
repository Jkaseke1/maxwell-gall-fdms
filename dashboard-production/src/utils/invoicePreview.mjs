// Tax choices returned by GetConfig for test device 46158, 2026-09-05.
// Refresh from the device before enabling submission; this module never sends data.
export const PRODUCTION_TAXES = [
  { id: 515, rate: 15.5, label: 'Standard VAT 15.5%' },
  { id: 2, rate: 0, label: 'Zero rated 0%' },
  { id: 1, rate: null, label: 'Exempt' },
];
const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
export function calculateInvoice(items, taxId, receiptType = 'FiscalInvoice') {
  const tax = PRODUCTION_TAXES.find(t => t.id === Number(taxId));
  if (!tax) throw new Error('Choose a tax category from the test device configuration.');
  if (!Array.isArray(items) || !items.length) throw new Error('Add at least one line item.');
  const direction = receiptType === 'CreditNote' ? -1 : 1;
  const lines = items.map((item, index) => {
    const tax = PRODUCTION_TAXES.find(t => t.id === Number(item.taxId ?? taxId)); if(!tax) throw Error('Invalid line tax');
    const price = Number(item.unitCost), quantity = Number(item.qty);
    if (!String(item.description || '').trim()) throw new Error(`Line ${index + 1}: description is required.`);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Line ${index + 1}: price and quantity must be greater than zero.`);
    }
    return { description: item.description.trim(), hs_code: item.hsCode || '', unit_price: (item.discount ? -1 : direction)*price, quantity,
      total_amount: (item.discount ? -1 : direction)*round(price * quantity), tax_id: tax.id, tax_percent: tax.rate };
  });
  const subtotal = round(lines.reduce((s, l) => s + l.total_amount, 0));
  const groups = new Map(); for(const l of lines) groups.set(l.tax_id, (groups.get(l.tax_id)||0)+l.total_amount);
  const taxAmount = round([...groups].reduce((s,[id,net])=>s + Math.sign(net)*round(Math.abs(net)*(PRODUCTION_TAXES.find(t=>t.id===id).rate||0)/100),0));
  for(const l of lines){l.tax_amount=l.tax_percent===null?null:Math.sign(l.total_amount)*round(Math.abs(l.total_amount)*(l.tax_percent||0)/100);l.gross_amount=round(l.total_amount+(l.tax_amount||0));}
  return { lines, subtotal, taxAmount, totalAmount: round(subtotal + taxAmount), tax };
}
export function buildInvoicePreview({ items, taxId, invoiceNumber, currency, customer, amountPaid, receiptType = 'FiscalInvoice', paymentMethod = 'Cash', notes = '' }) {
  if (!String(invoiceNumber || '').trim() || invoiceNumber.length > 50) throw new Error('Invoice number must contain 1–50 characters.');
  if (!['USD', 'ZWG'].includes(currency)) throw new Error('Choose USD or ZWG.');
  const { lines, subtotal, taxAmount, totalAmount, tax } = calculateInvoice(items, taxId, receiptType);
  const paid = (receiptType==='CreditNote'?-1:1)*Number(amountPaid);
  if (!Number.isFinite(paid) || Number(amountPaid) < 0 || Math.abs(paid) > Math.abs(totalAmount)) throw new Error('Amount paid must be between zero and the invoice total.');
  return {
    receipt_type: receiptType, notes, invoice_number: invoiceNumber.trim(), invoice_date: new Date().toISOString(), currency,
    customer, customer_name: customer.name || 'Walk-in Customer', customer_attention: customer.attention,
    customer_id: customer.customerId, customer_phone: customer.phone, customer_email: customer.email,
    buyer_address: customer.address ? { street: customer.address } : Object.fromEntries(['houseNo','street','city','province'].filter(k=>customer[k]).map(k=>[k,customer[k]])), customer_tin: customer.taxDetails ? customer.tin : undefined, customer_vat: customer.taxDetails ? customer.vat : undefined,
    line_items: lines, subtotal, tax_amount: taxAmount, total_amount: totalAmount,
    tax_rate: new Set(lines.map(l=>l.tax_id)).size>1?'Mixed VAT':lines[0].tax_percent===null?'Exempt':`${lines[0].tax_percent}%`, tax_inclusive: false,
    amount_paid: round(paid), balance_due: round(totalAmount - paid),
    payment: [ ...(paid !== 0 ? [{ method: paymentMethod, amount: round(paid) }] : []),
      ...(round(totalAmount - paid) !== 0 ? [{ method: 'Credit', amount: round(totalAmount - paid) }] : []) ],
    payments: [...(paid !== 0 ? [{moneyTypeCode:paymentMethod,paymentAmount:round(paid)}] : []), ...(totalAmount!==paid ? [{moneyTypeCode:'Credit',paymentAmount:round(totalAmount-paid)}] : [])],
    status: 'LOCAL_PREVIEW', environment: 'PRODUCTION', device_id: '46158',
    device_serial: 'ZIMRAVD-1737',
    validation_notes: ['Arithmetic checked locally. Not submitted to ZIMRA.',
      'HS codes, buyer tax details, live receipt counters and signature must be checked before submission.'],
  };
}

