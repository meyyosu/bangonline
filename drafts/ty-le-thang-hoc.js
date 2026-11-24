'use strict';
// Học trọng số hồi quy logistic 3 phe từ ván bot, ghi drafts/ty-le-thang-trong-so.json.
// Chạy: node drafts/ty-le-thang-hoc.js [sốVán=4000]   (phân tích độ chuẩn: drafts/ty-le-thang-phan-tich.js)
const path = require('path');
const fs = require('fs');
const { play } = require('./bot-ngau-nhien');
const TL = require('./ty-le-thang');

const N = Number(process.argv[2] || 4000);
const PER_GAME = 20; // số điểm lấy mỗi ván (ván dài không lấn át)
const t0 = Date.now();
const games = [];
for (let s = 1; s <= N; s++) {
  const n = 4 + (s % 4);
  const g = play(500000 + s, n);
  if (!g.winner) continue;
  const roles = g.players.map((p) => p.role), maxHp = g.players.map((p) => p.maxHp);
  const T = g.timeline.slice(0, -1); // bỏ điểm cuối (đã biết kết quả)
  const step = Math.max(1, Math.floor(T.length / PER_GAME));
  const snaps = [];
  for (let k = 0; k < T.length; k += step) snaps.push(TL.snapshot(T[k].ps, g.tlStart, roles, maxHp));
  games.push({ n, winner: TL.FAC[g.winner], snaps });
}
const prior = {};
for (const n of [4, 5, 6, 7]) {
  const gs = games.filter((g) => g.n === n), w = { law: 0, out: 0, ren: 0 };
  gs.forEach((g) => w[g.winner]++);
  prior[n] = { law: w.law / gs.length, out: w.out / gs.length, ren: Math.max(0.005, w.ren / gs.length) };
}
const samples = [];
games.forEach((g) => g.snaps.forEach((s) => samples.push([TL.features(s, prior), g.winner, TL.possible(s)])));
console.log(`${games.length} ván, ${samples.length} mẫu (${((Date.now() - t0) / 1000).toFixed(0)} giây). Đang học…`);
const W = TL.train(samples);
const round = (v) => Math.round(v * 10000) / 10000;
const OUT = path.join(__dirname, 'ty-le-thang-trong-so.json');
fs.writeFileSync(OUT, JSON.stringify({
  note: `Học từ ${games.length} ván bot ngẫu nhiên — node drafts/ty-le-thang-hoc.js ${N}`, feat: TL.FEAT,
  prior: Object.fromEntries(Object.entries(prior).map(([n, p]) => [n, { law: round(p.law), out: round(p.out), ren: round(p.ren) }])),
  W: Object.fromEntries(TL.FS.map((f) => [f, W[f].map(round)])),
}, null, 1) + '\n');
console.log(`Đã ghi ${OUT} sau ${((Date.now() - t0) / 1000).toFixed(0)} giây.`);
