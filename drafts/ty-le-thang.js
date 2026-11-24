'use strict';
// Tỉ lệ thắng 3 phe (Luật pháp / Outlaw / Renegade) bằng hồi quy logistic 3 lớp (softmax).
// Đầu vào là các điểm trong g.timeline (ps[i] = [máu, còn sống, sức mạnh, trang bị]) + g.tlStart.
// Trọng số học từ ván bot: node drafts/ty-le-thang-phan-tich.js → drafts/ty-le-thang-trong-so.json
const FAC = { Sheriff: 'law', Deputy: 'law', Outlaw: 'out', Renegade: 'ren' };
const FS = ['law', 'out', 'ren'];
const FEAT = ['hằng số', 'rL', 'rO', 'rR', 'shHpF', 'shRel', 'lawA', 'outA', 'renA', 'aliveFrac', 'renLate', 'gốc L/O', 'gốc R/O'];

// Ảnh chụp một thời điểm thành các đại lượng dễ hiểu (đều 0..~1)
function snapshot(ps, start, roles, maxHp) {
  const n = roles.length, sh = roles.indexOf('Sheriff'), ren = roles.indexOf('Renegade');
  const st = { law: 0, out: 0, ren: 0 }, s0 = { law: 0, out: 0, ren: 0 }, alive = { law: 0, out: 0, ren: 0 }, cnt = { law: 0, out: 0, ren: 0 };
  ps.forEach((x, i) => { const f = FAC[roles[i]]; st[f] += x[2]; s0[f] += start[i][2]; alive[f] += x[1]; cnt[f]++; });
  return {
    n,
    rL: st.law / (s0.law || 1),            // sức mạnh phe so với đầu ván
    rO: st.out / (s0.out || 1),
    rR: ren >= 0 ? st.ren / (s0.ren || 1) : 0,
    shHpF: ps[sh][0] / maxHp[sh],           // máu Sheriff / máu tối đa
    shRel: ps[sh][2] / (start[sh][2] || 1), // sức mạnh Sheriff so với đầu ván
    lawA: alive.law / cnt.law,              // tỉ lệ còn sống mỗi phe
    outA: cnt.out ? alive.out / cnt.out : 0,
    renA: ren >= 0 ? ps[ren][1] : 0,
    aliveFrac: ps.filter((x) => x[1]).length / n,
  };
}
function features(s, prior) {
  const pr = prior[s.n];
  return [1, s.rL, s.rO, s.rR, s.shHpF, s.shRel, s.lawA, s.outA, s.renA, s.aliveFrac, s.renA * (1 - s.aliveFrac), Math.log(pr.law / pr.out), Math.log(pr.ren / pr.out)];
}
// Phe nào hết người sống thì không thể thắng: loại khỏi softmax (Sheriff chết là hết ván nên Luật pháp luôn còn).
const possible = (s) => ({ law: true, out: s.outA > 0, ren: s.renA > 0 });
function softmax(W, x, ok = { law: true, out: true, ren: true }) {
  const z = FS.map((f) => W[f].reduce((a, w, j) => a + w * x[j], 0));
  const m = Math.max(...z), e = z.map((v, k) => (ok[FS[k]] ? Math.exp(v - m) : 0)), s = e[0] + e[1] + e[2];
  return { law: e[0] / s, out: e[1] / s, ren: e[2] / s };
}
// samples: [[x, phe thắng, possible]]. Gradient descent toàn bộ, có L2 nhỏ.
function train(samples, { epochs = 4000, lr = 0.4, l2 = 1e-4 } = {}) {
  const D = samples[0][0].length;
  const W = { law: new Array(D).fill(0), out: new Array(D).fill(0), ren: new Array(D).fill(0) };
  for (let ep = 0; ep < epochs; ep++) {
    const grad = { law: new Array(D).fill(0), out: new Array(D).fill(0), ren: new Array(D).fill(0) };
    for (const [x, y, ok] of samples) { const q = softmax(W, x, ok); for (const f of FS) { const e = q[f] - (f === y ? 1 : 0); for (let j = 0; j < D; j++) grad[f][j] += e * x[j]; } }
    for (const f of FS) for (let j = 0; j < D; j++) W[f][j] -= lr * (grad[f][j] / samples.length + l2 * W[f][j]);
  }
  return W;
}
// model = nội dung file trọng số {prior, W}
const predict = (model, s) => softmax(model.W, features(s, model.prior), possible(s));

module.exports = { FAC, FS, FEAT, snapshot, features, possible, softmax, train, predict };
