'use strict';
// Xem thử bàn chơi viên thuốc nằm ngang với 4–8 người (8 người bật Dodge City) + pop-up Indians/Gatling/General Store.
// Dùng nguyên code bàn chơi thật của public/app.js; ván tạo bằng luật thật, pop-up phát từng bước bằng dữ liệu giả lập.
// Chạy: node tools/demo-capsule-table.js rồi mở http://localhost:3012
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');
const publicDir = path.resolve(__dirname, '../public');
const allNames = ['CaoBoiMienTay', 'ThanhXaThu99', 'HoangHonDo', 'TuongCuopSaMac', 'BongMaThungLung', 'SieuDaoChich', 'KeHaiMat_VN', 'DocNhanDodge'];

// Một ván cho mỗi số người 4–7, có sẵn vài trang bị để thấy khung trang bị trên đầu ghế
function makeView(n) {
  let seed = 11 + n;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const game = new Game(allNames.slice(0, n), { rng, dodgeCity: n === 8 }); // 8 người cần bản mở rộng Dodge City
  game.pending = null; game.queue = []; game.phase = 'play';
  const wanted = ['Barrel', 'Mustang', 'Scope', 'Volcanic', 'Schofield', 'Remington', 'Winchester'];
  game.players.forEach((p, i) => {
    const count = i % 3; // 0, 1 hoặc 2 món
    for (let k = 0; k < count; k++) {
      const idx = game.deck.findIndex((c) => wanted.includes(c.name) && !p.eq.some((e) => e.name === c.name || (CARD_INFO[e.name].type === 'gun' && CARD_INFO[c.name].type === 'gun')));
      if (idx >= 0) p.eq.push(game.deck.splice(idx, 1)[0]);
    }
  });
  return game.viewFor(game.players[(game.turn + 2) % n].name);
}
const views = Object.fromEntries([4, 5, 6, 7, 8].map((n) => [n, makeView(n)]));

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8'); // đọc lại mỗi lần tải trang
const header = `
META = ${JSON.stringify({ cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO })};
const demoViews = ${JSON.stringify(views)};
`;
const port = Number(process.env.DEMO_PORT) || 3012;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/demo-capsule-app.js') {
      const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(source.slice(0, source.indexOf('(async function init()')) + header + read('capsule-table-demo.js'));
    }
    if (url.pathname === '/') {
      const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
        .replace('/app.js', '/demo-capsule-app.js')
        .replace('</head>', `<style>${read('capsule-table-demo.css')}</style></head>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
  } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(e.message); }
  const file = path.resolve(publicDir, '.' + decodeURIComponent(url.pathname));
  if (!file.startsWith(publicDir + path.sep)) { res.writeHead(404); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': { '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8' }[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log('Nháp bàn viên thuốc: http://localhost:' + port));
