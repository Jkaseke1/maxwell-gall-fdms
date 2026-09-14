// Isolated Maxwell Glass sandbox transport and device setup. Never loads .env or Supabase.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env.zimra-test');
const config = fs.existsSync(envFile)
  ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  : process.env.NODE_ENV === 'test'
    ? { FDMS_BASE_URL: 'https://fdmsapitest.zimra.co.zw', FDMS_DEVICE_ID: '38293', FDMS_DEVICE_MODEL_NAME: 'Server', FDMS_DEVICE_MODEL_VERSION: 'v1', FDMS_CERT_PATH: './certs/test-38293/device.cert.pem', FDMS_KEY_PATH: './certs/test-38293/device.key.pem' }
    : (() => { throw new Error('Missing .env.zimra-test. Configure the Maxwell Glass sandbox before running transport commands.'); })();
if (config.FDMS_BASE_URL !== 'https://fdmsapitest.zimra.co.zw' || config.FDMS_DEVICE_ID !== '38293') {
  throw new Error('Sandbox host/device guard failed');
}
const output = path.join(root, 'test-results', 'test-38293');
fs.mkdirSync(output, { recursive: true });
const keyPath = path.resolve(root, config.FDMS_KEY_PATH);
const certPath = path.resolve(root, config.FDMS_CERT_PATH);
const certDir = path.join(root, 'certs', 'test-38293');
if (path.dirname(keyPath) !== certDir || path.dirname(certPath) !== certDir) throw new Error('Sandbox certificate path guard failed');
function save(name, data) { fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(data, null, 2)); }
function request(endpoint, body, authenticated = false) {
  const allowed = [`/Public/v1/38293/VerifyTaxpayerInformation`, `/Public/v1/38293/RegisterDevice`,
    `/Device/v1/38293/GetConfig`, `/Device/v1/38293/GetStatus`,
    `/Device/v1/38293/Ping`, `/Device/v1/38293/IssueCertificate`, `/Public/v1/GetServerCertificate`,
    `/Device/v1/38293/OpenDay`, `/Device/v1/38293/CloseDay`, `/Device/v1/38293/SubmitReceipt`];
  if (!allowed.includes(endpoint) && !/^\/Public\/v1\/GetServerCertificate\?thumbprint=[a-fA-F0-9]{40}$/.test(endpoint)) throw new Error('Endpoint is not allowed by sandbox setup');
  return new Promise((resolve, reject) => {
    const req = https.request(config.FDMS_BASE_URL + endpoint, {
      method: body ? 'POST' : 'GET', timeout: 30000,
      headers: { 'Content-Type': 'application/json', DeviceModelName: config.FDMS_DEVICE_MODEL_NAME,
        DeviceModelVersion: config.FDMS_DEVICE_MODEL_VERSION },
      ...(authenticated ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : {})
    }, res => {
      let text = ''; res.on('data', d => { text += d; });
      res.on('end', () => {
        let data; try { data = JSON.parse(text); } catch { return reject(new Error('Non-JSON response: HTTP ' + res.statusCode)); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          save('last-error', { endpoint, status: res.statusCode, response: data });
          const error = new Error(`HTTP ${res.statusCode}: ${data.errorCode || ''} ${data.detail || data.title || ''} (operation ${data.operationID || 'unknown'})`);
          error.retryable = res.statusCode >= 500 || res.statusCode === 429; error.statusCode = res.statusCode;
          return reject(error);
        }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Request timed out; do not assume registration failed. Reuse the saved key/CSR.')));
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
async function main() {
  const command = process.argv[2] || 'verify';
  if (!['verify', 'register', 'status'].includes(command)) throw new Error('Use verify, register, or status');
  if (command !== 'status') {
    const taxpayer = await request('/Public/v1/38293/VerifyTaxpayerInformation', {
      activationKey: config.FDMS_ACTIVATION_KEY, deviceSerialNo: config.FDMS_DEVICE_SERIAL_NO
    });
    if (String(taxpayer.taxPayerTIN) !== config.CUSTOMER_TIN) throw new Error('TIN mismatch: registration blocked');
    save('taxpayer', taxpayer);
    console.log(`Verified ${taxpayer.taxPayerName}; TIN ${taxpayer.taxPayerTIN}; branch ${taxpayer.deviceBranchName}`);
  }
  if (command === 'register' && !fs.existsSync(certPath)) {
    fs.mkdirSync(certDir, { recursive: true });
    const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
    const csrPath = path.join(certDir, 'device.csr.pem');
    const cn = `ZIMRA-${config.FDMS_DEVICE_SERIAL_NO}-${config.FDMS_DEVICE_ID.padStart(10, '0')}`;
    // Preserve keys across retries, including ambiguous registration responses.
    if (!fs.existsSync(keyPath)) execFileSync(openssl, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath]);
    execFileSync(openssl, ['req', '-new', '-sha256', '-key', keyPath, '-out', csrPath, '-subj', `/C=ZW/O=Zimbabwe Revenue Authority/CN=${cn}`]);
    const result = await request('/Public/v1/38293/RegisterDevice', {
      activationKey: config.FDMS_ACTIVATION_KEY, certificateRequest: fs.readFileSync(csrPath, 'utf8')
    });
    // Save the response immediately to preserve recovery evidence.
    save('registration', result);
    const cert = new crypto.X509Certificate(result.certificate);
    if (!cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(keyPath)))) throw new Error('Certificate/key mismatch');
    fs.writeFileSync(certPath, result.certificate, { flag: 'wx' });
    console.log('Test device registered; certificate saved in certs/test-38293.');
  }
  if (command === 'status' || command === 'register') {
    const deviceConfig = await request('/Device/v1/38293/GetConfig', undefined, true);
    if (String(deviceConfig.taxPayerTIN) !== config.CUSTOMER_TIN || deviceConfig.deviceSerialNo !== config.FDMS_DEVICE_SERIAL_NO) throw new Error('Device identity mismatch');
    save('config', deviceConfig);
    const status = await request('/Device/v1/38293/GetStatus', undefined, true);
    save('status', status);
    console.log(JSON.stringify({ applicableTaxes: deviceConfig.applicableTaxes, status }, null, 2));
  }
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { request, keyPath, certPath, output };
