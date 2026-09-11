import { useEffect, useState, useRef } from 'react';
import { Terminal, Activity, Pause, Play, RefreshCw, CheckCircle, XCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';

function LogLine({ line }) {
  let color = 'text-gray-500';
  if (line.includes('[SUCCESS]'))                             color = 'text-green-400';
  else if (line.includes('[ERROR]') || line.includes('FAIL')) color = 'text-red-400';
  else if (line.includes('[WARN]'))                           color = 'text-yellow-400';
  else if (line.includes('[INFO]'))                           color = 'text-blue-300';

  // Bold the key event words
  const bold = line.includes('FISCALIZING') || line.includes('ZIMRA SUCCESS') || line.includes('recorded') || line.includes('Fiscal day');

  return (
    <div className={`text-xs font-mono leading-5 ${color} ${bold ? 'font-semibold' : ''}`}>
      {line}
    </div>
  );
}

function CounterCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200/80 p-4">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-bold text-gray-900 mt-1">{value ?? '—'}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Logs() {
  const [lines, setLines]               = useState([]);
  const [recentReceipts, setReceipts]   = useState([]);
  const [stateData, setStateData]       = useState(null);
  const [autoScroll, setAutoScroll]     = useState(true);
  const [loading, setLoading]           = useState(true);
  const [apiOnline, setApiOnline]       = useState(false);
  const [logDate, setLogDate]           = useState(new Date().toISOString().split('T')[0]);
  const [totalLines, setTotalLines]     = useState(0);
  const terminalRef = useRef(null);

  // Poll log file + state every 3 seconds
  useEffect(() => {
    async function fetchLogs() {
      try {
        const res = await fetch(`/api/logs?lines=400&date=${logDate}`);
        if (res.ok) {
          const data = await res.json();
          setLines(data.lines || []);
          setTotalLines(data.total || 0);
          setApiOnline(true);
        } else {
          setApiOnline(false);
        }
      } catch {
        setApiOnline(false);
      }
      setLoading(false);
    }

    async function fetchState() {
      try {
        const res = await fetch('/api/state');
        if (res.ok) {
          const data = await res.json();
          if (data.success) setStateData(data.data);
        }
      } catch {}
    }

    fetchLogs();
    fetchState();
    const interval = setInterval(() => { fetchLogs(); fetchState(); }, 3000);
    return () => clearInterval(interval);
  }, [logDate]);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Supabase: initial load + realtime subscription
  useEffect(() => {
    async function fetchReceipts() {
      const { data } = await supabase
        .from('fiscal_receipts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(25);
      if (data) setReceipts(data);
    }
    fetchReceipts();

    const channel = supabase
      .channel('logs-activity')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'fiscal_receipts' },
        (payload) => {
          setReceipts((prev) => [payload.new, ...prev].slice(0, 25));
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, []);

  const successCount = lines.filter(l => l.includes('[SUCCESS]')).length;
  const errorCount   = lines.filter(l => l.includes('[ERROR]')).length;

  return (
    <div className="space-y-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-gray-900">Live Activity</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={logDate}
            onChange={(e) => setLogDate(e.target.value)}
            className="px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-600"
          />
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${
            apiOnline
              ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-red-50 text-red-600 border-red-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${apiOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
            {apiOnline ? 'API Online' : 'API Offline — run: npm run api'}
          </span>
        </div>
      </div>

      {/* State counters */}
      <div className="grid grid-cols-6 gap-3">
        <CounterCard label="Receipt Counter"  value={stateData?.receiptCounter}  sub="last submitted" />
        <CounterCard label="Global No"        value={stateData?.receiptGlobalNo} sub="ZIMRA sequence" />
        <CounterCard label="Fiscal Day"       value={stateData?.fiscalDayNo != null ? `Day ${stateData.fiscalDayNo}` : null} sub="currently open" />
        <CounterCard
          label="Last Receipt"
          value={stateData?.lastReceiptDate
            ? new Date(stateData.lastReceiptDate).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '—'}
          sub={stateData?.lastReceiptDate
            ? new Date(stateData.lastReceiptDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
            : 'no receipts'}
        />
        <CounterCard label="Log Successes"   value={successCount} sub={`today (${logDate})`} />
        <CounterCard label="Log Errors"      value={errorCount}   sub={errorCount > 0 ? 'check log' : 'all clear'} />
      </div>

      {/* Fiscal counters per currency */}
      {stateData?.fiscalCounters && Object.keys(stateData.fiscalCounters).length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200/80 p-4">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Fiscal Counters (Current Day)</p>
          <div className="flex gap-6">
            {Object.entries(stateData.fiscalCounters).map(([ccy, c]) => (
              <div key={ccy} className="flex items-center gap-3">
                <span className="text-xs font-bold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">{ccy}</span>
                <span className="text-xs text-gray-600">Sales: <strong>{(c.salesAmountWithTax || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
                <span className="text-xs text-gray-600">Tax: <strong>{(c.taxAmount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</strong></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main panel: terminal + recent receipts */}
      <div className="grid grid-cols-3 gap-4">

        {/* Terminal log */}
        <div className="col-span-2 bg-gray-950 rounded-lg border border-gray-700 flex flex-col" style={{ height: '520px' }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-gray-500" />
              <span className="text-xs font-medium text-gray-300">
                fiscalization-{logDate}.log
              </span>
              <span className="text-[10px] text-gray-600">({totalLines} lines)</span>
              {loading && <RefreshCw className="w-3 h-3 text-gray-600 animate-spin" />}
            </div>
            <button
              onClick={() => setAutoScroll(v => !v)}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-200 transition-colors"
            >
              {autoScroll ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              {autoScroll ? 'Pause' : 'Resume'}
            </button>
          </div>
          <div
            ref={terminalRef}
            className="flex-1 overflow-y-auto px-4 py-3 space-y-px"
          >
            {lines.length === 0 ? (
              <div className="text-gray-600 text-xs font-mono">
                {apiOnline
                  ? `No log entries for ${logDate}. Drop a PDF into C:\\FDMS\\unsigned\\ to see activity.`
                  : 'API server is offline. Start it with: npm run api'}
              </div>
            ) : (
              lines.map((line, i) => <LogLine key={i} line={line} />)
            )}
          </div>
        </div>

        {/* Recent activity feed */}
        <div className="bg-white rounded-lg border border-gray-200/80 flex flex-col" style={{ height: '520px' }}>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 flex-shrink-0">
            <Activity className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">Receipts</span>
            <span
              className="ml-auto w-2 h-2 rounded-full bg-green-400 animate-pulse"
              title="Realtime — updates automatically"
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-50">
            {recentReceipts.length === 0 ? (
              <p className="text-sm text-gray-400 p-4">No receipts yet</p>
            ) : (
              recentReceipts.map((r) => {
                const isCredit = r.receipt_type === 'CreditNote';
                const total    = parseFloat(r.receipt_total || 0);
                return (
                  <div key={r.id} className="px-4 py-3 hover:bg-gray-50/50">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-900">{r.invoice_no || '—'}</span>
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                        r.submission_status === 'submitted'
                          ? 'bg-green-50 text-green-600'
                          : r.submission_status === 'failed'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-amber-50 text-amber-600'
                      }`}>
                        {r.submission_status === 'submitted'
                          ? <span className="flex items-center gap-1"><CheckCircle className="w-2.5 h-2.5 inline" /> submitted</span>
                          : r.submission_status === 'failed'
                            ? <span className="flex items-center gap-1"><XCircle className="w-2.5 h-2.5 inline" /> failed</span>
                            : r.submission_status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[11px] text-gray-400">
                        {isCredit ? 'Credit Note' : 'Invoice'} · {r.receipt_currency} · G#{r.receipt_global_no}
                      </span>
                      <span className={`text-xs font-medium ${isCredit ? 'text-red-500' : 'text-gray-800'}`}>
                        {r.receipt_currency} {Math.abs(total).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5 truncate">
                      {r.buyer_data?.buyerRegisterName || 'Walk-in'}
                    </p>
                    <div className="flex items-center gap-1 mt-1">
                      <Clock className="w-2.5 h-2.5 text-gray-300" />
                      <span className="text-[10px] text-gray-400">
                        {r.receipt_date
                          ? new Date(r.receipt_date).toLocaleString('en-GB', {
                              day: 'numeric', month: 'short',
                              hour: '2-digit', minute: '2-digit'
                            })
                          : '—'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
