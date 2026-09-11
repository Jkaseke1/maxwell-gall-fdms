// Maxwell Glass production device utility. Credentials are read only from
// .env.maxwell-production and are never printed.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.maxwell-production');
if (!fs.existsSync(envFile)) throw Error('Missing .env.maxwell-production.');
const cfg = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
if (cfg.FDMS_BASE_URL !== 'https://fdmsapi.zimra.co.zw' || cfg.FDMS_DEVICE_ID !== '46158' || cfg.FDMS_DEVICE_SERIAL_NO !== 'ZIMRAVD-1737') {
  throw Error('Maxwell Glass production identity guard failed.');
}
const id = cfg.FDMS_DEVICE_ID;
const certPath = path.resolve(root, cfg.FDMS_CERT_PATH);
const keyPath = path.resolve(root, cfg.FDMS_KEY_PATH);
const certDir = path.dirname(certPath);
function request(endpoint, body, authenticated = false) {
  return new Promise((resolve, reject) => {
    const req = https.request(cfg.FDMS_BASE_URL + endpoint, {
      method: body ? 'POST' : 'GET', timeout: 30000,
      headers: { 'Content-Type': 'application/json', DeviceModelName: cfg.FDMS_DEVICE_MODEL_NAME, DeviceModelVersion: cfg.FDMS_DEVICE_MODEL_VERSION },
      ...(authenticated ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : {})
    }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data; try { data = JSON.parse(text); } catch { return reject(Error(`Non-JSON response: HTTP ${res.statusCode}`)); }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(Error(`HTTP ${res.statusCode}: ${data.errorCode || ''} ${data.detail || data.title || ''} (operation ${data.operationID || 'unknown'})`));
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(Error('Request timed out; retry without changing the saved key.')));
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
async function verify() {
  const taxpayer = await request(`/Public/v1/${id}/VerifyTaxpayerInformation`, { activationKey: cfg.FDMS_ACTIVATION_KEY, deviceSerialNo: cfg.FDMS_DEVICE_SERIAL_NO });
  if (String(taxpayer.taxPayerTIN) !== cfg.CUSTOMER_TIN) throw Error('ZIMRA taxpayer TIN does not match Maxwell Glass.');
  fs.mkdirSync(path.join(root, 'test-results', 'production-46158'), { recursive: true });
  fs.writeFileSync(path.join(root, 'test-results', 'production-46158', 'taxpayer.json'), JSON.stringify(taxpayer, null, 2));
  console.log(`Verified Maxwell Glass production device ${id}; serial ${cfg.FDMS_DEVICE_SERIAL_NO}; TIN ${taxpayer.taxPayerTIN}.`);
  return taxpayer;
}
async function register() {
  await verify(); fs.mkdirSync(certDir, { recursive: true });
  const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const csrPath = path.join(certDir, 'device.csr.pem');
  if (!fs.existsSync(keyPath)) execFileSync(openssl, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath], { windowsHide: true });
  // ZIMRA expects the same CN shape used by the device-registration guide:
  // ZIMRA-{device serial}-{10 digit device id}.
  if (fs.existsSync(csrPath)) fs.unlinkSync(csrPath);
  execFileSync(openssl, ['req', '-new', '-sha256', '-key', keyPath, '-out', csrPath, '-subj', `/C=ZW/O=Zimbabwe Revenue Authority/CN=ZIMRA-${cfg.FDMS_DEVICE_SERIAL_NO}-${id.padStart(10, '0')}`], { windowsHide: true });
  if (fs.existsSync(certPath)) throw Error('Production certificate already exists; use status instead of registering again.');
  const result = await request(`/Public/v1/${id}/RegisterDevice`, { activationKey: cfg.FDMS_ACTIVATION_KEY, certificateRequest: fs.readFileSync(csrPath, 'utf8') });
  const cert = new crypto.X509Certificate(result.certificate);
  if (!cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(keyPath)))) throw Error('ZIMRA certificate does not match the saved private key.');
  fs.writeFileSync(certPath, result.certificate, { flag: 'wx' });
  fs.writeFileSync(path.join(root, 'test-results', 'production-46158', 'registration.json'), JSON.stringify({ ...result, certificate: '[stored in certs/production-46158]' }, null, 2));
  console.log(`Registered Maxwell Glass production device ${id}; certificate saved separately.`);
}
async function status() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) throw Error('Production certificate/key not found; run register first.');
  const config = await request(`/Device/v1/${id}/GetConfig`, undefined, true);
  const device = await request(`/Device/v1/${id}/GetStatus`, undefined, true);
  if (String(config.taxPayerTIN) !== cfg.CUSTOMER_TIN || String(config.deviceID || id) !== id) throw Error('Production GetConfig identity mismatch.');
  console.log(JSON.stringify({ deviceId: id, serial: config.deviceSerialNo, taxpayerTIN: config.taxPayerTIN, fiscalDayStatus: device.fiscalDayStatus, lastFiscalDayNo: device.lastFiscalDayNo, lastReceiptGlobalNo: device.lastReceiptGlobalNo, certificateValidTill: config.certificateValidTill }, null, 2));
}
const command = process.argv[2] || 'verify';
(command === 'verify' ? verify() : command === 'register' ? register() : command === 'status' ? status() : Promise.reject(Error('Use verify, register, or status'))).catch(error => { console.error(error.message); process.exitCode = 1; });
