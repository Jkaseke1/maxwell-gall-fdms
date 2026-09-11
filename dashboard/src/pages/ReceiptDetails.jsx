import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { COMPANY } from '../config/company';

export default function ReceiptDetails() {
  const { receiptId } = useParams();
  const [invoice, setInvoice] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    fetch('/sandbox-api/receipts').then(async r => {
      if (!r.ok) throw Error('Receipt archive unavailable.');
      const found = (await r.json()).find(i => String(i.receipt_id) === receiptId);
      if (!found) throw Error('Receipt not found in the Maxwell Glass archive.');
      if (active) {
        setInvoice(found);
        fetch('/sandbox-api/event', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Maxwell-Sandbox': '38293' }, body: JSON.stringify({ type: 'invoice.viewed', invoiceNumber: found.invoice_number }) })
          .then(r => { if (!r.ok) throw Error('Receipt loaded, but the view could not be added to the audit log.'); })
          .catch(e => { if (active) setError(e.message); });
      }
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [receiptId]);
  const accepted = invoice?.status === 'FISCALIZED' && !invoice?.validation_errors?.length;
  const officialUrl = invoice?.zimra_verification_url?.startsWith('https://fdmstest.zimra.co.zw/') ? invoice.zimra_verification_url : null;
  const field = (label, value) => <div><dt className="text-sm mb-2 uppercase text-slate-800">{label}</dt><dd className="bg-[#dedede] rounded-md px-4 py-3 text-xl break-words">{value || '—'}</dd></div>;
  return <main className="min-h-screen bg-white px-6 py-10 text-slate-900">
    <div className="max-w-lg mx-auto space-y-7">
      <img src="/max-glass-logo.svg" alt="Max Glass" className="w-64 mx-auto" />
      <p className="text-center text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">Maxwell Glass · Sandbox receipt details<br />Local archive view — official validation is provided by ZIMRA.</p>
      {error ? <p role="alert">{error}</p> : !invoice ? <p>Loading saved receipt…</p> : <>
        <h1 className="text-center text-2xl">{accepted ? 'Test receipt accepted' : 'Receipt requires review'}</h1>
        {accepted && <div className="rounded-full bg-green-100 p-5 w-fit mx-auto"><CheckCircle2 className="w-16 h-16 text-green-700" aria-label="Saved response contains no validation errors" /></div>}
        <p className="text-center text-sm text-slate-600">Status from the saved ZIMRA response. Open official validation below to check with ZIMRA.</p>
        <dl className="space-y-6">
          {field('Taxpayer name', COMPANY.name)}
          {field('Trade name', COMPANY.shortName)}
          {field('Company address', COMPANY.address)}
          <div className="grid grid-cols-2 gap-4">{field('TIN', COMPANY.tin)}{field('VAT registration', COMPANY.vatNo)}</div>
          <div className="grid grid-cols-2 gap-4">{field('Invoice date and time', invoice.invoice_date?.replace('T', ' '))}{field('Invoice number', invoice.invoice_number)}</div>
          <div className="grid grid-cols-2 gap-4">{field('Invoice total amount', Number(invoice.total_amount).toFixed(2))}{field('Currency', invoice.currency)}</div>
          <div className="grid grid-cols-2 gap-4">{field('Fiscal receipt number', String(invoice.receipt_number))}{field('Fiscal day', String(invoice.fiscal_day))}</div>
        </dl>
        <p className="text-sm text-slate-600">The company address above comes from Maxwell Glass settings. ZIMRA’s sandbox branch address is managed separately and may still show its test placeholder.</p>
        {officialUrl && <a className="block rounded-full bg-green-600 text-white font-bold text-center px-5 py-4" href={officialUrl} target="_blank" rel="noreferrer">OPEN ZIMRA VALIDATION</a>}
        <details className="border rounded-lg p-4"><summary className="cursor-pointer font-semibold">Review invoice items</summary><ul className="divide-y">{invoice.line_items?.map((item, i) => <li key={i} className="py-3">{item.description}<br /><span className="text-sm">HS {item.hs_code} · Quantity {item.quantity} · {invoice.currency} {Number(item.total_amount).toFixed(2)} before tax</span></li>)}</ul></details>
      </>}
      <Link className="block text-center underline text-green-800" to="/audit">Back to Maxwell Glass audit trail</Link>
    </div>
  </main>;
}
