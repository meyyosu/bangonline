'use strict';
// Sức mạnh từng người & cán cân Luật pháp ↔ Outlaw (dùng cho tab Diễn biến / Đóng góp ở màn kết thúc).
// Chỉ đọc trạng thái Game theo vai trò thật, không sửa gì. CARD_INFO do game.js truyền vào (tránh require vòng).
//
// Sức mạnh = Máu (không tuyến tính, theo vai trò) + Trang bị trước mặt (theo tác dụng thật)
//          + K × Giá trị bài (đơn vị "lá": Bang!/Missed! = 1), gồm bài trên tay và lá xanh Dodge City trước mặt.
let CARD_INFO = {};

const W = {
  // máu
  hpFirst: 1.5, hpSecond: 1.2, hpRest: 1.0, // máu cuối quý nhất
  sheriff: 1.5,                            // máu Sheriff nặng ký hơn
  deputyNextToSheriff: 1.15,               // Deputy ngồi sát Sheriff (kể cả khi người giữa đã chết)
  // trang bị xanh dương trước mặt (đơn vị: máu)
  barrel: 0.6, volcanic: 0.6,
  reach: 0.8,                              // súng + Scope: × mức tăng "độ phủ" (tỉ lệ kẻ địch với tới được)
  mustang: 0.3,                            // Mustang: × số kẻ địch bị chặn không với tới mình nữa
  jailInFront: -0.5, dynamiteInFront: -0.4,
  equipOnHand: 0.7,                        // trang bị xanh dương còn trên tay: 70% giá trị khi đã lắp
  // bài (đơn vị: lá; Bang!/Missed! = 1) → nhân K để ra máu
  K: 0.4,
  greenReady: 1.0, greenCooling: 0.7, greenOnHand: 0.6, // lá xanh: sẵn sàng / vừa đặt / còn trên tay
  norm: true,                              // so mỗi phe với chính nó lúc đầu ván
};

// Giá trị lá bài (đơn vị lá). Bang!/Missed! có dãy giảm dần cho lá trùng.
const CARD = {
  bangSeq: [1, 0.4], bangNoTarget: 0.3,        // lá Bang! thứ 2 trở đi chỉ còn để đỡ Indians!/Duel
  missedSeq: [1, 0.6, 0.3], missedMinThreat: 0.3, // × mức bị đe doạ (Gatling/Howitzer không cần tầm nên không về 0)
  beer: 1, beerLastHp: 1.5,
  saloon: 0.5, saloonPerHurt: 0.3,
  drawCard: 0.6,                               // một lá rút thêm ~ 0,6 lá → Stagecoach 1,2 · Wells Fargo 1,8
  generalStore: 0.5,
  panic: 1.2, panicNoTarget: 0.4, catBalou: 0.8, duel: 0.8,
  gatlingPerNet: 0.6, indiansPerNet: 0.5,      // × (số địch − số đồng đội) còn sống, tối thiểu 0
  jail: 0.8,
};

// Kỹ năng nhân vật tương đương một trang bị luôn có sẵn
const INNATE = { Jourdonnais: 'Barrel', 'Paul Regret': 'Mustang', 'Rose Doolan': 'Scope', 'Willy the Kid': 'Volcanic' };

const FACTION = { Sheriff: 'law', Deputy: 'law', Outlaw: 'out', Renegade: 'ren' };
const isEnemy = (a, b) => (a.role === 'Renegade' || b.role === 'Renegade' ? a !== b : FACTION[a.role] !== FACTION[b.role]);
const hpValue = (h) => { let v = 0; for (let k = 1; k <= h; k++) v += k === 1 ? W.hpFirst : k === 2 ? W.hpSecond : W.hpRest; return v; };

