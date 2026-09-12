function reports(state, config) {
  const days = [...new Set(state.receipts.map(r => r.fiscalDayNo).concat(state.fiscalDayNo || []))].sort((a,b)=>a-b);
  return days.map(day => {
    const rows = state.receipts.filter(r => r.fiscalDayNo === day);
    const closed = state.closedDays?.[day];
    const currencies = {};
    for (const row of rows) {
      const r = row.prepared.receipt;
      const c = currencies[r.receiptCurrency] ||= { taxes:{}, payments:{}, documents:{}, net:0, tax:0, gross:0 };
      const d = c.documents[r.receiptType] ||= { count:0, total:0 }; d.count++; d.total += r.receiptTotal;
      c.gross += r.receiptTotal;
      for (const t of r.receiptTaxes) { const b = c.taxes[t.taxID] ||= { taxID:t.taxID, rate:t.taxPercent ?? null, net:0, tax:0, gross:0 }; b.net+=t.salesAmountWithTax-t.taxAmount; b.tax+=t.taxAmount; b.gross+=t.salesAmountWithTax; c.net+=t.salesAmountWithTax-t.taxAmount; c.tax+=t.taxAmount; }
      for (const p of r.receiptPayments) c.payments[p.moneyTypeCode] = (c.payments[p.moneyTypeCode] || 0)+p.paymentAmount;
    }
    const snapshot = rows.find(r => r.prepared.seller)?.prepared.seller;
    const round = n=>Math.round(n*100)/100;
    for(const c of Object.values(currencies)) {
      for(const k of ['net','tax','gross']) c[k]=round(c[k]);
      for(const t of Object.values(c.taxes)) for(const k of ['net','tax','gross']) t[k]=round(t[k]);
      for(const d of Object.values(c.documents)) d.total=round(d.total);
      for(const k of Object.keys(c.payments)) c.payments[k]=round(c.payments[k]);
    }
    return { fiscalDayNo:day, type:closed ? 'Z REPORT' : 'X REPORT', environment:'PRODUCTION', deviceId:46158, serial:'ZIMRAVD-1737',
      seller:snapshot, config:closed?.config || config, openedAt:closed?.openedAt || (day===state.fiscalDayNo ? state.openedAt : null),
      closedAt:closed?.status?.fiscalDayClosed, reconciliationMode:closed?.status?.fiscalDayReconciliationMode,
      currencies, receiptCount:rows.length, pending:state.pending?.fiscalDayNo === day, closure:closed?.status || null,
      warning: !closed && day !== state.fiscalDayNo ? 'Historical closure evidence was not captured in this archive; this is a reconstruction, not a Z report.' : null };
  });
}
const escape = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function printable(r) {
  const money=n=>Number(n||0).toFixed(2);
  return '<!doctype html><html><head><meta charset="utf-8"><title>Maxwell Glass '+escape(r.type)+'</title><style>body{font:14px Arial;max-width:760px;margin:30px auto;color:#123}table{border-collapse:collapse;width:100%;margin:16px 0}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:right}td:first-child,th:first-child{text-align:left}h1,h2{color:#18562d}@media print{@page{size:A4;margin:15mm}button{display:none}body{margin:0}tr{break-inside:avoid}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>'+escape(r.type)+' — PRODUCTION</h1><h2>MAXWELL GLASS</h2><p>TIN 2000945150 · VAT 220438802</p><p>'+escape(r.seller ? ['houseNo','street','city','province'].map(k=>r.seller.address?.[k]).filter(Boolean).join(', ') : 'Historical seller configuration unavailable')+'</p><p>Device 46158 · ZIMRAVD-1737</p><p>Fiscal day '+r.fiscalDayNo+' · Opened '+escape(r.openedAt)+' · Closed '+escape(r.closedAt || 'Not confirmed')+'</p>'+ (r.warning?'<p>'+escape(r.warning)+'</p>':'')+Object.entries(r.currencies).sort().map(([currency,c])=>'<h2>'+escape(currency)+'</h2><table><tr><th>Tax category</th><th>Net</th><th>Tax</th><th>Gross</th></tr>'+Object.values(c.taxes).map(t=>'<tr><td>'+escape(t.rate===null?'Exempt':t.rate+'%')+'</td><td>'+money(t.net)+'</td><td>'+money(t.tax)+'</td><td>'+money(t.gross)+'</td></tr>').join('')+'<tr><th>Total</th><th>'+money(c.net)+'</th><th>'+money(c.tax)+'</th><th>'+money(c.gross)+'</th></tr></table><h3>Documents</h3>'+Object.entries(c.documents).map(([t,d])=>'<p>'+escape(t)+': '+d.count+' · '+money(d.total)+'</p>').join('')+'<h3>Payments</h3>'+Object.entries(c.payments).map(([t,n])=>'<p>'+escape(t)+': '+money(n)+'</p>').join('')).join('')+'<p>Receipt count: '+r.receiptCount+'</p></body></html>';
}
module.exports = { reports, printable };



