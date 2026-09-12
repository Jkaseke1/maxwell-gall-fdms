import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
export default function Audit() {
  const [backupStatus,setBackupStatus]=useState('');
  const backup=async()=>{try{const r=await fetch('/api/backup',{method:'POST',headers:{'Content-Type':'application/json','X-Maxwell-Production':'46158'},body:'{}'});const x=await r.json();if(!r.ok)throw Error(x.error);setBackupStatus('Verified local production backup: '+x.destination+'. Device keys remain in the protected production certificate directory.');}catch(e){setBackupStatus(e.message);}};
  const [events, setEvents] = useState([]), [error, setError] = useState(''), [search, setSearch] = useState('');
  const [invoices, setInvoices] = useState([]);
  const refresh = async () => {
    try { const [r, records] = await Promise.all([fetch('/api/audit'), fetch('/api/archive')]); if (!r.ok || !records.ok) throw Error('Audit archive unavailable'); setEvents(await r.json()); setInvoices(await records.json()); setError(''); }
    catch (e) { setError(e.message); }
  };
  useEffect(() => { refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer); }, []);
  const filtered = events.filter(e => JSON.stringify(e).toLowerCase().includes(search.toLowerCase()));
  return <section className="space-y-4 max-w-6xl mx-auto">
    <h1 className="text-2xl font-bold">Maxwell Glass invoice audit trail</h1>
    <p className="text-sm">Production device 46158 · Latest 500 events. Export includes all archived invoices, signed payloads, ZIMRA responses, draft history and numbering reservations.</p>
    <div className="flex gap-3 items-center flex-wrap">
      <input aria-label="Search audit trail" placeholder="Search invoice number, event or error" className="border rounded p-2 flex-1" value={search} onChange={e => setSearch(e.target.value)} />
      <button onClick={refresh} className="border rounded p-2">Refresh audit log</button>
      <button onClick={backup} className="border rounded p-2">Create verified local backup</button>
      <a href="/api/export" className="bg-emerald-700 text-white rounded p-2">Download full audit archive (JSON)</a>
    </div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {backupStatus&&<p role="status" className="text-sm">{backupStatus}</p>}
    <p className="text-xs text-gray-600">Stored locally in data/maxwell-glass/production-46158. Print events record a request, not proof that paper or a PDF was produced. Staff identity is not recorded until user logins are added.</p>
    <h2 className="font-bold">Archived invoices ({invoices.length})</h2>
    {invoices.filter(r => JSON.stringify(r.input).toLowerCase().includes(search.toLowerCase())).map(r => <details key={r.digest} className="border bg-white rounded p-3">
      <summary className="cursor-pointer text-sm">{r.input.invoiceNumber} · {r.printed.currency} {r.printed.total_amount.toFixed(2)} · Receipt {r.printed.receipt_id} · {r.printed.status}</summary>
      <Link className="inline-block my-3 text-emerald-800 underline" to={'/receipt/' + r.printed.receipt_id}>Open receipt details</Link>
      <pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto mt-3">{JSON.stringify({...r, printed: {...r.printed, qr_image: '(QR image retained in export)'}}, null, 2)}</pre>
    </details>)}
    <h2 className="font-bold">Activity log</h2>
    <div className="space-y-2">{filtered.map(e => <details key={e.id} className="bg-white border rounded p-3">
      <summary className="cursor-pointer text-sm"><span className="font-mono">#{e.id} · {new Date(e.timestamp).toLocaleString('en-GB')}</span> · <strong>{e.type}</strong> · {e.data.invoiceNumber || e.data.input?.invoiceNumber || e.data.endpoint || e.data.route || ''}</summary>
      <pre className="mt-3 text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(e, null, 2)}</pre>
    </details>)}</div>
  </section>;
}

