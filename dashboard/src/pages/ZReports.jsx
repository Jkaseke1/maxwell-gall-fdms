import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

function StatusBadge({ status }) {
  const styles = {
    Open: 'bg-blue-50 text-blue-600 border-blue-200',
    Closed: 'bg-gray-50 text-gray-600 border-gray-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${styles[status] || styles.Open}`}>
      {status}
    </span>
  );
}

export default function ZReports() {
  const [fiscalDays, setFiscalDays] = useState([]);
  const [counters, setCounters] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      // For now, derive fiscal days from receipt dates
      const { data: receipts } = await supabase
        .from('fiscal_receipts')
        .select('receipt_date, receipt_total, receipt_taxes, submission_status')
        .order('receipt_date', { ascending: true });

      if (receipts) {
        const dayMap = new Map();
        receipts.forEach((r) => {
          const date = r.receipt_date ? r.receipt_date.split('T')[0] : 'unknown';
          if (!dayMap.has(date)) {
            dayMap.set(date, { dayNo: dayMap.size + 1, date, receipts: 0, total: 0, status: 'Open' });
          }
          const d = dayMap.get(date);
          d.receipts += 1;
          d.total += parseFloat(r.receipt_total) || 0;
        });
        setFiscalDays(Array.from(dayMap.values()));
      }
      setCounters(null); // Will populate from state.json later
      setLoading(false);
    }
    fetchData();
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-gray-900">Z reports — Fiscal days</h1>

      <div className="bg-white rounded-lg border border-gray-200/80">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Fiscal days</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100">
                {['DAY #', 'OPENED', 'CLOSED', 'RECEIPTS', 'STATUS'].map((h) => (
                  <th key={h} className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">Loading...</td></tr>
              ) : fiscalDays.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">No fiscal days yet</td></tr>
              ) : (
                fiscalDays.map((d) => (
                  <tr key={d.dayNo} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                    <td className="px-5 py-3.5 text-sm text-gray-900">{d.dayNo}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">
                      {new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">—</td>
                    <td className="px-5 py-3.5 text-sm text-gray-900">{d.receipts}</td>
                    <td className="px-5 py-3.5"><StatusBadge status={d.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200/80">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Fiscal counters</h2>
        </div>
        <div className="px-5 py-10 text-center">
          {counters ? (
            <div className="grid grid-cols-3 gap-4 text-left">
              <div>
                <p className="text-[11px] text-gray-400 uppercase">Sales with Tax</p>
                <p className="text-lg font-bold text-gray-900">${counters.salesAmountWithTax?.toFixed(2) || '0.00'}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400 uppercase">Tax Amount</p>
                <p className="text-lg font-bold text-gray-900">${counters.taxAmount?.toFixed(2) || '0.00'}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400 uppercase">Payment</p>
                <p className="text-lg font-bold text-gray-900">${counters.paymentAmount?.toFixed(2) || '0.00'}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No counters yet</p>
          )}
        </div>
      </div>
    </div>
  );
}
