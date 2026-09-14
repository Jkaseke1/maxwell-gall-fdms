const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {prepare,closePayload}=require('../server/sandbox/receipt');
const {SandboxService}=require('../server/sandbox/service');
const {reports}=require('../server/sandbox/reports');
const {buildCounterString}=require('../src/signatures/fiscalDaySignature');
const config=require('./fixtures/maxwell-test-config.json');
const key=crypto.generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({type:'pkcs8',format:'pem'});
const line={description:'Synthetic service',hsCode:'99001000',unitCost:10,qty:1};
const base={invoiceNumber:'LOCAL-72-001',currency:'USD',taxId:517,amountPaid:0,items:[line],customer:{taxDetails:false}};
const counter={nextCounter:1,nextGlobalNo:1};
test('mixed VAT and discounts reconcile, seller snapshot captured, input immutable',()=>{
 const input={...base,items:[line,{...line,unitCost:2,discount:true},{...line,taxId:2,hsCode:'99002000'},{...line,taxId:1,hsCode:'99003000'}]};
 const before=JSON.stringify(input),p=prepare(input,config,counter,key);
 assert.equal(p.total,29.24);assert.equal(p.taxAmount,1.24);assert.equal(p.receipt.receiptTaxes.length,3);assert.equal(p.seller.tin,'2000945150');assert.equal(JSON.stringify(input),before);
 assert.throws(()=>prepare({...base,items:[{...line,discount:true}]},config,counter,key),/Discount exceeds/);
});
test('credit-note signs, precision and required references',()=>{
 const credit=prepare({...base,receiptType:'CreditNote',originalReceiptId:123,notes:'return',amountPaid:11.55},config,counter,key);
 assert.equal(credit.total,-11.55);assert.equal(credit.receipt.receiptPayments[0].paymentAmount,-11.55);assert.equal(credit.receipt.receiptLines[0].receiptLinePrice,-10);
 assert.throws(()=>prepare({...base,receiptType:'DebitNote'},config,counter,key),/invoices and credit notes only/);
 assert.throws(()=>prepare({...base,items:[{...line,unitCost:0.1234567}]},config,counter,key),/six decimal/);
 assert.equal(prepare({...base,items:[{...line,unitCost:1.123456}]},config,counter,key).subtotal,1.12);
});
test('closing counters keep credit negative and payments follow enum order',()=>{
 const invoice=prepare(base,config,counter,key),credit=prepare({...base,receiptType:'CreditNote',originalReceiptId:123,notes:'return'},config,counter,key);
 const rows=[invoice,credit].map(prepared=>({fiscalDayNo:3,prepared}));
 const payload=closePayload({receipts:rows,fiscalDayNo:3,counter:2,openedAt:'2026-09-07T09:00:00'},key);
 assert.equal(payload.fiscalDayCounters.find(t=>t.fiscalCounterType==='CreditNoteByTax').fiscalCounterValue,-11.55);
 assert.ok(!payload.fiscalDayCounters.some(t=>t.fiscalCounterType==='BalanceByMoneyType'));
 const str=buildCounterString(['Card','Cash','BankTransfer'].map(fiscalCounterMoneyType=>({fiscalCounterType:'BalanceByMoneyType',fiscalCounterCurrency:'USD',fiscalCounterMoneyType,fiscalCounterValue:1})));
 assert.ok(str.indexOf('CASH')<str.indexOf('CARD'));assert.ok(str.indexOf('CARD')<str.indexOf('BANKTRANSFER'));
 const report=reports({receipts:rows,fiscalDayNo:3,openedAt:'2026-09-07T09:00:00'},config)[0];assert.equal(report.type,'X REPORT');assert.equal(report.currencies.USD.gross,0);
});
test('over-credit, wrong currency and clock rollback are blocked before sending',async()=>{
 const directory=fs.mkdtempSync(path.resolve('test-results/unit-state-'));
 const original=prepare(base,config,counter,key,'2026-09-06T10:00:00');
 const request=async url=>{if(url.endsWith('GetConfig'))return config;if(url.endsWith('GetStatus'))return{fiscalDayStatus:'FiscalDayOpened',lastFiscalDayNo:2,lastReceiptGlobalNo:1};throw Error('Must not submit');};
 const service=new SandboxService({directory,key,request,verifyReceipt:async()=>({verified:true})});
 service.state={deviceId:38293,lastGlobalNo:1,counter:0,fiscalDayNo:2,openedAt:new Date(Date.now()+7200000-60000).toISOString().slice(0,19),receipts:[{prepared:original,response:{receiptID:123},printed:{status:'FISCALIZED'},input:base}]};
 await assert.rejects(service.submit({...base,invoiceNumber:'NEW-CREDIT',receiptType:'CreditNote',notes:'return',originalReceiptId:123,items:[{...line,unitCost:20}]}),/Credit exceeds/);
 await assert.rejects(service.submit({...base,invoiceNumber:'NEW-CREDIT',receiptType:'CreditNote',notes:'return',originalReceiptId:123,currency:'ZWG'}),/currency/);
 service.state.receipts[0].prepared.receipt.receiptDate='2099-01-01T00:00:00';
 await assert.rejects(service.submit({...base,invoiceNumber:'NEW-INVOICE'}),/clock/);
 assert.equal(service.state.pending,undefined);
});

test('real FDMS receipt and day signatures verify, altered acknowledgements fail',async()=>{
 const {verifyReceipt,verifyDay}=require('../server/sandbox/certificates');
 const v=require('./fixtures/maxwell-signature-vectors.json');
 const request=async()=>v.certificate;
 assert.equal((await verifyReceipt(v.prepared,v.response,request)).verified,true);
 assert.equal((await verifyDay(v.day,v.day.status,request)).verified,true);
 await assert.rejects(verifyReceipt(v.prepared,{...v.response,receiptID:v.response.receiptID+1},request),/signature verification failed/);
 const bad=structuredClone(v.day);bad.closing.payload.fiscalDayCounters[0].fiscalCounterValue+=1;
 await assert.rejects(verifyDay(bad,bad.status,request),/signature verification failed/);
});
test('advance day warning uses server threshold without blocking a valid day',async()=>{
 const directory=fs.mkdtempSync(path.resolve('test-results/unit-state-'));
 const request=async url=>url.endsWith('GetConfig')?{...config,taxpayerDayEndNotificationHrs:2,taxPayerDayMaxHrs:24}:{fiscalDayStatus:'FiscalDayOpened',lastFiscalDayNo:1,lastReceiptGlobalNo:0};
 const service=new SandboxService({directory,key,request});service.state.fiscalDayNo=1;service.state.openedAt=new Date(Date.now()+7200000-23*3600000).toISOString().slice(0,19);
 const result=await service.live();assert.equal(result.endingSoon,true);assert.equal(result.ready,true);assert.match(result.message,/ends in/);
});
test('automatic rollover is scheduled before ZIMRA day expiry',async()=>{
 const directory=fs.mkdtempSync(path.resolve('test-results/unit-state-'));
 const request=async url=>url.endsWith('GetConfig')?config:{fiscalDayStatus:'FiscalDayOpened',lastFiscalDayNo:4,lastReceiptGlobalNo:0};
 const service=new SandboxService({directory,key,request});
 service.state={deviceId:38293,lastGlobalNo:0,counter:0,fiscalDayNo:4,openedAt:new Date(Date.now()+7200000-22*3600000).toISOString().slice(0,19),receipts:[]};
 const result=await service.autoRollover();
 assert.equal(result.action,'scheduled'); assert.ok(Date.parse(result.closeAt)>Date.now());
});
