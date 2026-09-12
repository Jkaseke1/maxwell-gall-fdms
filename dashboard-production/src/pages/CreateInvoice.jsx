import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Eye, FileText, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import FiscalInvoiceModal from '../components/FiscalInvoiceModal';
import { PRODUCTION_TAXES, calculateInvoice, buildInvoicePreview } from '../utils/invoicePreview.mjs';

const PRESETS = [
  { description: '6mm Clear Float Glass Supply & Cutting', unitCost: 45, hsCode: '70052900' },
  { description: 'Glass Fitting & Glazing Services', unitCost: 30, hsCode: '99001000' },
  { description: 'Aluminium Window Frame & Fitting', unitCost: 120, hsCode: '76101000' },
];
const blankCustomer = { name: '', attention: '', phone: '', email: '', customerId: '', taxDetails: false, tin: '', vat: '', address: '', city: '', street: '', houseNo: '', province: '' };
const defaultLines = PRESETS.slice(0, 2).map(x => ({ ...x, qty: 1 }));

export default function CreateInvoice({ mode = 'invoice' }) {
  const isCredit = mode === 'credit';
  const receiptType = isCredit ? 'CreditNote' : 'FiscalInvoice';
  const storageKey = isCredit ? 'maxwell-credit-note-draft-id' : 'maxwell-invoice-draft-id';
  const [draftId, setDraftId] = useState(() => sessionStorage.getItem(storageKey) || crypto.randomUUID());
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [customer, setCustomer] = useState(blankCustomer);
  const [items, setItems] = useState(defaultLines);
  const [taxId, setTaxId] = useState(517);
  const [currency, setCurrency] = useState('USD');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [amountPaid, setAmountPaid] = useState(0);
  const [originalReceiptId, setOriginalReceiptId] = useState('');
  const [notes, setNotes] = useState('');
  const [live, setLive] = useState(null), [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [draftStatus, setDraftStatus] = useState('');
  const [modal, setModal] = useState(null);
  const [processedQuery, setProcessedQuery] = useState('');
  const api = async (route, body) => {
    const response = await fetch('/api/' + route, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Maxwell-Production': '46158' }, body: JSON.stringify(body) });
    const payload = await response.json(); if (!response.ok) throw Error(payload.error || 'Request failed.'); return payload;
  };
  const refresh = async () => {
    try { const [status, receipts] = await Promise.all([api('status'), api('receipts')]); setLive(status); setHistory(receipts); } catch (e) { setError('Production API: ' + e.message); }
  };
  useEffect(() => { refresh(); const timer = setInterval(refresh, 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let active = true; sessionStorage.setItem(storageKey, draftId); setInvoiceNumber('');
    api('number', { draftId }).then(r => { if (!active) return; if (r.completed) { setDraftId(crypto.randomUUID()); return; }
      if (r.draft?.receiptType === receiptType) { setItems(r.draft.items); setTaxId(r.draft.taxId); setCurrency(r.draft.currency); setCustomer(r.draft.customer); setAmountPaid(r.draft.amountPaid); setOriginalReceiptId(r.draft.originalReceiptId || ''); setNotes(r.draft.notes || ''); setPaymentMethod(r.draft.paymentMethod || 'Cash'); }
      setInvoiceNumber(r.invoiceNumber); setDraftStatus('Saved automatically');
    }).catch(e => active && setError(e.message)); return () => { active = false; };
  }, [draftId, storageKey, receiptType]);
  useEffect(() => {
    if (!invoiceNumber) return; const timer = setTimeout(() => api('draft', { draftId, invoiceNumber, items, taxId, currency, customer, amountPaid, receiptType, originalReceiptId, notes, paymentMethod }).then(() => setDraftStatus('Saved automatically')).catch(e => setDraftStatus(e.message)), 700); return () => clearTimeout(timer);
  }, [draftId, invoiceNumber, items, taxId, currency, customer, amountPaid, receiptType, originalReceiptId, notes, paymentMethod]);
  const figures = useMemo(() => { try { return calculateInvoice(items, taxId, receiptType); } catch { return { subtotal: 0, taxAmount: 0, totalAmount: 0 }; } }, [items, taxId, receiptType]);
  const updateLine = (index, key, value) => setItems(items.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const addLine = preset => setItems([...items, preset ? { ...preset, qty: 1 } : { description: '', unitCost: 0, qty: 1, hsCode: '' }]);
  const review = () => { try { setModal(buildInvoicePreview({ items, taxId, invoiceNumber, currency, customer, amountPaid, receiptType, paymentMethod, notes })); } catch (e) { setError(e.message); } };
  const submit = async () => { setBusy(true); setError(''); try { const result = await api('receipts', { draftId, items, taxId, invoiceNumber, currency, customer, amountPaid, receiptType, originalReceiptId, notes, paymentMethod }); setModal(result); setDraftId(crypto.randomUUID()); await refresh(); } catch (e) { setError(e.message); await refresh(); } finally { setBusy(false); } };
  const isOpen = live?.status?.fiscalDayStatus === 'FiscalDayOpened';
  const acceptedInvoices = history.filter(r => r.status === 'FISCALIZED' && (!r.receipt_type || r.receipt_type === 'FiscalInvoice'));
  const processed = history.filter(r => (isCredit ? r.receipt_type === 'CreditNote' : (!r.receipt_type || r.receipt_type === 'FiscalInvoice'))).slice().reverse();
  const visibleProcessed = processed.filter(record => {
    const query = processedQuery.trim().toLowerCase();
    if (!query) return true;
    return [record.invoice_number, record.customer_name, record.currency, record.receipt_id, record.receipt_type, record.status, record.invoice_date]
      .filter(Boolean).some(value => String(value).toLowerCase().includes(query));
  });
  const formatRecordDate = value => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' }) : 'Date unavailable';
  const sign = isCredit ? -1 : 1;
  return <div className="erp-page">
    <section className="erp-page-heading"><div><span className="erp-eyebrow">{isCredit ? 'CREDIT MANAGEMENT' : 'SALES'}</span><h2>{isCredit ? 'Create credit note' : 'Create fiscal invoice'}</h2><p>{isCredit ? 'Choose an accepted invoice, state the reason, and issue a signed reversal.' : 'Prepare, review and submit a tax invoice from one focused workspace.'}</p></div><div className="erp-draft"><FileText size={17} /><span>Document no.<b>{invoiceNumber || 'Loading…'}</b><small>{draftStatus}</small></span></div></section>

    <section className={'erp-device-card ' + (isOpen ? 'ready' : 'attention')}>
      <div className="erp-device-title">{isOpen ? <CheckCircle size={18} /> : <AlertCircle size={18} />}<span><b>{isOpen ? 'Ready to fiscalise' : 'Fiscal day needs attention'}</b><small>{live?.message || 'Connecting to Maxwell Glass device…'}</small></span></div>
      <div className="erp-device-stats"><span><small>Fiscal day</small><b>{live?.fiscalDayNo ?? '—'}</b></span><span><small>Next receipt</small><b>{live?.nextGlobalNo ?? '—'}</b></span><span><small>Day counter</small><b>{live?.nextCounter ?? '—'}</b></span><span><small>Currency</small><b>USD · ZWG</b></span></div>
      <div className="erp-device-actions"><button type="button" onClick={refresh} className="erp-text-button"><RefreshCw size={14} /> Refresh</button><a href="/settings" className="erp-secondary-button">Manage fiscal day in Settings</a></div>
    </section>

    <form onSubmit={e => { e.preventDefault(); review(); }} className="erp-document-grid">
      <div className="erp-form-stack">
        {isCredit && <section className="erp-card"><div className="erp-card-heading"><h3>Original invoice</h3><p>Only accepted Maxwell Glass invoices are available.</p></div><label className="erp-field">Accepted invoice<select required value={originalReceiptId} onChange={e => { setOriginalReceiptId(e.target.value); const original = history.find(r => String(r.receipt_id) === e.target.value); if (original) { setCurrency(original.currency); setItems((original.line_items || []).map(line => ({ description: line.description, unitCost: Math.abs(Number(line.unit_price || 0)), qty: line.quantity, hsCode: line.hs_code }))); setCustomer(current => ({ ...current, name: original.customer_name || '', tin: original.customer_tin || '', vat: original.customer_vat || '', phone: original.customer_phone || '', email: original.customer_email && original.customer_email !== 'N/A' ? original.customer_email : '', address: typeof original.buyer_address === 'string' ? original.buyer_address : [original.buyer_address?.houseNo, original.buyer_address?.street, original.buyer_address?.city, original.buyer_address?.province].filter(Boolean).join(', '), taxDetails: Boolean(original.customer_tin) })); } }}><option value="">Choose original invoice</option>{acceptedInvoices.map(r => <option key={r.receipt_id} value={r.receipt_id}>{r.invoice_number} · {r.currency} {r.total_amount.toFixed(2)}</option>)}</select></label><label className="erp-field">Reason for credit note<input required value={notes} placeholder="For example: damaged glass returned" onChange={e => setNotes(e.target.value)} /></label></section>}
        <section className="erp-card"><div className="erp-card-heading"><h3>Customer / buyer details</h3><p>Enter the buyer information that should appear on the invoice and validation record.</p></div><div className="erp-field-grid"><label className="erp-field wide">Customer name<input required value={customer.name} placeholder="Walk-in customer or business name" onChange={e => setCustomer({ ...customer, name: e.target.value })} /></label><label className="erp-field">TIN<input value={customer.tin} placeholder="10-digit TIN" onChange={e => setCustomer({ ...customer, tin: e.target.value })} /></label><label className="erp-field">VAT<input value={customer.vat} placeholder="9-digit VAT (optional)" onChange={e => setCustomer({ ...customer, vat: e.target.value })} /></label><label className="erp-field wide">Address<input value={customer.address} placeholder="Buyer physical address" onChange={e => setCustomer({ ...customer, address: e.target.value })} /></label><label className="erp-field">Phone<input value={customer.phone} placeholder="Buyer phone" onChange={e => setCustomer({ ...customer, phone: e.target.value })} /></label><label className="erp-field">Email<input type="email" value={customer.email} placeholder="buyer@example.com" onChange={e => setCustomer({ ...customer, email: e.target.value })} /></label></div><label className="erp-check"><input type="checkbox" checked={customer.taxDetails} onChange={e => setCustomer({ ...customer, taxDetails: e.target.checked })} /> Include registered buyer tax details for ZIMRA</label><p className="erp-help">Leave unchecked for a consumer sale. Check it when the TIN belongs to a registered business.</p></section>
        <section className="erp-card"><div className="erp-card-heading row"><div><h3>Items</h3><p>Every line needs a valid HS code.</p></div><button type="button" onClick={() => addLine()} className="erp-secondary-button"><Plus size={16} /> Add line</button></div><div className="erp-presets"><span>Quick add</span>{PRESETS.map(p => <button type="button" key={p.description} onClick={() => addLine(p)}>{p.description.replace(' Supply & Cutting', '').replace(' & Glazing Services', '')}</button>)}</div><div className="erp-lines">{items.map((item, index) => <div className="erp-line" key={index}><label className="erp-field line-description"><span>Description</span><input required value={item.description} onChange={e => updateLine(index, 'description', e.target.value)} /></label><label className="erp-field"><span>HS code</span><input required inputMode="numeric" maxLength="8" value={item.hsCode || ''} onChange={e => updateLine(index, 'hsCode', e.target.value)} /></label><label className="erp-field"><span>Rate</span><input required type="number" min="0.000001" step="0.000001" value={item.unitCost} onChange={e => updateLine(index, 'unitCost', e.target.value)} /></label><label className="erp-field"><span>Qty</span><input required type="number" min="0.000001" step="0.000001" value={item.qty} onChange={e => updateLine(index, 'qty', e.target.value)} /></label><div className="erp-line-total"><small>Total</small><b>{currency} {(sign * Number(item.unitCost || 0) * Number(item.qty || 0)).toFixed(2)}</b></div><button type="button" aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems(items.filter((_, i) => i !== index))} className="erp-delete"><Trash2 size={16} /></button></div>)}</div></section>
      </div>
      <aside className="erp-summary-stack"><section className="erp-card erp-sticky"><div className="erp-card-heading"><h3>Document settings</h3></div><label className="erp-field">Currency<select value={currency} onChange={e => setCurrency(e.target.value)}><option value="USD">USD — US Dollar</option><option value="ZWG">ZWG — ZiG</option></select></label><label className="erp-field">VAT category<select value={taxId} onChange={e => setTaxId(Number(e.target.value))}>{PRODUCTION_TAXES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label><label className="erp-field">Payment method<select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>{['Cash', 'Card', 'MobileWallet', 'BankTransfer', 'Other'].map(v => <option key={v}>{v}</option>)}</select></label><label className="erp-field">{isCredit ? 'Amount refunded' : 'Amount paid'}<input type="number" min="0" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} /></label>{!isCredit && <label className="erp-field">Internal note<input value={notes} onChange={e => setNotes(e.target.value)} /></label>}<div className="erp-total-block"><div><span>Subtotal</span><b>{currency} {figures.subtotal.toFixed(2)}</b></div><div><span>VAT</span><b>{currency} {figures.taxAmount.toFixed(2)}</b></div><div className="grand"><span>{isCredit ? 'Credit total' : 'Invoice total'}</span><b>{currency} {figures.totalAmount.toFixed(2)}</b></div></div><button type="button" disabled={busy || !live?.ready || !invoiceNumber} onClick={submit} className="erp-primary-button"><Send size={17} /> {busy ? 'Processing…' : isCredit ? 'Submit credit note' : 'Submit invoice'}</button><button type="submit" className="erp-review-button">Review before submission</button></section></aside>
    </form>
    {error && <p className="erp-error" role="alert"><AlertCircle size={16} /> {error}</p>}
    <section className="erp-card erp-processed-card"><div className="erp-card-heading row"><div><h3>Processed {isCredit ? 'credit notes' : 'invoices'}</h3><p>Search by date, invoice number, customer, currency, receipt or status.</p></div><span className="erp-count-badge">{processed.length} recorded</span></div>{processed.length === 0 ? <div className="erp-empty">No processed {isCredit ? 'credit notes' : 'invoices'} yet.</div> : <><div className="erp-record-toolbar"><label className="erp-record-search"><span>Search records</span><input value={processedQuery} onChange={e => setProcessedQuery(e.target.value)} placeholder="Invoice no., customer, date, receipt…" /></label><small>{visibleProcessed.length} shown</small></div><div className="erp-record-head"><span>Document</span><span>Date</span><span>Customer</span><span>Amount</span><span>Status</span><span></span></div><div className="erp-processed-list">{visibleProcessed.slice(0, 50).map(record => <div className="erp-processed-row" key={record.digest}><div className="erp-processed-main"><span className="erp-doc-type">{record.receipt_type === 'CreditNote' ? 'CREDIT NOTE' : 'INVOICE'}</span><strong>{record.invoice_number}</strong><small>Receipt {record.receipt_id} · Fiscal day {record.fiscal_day}</small></div><span className="erp-record-date">{formatRecordDate(record.invoice_date)}</span><span className="erp-record-customer">{record.customer_name || 'Walk-in customer'}</span><div className="erp-processed-amount"><b>{record.currency} {Number(record.total_amount || 0).toFixed(2)}</b><small>{record.receipt_type === 'CreditNote' ? 'Credit note' : 'Invoice'}</small></div><span className="erp-record-status">{record.status === 'FISCALIZED' ? 'Accepted by ZIMRA' : record.status}</span><button type="button" className="erp-view-button" onClick={() => setModal(record)}><Eye size={15} /> View</button></div>)}</div>{visibleProcessed.length === 0 && <div className="erp-empty">No records match “{processedQuery}”.</div>}</>}</section>
    {modal && <FiscalInvoiceModal invoice={modal} onClose={() => setModal(null)} onPrint={() => api('event', { type: 'invoice.print_requested', invoiceNumber: modal.invoice_number }).catch(() => {})} />}
  </div>;
}

