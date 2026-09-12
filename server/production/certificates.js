const crypto = require('node:crypto');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const transport = require('../../scripts/maxwellProductionTransport');
function thumbprint(value) {
  if (/^[a-f0-9]{40}$/i.test(value || '')) return value.toLowerCase();
  const decoded = Buffer.from(value || '', 'base64');
  if (decoded.length !== 20) throw Error('Missing or invalid FDMS certificate thumbprint.');
  return decoded.toString('hex');
}
async function verifyFDMS(signature, message, request) {
  const thumb = thumbprint(signature?.certificateThumbprint);
  const response = await request('/Public/v1/GetServerCertificate?thumbprint=' + thumb, undefined, false);
  const cert = response.certificate.map(pem => new crypto.X509Certificate(pem)).find(c => c.fingerprint.replace(/:/g,'').toLowerCase() === thumb);
  if (!cert) throw Error('FDMS signing certificate does not match acknowledgement thumbprint.');
  // Certificate is retrieved over authenticated HTTPS from the pinned production host.
  const hash = crypto.createHash('sha256').update(message).digest('base64');
  if (hash !== signature.hash || !crypto.verify('sha256', Buffer.from(message), cert.publicKey, Buffer.from(signature.signature, 'base64'))) throw Error('FDMS signature verification failed.');
  return { verified: true, thumbprint: thumb, checkedAt: new Date().toISOString() };
}
async function verifyReceipt(prepared, response, request) {
  if (!response.serverDate) throw Error('FDMS response missing serverDate.');
  return verifyFDMS(response.receiptServerSignature, prepared.receipt.receiptDeviceSignature.signature + response.receiptID + response.serverDate, request);
}
async function verifyDay(day, status, request) {
  const {buildCounterString} = require('../../src/signatures/fiscalDaySignature');
  if (!day.closing?.payload || !status.fiscalDayClosed || !status.fiscalDayReconciliationMode) throw Error('Fiscal-day verification data unavailable.');
  const p=day.closing.payload;
  const message='46158'+p.fiscalDayNo+day.openedAt.slice(0,10)+status.fiscalDayClosed+status.fiscalDayReconciliationMode.toUpperCase()+buildCounterString(status.fiscalDayCounter || p.fiscalDayCounters)+(status.fiscalDayReconciliationMode==='Manual'?'':p.fiscalDayDeviceSignature.signature);
  return verifyFDMS(status.fiscalDayServerSignature,message,request);
}
async function renewCertificate(request) {
  const old = new crypto.X509Certificate(fs.readFileSync(transport.certPath));
  if (Date.parse(old.validTo) - Date.now() > 30 * 86400000) return { renewed: false, validTill: old.validTo, message: 'Certificate is not within the 30-day renewal window.' };
  const csr = path.join(path.dirname(transport.certPath), 'renewal.csr.pem');
  execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req','-new','-sha256','-key',transport.keyPath,'-out',csr,'-subj','/C=ZW/O=Zimbabwe Revenue Authority/CN=ZIMRA-ZIMRAVD-1737-0000046158'], { windowsHide: true });
  const response = await request('/Device/v1/46158/IssueCertificate', {certificateRequest: fs.readFileSync(csr,'utf8')}, true);
  // Keep the returned certificate immediately so a interrupted replacement is recoverable.
  fs.writeFileSync(transport.certPath + '.renewed', response.certificate);
  const next = new crypto.X509Certificate(response.certificate);
  if (!next.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(transport.keyPath))) || next.subject !== old.subject || Date.parse(next.validTo) <= Date.now()) throw Error('Renewed certificate failed identity/key/validity checks.');
  fs.copyFileSync(transport.certPath, transport.certPath + '.' + old.fingerprint256.replace(/:/g,'') + '.previous');
  fs.renameSync(transport.certPath + '.renewed', transport.certPath);
  return { renewed: true, validTill: next.validTo };
}
module.exports = { verifyReceipt, verifyFDMS, verifyDay, renewCertificate };

