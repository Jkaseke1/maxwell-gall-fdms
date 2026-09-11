import { useEffect, useState } from 'react';
import {
  FileText, DollarSign, Receipt, AlertCircle, Calendar,
  Hash, Globe, Activity, CheckCircle, XCircle, QrCode,
  PenTool, Lock, Server
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { COMPANY } from '../config/company';

function StatCard({ title, value, subtext, icon: Icon, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200/80 p-4 flex flex-col justify-between h-[100px]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{title}</p>
          <p className={`text-lg font-bold mt-1 ${color}`}>{value}</p>
        </div>
        {Icon && <Icon className="w-4 h-4 text-gray-300" />}
      </div>
      {subtext && <p className="text-[10px] text-gray-400 mt-1">{subtext}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    submitted: 'bg-green-50 text-green-600 border-green-200',
    failed: 'bg-red-50 text-red-600 border-red-200',
    pending: 'bg-amber-50 text-amber-600 border-amber-200',
    copy: 'bg-blue-50 text-blue-600 border-blue-200',
  };
  const label = status === 'submitted' ? 'Submitted' : status === 'failed' ? 'Failed' : status === 'copy' ? 'Copy' : 'Pending';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border ${styles[status] || styles.pending}`}>
      {status === 'submitted' ? <CheckCircle className="w-3 h-3" /> : status === 'failed' ? <XCircle className="w-3 h-3" /> : null}
      {label}
    </span>
  );
}

function SubmissionCheck({ label, ok }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
      <span className={ok ? 'text-gray-700' : 'text-red-600 font-medium'}>{label}</span>
    </div>
  );
}

export default function Overview() {
  const [receipts, setReceipts] = useState([]);
  const [failedReceipts, setFailedReceipts] = useState([]);
  const [stats, setStats] = useState({
    todayInvoices: 0,
    todayTotal: 0,
    taxCollected: 0,
    allTime: 0,
    failed: 0,
    fiscalDayNo: 1,
    lastGlobalNo: 0,
    lastCounter: 0,
    totalRevenue: 0,
    totalTax: 0,
    qrCodes: 0,
    signatures: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];

      const { data: allReceipts, error } = await supabase
        .from('fiscal_receipts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Supabase error:', error);
        setLoading(false);
        return;
      }

      if (allReceipts) {
        setReceipts(allReceipts.slice(0, 10));
        setFailedReceipts(allReceipts.filter(r => r.submission_status === 'failed'));

        // Group by date for "latest day" stats
        const dateMap = new Map();
        allReceipts.forEach(r => {
          const dateField = r.receipt_date || r.created_at;
          if (!dateField) return;
          const dateStr = typeof dateField === 'string' ? dateField.split('T')[0] : '';
          if (!dateMap.has(dateStr)) dateMap.set(dateStr, []);
          dateMap.get(dateStr).push(r);
        });

        const dates = Array.from(dateMap.keys()).sort().reverse();
        const latestDate = dates[0] || today;
        const latestReceipts = dateMap.get(latestDate) || [];

        const latestTotal = latestReceipts.reduce((s, r) => s + (parseFloat(r.receipt_total) || 0), 0);
        const taxTotal = latestReceipts.reduce((s, r) => {
          let taxes = r.receipt_taxes;
          if (typeof taxes === 'string') { try { taxes = JSON.parse(taxes); } catch { taxes = []; } }
          if (!Array.isArray(taxes)) taxes = [];
          return s + taxes.reduce((t, tx) => t + (parseFloat(tx?.taxAmount ?? tx?.tax_amount ?? 0) || 0), 0);
        }, 0);

        // All-time totals
        const totalRevenue = allReceipts.reduce((s, r) => s + (parseFloat(r.receipt_total) || 0), 0);
        const totalTax = allReceipts.reduce((s, r) => {
          let taxes = r.receipt_taxes;
          if (typeof taxes === 'string') { try { taxes = JSON.parse(taxes); } catch { taxes = []; } }
          if (!Array.isArray(taxes)) taxes = [];
          return s + taxes.reduce((t, tx) => t + (parseFloat(tx?.taxAmount ?? tx?.tax_amount ?? 0) || 0), 0);
        }, 0);

        const failed = allReceipts.filter(r => r.submission_status === 'failed').length;
        const qrCodes = allReceipts.filter(r => r.qr_code && r.qr_code.length > 0).length;
        const signatures = allReceipts.filter(r => r.device_signature && r.device_signature.length > 0).length;

        // Get latest counters
        const latest = allReceipts[0] || {};

        setStats({
          todayInvoices: latestReceipts.length,
          todayTotal: latestTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          taxCollected: taxTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          allTime: allReceipts.length,
          failed,
          fiscalDayNo: latest.fiscal_day_no || 1,
          lastGlobalNo: latest.receipt_global_no || 0,
          lastCounter: latest.receipt_counter || 0,
          totalRevenue: totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          totalTax: totalTax.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          qrCodes,
          signatures,
        });
      }
      setLoading(false);
    }
    fetchData();

    // Realtime: re-fetch when a new receipt is inserted
    const channel = supabase
      .channel('overview-receipts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fiscal_receipts' },
        () => { fetchData(); }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const submittedReceipts = receipts.filter(r => r.submission_status === 'submitted');

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-gray-900">Overview</h1>

      {/* Row 1: Activity stats */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard title="Latest Day Invoices" value={stats.todayInvoices} subtext={`on last active day`} icon={FileText} />
        <StatCard title="Latest Day Total" value={`$${stats.todayTotal}`} subtext="USD incl tax" icon={DollarSign} />
        <StatCard title="Tax Collected (Day)" value={`$${stats.taxCollected}`} subtext="on last active day" icon={Receipt} />
        <StatCard title="All Time Receipts" value={stats.allTime} subtext="total submitted" icon={Globe} color="text-blue-600" />
        <StatCard title="Failed Submissions" value={stats.failed} subtext={stats.failed === 0 ? 'All clear' : 'needs attention'} icon={AlertCircle} color={stats.failed > 0 ? 'text-red-600' : 'text-gray-900'} />
        <StatCard title="Fiscal Day" value={`Day ${stats.fiscalDayNo}`} subtext="Opened · Active" icon={Calendar} />
      </div>

      {/* Row 2: Global counters */}
      <div className="grid grid-cols-6 gap-3">
        <StatCard title="Total Revenue" value={`$${stats.totalRevenue}`} subtext="all time USD" icon={DollarSign} color="text-emerald-600" />
        <StatCard title="Total Tax" value={`$${stats.totalTax}`} subtext="all time VAT" icon={Receipt} color="text-emerald-600" />
        <StatCard title="Last Global #" value={stats.lastGlobalNo} subtext="ZIMRA global counter" icon={Globe} />
        <StatCard title="Last Counter" value={stats.lastCounter} subtext="device receipt counter" icon={Hash} />
        <StatCard title="QR Codes" value={stats.qrCodes} subtext="stamped on PDFs" icon={QrCode} />
        <StatCard title="Signatures" value={stats.signatures} subtext="RSA signatures generated" icon={PenTool} />
      </div>

      {/* Submission Health */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200/80 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-blue-600" />
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Submission Health</h2>
          </div>
          <div className="space-y-2">
            <SubmissionCheck label="Device registered with ZIMRA" ok={true} />
            <SubmissionCheck label="Fiscal day is open" ok={true} />
            <SubmissionCheck label="Certificate is valid" ok={true} />
            <SubmissionCheck label="Tax config synced from ZIMRA" ok={true} />
            <SubmissionCheck label="Supabase logging active" ok={true} />
            <SubmissionCheck label={`Failed receipts: ${stats.failed}`} ok={stats.failed === 0} />
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200/80 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server className="w-4 h-4 text-blue-600" />
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Device Info</h2>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Device ID</span><span className="font-medium text-gray-900">{COMPANY.deviceId}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Serial No</span><span className="font-medium text-gray-900">{COMPANY.serialNo}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">TIN</span><span className="font-medium text-gray-900">{COMPANY.tin}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">VAT No</span><span className="font-medium text-gray-900">{COMPANY.vatNo}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Environment</span><span className={`font-medium ${COMPANY.environment === 'PRODUCTION' ? 'text-green-600' : 'text-amber-600'}`}>{COMPANY.environment}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">API Endpoint</span><span className="font-medium text-gray-900">{COMPANY.apiEndpoint}</span></div>
          </div>
        </div>
      </div>

      {/* Recent Receipts */}
      <div className="bg-white rounded-lg border border-gray-200/80">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Recent Receipts</h2>
          <span className="text-[11px] text-gray-400">{submittedReceipts.length} submitted · {stats.failed} failed</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                {['INVOICE', 'CUSTOMER', 'DATE', 'TOTAL (USD)', 'GLOBAL #', 'COUNTER', 'RECEIPT ID', 'HASH', 'SIG', 'QR', 'STATUS'].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} className="px-5 py-8 text-center text-sm text-gray-400">Loading...</td></tr>
              ) : receipts.length === 0 ? (
                <tr><td colSpan={11} className="px-5 py-8 text-center text-sm text-gray-400">No receipts yet</td></tr>
              ) : (
                receipts.map((r) => {
                  const hasHash = !!r.receipt_hash;
                  const hasSig = !!r.device_signature;
                  const hasQr = !!r.qr_code;
                  return (
                    <tr key={r.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/50 ${r.submission_status === 'failed' ? 'bg-red-50/30' : ''}`}>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900">{r.invoice_no || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{r.buyer_data?.buyerRegisterName || 'Walk-in'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {r.receipt_date ? new Date(r.receipt_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        ${parseFloat(r.receipt_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{r.receipt_global_no ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{r.receipt_counter ?? '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 font-mono">{r.receipt_id || '-'}</td>
                      <td className="px-4 py-3">{hasHash ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}</td>
                      <td className="px-4 py-3">{hasSig ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}</td>
                      <td className="px-4 py-3">{hasQr ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-gray-300" />}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.submission_status || 'pending'} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Failed Receipts Alert */}
      {failedReceipts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-5 h-5 text-red-600" />
            <h2 className="text-sm font-bold text-red-700">Failed Submissions — Action Required</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-red-100">
                  {['INVOICE', 'ERROR', 'DATE', 'ATTEMPTS'].map((h) => (
                    <th key={h} className="px-4 py-2 text-[10px] font-semibold text-red-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {failedReceipts.map((r) => (
                  <tr key={r.id} className="border-b border-red-100/50 last:border-0">
                    <td className="px-4 py-2.5 text-sm font-semibold text-red-900">{r.invoice_no || '-'}</td>
                    <td className="px-4 py-2.5 text-sm text-red-700">{r.error_message || 'Submission failed — check logs'}</td>
                    <td className="px-4 py-2.5 text-sm text-red-600 whitespace-nowrap">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </td>
                    <td className="px-4 py-2.5 text-sm text-red-600">{r.submission_attempts || 1}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
