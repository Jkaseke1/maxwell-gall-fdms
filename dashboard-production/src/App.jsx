import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { BarChart3, ClipboardList, CreditCard, FilePlus2, RefreshCw, ShieldCheck } from 'lucide-react';
import CreateInvoice from './pages/CreateInvoice';
import Audit from './pages/Audit';
import Reports from './pages/Reports';
import ReceiptDetails from './pages/ReceiptDetails';
import { COMPANY } from './config/company';

const navItems = [
  { path: '/invoices', icon: FilePlus2, label: 'Invoices', detail: 'Create and fiscalise' },
  { path: '/credit-notes', icon: CreditCard, label: 'Credit notes', detail: 'Issue a linked reversal' },
  { path: '/audit', icon: ClipboardList, label: 'Audit trail', detail: 'Receipts and activity' },
  { path: '/reports', icon: BarChart3, label: 'Day reports', detail: 'X and Z reports' },
];

function Sidebar() {
  const location = useLocation();
  return <aside className="erp-sidebar">
    <Link to="/invoices" className="erp-brand"><span className="erp-mark"><img src="/max-glass-logo.svg" alt="" /></span><span><strong>MAXWELL GLASS</strong><small>Fiscal workspace</small></span></Link>
    <p className="erp-nav-label">WORKSPACE</p>
    <nav className="erp-nav">{navItems.map(({ path, icon: Icon, label, detail }) => {
      const active = location.pathname === path;
      return <Link key={path} to={path} className={'erp-nav-link ' + (active ? 'active' : '')}><Icon size={18} /><span><b>{label}</b><small>{detail}</small></span></Link>;
    })}</nav>
    <div className="erp-sidebar-foot"><ShieldCheck size={16} /><span>Production isolated<br />Device 46158 only</span></div>
  </aside>;
}

function Header() {
  const [live, setLive] = React.useState(null);
  const load = React.useCallback(async () => { try { const response = await fetch('/api/status'); if (!response.ok) throw Error(); setLive(await response.json()); } catch { setLive(null); } }, []);
  React.useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);
  const open = live?.status?.fiscalDayStatus === 'FiscalDayOpened';
  return <header className="erp-header"><div><p>MAXWELL GLASS · {COMPANY.environment}</p><h1>Fiscal operations</h1></div><div className="erp-header-status"><span className={'erp-live-dot ' + (open ? 'online' : '')}>{open ? 'Device online' : 'Device check needed'}</span><span className="erp-header-stat">Day <b>{live?.fiscalDayNo ?? '—'}</b></span><span className="erp-header-stat">Next receipt <b>{live?.nextGlobalNo ?? '—'}</b></span><button type="button" onClick={load} className="erp-icon-button" aria-label="Refresh device status"><RefreshCw size={16} /></button></div></header>;
}

function Workspace() {
  return <div className="erp-shell"><Sidebar /><div className="erp-main"><Header /><main className="erp-content"><Routes>
    <Route path="/invoices" element={<CreateInvoice mode="invoice" />} />
    <Route path="/credit-notes" element={<CreateInvoice mode="credit" />} />
    <Route path="/create-invoice" element={<Navigate to="/invoices" replace />} />
    <Route path="/audit" element={<Audit />} /><Route path="/reports" element={<Reports />} />
    <Route path="*" element={<Navigate to="/invoices" replace />} />
  </Routes></main></div></div>;
}

export default function App() { return <BrowserRouter><Routes><Route path="/receipt/:receiptId" element={<ReceiptDetails />} /><Route path="*" element={<Workspace />} /></Routes></BrowserRouter>; }

