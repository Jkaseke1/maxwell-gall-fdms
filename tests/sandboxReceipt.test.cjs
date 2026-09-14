const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { prepare } = require('../server/sandbox/receipt');
const { generateReceiptQrData } = require('../src/signatures/qrCodeGenerator');
const { SandboxService } = require('../server/sandbox/service');
const config = require('./fixtures/maxwell-test-config.json');
fs.mkdirSync(path.resolve('test-results'), { recursive: true });
const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const key = privateKey.export({ type: 'pkcs8', format: 'pem' });
const input = { invoiceNumber: 'LOCAL-UNIT-001', currency: 'USD', taxId: 517, amountPaid: 0,
  items: [{ description: 'Test float glass', hsCode: '7005', unitCost: 10, qty: 1 }], customer: { name: 'Test Consumer', taxDetails: false } };
const counter = { nextCounter: 1, nextGlobalNo: 1, previousHash: null };
test('QR uses MD5 of bytes, not encoded text', () => {
  assert.equal(generateReceiptQrData(Buffer.from('abc').toString('base64')), '900150983CD24FB0');
});
test('correct schema shape, arithmetic, private signing and buyer omission', () => {
  const p = prepare(input, config, counter, key);
  assert.equal(p.receipt.receiptType, 'FiscalInvoice'); assert.equal(p.receipt.receiptGlobalNo, 1);
  assert.equal(p.receipt.receiptTotal, 11.55); assert.equal(p.receipt.receiptLinesTaxInclusive, false);
  assert.deepEqual(p.receipt.receiptPayments, [{ moneyTypeCode: 'Credit', paymentAmount: 11.55 }]);
  assert.equal(p.receipt.buyerData, undefined); assert.equal(Buffer.from(p.receipt.receiptDeviceSignature.hash, 'base64').length, 32);
  const second = prepare(input, config, { ...counter, previousHash: p.receipt.receiptDeviceSignature.hash }, key);
  assert.notEqual(p.receipt.receiptDeviceSignature.hash, second.receipt.receiptDeviceSignature.hash);
});
test('buyer tax details and address use the API structure', () => {
  const p = prepare({ ...input, customer: { taxDetails: true, name: 'Synthetic Unit Test Buyer', tin: '1234567890', vat: '123456789', city: 'Harare' } }, config, counter, key);
  assert.equal(p.receipt.buyerData.vatNumber, '123456789');
  assert.deepEqual(p.receipt.buyerData.buyerAddress, { city: 'Harare' });
});
test('bad HS codes, TIN, stale taxes and wrong company are rejected', () => {
  assert.throws(() => prepare({ ...input, items: [{ ...input.items[0], hsCode: '' }] }, config, counter, key));
  assert.throws(() => prepare({ ...input, customer: { taxDetails: true, name: 'Buyer', tin: '123' } }, config, counter, key));
  assert.throws(() => prepare({ ...input, taxId: 515 }, config, counter, key));
  assert.throws(() => prepare(input, { ...config, testFixture: false, taxPayerTIN: '1234567890' }, counter, key));
});

test('VAT zero-rated and exempt lines require all eight HS digits', () => {
  for (const taxId of [1, 2]) {
    assert.throws(() => prepare({ ...input, taxId }, config, counter, key), /8 digit HS/);
    const p = prepare({ ...input, taxId, items: [{ ...input.items[0], hsCode: taxId === 1 ? '99003000' : '99002000' }] }, config, counter, key);
    assert.equal(p.receipt.receiptTotal, 10);
  }
});

test('expired fiscal day is not ready and cannot submit a new receipt', async () => {
  const directory = fs.mkdtempSync(path.resolve('test-results/unit-state-'));
  const request = async url => {
    if (url.endsWith('GetConfig')) return { ...config, taxPayerDayMaxHrs: 24 };
    if (url.endsWith('GetStatus')) return { fiscalDayStatus: 'FiscalDayOpened', lastFiscalDayNo: 1, lastReceiptGlobalNo: 0 };
    throw Error('No fiscal mutation should be sent');
  };
  const service = new SandboxService({ directory, key, request, verifyReceipt: async()=>({verified:true}) });
  service.state.fiscalDayNo = 1;
  service.state.openedAt = new Date(Date.now() + 7200000 - 25 * 3600000).toISOString().slice(0, 19);
  assert.equal((await service.live()).ready, false);
  assert.equal((await service.live()).expired, true);
  await assert.rejects(service.submit(input), /expired/);
  assert.equal(service.state.pending, undefined);
});
test('timeout retry reuses identical signed bytes; duplicate never calls ZIMRA again', async () => {
  const directory = fs.mkdtempSync(path.resolve('test-results/unit-state-'));
  const sent = []; let fail = true; let serverLast = 0;
  const request = async (url, body) => {
    if (url.endsWith('GetConfig')) return config;
    if (url.endsWith('GetStatus')) return { fiscalDayStatus: 'FiscalDayOpened', lastFiscalDayNo: 1, lastReceiptGlobalNo: serverLast };
    if (url.endsWith('SubmitReceipt')) {
      sent.push(JSON.stringify(body));
      if (fail) { fail = false; throw Error('Synthetic timeout'); }
      serverLast = 1;
      return { receiptID: 123, operationID: 'unit', receiptServerSignature: { signature: 'unit-test', hash: 'unit' } };
    }
    throw Error('Unexpected request');
  };
  const service = new SandboxService({ directory, key, request, verifyReceipt: async()=>({verified:true}) });
  service.state.fiscalDayNo = 1;
  service.state.openedAt = new Date(Date.now() + 7200000 - 60000).toISOString().slice(0, 19);
  await assert.rejects(service.submit(input), /retained/);
  assert.ok(service.state.pending);
  const result = await service.submit(input);
  assert.equal(result.status, 'FISCALIZED'); assert.equal(sent[0], sent[1]);
  await service.submit(input); assert.equal(sent.length, 2);
  await assert.rejects(service.submit({ ...input, amountPaid: 1 }), /already used/);
});

