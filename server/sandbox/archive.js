const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function atomic(file, data) {
  const fd = fs.openSync(file + '.tmp', 'w');
  try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(file + '.tmp', file);
}
class Archive {
  constructor(directory) {
    this.directory = directory; this.eventsFile = path.join(directory, 'events.jsonl');
    this.registryFile = path.join(directory, 'numbering.json');
    fs.mkdirSync(path.join(directory, 'invoices'), { recursive: true });
    this.events = fs.existsSync(this.eventsFile) ? fs.readFileSync(this.eventsFile, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : [];
    let previous = '';
    for (const event of this.events) {
      const { hash: digest, ...body } = event;
      if (body.previousHash !== previous || hash(JSON.stringify(body)) !== digest) throw Error('Audit log integrity check failed. Restore/reconcile the archive before continuing.');
      previous = digest;
    }
    this.registry = fs.existsSync(this.registryFile) ? JSON.parse(fs.readFileSync(this.registryFile)) : { reservations: {}, sequences: {} };
    for (const event of this.events.filter(e => e.type === 'invoice.archived')) {
      const file = path.join(directory, 'invoices', path.basename(event.data.file));
      if (!fs.existsSync(file) || hash(fs.readFileSync(file)) !== event.data.sha256) throw Error('Archived invoice integrity check failed.');
    }
  }
  log(type, data = {}) {
    const body = { id: this.events.length + 1, timestamp: new Date().toISOString(), deviceId: 38293,
      actor: 'local-session (no user login)', type, data, previousHash: this.events.at(-1)?.hash || '' };
    const event = { ...body, hash: hash(JSON.stringify(body)) };
    const fd = fs.openSync(this.eventsFile, 'a');
    try { fs.writeFileSync(fd, JSON.stringify(event) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    this.events.push(event); return event;
  }
  reserve(draftId, usedNumbers, now = new Date()) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(draftId || '')) throw Error('Valid draft ID required.');
    if (this.registry.reservations[draftId]) return this.registry.reservations[draftId];
    const date = new Date(now.getTime() + 7200000).toISOString().slice(0, 10);
    const prefix = date.slice(8, 10) + date.slice(5, 7) + date.slice(2, 4);
    const used = new Set([...usedNumbers, ...Object.values(this.registry.reservations)]);
    let sequence = this.registry.sequences[date] || 0;
    for (const n of used) if (n.startsWith(prefix) && /^\d+$/.test(n.slice(6))) sequence = Math.max(sequence, Number(n.slice(6)));
    let number;
    do { number = prefix + String(++sequence).padStart(2, '0'); } while (used.has(number));
    this.registry.sequences[date] = sequence;
    this.registry.reservations[draftId] = number;
    atomic(this.registryFile, this.registry);
    this.log('invoice.number_reserved', { draftId, invoiceNumber: number });
    return number;
  }
  saveReceipt(record) {
    const file = path.join(this.directory, 'invoices', hash(record.input.invoiceNumber) + '.json');
    if (fs.existsSync(file)) {
      const existing = JSON.parse(fs.readFileSync(file));
      if (existing.digest !== record.digest) throw Error('Archived invoice cannot be overwritten with different data.');
      return;
    }
    atomic(file, record);
    this.log('invoice.archived', { invoiceNumber: record.input.invoiceNumber, receiptId: record.printed.receipt_id,
      status: record.printed.status, file: path.basename(file), sha256: hash(fs.readFileSync(file)) });
  }
  receipts() { return fs.readdirSync(path.join(this.directory, 'invoices')).filter(n => n.endsWith('.json')).map(n => JSON.parse(fs.readFileSync(path.join(this.directory, 'invoices', n)))); }
  export() { return { company: 'MAXWELL GLASS', deviceId: 38293, environment: 'TEST', exportedAt: new Date().toISOString(),
    invoices: this.receipts(), numbering: this.registry, events: this.events }; }
}
module.exports = { Archive };
