const crypto = require('node:crypto');
const { buildReceiptHashInput } = require('../../src/signatures/receiptSignature.js');
const { generateQRData } = require('../../src/signatures/qrCodeGenerator.js');
const { buildFiscalDayHashInput } = require('../../src/signatures/fiscalDaySignature.js');
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
function localTime(date = new Date()) { return new Date(date.getTime() + 7200000).toISOString().slice(0, 19); }
function identity(config) {
  if (config.testFixture === true) {
    if (config.deviceOperatingMode !== 'Online') throw Error('Device must be in Online mode.');
    return;
  }
  if (config.taxPayerTIN !== '2000945150' || config.vatNumber !== '220438802' || config.deviceSerialNo !== 'TEST-2000945150-B670') throw Error('Maxwell Glass identity mismatch.');
  if (config.deviceOperatingMode !== 'Online') throw Error('Device must be in Online mode.');
}
function prepare(input, config, counters, key, now = localTime()) {
  identity(config);
  if (!input || typeof input !== 'object') throw Error('Invoice data required.');
  const invoiceNo = String(input.invoiceNumber || '').trim();
  if (!invoiceNo || invoiceNo.length > 50) throw Error('Invoice number must contain 1–50 characters.');
  if (!['USD', 'ZWG'].includes(input.currency)) throw Error('Currency must be USD or ZWG.');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 100) throw Error('Provide 1–100 invoice lines.');
  const receiptType = input.receiptType || 'FiscalInvoice';
  // Maxwell Glass issues fiscal invoices and credit notes only.  Keep any
  // historic debit-note records readable, but never create a new one.
  if (!['FiscalInvoice', 'CreditNote'].includes(receiptType)) throw Error('Maxwell Glass supports fiscal invoices and credit notes only.');
  const sign = receiptType === 'CreditNote' ? -1 : 1;
  if (receiptType === 'CreditNote' && (!input.originalReceiptId || !input.notes?.trim())) throw Error('Credit note requires original receipt and reason.');
  const taxes = new Map();
  const lines = input.items.map((item, i) => {
    const tax = config.applicableTaxes.find(t => t.taxID === Number(item.taxId ?? input.taxId) && t.validFrom <= now && (!t.validTill || t.validTill >= now));
    if (!tax || ![1, 2, 517].includes(tax.taxID)) throw Error('Choose an applicable VAT category returned by this test device.');
    const taxFields = { taxID: tax.taxID, ...(tax.taxPercent == null ? {} : { taxPercent: tax.taxPercent }) };
    const price = Number(item.unitCost), qty = Number(item.qty), hs = String(item.hsCode || '').trim();
    if (!String(item.description || '').trim() || item.description.length > 200) throw Error(`Line ${i + 1}: description required, maximum 200 characters.`);
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) throw Error(`Line ${i + 1}: positive price and quantity required.`);
    if ([price, qty].some(v => v > 100000000 || Math.abs(v * 1e6 - Math.round(v * 1e6)) > 0.00001)) throw Error('Price and quantity must have at most six decimal places and be within supported range.');
    if (item.discount && receiptType !== 'FiscalInvoice') throw Error('Separate discount lines are supported on invoices only.');
    const fullHS = tax.taxPercent == null || tax.taxPercent === 0;
    if (!(fullHS ? /^\d{8}$/ : /^(\d{4}|\d{8})$/).test(hs)) throw Error(`Line ${i + 1}: enter ${fullHS ? '8' : '4 or 8'} digit HS code.`);
    const direction = item.discount ? -1 : sign;
    const total = direction * round(price * qty);
    if (!Number.isFinite(total) || total === 0 || Math.abs(total) > 100000000) throw Error('Line amount is outside supported range.');
    const bucket = taxes.get(tax.taxID) || { ...taxFields, net: 0 };
    bucket.net = round(bucket.net + total); taxes.set(tax.taxID, bucket);
    return { receiptLineType: item.discount ? 'Discount' : 'Sale', receiptLineNo: i + 1, receiptLineName: item.description.trim(),
      receiptLineHSCode: hs, receiptLinePrice: direction * price, receiptLineQuantity: qty, receiptLineTotal: total, ...taxFields };
  });
  const receiptTaxes = [...taxes.values()].sort((a,b) => a.taxID-b.taxID).map(({net, ...tax}) => {
    if (net * sign < 0) throw Error('Discount exceeds sales in its tax category.');
    const amount = sign * round(Math.abs(net) * (tax.taxPercent || 0) / 100);
    return { ...tax, taxAmount: amount, salesAmountWithTax: round(net + amount) };
  });
  const subtotal = round(lines.reduce((s, l) => s + l.receiptLineTotal, 0));
  const taxAmount = round(receiptTaxes.reduce((s,t) => s+t.taxAmount,0)), total = round(subtotal + taxAmount);
  const paidMagnitude = round(Number(input.amountPaid));
  if (!Number.isFinite(paidMagnitude) || paidMagnitude < 0 || paidMagnitude > Math.abs(total)) throw Error('Amount paid/refunded must be between zero and absolute total.');
  const paid = sign * paidMagnitude;
  const paymentMethod = input.paymentMethod || 'Cash';
  if (!['Cash','Card','MobileWallet','Coupon','BankTransfer','Other'].includes(paymentMethod)) throw Error('Invalid payment method.');
  const buyer = input.customer || {};
  let buyerData;
  if (buyer.taxDetails) {
    if (!buyer.name?.trim() || buyer.name.length > 250 || !/^\d{10}$/.test(buyer.tin || '')) throw Error('Tax buyer requires a registered name and 10-digit TIN.');
    if (buyer.vat && !/^\d{9}$/.test(buyer.vat)) throw Error('Buyer VAT number must contain 9 digits.');
    if (buyer.email && buyer.email !== 'N/A' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyer.email)) throw Error('Buyer email is invalid.');
    if (!buyer.address?.trim() && !['province', 'city', 'street', 'houseNo', 'district'].some(k => buyer[k]?.trim())) throw Error('Registered buyer requires a physical address.');
    const address = buyer.address?.trim() ? { street: buyer.address.trim() } : Object.fromEntries(['province', 'city', 'street', 'houseNo', 'district'].filter(k => buyer[k]?.trim()).map(k => [k, buyer[k].trim()]));
    if (Object.values(address).some(v => v.length > 100)) throw Error('Buyer address fields must be 100 characters or fewer.');
    const contacts = { ...(buyer.phone ? { phoneNo: buyer.phone } : {}), ...(buyer.email && buyer.email !== 'N/A' ? { email: buyer.email } : {}) };
    if ((buyer.phone || '').length > 20 || (buyer.email || '').length > 100) throw Error('Buyer contact details are too long.');
    buyerData = { buyerRegisterName: buyer.name.trim(), buyerTIN: buyer.tin,
      ...(buyer.vat ? { vatNumber: buyer.vat } : {}),
      ...(Object.keys(address).length ? { buyerAddress: address } : {}), ...(Object.keys(contacts).length ? { buyerContacts: contacts } : {}) };
  }
  if (!Number.isInteger(counters.nextCounter) || counters.nextCounter < 1 || !Number.isInteger(counters.nextGlobalNo) || counters.nextGlobalNo < 1) throw Error('Live receipt counters are unavailable.');
  const receipt = { receiptType, receiptCurrency: input.currency, invoiceNo,
    receiptCounter: counters.nextCounter, receiptGlobalNo: counters.nextGlobalNo, receiptDate: now,
    receiptLinesTaxInclusive: false, receiptLines: lines,
    receiptTaxes,
    receiptPayments: [...(paid !== 0 ? [{ moneyTypeCode: paymentMethod, paymentAmount: paid }] : []),
      ...(total !== paid || total === 0 ? [{ moneyTypeCode: 'Credit', paymentAmount: round(total - paid) }] : [])],
    receiptTotal: total, receiptPrintForm: 'InvoiceA4', ...(buyerData ? { buyerData } : {}),
    ...(receiptType !== 'FiscalInvoice' ? { creditDebitNote: { receiptID: Number(input.originalReceiptId) } } : {}),
    receiptNotes: 'MAXWELL GLASS SANDBOX TEST - NOT A PRODUCTION INVOICE' + (input.notes ? ': ' + input.notes.trim() : '') };
  const hashInput = buildReceiptHashInput({ ...receipt, deviceID: 38293 }, counters.previousHash);
  receipt.receiptDeviceSignature = { hash: crypto.createHash('sha256').update(hashInput).digest('base64'),
    signature: crypto.sign('sha256', Buffer.from(hashInput), key).toString('base64') };
  if (!crypto.verify('sha256', Buffer.from(hashInput), crypto.createPublicKey(key), Buffer.from(receipt.receiptDeviceSignature.signature, 'base64'))) throw Error('Local signature verification failed.');
  return { receipt, subtotal, taxAmount, total, paid, seller: { name: config.taxPayerName, tin: config.taxPayerTIN, vatNo: config.vatNumber, branch: config.deviceBranchName, address: config.deviceBranchAddress, contacts: config.deviceBranchContacts, deviceId: 38293, serialNo: config.deviceSerialNo }, configSnapshot: config };
}
function printed(input, prepared, response, fiscalDayNo, qrBase) {
  const r = prepared.receipt, errors = response.validationErrors || [];
  const valid = errors.length === 0;
  if (qrBase !== 'https://fdmstest.zimra.co.zw') throw Error('Unexpected sandbox QR host.');
  return { invoice_number: r.invoiceNo, invoice_date: r.receiptDate, currency: r.receiptCurrency,
    receipt_type: r.receiptType, seller: prepared.seller, taxes: r.receiptTaxes, payments: r.receiptPayments, notes: r.receiptNotes, original_receipt_id: r.creditDebitNote?.receiptID,
    customer_name: input.customer?.name || 'Walk-in Customer', customer_tin: r.buyerData?.buyerTIN, customer_vat: r.buyerData?.vatNumber,
    customer_attention: input.customer?.attention, customer_phone: input.customer?.phone, customer_email: input.customer?.email,
    customer_id: input.customer?.customerId, buyer_address: r.buyerData?.buyerAddress,
    line_items: r.receiptLines.map(l => ({ description: (l.receiptLineType === 'Discount' ? 'Discount: ' : '') + l.receiptLineName, hs_code: l.receiptLineHSCode, unit_price: l.receiptLinePrice, quantity: l.receiptLineQuantity, total_amount: l.receiptLineTotal, tax_percent: l.taxPercent ?? null, tax_amount: l.taxPercent == null ? null : Math.sign(l.receiptLineTotal) * round(Math.abs(l.receiptLineTotal) * l.taxPercent / 100), gross_amount: round(l.receiptLineTotal + Math.sign(l.receiptLineTotal) * round(Math.abs(l.receiptLineTotal) * (l.taxPercent || 0) / 100)) })),
    subtotal: prepared.subtotal, tax_amount: prepared.taxAmount, total_amount: prepared.total,
    tax_rate: r.receiptTaxes.length > 1 ? 'Mixed VAT' : r.receiptTaxes[0].taxPercent == null ? 'Exempt' : `${r.receiptTaxes[0].taxPercent}%`, amount_paid: prepared.paid,
    balance_due: round(prepared.total - prepared.paid), status: valid ? 'FISCALIZED' : 'VALIDATION_ERRORS', environment: 'TEST',
    device_id: '38293', device_serial: 'TEST-2000945150-B670', receipt_number: r.receiptGlobalNo,
    receipt_counter: r.receiptCounter, fiscal_day: fiscalDayNo, receipt_id: response.receiptID,
    operation_id: response.operationID, device_signature: r.receiptDeviceSignature, server_signature: response.receiptServerSignature,
    validation_errors: errors, zimra_verification_url: generateQRData(qrBase, 38293, r.receiptDate, r.receiptGlobalNo, r.receiptDeviceSignature.signature) };
}
function closePayload(state, key) {
  const buckets = new Map();
  const add = (fields, value) => {
    const id = JSON.stringify(fields);
    const old = buckets.get(id);
    buckets.set(id, { ...fields, fiscalCounterValue: round((old?.fiscalCounterValue || 0) + value) });
  };
  for (const record of state.receipts.filter(r => r.fiscalDayNo === state.fiscalDayNo)) {
    const r = record.prepared.receipt;
    for (const tax of r.receiptTaxes) {
      const fields = { fiscalCounterCurrency: r.receiptCurrency, fiscalCounterTaxID: tax.taxID,
        ...(tax.taxPercent == null ? {} : { fiscalCounterTaxPercent: tax.taxPercent }) };
      const prefix = r.receiptType === 'CreditNote' ? 'CreditNote' : r.receiptType === 'DebitNote' ? 'DebitNote' : 'Sale';
      add({ fiscalCounterType: prefix + 'ByTax', ...fields }, tax.salesAmountWithTax);
      add({ fiscalCounterType: prefix + 'TaxByTax', ...fields }, tax.taxAmount);
    }
    for (const payment of r.receiptPayments) add({ fiscalCounterType: 'BalanceByMoneyType', fiscalCounterCurrency: r.receiptCurrency,
      fiscalCounterMoneyType: payment.moneyTypeCode }, payment.paymentAmount);
  }
  const counters = [...buckets.values()].filter(c => c.fiscalCounterValue !== 0);
  const hashInput = buildFiscalDayHashInput({ deviceID: 38293, fiscalDayNo: state.fiscalDayNo, fiscalDayDate: state.openedAt }, counters);
  return { fiscalDayNo: state.fiscalDayNo, receiptCounter: state.counter, fiscalDayCounters: counters,
    fiscalDayDeviceSignature: { hash: crypto.createHash('sha256').update(hashInput).digest('base64'),
      signature: crypto.sign('sha256', Buffer.from(hashInput), key).toString('base64') } };
}
module.exports = { prepare, printed, identity, localTime, closePayload };
