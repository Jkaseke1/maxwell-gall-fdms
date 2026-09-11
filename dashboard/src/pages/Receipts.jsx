import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { supabase } from '../lib/supabase';

function StatusBadge({ status }) {
  const styles = {
    submitted: 'bg-green-50 text-green-600 border-green-200',
    failed: 'bg-red-50 text-red-600 border-red-200',
    pending: 'bg-amber-50 text-amber-600 border-amber-200',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border ${styles[status] || styles.pending}`}>
      {status}
    </span>
  );
}

export default function Receipts() {
  const [receipts, setReceipts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [invoiceFilter, setInvoiceFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('All statuses');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      let query = supabase.from('fiscal_receipts').select('*').order('created_at', { ascending: false });
      if (invoiceFilter) query = query.ilike('invoice_no', `%${invoiceFilter}%`);
      if (statusFilter !== 'All statuses') query = query.eq('submission_status', statusFilter);
      const { data } = await query;
      if (data) setReceipts(data);
      setLoading(false);
    }
    fetchData();
  }, [invoiceFilter, statusFilter]);

  const filtered = receipts.filter((r) => {
    const cust = (r.buyer_data?.buyerRegisterName || '').toLowerCase();
    return cust.includes(customerFilter.toLowerCase());
  });

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-gray-900">All receipts</h1>

      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Invoice no..."
          value={invoiceFilter}
          onChange={(e) => setInvoiceFilter(e.target.value)}
          className="w-40 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
        />
        <input
          type="text"
          placeholder="Customer..."
          value={customerFilter}
          onChange={(e) => setCustomerFilter(e.target.value)}
          className="w-40 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-gray-400"
        />
        <input
          type="date"
          className="px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-500"
        />
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="appearance-none w-32 px-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-600 bg-white pr-8"
          >
            <option>All statuses</option>
            <option>submitted</option>
            <option>failed</option>
            <option>pending</option>
          </select>
          <ChevronDown className="w-4 h-4 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200/80 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-gray-100">
              {['INVOICE', 'CUSTOMER', 'DATE', 'TOTAL (USD)', 'GLOBAL #', 'RECEIPT ID', 'STATUS'].map((h) => (
                <th key={h} className="px-5 py-3 text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">No receipts found</td></tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                  <td className="px-5 py-3.5 text-sm font-semibold text-gray-900">{r.invoice_no || '-'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-600">{r.buyer_data?.buyerRegisterName || 'Walk-in'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-500">
                    {r.receipt_date ? new Date(r.receipt_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                  </td>
                  <td className="px-5 py-3.5 text-sm font-medium text-gray-900">
                    ${parseFloat(r.receipt_total || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-5 py-3.5 text-sm text-gray-500">{r.receipt_global_no || '-'}</td>
                  <td className="px-5 py-3.5 text-sm text-gray-500 font-mono">{r.receipt_id || '-'}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={r.submission_status || 'pending'} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
