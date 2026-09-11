const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const children = [];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code; }
function start(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => stop(code || 0));
}
console.log('MAXWELL GLASS only: sandbox device 38293. Open http://127.0.0.1:5173/create-invoice');
start([path.join(root, 'server/sandbox/index.js')], root);
start([path.join(root, 'dashboard/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort', '--open', 'false'], path.join(root, 'dashboard'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
