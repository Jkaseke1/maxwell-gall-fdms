const path = require('node:path');
const { spawn } = require('node:child_process');
require('dotenv').config({ path: path.resolve(__dirname, '../.env.maxwell-production') });
if (process.env.FDMS_DEVICE_ID !== '46158' || process.env.FDMS_DEVICE_SERIAL_NO !== 'ZIMRAVD-1737') throw Error('Maxwell production identity guard failed.');
const children = [
  spawn(process.execPath, [path.resolve(__dirname, '../server/production/index.js')], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, [path.resolve(__dirname, '../server/production/static.js')], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', windowsHide: true })
];
let stopping = false;
const stop = code => { if (stopping) return; stopping = true; for (const child of children) if (!child.killed) child.kill(); setTimeout(() => process.exit(code), 1000).unref(); };
for (const child of children) child.on('exit', code => { if (!stopping && code !== 0) stop(code || 1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(0));
