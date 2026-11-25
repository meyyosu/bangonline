'use strict';
// Nháp: tay bài hình quạt kiểu Hearthstone ở mép dưới màn hình, trên giao diện ván thật 8 người (Dodge City).
// Dùng nguyên code giao diện của public/app.js + style.css; chỉ thêm lớp quạt ở tools/fan-hand-demo.{js,css}.
// Chạy: node tools/demo-fan-hand.js rồi mở http://localhost:3016
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');
const publicDir = path.resolve(__dirname, '../public');
const allNames = ['CaoBoiMienTay', 'ThanhXaThu99', 'HoangHonDo', 'TuongCuopSaMac', 'BongMaThungLung', 'SieuDaoChich', 'KeHaiMat_VN', 'DocNhanDodge'];

// Ván 8 người đang ở lượt của mình, đã rút bài xong, trên tay 7 lá; vài người có trang bị
function makeView(n, handSize) {
  let seed = 23 + n;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const game = new Game(allNames.slice(0, n), { rng, dodgeCity: n === 8 });
  game.pending = null; game.queue = []; game.phase = 'play';
  const wanted = ['Barrel', 'Mustang', 'Scope', 'Volcanic', 'Schofield', 'Remington', 'Winchester'];
  game.players.forEach((p, i) => {
    for (let k = 0; k < i % 3; k++) {
      const idx = game.deck.findIndex((c) => wanted.includes(c.name) && !p.eq.some((e) => e.name === c.name || (CARD_INFO[e.name].type === 'gun' && CARD_INFO[c.name].type === 'gun')));
      if (idx >= 0) p.eq.push(game.deck.splice(idx, 1)[0]);
    }
  });
  const me = game.players[game.turn];
  while (me.hand.length < handSize && game.deck.length) me.hand.push(game.deck.pop());
  return game.viewFor(me.name);
}
const views = Object.fromEntries([4, 7, 10].map((k) => [k, makeView(8, k)]));

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8'); // đọc lại mỗi lần tải trang
const header = `
META = ${JSON.stringify({ cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO })};
const demoViews = ${JSON.stringify(views)};
`;
const port = Number(process.env.DEMO_PORT) || 3016;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/demo-fan-app.js') {
      const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(source.slice(0, source.indexOf('(async function init()')) + header + read('fan-hand-demo.js'));
    }
    if (url.pathname === '/') {
      const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
        .replace('/app.js', '/demo-fan-app.js')
        .replace('</head>', `<style>${read('fan-hand-demo.css')}</style></head>`);
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
}).listen(port, '127.0.0.1', () => console.log('Nháp tay bài quạt: http://localhost:' + port));
