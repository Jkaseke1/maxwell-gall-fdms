import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Lock, Unlock, ShieldCheck } from 'lucide-react';

export default function Device() {
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { const r = await fetch('/api/status'); const data = await r.json(); if (!r.ok) throw Error(data.error || 'Status unavailable'); setLive(data); setError(''); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
  const mutateDay = async (action) => { setBusy(true); setError(''); try { const r = await fetch('/api/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Maxwell-Production': '46158' }, body: '{}' }); const data = await r.json(); if (!r.ok) throw Error(data.error || 'Fiscal-day operation failed'); setLive(data); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const closed = live?.status?.fiscalDayStatus === 'FiscalDayClosed';
  const address = [live?.config?.deviceBranchAddress?.houseNo, live?.config?.deviceBranchAddress?.street, live?.config?.deviceBranchAddress?.city, live?.config?.deviceBranchAddress?.province].filter(Boolean).join(', ');
  const cards = [['Connection', live ? 'Online' : 'Offline'], ['Device ID', live?.deviceId ?? '—'], ['Serial number', live?.serial ?? '—'], ['Environment', live?.environment ?? 'PRODUCTION'], ['Fiscal day', live?.fiscalDayNo ?? '—'], ['Fiscal-day status', live?.status?.fiscalDayStatus ?? '—'], ['Next global receipt', live?.nextGlobalNo ?? '—'], ['Day counter', live?.nextCounter ?? '—']];
  const rows = [['Taxpayer', live?.config?.taxPayerName], ['TIN', live?.config?.taxPayerTIN], ['VAT number', live?.config?.vatNumber], ['Branch address', address], ['Operating mode', live?.config?.deviceOperatingMode], ['Certificate valid until', live?.certificateValidTill], ['QR verification host', live?.config?.qrUrl], ['Counter alignment', live?.ready ? 'Ready' : (live?.message || 'Needs attention')]];
  return <section className="space-y-6 max-w-6xl mx-auto">
    <div className="erp-card-heading row"><div><h2>Production device settings</h2><p>Monitor the Maxwell Glass ZIMRA device and manage fiscal-day operations here.</p></div><button type="button" onClick={load} className="erp-text-button"><RefreshCw size={14} /> Refresh</button></div>
    {error && <p role="alert" className="erp-error">{error}</p>}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{cards.map(([label, value]) => <div className="erp-card" key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>
    <div className="erp-card"><div className="erp-card-heading"><h3>Company and ZIMRA configuration</h3><p>Read-only values returned by the production device.</p></div><div className="grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm">{rows.map(([label, value]) => <div className="flex justify-between gap-4 border-b border-slate-100 py-2" key={label}><span className="text-slate-500">{label}</span><b className="text-right">{value || '—'}</b></div>)}</div></div>
    <div className="erp-card"><div className="erp-card-heading"><h3>Fiscal-day controls</h3><p>These actions are intentionally restricted to Settings.</p></div><div className="flex items-center gap-3 flex-wrap"><span className="text-sm">Current status: <b>{live?.status?.fiscalDayStatus || 'Unknown'}</b></span>{closed ? <button type="button" disabled={busy || !live} onClick={() => mutateDay('open-day')} className="erp-secondary-button"><Unlock size={15} /> Open fiscal day</button> : <button type="button" disabled={busy || !live || !!live?.pendingInvoice} onClick={() => mutateDay('close-day')} className="erp-text-button"><Lock size={15} /> Close fiscal day</button>}<span className="text-xs text-slate-500 flex items-center gap-1"><ShieldCheck size={14} /> Device 46158 only</span></div></div>
  </section>;
}