function strength(g, i, cardInfo = CARD_INFO) {
  CARD_INFO = cardInfo;
  const P = g.players, p = P[i];
  if (!p.alive) return 0;
  const alive = g.alive();
  const seat = (a, b) => g.seatDistance(a, b);
  const ab = (q) => g.ability(q);
  const has = (q, name) => q.eq.some((c) => c.name === name);
  const gunRange = (q) => { const gun = q.eq.find((c) => CARD_INFO[c.name].type === 'gun'); return gun ? CARD_INFO[gun.name].range : 1; };
  // khoảng cách a→b, cho phép giả định có/không Scope của a, Mustang của b (kỹ năng nhân vật luôn tính)
  const dist = (a, b, { scopeA = has(P[a], 'Scope'), mustangB = has(P[b], 'Mustang') } = {}) => {
    let d = seat(a, b);
    if (mustangB) d++;
    if (ab(P[b]) === 'Paul Regret') d++;
    if (scopeA) d--;
    if (ab(P[a]) === 'Rose Doolan') d--;
    return Math.max(1, d);
  };
  const enemies = alive.filter((j) => j !== i && isEnemy(p, P[j]));
  const allies = alive.filter((j) => j !== i && !isEnemy(p, P[j]));
  const inRange = (range, scope) => enemies.filter((j) => dist(i, j, { scopeA: scope }) <= range);
  const coverage = (range, scope) => (enemies.length ? inRange(range, scope).length / enemies.length : 0);
  const blockedByMustang = () => enemies.filter((j) => { const r = gunRange(P[j]); return dist(j, i, { mustangB: false }) <= r && dist(j, i, { mustangB: true }) > r; }).length;

  // ---------- 1. Máu ----------
  let mult = 1;
  if (p.role === 'Sheriff') mult = W.sheriff;
  if (p.role === 'Deputy') { const sh = P.findIndex((q) => q.role === 'Sheriff'); if (P[sh].alive && seat(i, sh) === 1) mult = W.deputyNextToSheriff; }
  let s = hpValue(Math.max(0, p.hp)) * mult;

  // ---------- 2. Trang bị xanh dương trước mặt ----------
  const covNow = coverage(gunRange(p), has(p, 'Scope'));
  s += W.reach * (covNow - coverage(1, false));                 // chỉ phần tầm thật sự cần (Rose Doolan đã nằm trong dist)
  if (has(p, 'Barrel')) s += W.barrel;
  if (INNATE[ab(p)] === 'Barrel') s += W.barrel;                // Jourdonnais: luôn có thêm 1 Barrel
  const unlimited = (gunRange(p) === 1 && has(p, 'Volcanic')) || INNATE[ab(p)] === 'Volcanic';
  if (unlimited) s += W.volcanic;
  if (has(p, 'Mustang')) s += W.mustang * blockedByMustang();
  if (has(p, 'Jail')) s += W.jailInFront;                       // âm cho tới khi rút kiểm tra tù
  if (has(p, 'Dynamite')) s += W.dynamiteInFront;

  // ---------- 3. Giá trị bài (đơn vị lá) ----------
  const threat = enemies.length ? enemies.filter((j) => dist(j, i) <= gunRange(P[j])).length / enemies.length : 0;
  const living = (j) => !P[j].ghost;
  const net = Math.max(0, enemies.filter(living).length - allies.filter(living).length); // Gatling/Indians/Howitzer trúng cả đồng đội
  const hurt = (list) => list.filter((j) => g.canHeal(P[j])).length;
  const jailable = enemies.some((j) => P[j].role !== 'Sheriff' && !has(P[j], 'Jail'));
  const reachNow = inRange(gunRange(p), has(p, 'Scope')).length > 0;
  const atOne = inRange(1, has(p, 'Scope')).length > 0;
  let bangs = 0, misses = 0;
  const bang = (needsRange = 'weapon', limited = true) => {
    const ok = needsRange === 'any' || (needsRange === 1 ? atOne : reachNow);
    if (!ok) return CARD.bangNoTarget;
    if (!limited) return CARD.bangSeq[0];                       // lá xanh tấn công không tính vào giới hạn 1 Bang!/lượt
    const v = unlimited ? CARD.bangSeq[0] : CARD.bangSeq[Math.min(bangs, CARD.bangSeq.length - 1)];
    bangs++;
    return v;
  };
  const missed = () => CARD.missedSeq[Math.min(misses++, CARD.missedSeq.length - 1)] * Math.max(CARD.missedMinThreat, threat);
  const heal = (beer) => (p.hp >= p.maxHp || (beer && alive.length <= 2) ? 0 : p.hp === 1 ? CARD.beerLastHp : CARD.beer);
  const draw = (n) => n * CARD.drawCard;

  const units = (c) => {
    const info = CARD_INFO[c.name] || {};
    if (info.type === 'green') {
      const extra = info.draw ? draw(info.draw) : 0;
      switch (info.effect) {
        case 'dodge': return missed() + extra;
        case 'attack': return bang(info.maxDistance === 1 ? 1 : info.maxDistance === 'weapon' ? 'weapon' : 'any', false) + extra;
        case 'heal': return heal(false);
        case 'take': return CARD.panic;
        case 'discard': return CARD.catBalou;
        case 'attackAll': return CARD.gatlingPerNet * net;
        case 'draw': return draw(info.draw || 0);
        default: return 0.6;
      }
    }
    switch (c.name) {
      case 'Bang': return bang();
      case 'Missed': return missed();
      case 'Beer': return heal(true);
      case 'Saloon': return Math.max(0, CARD.saloon + CARD.saloonPerHurt * (hurt([i, ...allies]) - hurt(enemies)));
      case 'Stagecoach': return draw(2);
      case 'Wells Fargo': return draw(3);
      case 'General Store': return CARD.generalStore;
      case 'Panic': return atOne ? CARD.panic : CARD.panicNoTarget;
      case 'Cat Balou': return CARD.catBalou;
      case 'Duel': return CARD.duel;
      case 'Gatling': return CARD.gatlingPerNet * net;
      case 'Indians': return CARD.indiansPerNet * net;
      case 'Jail': return jailable ? CARD.jail : 0;             // 1v1 với Sheriff (không ai bỏ tù được) = 0
      case 'Dynamite': return 0;                                 // trên tay: trung tính
      default: return 0.6;
    }
  };

  let cardUnits = 0;
  // lá xanh trước mặt: sẵn sàng hay đang chờ đủ một lượt
  for (const c of p.eq) if ((CARD_INFO[c.name] || {}).type === 'green') cardUnits += units(c) * (p.coolingGreen?.has(c.id) ? W.greenCooling : W.greenReady);
  // bài trên tay: Bang!/Missed! xếp trước để lá đầu tiên nhận giá trị đầy đủ
  const order = { Bang: 0, Missed: 1 };
  const hand = [...p.hand].sort((a, b) => (order[a.name] ?? 2) - (order[b.name] ?? 2));
  let bestHandCov = covNow;
  for (const c of hand) {
    const info = CARD_INFO[c.name] || {};
    if (info.type === 'green') { cardUnits += units(c) * W.greenOnHand; continue; }
    // trang bị xanh dương trên tay: tính theo tác dụng (đơn vị máu) × 70%
    if (info.type === 'gun') {
      bestHandCov = Math.max(bestHandCov, coverage(info.range, has(p, 'Scope')));
      if (c.name === 'Volcanic' && !unlimited) s += W.volcanic * W.equipOnHand;
      continue;
    }
    if (c.name === 'Scope') { if (!has(p, 'Scope')) bestHandCov = Math.max(bestHandCov, coverage(gunRange(p), true)); continue; }
    if (c.name === 'Barrel') { if (!has(p, 'Barrel')) s += W.barrel * W.equipOnHand; continue; }
    if (c.name === 'Mustang') { if (!has(p, 'Mustang')) s += W.mustang * blockedByMustang() * W.equipOnHand; continue; }
    cardUnits += units(c);
  }
  s += W.reach * W.equipOnHand * (bestHandCov - covNow);
  s += W.K * cardUnits;
  return s;
}

