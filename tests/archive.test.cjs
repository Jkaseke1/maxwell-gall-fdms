const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
fs.mkdirSync(path.resolve('test-results'), { recursive: true });
const { Archive } = require('../server/sandbox/archive');
const temp = () => fs.mkdtempSync(path.resolve('test-results/archive-unit-'));
test('number reservation skips legacy numbers, is idempotent and survives restart', () => {
  const directory = temp(), a = new Archive(directory), date = new Date('2026-09-05T12:00:00Z');
  assert.equal(a.reserve('draft-0001', ['05092601', '05092602'], date), '05092603');
  assert.equal(a.reserve('draft-0001', [], date), '05092603');
  assert.equal(new Archive(directory).reserve('draft-0002', [], date), '05092604');
  assert.equal(new Archive(directory).reserve('draft-0003', [], new Date('2026-09-05T22:00:00Z')), '06092601');
});
test('event history detects modification and exports complete invoice data', () => {
  const directory = temp(), a = new Archive(directory);
  a.log('invoice.draft_saved', { input: { invoiceNumber: 'ONE', total: 10 } });
  const r = { digest: 'original', input: { invoiceNumber: 'ONE' }, prepared: { receipt: { receiptTotal: 10 } }, printed: { receipt_id: 1, status: 'FISCALIZED' } };
  a.saveReceipt(r); a.saveReceipt(r);
  assert.equal(a.receipts().length, 1);
  assert.equal(a.export().invoices[0].prepared.receipt.receiptTotal, 10);
  assert.throws(() => a.saveReceipt({ ...r, digest: 'changed' }), /overwritten/);
  const file = path.join(directory, 'events.jsonl');
  fs.writeFileSync(file, fs.readFileSync(file,'utf8').replace('"total":10', '"total":99'));
  assert.throws(() => new Archive(directory), /integrity/);
});
