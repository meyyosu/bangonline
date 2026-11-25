'use strict';
// Mô phỏng ván đấu với bot ngẫu nhiên để kiểm tra logic. Chạy: node test/sim.js [sốVán]
const { Game, GameError, CARD_INFO } = require('../game');

function seeded(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

function assertCards(g, seed) {
  const cards = [...g.deck, ...g.discard, ...g.players.flatMap((p) => [...p.hand, ...p.eq]),
    ...(g.pending?.cards || []), ...g.queue.flatMap((q) => q.cards || [])];
  const expected = g.fullDeck.length;
  if (cards.length !== expected || new Set(cards.map((c) => c.id)).size !== expected) {
    throw new Error(`Ván ${seed}: có ${cards.length}/${expected} lá. ${g.log.slice(-6).join(' ')}`);
  }
}

function candidates(g, pi, rng) {
  const p = g.players[pi];
  const others = g.players.filter((q, i) => q.alive && i !== pi).map((q) => q.name);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const out = [];
  if (g.phase === 'character') return g.pending.options.map((character) => ({ type: 'chooseCharacter', character }));
  const pend = g.pending;
  if (pend) {
    if (pend.type === 'draw') for (const from of pend.options) {
      const target = pick(from === 'evelyn' ? others.filter((name) => g.distance(pi, g.idx(name)) <= g.range(p)) : others);
      const eq = pick(g.players[g.idx(target)]?.eq || []);
      out.push({ type: 'drawChoice', from, target, cardId: eq?.id });
    }
    if (pend.type === 'kit') out.push({ type: 'kit', cardIds: pend.cards.slice(0, 2).map((c) => c.id) });
    if (pend.type === 'store') out.push({ type: 'pick', cardId: pick(pend.cards).id });
    if (pend.type === 'check') { out.push({ type: 'checkDraw' }); out.push({ type: 'take' }); }
    if (['bang', 'indians', 'duel'].includes(pend.type)) {
      for (const c of p.hand) out.push({ type: 'respond', cardId: c.id });
      out.push({ type: 'barrel' });
      out.push({ type: 'take' });
    }
    if (pend.canEscape) for (const c of g.escapeCards(p)) out.push({ type: 'escape', cardId: c.id });
    if (pend.type === 'saved') out.push({ type: 'saved', cardId: p.hand.find((c) => c.name === 'Saved!')?.id, from: 'deck' }, { type: 'take' });
    if (pend.type === 'valleyDiscard') out.push({ type: 'valleyDiscard', cardIds: p.hand.slice(0, pend.count).map((c) => c.id) });
    if (pend.type === 'poker') out.push({ type: 'poker', cardIds: pend.ids.slice(0, 2) });
    if (pend.type === 'lemonade') out.push({ type: 'lemonade', cardId: p.hand[0]?.id });
    return out;
  }
  for (const c of [...p.hand, ...p.eq.filter((c) => CARD_INFO[c.name].activate && !p.coolingGreen.has(c.id))]) {
    const revivable = g.players.filter((q) => !q.alive && !q.forfeited).map((q) => q.name);
    const t = pick(c.name === 'Ghost' ? revivable : others);
    const tp = g.players[g.idx(t)];
    const targetCard = (q) => !q?.eq.length || (q.hand.length && rng() < 0.6) ? 'hand' : pick(q.eq).id;
    const cost = pick(p.hand.filter((q) => q !== c));
    const second = tp?.alive ? pick(g.fanningTargets(pi, g.idx(t))) : undefined;
    const bang = p.hand.find((q) => q !== c && (g.bangCard(p, q) || g.hasLeMat(p)));
    const targets = others.map((name) => g.players[g.idx(name)]).filter((q) => q.hand.length || q.eq.length)
      .map((q) => ({ target: q.name, targetCard: targetCard(q) }));
    out.push({ type: p.eq.includes(c) ? 'activate' : 'play', cardId: c.id, target: t,
      targetCard: targetCard(tp), costCardId: cost?.id, bangCardId: bang?.id, secondTarget: g.players[second]?.name, targets });
    if (g.hasLeMat(p) && p.hand.includes(c)) out.push({ type: 'play', cardId: c.id, target: t, asBang: true });
  }
  if (p.hand.length > g.handLimit(p) && !p.ghost) out.push({ type: 'discard', cardIds: [p.hand[0].id] });
  if (g.activeSkill(p)) {
    const skill = g.ability(p);
    const card = p.hand.find((c) => skill === 'Black Flower' ? c.suit === 'C'
      : skill === 'Der Spot-Burst Ringer' ? c.name === 'Bang' : g.isBlue(c));
    out.push({ type: 'skill', target: pick(others),
      cardIds: skill === 'Doc Holyday' ? p.hand.slice(0, 2).map((c) => c.id) : card ? [card.id] : [] });
  }
  if (rng() < 0.3) out.push({ type: 'endTurn' });
  if (p.char === 'Sid Ketchum' && p.hand.length >= 2) out.push({ type: 'sid', cardIds: [p.hand[0].id, p.hand[1].id] });
  return out;
}

const N = Number(process.argv[2] || 100);
let wins = {}, totalActions = 0;
const checks = {}; // số lần phải chờ rút kiểm tra theo loại
const variants = {};
for (let s = 1; s <= N; s++) {
  const rng = seeded(s);
  const names = Array.from({ length: 4 + (s % 4) }, (_, i) => `P${i + 1}`);
  const mode = ((s - 1) + Math.floor((s - 1) / 4)) % 4;
  const dodgeCity = Boolean(mode & 1), valleyOfShadow = Boolean(mode & 2);
  const variant = ['Gốc', 'Dodge City', 'Valley of Shadow', 'Cả hai'][mode];
  variants[variant] = (variants[variant] || 0) + 1;
  const g = new Game(names, { rng, characterChoices: 1 + (s % 4), dodgeCity, valleyOfShadow });
  let steps = 0;
  while (!g.winner) {
    if (++steps > 20000) throw new Error(`Ván ${s}: kẹt vòng lặp`);
    if (g.pending?.type === 'check') checks[g.pending.kind] = (checks[g.pending.kind] || 0) + 1;
    const pi = g.pending ? g.pending.player : g.turn;
    const cands = candidates(g, pi, rng);
    // ưu tiên hành động "có ích" bằng cách thử ngẫu nhiên tới khi hợp lệ
    let done = false;
    for (let k = 0; k < 40 && !done && cands.length; k++) {
      const a = cands[Math.floor(rng() * cands.length)];
      try { g.act(g.players[pi].name, a); done = true; totalActions++; } catch (e) { if (!(e instanceof GameError)) { console.error('Seed', s, a, e); process.exit(1); } }
    }
    if (!done) { g.timeout(); totalActions++; }
    assertCards(g, s);
    for (const nm of names) g.viewFor(nm);
  }
  wins[g.winner] = (wins[g.winner] || 0) + 1;
}
console.log(`OK: ${N} ván, ${totalActions} hành động. Phiên bản:`, variants, 'Kết quả:', wins, 'Rút kiểm tra:', checks);
