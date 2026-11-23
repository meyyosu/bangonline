'use strict';
// Xem thử vòng vàng đếm ngược quanh avatar người đang có đồng hồ, trên bàn chơi thật.
// Chạy: node tools/demo-turn-ring.js rồi mở http://localhost:3010
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');
const publicDir = path.resolve(__dirname, '../public');
const names = ['CaoBoiMienTay', 'ThanhXaThu99', 'HoangHonDo', 'TuongCuopSaMac', 'BongMaThungLung', 'SieuDaoChich', 'KeHaiMat_VN'];

let seed = 7;
const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const game = new Game(names, { rng });
game.pending = null; game.queue = []; game.phase = 'play';
const view = game.viewFor(game.players[(game.turn + 3) % names.length].name);

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8'); // đọc lại mỗi lần tải trang
const header = `
META = ${JSON.stringify({ cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO })};
const demoView = ${JSON.stringify(view)};
`;
const port = Number(process.env.DEMO_PORT) || 3010;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/demo-ring-app.js') {
    const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(source.slice(0, source.indexOf('(async function init()')) + header + read('turn-ring-demo.js'));
  }
  if (url.pathname === '/') {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
      .replace('/app.js', '/demo-ring-app.js')
      .replace('</head>', `<style>${read('turn-ring-demo.css')}</style></head>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(html);
  }
  const file = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(publicDir + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': { '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8' }[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('Demo vòng đếm ngược: http://localhost:' + port));
