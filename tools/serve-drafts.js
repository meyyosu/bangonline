'use strict';
// Xem các file nháp trong drafts/ qua http (file nháp dùng ../public/style.css nên phục vụ cả thư mục dự án).
// Chạy: node tools/serve-drafts.js rồi mở http://localhost:3013/drafts/<tên>.html
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3013);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
const ALLOWED = ['drafts', 'public'].map((d) => path.join(ROOT, d) + path.sep);
http.createServer((req, res) => {
  const file = path.resolve(ROOT, '.' + decodeURIComponent(req.url.split('?')[0]));
  if (!ALLOWED.some((d) => file.startsWith(d))) { res.writeHead(404); return res.end('404'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Nháp: http://localhost:${PORT}/drafts/`));
