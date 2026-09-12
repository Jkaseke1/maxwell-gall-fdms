const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../dashboard-production/dist');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
if (!fs.existsSync(path.join(root, 'index.html'))) throw Error('Production dashboard is not built. Run npm --prefix dashboard-production run build.');
const server = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/api/')) {
    const proxy = http.request({ hostname: '127.0.0.1', port: 46158, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:46158' } }, upstream => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    });
    proxy.on('error', error => { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Production API unavailable: ' + error.message })); });
    req.pipe(proxy); return;
  }
  const requested = decodeURIComponent((req.url || '/').split('?')[0]);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  const file = candidate.startsWith(root + path.sep) && fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : path.join(root, 'index.html');
  res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable');
  res.setHeader('Content-Type', mime[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).on('error', () => { res.writeHead(500); res.end('Dashboard unavailable'); }).pipe(res);
});
server.listen(46157, '127.0.0.1', () => console.log('MAXWELL GLASS production dashboard: http://127.0.0.1:46157'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