// Cán cân −1..1: > 0 phe Luật pháp lợi, < 0 Outlaw lợi
function balance(g, cardInfo = CARD_INFO) {
  CARD_INFO = cardInfo;
  let law = 0, out = 0;
  g.players.forEach((p, i) => { const v = strength(g, i, cardInfo); if (FACTION[p.role] === 'law') law += v; else if (p.role === 'Outlaw') out += v; });
  if (W.norm) {
    // so mỗi phe với sức mạnh lúc đầu ván của chính phe đó (phe đông người không tự nhiên "lợi" hơn)
    if (!g._cc0) g._cc0 = { law: law || 1, out: out || 1 };
    law /= g._cc0.law; out /= g._cc0.out;
  }
  return law + out ? (law - out) / (law + out) : 0;
}

// ---------- Tỉ lệ thắng 3 phe (Luật pháp / Outlaw / Renegade) ----------
// Hồi quy logistic 3 lớp trên trạng thái bàn (ps[i] = [máu, còn sống, sức mạnh, trang bị] như game.powerState).
// Trọng số học từ 4000 ván bot ngẫu nhiên: node drafts/ty-le-thang-hoc.js → drafts/ty-le-thang-trong-so.json (chép vào đây).
// Phân tích độ chuẩn: node drafts/ty-le-thang-phan-tich.js
const WIN_MODEL = {
  prior: { // tỉ lệ thắng gốc theo số người
    4: { law: 0.533, out: 0.384, ren: 0.083 }, 5: { law: 0.441, out: 0.488, ren: 0.071 },
    6: { law: 0.414, out: 0.537, ren: 0.049 }, 7: { law: 0.384, out: 0.573, ren: 0.043 },
  },
  // đặc trưng: hằng số, rL, rO, rR, shHpF, shRel, lawA, outA, renA, aliveFrac, renLate, ln(gốc L/O), ln(gốc R/O)
  W: {
    law: [-0.2894, 0.799, -1.2863, -1.2771, 0.5998, 1.6166, -0.5207, 0.5591, 0.2629, -0.2015, -0.7085, 0.4074, -0.1606],
    out: [0.4512, -0.1028, 2.7049, -0.6557, -0.7392, -1.8922, 0.7771, -0.7026, -0.1011, 0.3953, 0.6765, -0.4404, -0.3684],
    ren: [-0.1618, -0.6962, -1.4187, 1.9328, 0.1394, 0.2757, -0.2564, 0.1436, -0.1618, -0.1938, 0.032, 0.0329, 0.5289],
  },
};
const WIN_FACS = ['law', 'out', 'ren'];

