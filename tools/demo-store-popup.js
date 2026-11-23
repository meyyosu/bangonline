'use strict';
// Xem thử pop-up General Store trên bàn chơi thật, chạy bằng luật thật.
// Server giữ một ván thật; bot tự chọn lá, tới lượt bạn thì bạn bấm chọn.
// Chạy: node tools/demo-store-popup.js rồi mở http://localhost:3011
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Game, CARD_INFO, CHAR_INFO, ROLE_INFO } = require('../game');
const publicDir = path.resolve(__dirname, '../public');
const names = ['CaoBoiMienTay', 'ThanhXaThu99', 'HoangHonDo', 'TuongCuopSaMac', 'BongMaThungLung', 'SieuDaoChich', 'KeHaiMat_VN'];

let game, me, round = 0;
function reset() {
  round++;
  let seed = 7 + round;
  const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  game = new Game(names, { rng });
  game.pending = null; game.queue = []; game.phase = 'play';
  const P = game.players, pi = game.turn;
  const i = game.deck.findIndex((c) => c.name === 'General Store');
  const card = i >= 0 ? game.deck.splice(i, 1)[0] : game.discard.splice(game.discard.findIndex((c) => c.name === 'General Store'), 1)[0];
  P[pi].hand.push(card);
  game.act(P[pi].name, { type: 'play', cardId: card.id });
  me = game.pending.order[2]; // bạn chọn thứ 3
}
function act(name, a) { if (game.pending?.type === 'store') game.act(name, a); }
function state() { return { view: game.viewFor(game.players[me].name) }; }
reset();

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8'); // đọc lại mỗi lần tải trang
const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const port = Number(process.env.DEMO_PORT) || 3011;
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/demo/state') return json(res, state());
  if (url.pathname === '/demo/reset') { reset(); return json(res, state()); }
  if (url.pathname === '/demo/bot') { // người kế tiếp (không phải bạn) chọn ngẫu nhiên
    const pend = game.pending;
    if (pend?.type === 'store' && pend.player !== me) {
      act(game.players[pend.player].name, { type: 'pick', cardId: pend.cards[Math.floor(Math.random() * pend.cards.length)].id });
    }
    return json(res, state());
  }
  if (url.pathname === '/demo/pick') {
    try { act(game.players[me].name, { type: 'pick', cardId: Number(url.searchParams.get('id')) }); }
    catch (e) { return json(res, { error: e.message, ...state() }); }
    return json(res, state());
  }
  if (url.pathname === '/demo-store-app.js') {
    const source = fs.readFileSync(path.join(publicDir, 'app.js'), 'utf8');
    const header = `META = ${JSON.stringify({ cards: CARD_INFO, chars: CHAR_INFO, roles: ROLE_INFO })};\n`;
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(source.slice(0, source.indexOf('(async function init()')) + header + read('store-popup-demo.js'));
  }
  if (url.pathname === '/') {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8')
      .replace('/app.js', '/demo-store-app.js')
      .replace('</head>', `<style>${read('store-popup-demo.css')}</style></head>`);
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
}).listen(port, '127.0.0.1', () => console.log('Demo pop-up General Store: http://localhost:' + port));
