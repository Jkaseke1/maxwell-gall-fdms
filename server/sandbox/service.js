const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const transport = require('../../scripts/zimraSandbox');
const { prepare, printed, identity, localTime, closePayload } = require('./receipt');
const QRCode = require('qrcode');
const { Archive } = require('./archive');
const certificates = require('./certificates');
const { AlertNotifier } = require('./alerts');
// Close before the server's maximum fiscal-day duration.  This leaves time
// for a transient network failure to be retried before the day expires.
const AUTO_ROLLOVER_LEAD_MS = 10 * 60 * 1000;
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
class SandboxService {
  constructor({ request = transport.request, directory = transport.output, key = fs.readFileSync(transport.keyPath), verifyReceipt = certificates.verifyReceipt } = {}) {
    this.verifyReceipt = verifyReceipt;
    this.directory = directory; this.key = key;
    this.archive = new Archive(directory === transport.output ? path.resolve(__dirname, '../../data/maxwell-glass/sandbox-38293') : path.join(directory, 'archive'));
    this.alerts = new AlertNotifier({ logger: (type, data) => this.archive.log(type, data) });
    this.request = async (endpoint, body, authenticated) => {
      this.archive.log('zimra.request', { endpoint, body });
      try { const response = await request(endpoint, body, authenticated); this.archive.log('zimra.response', { endpoint, response }); return response; }
      catch (error) {
        this.archive.log('zimra.error', { endpoint, message: error.message });
        void this.alertError('ZIMRA request failed', error.message, { endpoint });
        throw error;
      }
    };
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'receipt-state.json');
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file)) : { deviceId: 38293, lastGlobalNo: 0, counter: 0, receipts: [] };
    if (this.state.deviceId !== 38293) throw Error('Saved state belongs to another device.');
    this.busy = false;
    for (const receipt of this.state.receipts) this.archive.saveReceipt(receipt);
  }
  alertError(source, message, context = {}) {
    return this.alerts.error({ source, message, context }).catch(error => {
      this.archive.log('alert.error', { source, message: error.message });
      return { error: error.message };
    });
  }
  persist() {
    const fd = fs.openSync(this.file + '.tmp', 'w');
    try { fs.writeFileSync(fd, JSON.stringify(this.state, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(this.file + '.tmp', this.file);
  }
  async exclusive(fn) {
    if (this.busy) throw Error('Another sandbox operation is in progress.');
    this.busy = true; try { return await fn(); } finally { this.busy = false; }
  }
  async live() {
    const config = await this.request('/Device/v1/38293/GetConfig', undefined, true);
    identity(config);
    const status = await this.request('/Device/v1/38293/GetStatus', undefined, true);
    const last = status.lastReceiptGlobalNo ?? 0;
    if (this.state.opening && status.fiscalDayStatus === 'FiscalDayOpened' && status.lastFiscalDayNo === this.state.opening.expectedDay && last === this.state.lastGlobalNo) {
      this.state.fiscalDayNo = status.lastFiscalDayNo; this.state.openedAt = this.state.opening.openedAt;
      this.state.counter = 0; this.state.previousHash = null; delete this.state.opening; this.persist();
    }
    const aligned = last === this.state.lastGlobalNo;
    const open = status.fiscalDayStatus === 'FiscalDayOpened';
    const dayAligned = open && status.lastFiscalDayNo === this.state.fiscalDayNo && Boolean(this.state.openedAt);
    const openedMs = Date.parse(this.state.openedAt + '+02:00');
    const maxHours = Number(config.taxPayerDayMaxHrs);
    const dayTimeValid = Number.isFinite(openedMs) && Number.isFinite(maxHours) && maxHours > 0;
    const expired = dayAligned && dayTimeValid && Date.now() - openedMs >= maxHours * 3600000;
    const remainingHours = dayTimeValid ? (openedMs + maxHours * 3600000 - Date.now()) / 3600000 : null;
    const endingSoon = dayAligned && !expired && remainingHours <= Number(config.taxpayerDayEndNotificationHrs);
    const invalidReceipt = this.state.receipts.find(r=>r.fiscalDayNo===this.state.fiscalDayNo && r.printed.status==='VALIDATION_ERRORS');
    this.latestConfig = config;
    if (status.fiscalDayStatus === 'FiscalDayClosed' && aligned && !this.state.pending && this.state.openedAt && this.state.fiscalDayNo === status.lastFiscalDayNo && !this.state.closedDays?.[this.state.fiscalDayNo]) {
      this.state.closedDays ||= {};
      this.state.closedDays[this.state.fiscalDayNo] = { status, openedAt: this.state.openedAt, lastCounter: this.state.counter, closing: this.state.closing, config };
      try { this.state.closedDays[this.state.fiscalDayNo].verification = await certificates.verifyDay(this.state.closedDays[this.state.fiscalDayNo],status,this.request); }
      catch(e) { this.state.closedDays[this.state.fiscalDayNo].verification = {verified:false,error:e.message}; this.archive.log('fiscal-day.verification_failed',{message:e.message}); }
      this.state.counter = 0; this.state.previousHash = null; this.persist();
    }
    const savedDay = this.state.closedDays?.[status.lastFiscalDayNo];
    if (status.fiscalDayStatus === 'FiscalDayClosed' && savedDay && !savedDay.verification) {
      try { savedDay.verification = await certificates.verifyDay(savedDay, status, this.request); }
      catch(e) { savedDay.verification = {verified:false,error:e.message}; }
      this.archive.log('fiscal-day.signature_checked',{fiscalDayNo:status.lastFiscalDayNo,...savedDay.verification}); this.persist();
    }
    return { config, status, deviceId: 38293, serial: config.deviceSerialNo, environment: 'TEST',
      nextGlobalNo: aligned ? last + 1 : null,
      nextCounter: aligned && dayAligned ? this.state.counter + 1 : null,
      fiscalDayNo: status.lastFiscalDayNo ?? null, pendingInvoice: this.state.pending?.input.invoiceNumber || null,
      pendingDraft: this.state.pending?.input || null,
      expired, endingSoon, remainingHours, certificateValidTill: config.certificateValidTill, maintenance: this.maintenanceStatus,
      ready: aligned && dayAligned && dayTimeValid && !expired && !this.state.pending && !invalidReceipt,
      message: !aligned ? 'Server and local receipt history differ. Reconcile before issuing receipts.' :
        this.state.pending ? 'A saved submission needs retry with the same invoice.' : invalidReceipt ? 'A receipt has validation errors. Reconcile it with ZIMRA before issuing more.' :
        status.fiscalDayStatus==='FiscalDayCloseInitiated' ? 'ZIMRA is processing closure. Refresh until closed.' :
        status.fiscalDayStatus==='FiscalDayCloseFailed' ? 'Closure failed: '+(status.fiscalDayClosingErrorCode || 'inspect response')+'. Reconcile and retry closure.' : !open ? 'Open a test fiscal day to issue receipts.' :
        !dayAligned ? 'This open day was not initialized by this sandbox. Reconcile local state.' :
        !dayTimeValid ? 'Fiscal day timing is unavailable. Reconcile before issuing receipts.' :
        expired ? 'Fiscal day expired. Close this test day, refresh until closed, then open a new day before issuing another invoice.' : endingSoon ? 'Fiscal day ends in ' + remainingHours.toFixed(1) + ' hours. Close the day before expiry.' : 'Connected to Maxwell Glass sandbox.' };
  }
  open() { return this.exclusive(async () => {
    const live = await this.live();
    if (this.state.pending) throw Error('Resolve the pending receipt first.');
    if (live.status.fiscalDayStatus === 'FiscalDayOpened') return live;
    if (live.status.fiscalDayStatus !== 'FiscalDayClosed' || live.nextGlobalNo == null) throw Error(live.message);
    const openedAt = localTime();
    // Persist intent before contacting the server; a timeout never authorizes an automatic reopen.
    this.state.opening = { openedAt, expectedDay: (live.status.lastFiscalDayNo ?? 0) + 1 }; this.persist();
    const response = await this.request('/Device/v1/38293/OpenDay', { fiscalDayOpened: openedAt }, true);
    this.state.fiscalDayNo = response.fiscalDayNo; this.state.openedAt = openedAt; this.state.counter = 0;
    this.state.previousHash = null; delete this.state.opening; this.persist();
    return this.live();
  }); }
  close() { return this.exclusive(async () => {
    const live = await this.live();
    if (this.state.pending || live.nextGlobalNo == null) throw Error('Resolve pending receipt / counter mismatch before closing.');
    if (live.status.fiscalDayStatus === 'FiscalDayClosed') return live;
    if (!['FiscalDayOpened', 'FiscalDayCloseFailed'].includes(live.status.fiscalDayStatus) || live.fiscalDayNo !== this.state.fiscalDayNo) throw Error('Fiscal day is not ready for closing.');
    const payload = closePayload(this.state, this.key);
    this.state.closing = { payload }; this.persist();
    this.state.closing.response = await this.request('/Device/v1/38293/CloseDay', payload, true); this.persist();
    return this.live();
  }); }
  submit(input) { return this.exclusive(async () => {
    // Credit notes inherit buyer identity from the linked invoice when the form
    // does not provide it. This keeps the buyer address and tax details on the
    // fiscal credit note even if the operator only selects the original invoice.
    if (input?.receiptType === 'CreditNote' && input.originalReceiptId) {
      const original = this.state.receipts.find(r => r.response?.receiptID === Number(input.originalReceiptId) && r.printed?.status === 'FISCALIZED');
      if (original?.printed) {
        const source = original.printed;
        const customer = { ...(input.customer || {}) };
        if (!customer.name) customer.name = source.customer_name || '';
        if (!customer.tin) customer.tin = source.customer_tin || '';
        if (!customer.vat) customer.vat = source.customer_vat || '';
        if (!customer.phone) customer.phone = source.customer_phone || '';
        if (!customer.email) customer.email = source.customer_email && source.customer_email !== 'N/A' ? source.customer_email : '';
        if (!customer.address && source.buyer_address) customer.address = typeof source.buyer_address === 'string' ? source.buyer_address : [source.buyer_address.houseNo, source.buyer_address.street, source.buyer_address.city, source.buyer_address.province].filter(Boolean).join(', ');
        if (source.customer_tin) customer.taxDetails = true;
        input = { ...input, customer };
      }
    }
    this.archive.log('invoice.submit_attempt', { input });
    if (input.draftId && this.archive.registry.reservations[input.draftId] !== input.invoiceNumber) throw Error('Invoice number does not match its server reservation.');
    // Compare logical input, never replace signed bytes when retrying.
    const digest = crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = this.state.receipts.find(r => r.input.invoiceNumber === input.invoiceNumber);
    if (existing) {
      if (existing.digest !== digest) throw Error('Invoice number already used with different data.');
      this.archive.saveReceipt(existing);
      this.archive.log('invoice.duplicate_returned', { invoiceNumber: input.invoiceNumber });
      return existing.printed;
    }
    let pending = this.state.pending;
    if (pending && pending.digest !== digest) throw Error('Resolve saved invoice ' + pending.input.invoiceNumber + ' before issuing another.');
    const live = await this.live();
    if (!pending) {
      if (!live.ready) throw Error(live.message);
      if (Date.now() - Date.parse(this.state.openedAt + '+02:00') >= live.config.taxPayerDayMaxHrs * 3600000) throw Error('Fiscal day expired. Close and reconcile it before issuing more invoices.');
      const now = localTime();
      if (now <= this.state.openedAt) throw Error('Fiscal day just opened. Try the invoice again in a second.');
      if (now <= (this.state.receipts.at(-1)?.prepared.receipt.receiptDate || '')) throw Error('Wait until the clock is later than the previous receipt time before issuing.');
      const prepared = prepare(input, live.config, { nextCounter: live.nextCounter, nextGlobalNo: live.nextGlobalNo, previousHash: this.state.previousHash }, this.key, now);
      if (prepared.receipt.receiptType !== 'FiscalInvoice') {
        const original = this.state.receipts.find(r => r.response.receiptID === Number(input.originalReceiptId) && r.printed.status === 'FISCALIZED' && r.prepared.receipt.receiptType === 'FiscalInvoice');
        if (!original) throw Error('Choose an accepted original invoice from this Maxwell Glass archive.');
        const r = original.prepared.receipt;
        const cutoff = new Date(now + '+02:00'); cutoff.setUTCFullYear(cutoff.getUTCFullYear()-1);
        if (Date.parse(r.receiptDate + '+02:00') < cutoff.getTime()) throw Error('Original invoice is older than 12 months.');
        if (r.receiptCurrency !== prepared.receipt.receiptCurrency) throw Error('Note currency must match original invoice.');
        if (prepared.receipt.receiptTaxes.some(t => !r.receiptTaxes.some(o => o.taxID === t.taxID && o.taxPercent === t.taxPercent))) throw Error('Note taxes must match original invoice.');
        const balance = this.state.receipts.filter(n => n.prepared.receipt.creditDebitNote?.receiptID === Number(input.originalReceiptId)).reduce((s,n) => s+n.prepared.receipt.receiptTotal, r.receiptTotal);
        if (Math.round((balance + prepared.total)*100) < 0) throw Error('Credit exceeds remaining original invoice balance.');
        prepared.original = { receiptId: original.response.receiptID, invoiceNo: r.invoiceNo, globalNo: r.receiptGlobalNo, date: r.receiptDate, deviceId:38293, serial:'TEST-2000945150-B670' };
      }
      pending = { digest, input, prepared, fiscalDayNo: this.state.fiscalDayNo, qrBase: live.config.qrUrl };
      this.state.pending = pending; this.persist();
    }
    let response;
    try {
      response = pending.response || await this.request('/Device/v1/38293/SubmitReceipt', { receipt: pending.prepared.receipt }, true);
    } catch (error) {
      // Preserve pending bytes even for HTTP errors: no guessed counter rollback.
      pending.retryable = error.retryable !== false; this.persist();
      throw Error(error.message + ' Saved invoice retained; retry this exact invoice.');
    }
    pending.response = response; this.persist();
    if (!response.receiptID || !response.receiptServerSignature?.signature) throw Error('Missing ZIMRA acknowledgement. Saved submission retained for investigation.');
    pending.verification = await this.verifyReceipt(pending.prepared, response, this.request);
    const result = printed(pending.input, pending.prepared, response, pending.fiscalDayNo, pending.qrBase);
    result.original = pending.prepared.original; result.server_verification = pending.verification;
    result.qr_image = await QRCode.toDataURL(result.zimra_verification_url, { width: 180, margin: 1 });
    const record = { ...pending, printed: result };
    this.state.receipts.push(record);
    this.state.lastGlobalNo = pending.prepared.receipt.receiptGlobalNo;
    this.state.counter = pending.prepared.receipt.receiptCounter;
    this.state.previousHash = pending.prepared.receipt.receiptDeviceSignature.hash;
    delete this.state.pending; this.persist();
    this.archive.saveReceipt(record);
    return result;
  }); }
  async autoRollover() {
    const live = await this.live();
    const status = live.status.fiscalDayStatus;
    const rollover = this.state.autoRollover;
    if (this.state.pending) return { action: 'waiting', message: 'Automatic rollover is waiting for the saved receipt to be resolved.' };

    // A closure can be asynchronous.  Only reopen the next day after ZIMRA
    // confirms the previous day is closed, and only when this service caused
    // the closure.  A user-closed day remains closed until opened manually.
    if (status === 'FiscalDayClosed' && rollover && rollover.fiscalDayNo === live.fiscalDayNo) {
      const opened = await this.open();
      if (opened.status.fiscalDayStatus !== 'FiscalDayOpened') throw Error('ZIMRA did not confirm the next fiscal day opening.');
      this.archive.log('fiscal-day.auto_opened', { closedDay: rollover.fiscalDayNo, openedDay: opened.fiscalDayNo });
      delete this.state.autoRollover; this.persist();
      return { action: 'opened', fiscalDayNo: opened.fiscalDayNo };
    }
    if (status !== 'FiscalDayOpened' || !live.ready) return { action: 'idle' };

    const openedAt = Date.parse(this.state.openedAt + '+02:00');
    const maxHours = Number(live.config.taxPayerDayMaxHrs);
    if (!Number.isFinite(openedAt) || !Number.isFinite(maxHours) || maxHours <= 0) return { action: 'idle' };
    const closeAt = openedAt + maxHours * 3600000 - AUTO_ROLLOVER_LEAD_MS;
    if (Date.now() < closeAt) return { action: 'scheduled', closeAt: new Date(closeAt).toISOString() };

    if (!rollover) {
      this.state.autoRollover = { fiscalDayNo: live.fiscalDayNo, requestedAt: new Date().toISOString() };
      this.persist();
      this.archive.log('fiscal-day.auto_close_requested', { fiscalDayNo: live.fiscalDayNo, closeAt: new Date(closeAt).toISOString() });
    }
    const closed = await this.close();
    if (closed.status.fiscalDayStatus === 'FiscalDayClosed') return this.autoRollover();
    return { action: 'closing', fiscalDayNo: live.fiscalDayNo };
  }
  async maintenance() {
    if (this.busy) return;
    try {
      const ping = await this.request('/Device/v1/38293/Ping', {}, true);
      this.maintenanceStatus = { ...this.maintenanceStatus, onlineAt: new Date().toISOString(), reportingFrequency: ping.reportingFrequency };
      return Math.max(0.1, Number(ping.reportingFrequency) || 5) * 60000;
    } catch (e) { this.maintenanceStatus = { error: e.message }; return 60000; }
  }
  startMaintenance() {
    let stopped = false;
    const tick = async () => {
      let delay = 60000;
      try {
        if (!this.busy) {
          if (!this.latestConfig) await this.live();
          delay = await this.maintenance() || delay;
          if (this.state.pending?.retryable && !this.busy) await this.submit(this.state.pending.input);
          if (!this.busy && this.latestConfig?.certificateValidTill && Date.parse(this.latestConfig.certificateValidTill) - Date.now() <= 30*86400000) await this.renew();
          if (!this.busy) this.maintenanceStatus = { ...this.maintenanceStatus, rollover: await this.autoRollover() };
          if (!this.busy && (!this.state.lastBackupAt || Date.now() - Date.parse(this.state.lastBackupAt) >= AUTO_BACKUP_INTERVAL_MS)) {
            this.maintenanceStatus = { ...this.maintenanceStatus, backup: await this.backup() };
          }
        }
      } catch (e) {
        this.archive.log('maintenance.error', { message: e.message });
        await this.alertError('Maintenance failed', e.message);
      }
      if (!stopped) { this.maintenanceTimer = setTimeout(tick, delay); this.maintenanceTimer.unref(); }
    };
    tick(); return () => { stopped = true; clearTimeout(this.maintenanceTimer); };
  }
  renew() { return this.exclusive(async () => {
    if (this.state.pending) throw Error('Resolve pending receipt before certificate renewal.');
    await this.live();
    const result = await certificates.renewCertificate(this.request); this.archive.log('certificate.renewal', result); return result;
  }); }
  backup() { return this.exclusive(async()=>{
    const destination=path.resolve(this.directory,'../../backups','test-38293-'+new Date().toISOString().replace(/[:.]/g,'-'));
    fs.mkdirSync(destination,{recursive:true});
    const contents={'receipt-state.json':JSON.stringify(this.state,null,2),'audit-export.json':JSON.stringify(this.archive.export(),null,2)};
    const hashes={};
    for(const [name,value] of Object.entries(contents)){fs.writeFileSync(path.join(destination,name),value);hashes[name]=crypto.createHash('sha256').update(value).digest('hex');}
    fs.writeFileSync(path.join(destination,'sha256.json'),JSON.stringify(hashes,null,2));
    // Verify deserialisation, identities, counts and bytes without overwriting live state.
    for(const [name,hash] of Object.entries(hashes))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(destination,name))).digest('hex')!==hash)throw Error('Backup checksum verification failed.');
    const restored=JSON.parse(fs.readFileSync(path.join(destination,'receipt-state.json'))),audit=JSON.parse(fs.readFileSync(path.join(destination,'audit-export.json')));
    if(restored.deviceId!==38293||audit.deviceId!==38293||audit.invoices.length!==restored.receipts.length)throw Error('Backup identity/count verification failed.');
    this.archive.log('backup.verified',{destination,receipts:restored.receipts.length});
    this.state.lastBackupAt = new Date().toISOString();
    this.persist();
    return {destination,verified:true,receipts:restored.receipts.length,keysIncluded:false};
  }); }
}
module.exports = { SandboxService };
