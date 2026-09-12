// Maxwell Glass production-only FDMS transport. Never loads the sandbox env.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const config = Object.fromEntries(fs.readFileSync(path.join(root, '.env.maxwell-production'), 'utf8')
  .split(/\r?\n/).filter(line => line && !line.startsWith('#') && line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const deviceId = config.FDMS_DEVICE_ID;
if (config.FDMS_BASE_URL !== 'https://fdmsapi.zimra.co.zw' || deviceId !== '46158' || config.FDMS_DEVICE_SERIAL_NO !== 'ZIMRAVD-1737') throw Error('Maxwell production identity guard failed.');
const output = path.resolve(root, config.FDMS_DATA_DIR || 'data/maxwell-glass/production-46158');
const keyPath = path.resolve(root, config.FDMS_KEY_PATH);
const certPath = path.resolve(root, config.FDMS_CERT_PATH);
if (path.dirname(keyPath) !== path.dirname(certPath)) throw Error('Production key and certificate must share an isolated directory.');
fs.mkdirSync(output, { recursive: true });
function save(name, data) { fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(data, null, 2)); }
const endpoint = suffix => `/Device/v1/${deviceId}/${suffix}`;
function request(urlPath, body, authenticated = false) {
  const allowed = new Set([
    `/Public/v1/${deviceId}/VerifyTaxpayerInformation`, `/Public/v1/${deviceId}/RegisterDevice`,
    endpoint('GetConfig'), endpoint('GetStatus'), endpoint('Ping'), endpoint('IssueCertificate'),
    endpoint('OpenDay'), endpoint('CloseDay'), endpoint('SubmitReceipt'), '/Public/v1/GetServerCertificate'
  ]);
  if (!allowed.has(urlPath) && !/^\/Public\/v1\/GetServerCertificate\?thumbprint=[a-fA-F0-9]{40}$/.test(urlPath)) throw Error('Production endpoint is not allowed.');
  return new Promise((resolve, reject) => {
    const req = https.request(config.FDMS_BASE_URL + urlPath, {
      method: body ? 'POST' : 'GET', timeout: 30000,
      headers: { 'Content-Type': 'application/json', DeviceModelName: config.FDMS_DEVICE_MODEL_NAME, DeviceModelVersion: config.FDMS_DEVICE_MODEL_VERSION },
      ...(authenticated ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) } : {})
    }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => {
        let data; try { data = JSON.parse(text); } catch { return reject(Error(`Non-JSON response: HTTP ${res.statusCode}`)); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          save('last-error', { endpoint: urlPath, status: res.statusCode, response: data });
          const error = Error(`HTTP ${res.statusCode}: ${data.errorCode || ''} ${data.detail || data.title || ''} (operation ${data.operationID || 'unknown'})`);
          error.retryable = res.statusCode >= 500 || res.statusCode === 429; return reject(error);
        }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(Error('Request timed out; reuse saved state before retrying.')));
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}
async function verify() {
  const taxpayer = await request(`/Public/v1/${deviceId}/VerifyTaxpayerInformation`, { activationKey: config.FDMS_ACTIVATION_KEY, deviceSerialNo: config.FDMS_DEVICE_SERIAL_NO });
  if (String(taxpayer.taxPayerTIN) !== config.CUSTOMER_TIN) throw Error('ZIMRA taxpayer TIN does not match Maxwell Glass.');
  save('taxpayer', taxpayer); return taxpayer;
}
async function register() {
  await verify(); fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const openssl = process.env.OPENSSL_PATH || (process.platform === 'win32' ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  const csrPath = path.join(path.dirname(keyPath), 'device.csr.pem');
  if (!fs.existsSync(keyPath)) execFileSync(openssl, ['ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', keyPath], { windowsHide: true });
  execFileSync(openssl, ['req', '-new', '-sha256', '-key', keyPath, '-out', csrPath, '-subj', `/C=ZW/O=Zimbabwe Revenue Authority/CN=ZIMRA-${config.FDMS_DEVICE_SERIAL_NO}-${deviceId.padStart(10, '0')}`], { windowsHide: true });
  if (fs.existsSync(certPath)) throw Error('Production certificate already exists; use status.');
  const response = await request(`/Public/v1/${deviceId}/RegisterDevice`, { activationKey: config.FDMS_ACTIVATION_KEY, certificateRequest: fs.readFileSync(csrPath, 'utf8') });
  const cert = new crypto.X509Certificate(response.certificate);
  if (!cert.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(keyPath)))) throw Error('Production certificate/key mismatch.');
  fs.writeFileSync(certPath, response.certificate, { flag: 'wx' });
  save('registration', { ...response, certificate: '[stored in isolated production certificate directory]' });
}
async function status() {
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) throw Error('Production certificate/key not found.');
  const configResponse = await request(endpoint('GetConfig'), undefined, true);
  const statusResponse = await request(endpoint('GetStatus'), undefined, true);
  if (String(configResponse.taxPayerTIN) !== config.CUSTOMER_TIN || configResponse.deviceSerialNo !== config.FDMS_DEVICE_SERIAL_NO) throw Error('Production GetConfig identity mismatch.');
  save('config', configResponse); save('status', statusResponse); return { config: configResponse, status: statusResponse };
}
if (require.main === module) (async () => {
  const command = process.argv[2] || 'status';
  if (command === 'verify') { const t = await verify(); console.log(`Verified Maxwell Glass production device ${deviceId}; TIN ${t.taxPayerTIN}.`); }
  else if (command === 'register') { await register(); console.log(`Registered Maxwell Glass production device ${deviceId}.`); }
  else if (command === 'status') console.log(JSON.stringify(await status(), null, 2));
  else throw Error('Use verify, register, or status.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { config, deviceId, output, keyPath, certPath, request };
