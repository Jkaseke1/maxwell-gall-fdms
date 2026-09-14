process.env.NODE_ENV = 'test';
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=1',
  'tests/sandboxReceipt.test.cjs',
  'tests/invoicePreview.test.mjs',
  'tests/archive.test.cjs',
  'tests/guide72.test.cjs',
], { stdio: 'inherit' });
process.exit(result.status ?? 1);