// Ván đã ngã ngũ theo luật Bang! chưa (theo danh sách còn sống)? → 'law' | 'out' | 'ren' | null
function decidedWinner(alive, roles) {
  const has = (f) => alive.some((a, i) => a && FACTION[roles[i]] === f);
  if (!alive[roles.indexOf('Sheriff')]) return alive.filter(Boolean).length === 1 && has('ren') ? 'ren' : 'out';
  return !has('out') && !has('ren') ? 'law' : null;
}

// Xác suất thắng của 3 phe ở trạng thái ps (start = ps đầu ván, maxHp theo người)
function winProb(ps, start, roles, maxHp) {
  const done = decidedWinner(ps.map((x) => x[1]), roles);
  if (done) return { law: +(done === 'law'), out: +(done === 'out'), ren: +(done === 'ren') };
  const n = roles.length, sh = roles.indexOf('Sheriff');
  const st = { law: 0, out: 0, ren: 0 }, s0 = { law: 0, out: 0, ren: 0 }, alive = { law: 0, out: 0, ren: 0 }, cnt = { law: 0, out: 0, ren: 0 };
  ps.forEach((x, i) => { const f = FACTION[roles[i]]; st[f] += x[2]; s0[f] += start[i][2]; alive[f] += x[1]; cnt[f]++; });
  const aliveFrac = ps.filter((x) => x[1]).length / n, renA = alive.ren > 0 ? 1 : 0;
  const pr = WIN_MODEL.prior[Math.min(7, Math.max(4, n))];
  const x = [1, st.law / (s0.law || 1), st.out / (s0.out || 1), cnt.ren ? st.ren / (s0.ren || 1) : 0,
    ps[sh][0] / (maxHp[sh] || 1), ps[sh][2] / (start[sh][2] || 1), alive.law / cnt.law, cnt.out ? alive.out / cnt.out : 0,
    renA, aliveFrac, renA * (1 - aliveFrac), Math.log(pr.law / pr.out), Math.log(pr.ren / pr.out)];
  // phe hết người thì không thể thắng: loại khỏi softmax
  const ok = { law: true, out: alive.out > 0, ren: renA > 0 };
  const z = WIN_FACS.map((f) => WIN_MODEL.W[f].reduce((a, w, j) => a + w * x[j], 0));
  const m = Math.max(...z), e = z.map((v, k) => (ok[WIN_FACS[k]] ? Math.exp(v - m) : 0)), s = e[0] + e[1] + e[2];
  return { law: e[0] / s, out: e[1] / s, ren: e[2] / s };
}

// Trạng thái giả định "người i mất 1 máu" (dùng cho kịch bản Barrel ngược lại): sức mạnh trừ đúng giá trị
// giọt máu đó (máu thứ 2: 1,2 · còn lại 1; Sheriff ×1,5); còn 1 máu thì gục.
function hurtState(ps, i, roles) {
  const q = ps.map((x) => [...x]), hp = q[i][0];
  if (hp <= 1) { q[i] = [0, 0, 0, q[i][3]]; return q; }
  q[i][0] = hp - 1;
  q[i][2] = Math.max(0, q[i][2] - (hp === 2 ? W.hpSecond : W.hpRest) * (roles[i] === 'Sheriff' ? W.sheriff : 1));
  return q;
}

module.exports = { W, CARD, strength, balance, WIN_MODEL, winProb, hurtState, decidedWinner };
