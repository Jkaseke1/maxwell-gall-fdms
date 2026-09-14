import React, { useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { COMPANY } from '../config/company';
const address = a => typeof a === 'string' ? a : ['houseNo','street','city','province','district'].map(k=>a?.[k]).filter(Boolean).join(', ');
const money = n => Number(n || 0).toFixed(2);
const price = n => Number(n || 0).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:6});
export default function FiscalInvoiceModal({invoice, onClose, onPrint}) {
  const [copy,setCopy]=useState(false), [error,setError]=useState('');
  if (!invoice) return null;
  const preview=invoice.status==='LOCAL_PREVIEW';
  const accepted=invoice.status==='FISCALIZED';
  const seller=invoice.seller;
  const display=seller || (preview ? COMPANY : null);
  const title=preview ? 'PRODUCTION PREVIEW' : invoice.receipt_type==='CreditNote' ? 'CREDIT NOTE' : invoice.receipt_type==='DebitNote' ? 'DEBIT NOTE' : 'FISCAL TAX INVOICE';
  const code=invoice.zimra_verification_url?.match(/([A-Fa-f0-9]{16})$/)?.[1]?.toUpperCase().match(/.{4}/g)?.join('-');
  const handlePrint=async()=>{
    try {
      setError('');
      if (invoice.receipt_id) {
        const r=await fetch('/api/print',{method:'POST',headers:{'Content-Type':'application/json','X-Maxwell-Production':'46158'},body:JSON.stringify({invoiceNumber:invoice.invoice_number})});
        const result=await r.json(); if(!r.ok) throw Error(result.error);
        flushSync(()=>setCopy(result.copy));
      } else await onPrint?.();
      window.print();
    } catch(e){setError(e.message);}
  };
  const rows=invoice.line_items || [];
  return createPortal(<div id="invoice-print-root" className="fixed inset-0 z-50 bg-black/70 p-4 flex justify-center items-start overflow-auto">
    <div id="invoice-print-dialog" className="w-full max-w-5xl bg-white rounded-lg my-4">
      <div className="print:hidden flex justify-between bg-emerald-950 text-white p-4 rounded-t-lg"><strong>{title}</strong><div className="flex gap-5"><button onClick={handlePrint}>Print / Save PDF</button><button onClick={onClose}>Close</button></div></div>
      {error&&<p role="alert" className="print:hidden text-red-800 p-4">{error}</p>}
      <article id="printable-invoice" className="p-8 text-slate-900 text-xs">
        <style>{`@media print{@page{size:A4 portrait;margin:12mm}body>:not(#invoice-print-root){display:none!important}html,body{margin:0!important;height:auto!important;overflow:visible!important}#invoice-print-root,#invoice-print-dialog{position:static!important;display:block!important;padding:0!important;margin:0!important;width:100%!important;max-width:none!important;height:auto!important;overflow:visible!important;background:white!important}#printable-invoice{padding:0!important}.print\\:hidden{display:none!important}thead{display:table-header-group}tr,.fiscal-footer{break-inside:avoid}*{print-color-adjust:exact;-webkit-print-color-adjust:exact}}`}</style>
        {!preview&&!seller&&<p className="mb-4 border p-3 text-amber-900">Historical receipt: seller configuration was not captured at issuance. Refer to the original printout and ZIMRA record. Current company settings have not been substituted.</p>}
        <header className="flex justify-between items-start gap-6 mb-7"><div className="flex items-center gap-5"><img src="/max-glass-logo.svg" alt="Maxwell Glass logo" className="w-40 h-24 object-contain" /><div><div className="text-3xl font-black tracking-tight text-emerald-800">MAX GLASS</div><div className="text-sm text-slate-600 mt-1">...giving value to your property</div></div></div><h1 className="text-3xl text-red-700 font-black text-right">{title}{copy&&<span className="block">COPY</span>}</h1></header>
        <div className="grid grid-cols-2 gap-8 mb-6">
          <section className="text-sm leading-6"><h2 className="text-base font-bold text-emerald-900 border-b mb-3 pb-1">SELLER</h2><strong className="text-lg">{display?.name || 'MAXWELL GLASS (see historical record)'}</strong><p>TIN: {display?.tin || invoice.device_id==='46158'&&'2000945150'}</p><p>VAT: {display?.vatNo || '220438802'}</p>{display?.branch&&display.branch!==display.name&&<p>{display.branch}</p>}<p><span className="font-semibold">ZIMRA branch address:</span> {address(display?.address)}</p><p>{display?.contacts?.phoneNo || (preview?COMPANY.telephone:'')}</p><p>{display?.contacts?.email}</p></section>
          <section className="text-sm leading-6"><h2 className="text-base font-bold text-emerald-900 border-b mb-3 pb-1">BUYER</h2><strong className="text-lg">{invoice.customer_name || 'Walk-in Customer'}</strong>{invoice.customer_tin&&<p>TIN: {invoice.customer_tin}</p>}{invoice.customer_vat&&<p>VAT: {invoice.customer_vat}</p>}<p>{address(invoice.buyer_address)}</p><p>{invoice.customer_phone}</p><p>{invoice.customer_email==='N/A'?'':invoice.customer_email}</p></section>
        </div>
        <div className="grid grid-cols-2 gap-2 border-y py-3 mb-5"><p>Invoice No: {invoice.receipt_counter ?? '—'}/{invoice.receipt_number ?? '—'}</p><p>Fiscal day: {invoice.fiscal_day ?? '—'}</p><p>Customer reference No: <strong>{invoice.invoice_number}</strong></p><p>Date and time: {invoice.invoice_date?.replace('T',' ').replace('Z',' UTC')}</p><p>Device serial: {invoice.device_serial || 'ZIMRAVD-1737'}</p><p>Device ID: {invoice.device_id || '46158'}</p></div>
        {invoice.original&&<div className="mb-4 border p-3"><strong>{invoice.receipt_type==='CreditNote'?'CREDITED':'DEBITED'} INVOICE</strong><p>Receipt {invoice.original.globalNo} · Reference {invoice.original.invoiceNo} · {invoice.original.date?.replace('T',' ')}</p><p>Device {invoice.original.deviceId} · Serial {invoice.original.serial}</p></div>}
        <table className="w-full border-collapse text-[11px]"><thead className="bg-emerald-900 text-white"><tr>{['HS / Description','Qty','Unit price excl. tax','Amount excl. tax','VAT','Amount incl. tax'].map(x=><th key={x} className="p-2 text-right first:text-left">{x}</th>)}</tr></thead><tbody>{rows.map((l,i)=><tr key={i} className="border-b even:bg-slate-50"><td className="p-2">{l.description}<div className="text-slate-500">{l.hs_code}</div></td><td className="p-2 text-right">{l.quantity}</td><td className="p-2 text-right">{price(l.unit_price)}</td><td className="p-2 text-right">{money(l.total_amount)}</td><td className="p-2 text-right">{l.tax_percent===null?'—':l.tax_amount===undefined?'See totals':money(l.tax_amount)}</td><td className="p-2 text-right">{l.gross_amount===undefined?'See totals':money(l.gross_amount)}</td></tr>)}</tbody></table>
        <div className="fiscal-footer mt-6 grid grid-cols-2 gap-6">
          <div>{accepted&&invoice.qr_image&&<img src={invoice.qr_image} alt="ZIMRA verification QR" className="w-28 h-28"/>}{code&&<p className="font-mono font-bold">Verification code: {code}</p>}<p className="mt-2 break-all">{invoice.zimra_verification_url&&<a href={invoice.zimra_verification_url} target="_blank" rel="noreferrer">{invoice.zimra_verification_url}</a>}</p></div>
          <div><table className="w-full"><tbody><tr><td>Subtotal excl. tax</td><td className="text-right">{money(invoice.subtotal)}</td></tr>{(invoice.taxes || [{taxPercent:invoice.tax_rate,taxAmount:invoice.tax_amount,salesAmountWithTax:invoice.total_amount}]).map((t,i)=><tr key={i}><td>VAT {t.taxPercent??'Exempt'}{typeof t.taxPercent==='number'?'%':''} · Net {money(t.salesAmountWithTax-t.taxAmount)}</td><td className="text-right">{money(t.taxAmount)}</td></tr>)}<tr className="font-bold border-t"><td>TOTAL {invoice.currency}</td><td className="text-right">{money(invoice.total_amount)}</td></tr>{invoice.payments?.map((p,i)=><tr key={i}><td>{p.moneyTypeCode}</td><td className="text-right">{money(p.paymentAmount)}</td></tr>)}<tr><td>Paid / refunded</td><td className="text-right">{money(invoice.amount_paid)}</td></tr><tr><td>Balance / credit</td><td className="text-right">{money(invoice.balance_due)}</td></tr></tbody></table></div>
        </div>
        {invoice.validation_errors?.length>0&&<pre className="text-red-800 whitespace-pre-wrap">{JSON.stringify(invoice.validation_errors,null,2)}</pre>}
        <details className="print:hidden border rounded p-3 mt-5"><summary>Technical audit details</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify({receiptId:invoice.receipt_id,deviceSignature:invoice.device_signature,serverSignature:invoice.server_signature,verification:invoice.server_verification},null,2)}</pre></details>
        <p className="text-center mt-6">THANK YOU FOR YOUR BUSINESS</p>
      </article>
    </div>
  </div>,document.body);
}


