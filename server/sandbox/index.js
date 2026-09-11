const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { SandboxService } = require('./service');
const { output } = require('../../scripts/zimraSandbox');
const lockPath = path.join(output, 'api.lock');
// Only one process may own this device's receipt state.
let lock;
try { lock = fs.openSync(lockPath, 'wx'); } catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const oldPid = Number(fs.readFileSync(lockPath, 'utf8'));
  if (!Number.isInteger(oldPid) || oldPid <= 0) throw Error('Invalid sandbox API lock; inspect before recovery.');
  let stale = false;
  try { process.kill(oldPid, 0); } catch (e) { if (e.code === 'ESRCH') stale = true; else throw e; }
  if (!stale) throw Error('Sandbox API is already running or its lock process is still active.');
  fs.unlinkSync(lockPath);
  lock = fs.openSync(lockPath, 'wx');
}
fs.writeFileSync(lock, String(process.pid));
const cleanup = () => { try { fs.closeSync(lock); fs.unlinkSync(lockPath); } catch {} };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0));
const service = new SandboxService();
const stopMaintenance = service.startMaintenance();
process.on('exit', stopMaintenance);
const allowedOrigins = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);
const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.has(origin)) { res.writeHead(403); return res.end('{"error":"Origin denied"}'); }
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Maxwell-Sandbox');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    let result;
    if (req.method === 'GET' && req.url === '/sandbox-api/status') result = await service.live();
    else if (req.method === 'GET' && req.url === '/sandbox-api/receipts') result = service.state.receipts.map(r => {
      const printed = r.printed;
      if (printed.receipt_type !== 'CreditNote' || printed.buyer_address || !printed.original_receipt_id) return printed;
      const original = service.state.receipts.find(candidate => candidate.response?.receiptID === Number(printed.original_receipt_id));
      if (!original?.printed) return printed;
      return { ...printed,
        buyer_address: original.printed.buyer_address,
        customer_name: printed.customer_name === 'Walk-in Customer' ? original.printed.customer_name : printed.customer_name,
        customer_tin: printed.customer_tin || original.printed.customer_tin,
        customer_vat: printed.customer_vat || original.printed.customer_vat,
        customer_phone: printed.customer_phone || original.printed.customer_phone,
        customer_email: printed.customer_email || original.printed.customer_email
      };
    });
    else if (req.method === 'GET' && req.url === '/sandbox-api/audit') result = service.archive.events.slice(-500).reverse();
    else if (req.method === 'GET' && req.url === '/sandbox-api/archive') result = service.archive.receipts();
    else if (req.method === 'GET' && req.url === '/sandbox-api/reports') result = require('./reports').reports(service.state, service.latestConfig);
    else if (req.method === 'GET' && /^\/sandbox-api\/report-print\?day=\d+$/.test(req.url)) {
      const report = require('./reports').reports(service.state, service.latestConfig).find(r=>r.fiscalDayNo===Number(req.url.split('=')[1]));
      if (!report) throw Error('Report not found');
      service.archive.log('report.viewed', {fiscalDayNo:report.fiscalDayNo,type:report.type});
      res.setHeader('Content-Type','text/html; charset=utf-8'); return res.end(require('./reports').printable(report));
    }
    else if (req.method === 'GET' && req.url === '/sandbox-api/export') {
      service.archive.log('archive.export_requested');
      res.setHeader('Content-Disposition', 'attachment; filename="maxwell-glass-sandbox-audit.json"');
      result = service.archive.export();
    }
    else if (req.method === 'POST' && ['/sandbox-api/open-day', '/sandbox-api/close-day', '/sandbox-api/receipts', '/sandbox-api/number', '/sandbox-api/draft', '/sandbox-api/event', '/sandbox-api/renew-certificate', '/sandbox-api/print', '/sandbox-api/backup'].includes(req.url)) {
      if (req.headers['x-maxwell-sandbox'] !== '38293' || !req.headers['content-type']?.startsWith('application/json')) throw Error('Maxwell sandbox request headers required.');
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 100000) throw Error('Invoice too large.'); }
      const input = JSON.parse(body || '{}');
      if (req.url.endsWith('/backup')) result = await service.backup();
      else if (req.url.endsWith('/renew-certificate')) result = await service.renew();
      else if (req.url.endsWith('/print')) {
        const record = service.state.receipts.find(r => r.input.invoiceNumber === input.invoiceNumber);
        if (!record) throw Error('Receipt not found.');
        const count = service.archive.events.filter(e => ['invoice.print_reserved', 'invoice.print_requested'].includes(e.type) && e.data.invoiceNumber === input.invoiceNumber).length;
        // Legacy archived receipts are always copies; their original print count predates this tracking.
        result = { copy: count > 0 || !record.prepared.seller, printNumber: count + 1 };
        service.archive.log('invoice.print_reserved', { invoiceNumber: input.invoiceNumber, ...result });
      }
      else if (req.url.endsWith('/number')) {
        const number = service.archive.reserve(input.draftId,
          [...service.state.receipts.map(r => r.input.invoiceNumber), ...(service.state.pending ? [service.state.pending.input.invoiceNumber] : [])]);
        result = { invoiceNumber: number, completed: service.state.receipts.some(r => r.input.invoiceNumber === number),
          draft: service.archive.events.findLast(e => e.type === 'invoice.draft_saved' && e.data.input.draftId === input.draftId)?.data.input };
      }
      else if (req.url.endsWith('/draft')) {
        if (service.archive.registry.reservations[input.draftId] !== input.invoiceNumber) throw Error('Unknown draft reservation.');
        service.archive.log('invoice.draft_saved', { input }); result = { saved: true };
      } else if (req.url.endsWith('/event')) {
        if (!['invoice.preview', 'invoice.viewed', 'invoice.print_requested'].includes(input.type)) throw Error('Unsupported event.');
        service.archive.log(input.type, { invoiceNumber: input.invoiceNumber }); result = { saved: true };
      } else result = req.url.endsWith('open-day') ? await service.open() : req.url.endsWith('close-day') ? await service.close() : await service.submit(input);
    } else { res.writeHead(404); return res.end('{"error":"Not found"}'); }
    res.end(JSON.stringify(result));
  } catch (error) {
    service.archive.log('api.error', { route: req.url, method: req.method, message: error.message });
    void service.alertError('API request failed', error.message, { route: req.url, method: req.method });
    res.writeHead(400); res.end(JSON.stringify({ error: error.message }));
  }
});
server.on('error', e => { console.error(e.message); process.exit(1); });
server.listen(38393, '127.0.0.1', () => console.log('MAXWELL GLASS sandbox API: http://127.0.0.1:38393 (device 38293 only)'));
