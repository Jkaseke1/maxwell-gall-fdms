import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { COMPANY } from '../config/company';

export default function Device() {
  const [device, setDevice] = useState(null);
  const [receipts, setReceipts] = useState([]);

  useEffect(() => {
    async function fetchData() {
      const { data: latest } = await supabase
        .from('fiscal_receipts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      const { data: allReceipts } = await supabase
        .from('fiscal_receipts')
        .select('receipt_total');

      if (allReceipts) {
        setReceipts(allReceipts);
      }

      const base = {
        deviceId: COMPANY.deviceId,
        serialNo: COMPANY.serialNo,
        tin: COMPANY.tin,
        vatNo: COMPANY.vatNo,
        taxpayer: COMPANY.name,
        address: COMPANY.address,
        telephone: COMPANY.telephone,
        email: COMPANY.email,
        model: COMPANY.model,
        vatRate: COMPANY.vatRate,
        taxIds: COMPANY.taxIds,
        apiEndpoint: `${COMPANY.apiEndpoint} (${COMPANY.environment})`,
        supabaseProject: (supabase?.supabaseUrl || '').replace('https://', '').slice(0, 12) + '...',
      };

      if (latest) {
        setDevice({
          ...base,
          deviceId: latest.device_id || COMPANY.deviceId,
          totalRevenue: allReceipts?.reduce((s, r) => s + (parseFloat(r.receipt_total) || 0), 0) || 0,
          lastReceipt: latest.invoice_no
            ? `${new Date(latest.receipt_date || latest.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${latest.invoice_no}`
            : '—',
        });
      } else {
        setDevice({ ...base, totalRevenue: 0, lastReceipt: '—' });
      }
    }
    fetchData();
  }, []);

  if (!device) return <div className="p-6 text-sm text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-bold text-gray-900">Device status</h1>

      <div className="grid grid-cols-6 gap-4">
        {[
          { label: 'DEVICE ID', value: device.deviceId },
          { label: 'SERIAL NO', value: device.serialNo },
          { label: 'TIN', value: device.tin },
          { label: 'VAT NO', value: device.vatNo },
          { label: 'TOTAL REVENUE', value: `$${device.totalRevenue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` },
          { label: 'LAST RECEIPT', value: device.lastReceipt },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-lg border border-gray-200/80 p-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{card.label}</p>
            <p className="text-sm font-bold text-gray-900 mt-2">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border border-gray-200/80">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Configuration</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {[
            { label: 'Taxpayer', value: device.taxpayer },
            { label: 'Address', value: device.address },
            { label: 'Telephone', value: device.telephone },
            { label: 'Email', value: device.email },
            { label: 'Model', value: device.model },
            { label: 'VAT rate', value: device.vatRate },
            { label: 'Tax IDs', value: device.taxIds },
            { label: 'API endpoint', value: device.apiEndpoint },
            { label: 'Supabase project', value: device.supabaseProject },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between px-5 py-3.5">
              <span className="text-sm text-gray-500">{row.label}</span>
              <span className="text-sm text-gray-900">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
