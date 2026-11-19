'use strict';
// Logic luật chơi Bang! (bản gốc): 80 lá bài, 16 nhân vật, 4 vai trò.

const RANKS = { J: 11, Q: 12, K: 13, A: 14 };
const rankVal = (r) => RANKS[r] || Number(r);
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };

const CARD_INFO = {
  'Bang': { type: 'brown', icon: '💥', desc: 'Bắn một người trong tầm súng. Mỗi lượt chỉ được dùng 1 lần.' },
  'Missed': { type: 'brown', icon: '🙅', desc: 'Né một phát Bang! (chỉ dùng khi bị bắn).' },
  'Beer': { type: 'brown', icon: '🍺', desc: 'Hồi 1 máu. Vô dụng khi chỉ còn 2 người. Tự động dùng khi sắp chết.' },
  'Saloon': { type: 'brown', icon: '🥃', desc: 'Mọi người còn sống hồi 1 máu.' },
  'Stagecoach': { type: 'brown', icon: '🐎', desc: 'Rút 2 lá.' },
  'Wells Fargo': { type: 'brown', icon: '💰', desc: 'Rút 3 lá.' },
  'General Store': { type: 'brown', icon: '🏪', desc: 'Lật số lá bằng số người sống, lần lượt mỗi người chọn 1 lá.' },
  'Panic': { type: 'brown', icon: '😱', desc: 'Lấy 1 lá của người ở khoảng cách 1.' },
  'Cat Balou': { type: 'brown', icon: '💃', desc: 'Buộc một người bỏ 1 lá bài.' },
  'Duel': { type: 'brown', icon: '🤠', desc: 'Đấu súng: lần lượt bỏ Bang!, ai không bỏ được thì mất 1 máu.' },
  'Indians': { type: 'brown', icon: '🪶', desc: 'Mọi người khác phải bỏ 1 Bang! hoặc mất 1 máu.' },
  'Gatling': { type: 'brown', icon: '🔫', desc: 'Bắn tất cả người khác (né bằng Missed!).' },
  'Barrel': { type: 'blue', icon: '🛢️', desc: 'Khi bị bắn, rút kiểm tra: ra ♥ thì coi như né.' },
  'Mustang': { type: 'blue', icon: '🐴', desc: 'Người khác nhìn bạn xa thêm 1.' },
  'Scope': { type: 'blue', icon: '🔭', desc: 'Bạn nhìn người khác gần hơn 1.' },
  'Jail': { type: 'blue', icon: '⛓️', desc: 'Đặt lên người khác (trừ Sheriff). Đầu lượt rút kiểm tra: ♥ thì thoát, không thì mất lượt.' },
  'Dynamite': { type: 'blue', icon: '🧨', desc: 'Đầu lượt rút kiểm tra: ♠2–9 thì nổ mất 3 máu, không thì chuyền sang người kế.' },
  'Volcanic': { type: 'gun', range: 1, icon: '🔫', desc: 'Súng tầm 1. Bắn Bang! không giới hạn.' },
  'Schofield': { type: 'gun', range: 2, icon: '🔫', desc: 'Súng tầm 2.' },
  'Remington': { type: 'gun', range: 3, icon: '🔫', desc: 'Súng tầm 3.' },
  'Rev. Carabine': { type: 'gun', range: 4, icon: '🔫', desc: 'Súng tầm 4.' },
  'Winchester': { type: 'gun', range: 5, icon: '🔫', desc: 'Súng tầm 5.' },
};

const CHAR_INFO = {
  'Bart Cassidy': { hp: 4, desc: 'Mỗi khi mất 1 máu, rút 1 lá.' },
  'Black Jack': { hp: 4, desc: 'Khi rút bài đầu lượt, nếu lá thứ 2 là ♥/♦ thì rút thêm 1 lá.' },
  'Calamity Janet': { hp: 4, desc: 'Dùng Bang! như Missed! và ngược lại.' },
  'El Gringo': { hp: 3, desc: 'Mỗi khi bị người khác làm mất 1 máu, lấy ngẫu nhiên 1 lá trên tay người đó.' },
  'Jesse Jones': { hp: 4, desc: 'Lá đầu tiên khi rút bài có thể lấy ngẫu nhiên từ tay một người.' },
  'Jourdonnais': { hp: 4, desc: 'Luôn có sẵn một Barrel.' },
  'Kit Carlson': { hp: 4, desc: 'Khi rút bài: xem 3 lá trên cùng, giữ 2, trả lại 1.' },
  'Lucky Duke': { hp: 4, desc: 'Khi rút kiểm tra, lật 2 lá và lấy lá có lợi.' },
  'Paul Regret': { hp: 3, desc: 'Luôn có Mustang: người khác nhìn bạn xa thêm 1.' },
  'Pedro Ramirez': { hp: 4, desc: 'Lá đầu tiên khi rút bài có thể lấy từ đỉnh chồng bài bỏ.' },
  'Rose Doolan': { hp: 4, desc: 'Luôn có Scope: bạn nhìn người khác gần hơn 1.' },
  'Sid Ketchum': { hp: 4, desc: 'Bỏ 2 lá bất kỳ để hồi 1 máu (bất cứ lúc nào).' },
  'Slab the Killer': { hp: 4, desc: 'Người bị bạn Bang! cần 2 Missed! để né.' },
  'Suzy Lafayette': { hp: 4, desc: 'Khi hết bài trên tay, rút ngay 1 lá.' },
  'Vulture Sam': { hp: 4, desc: 'Khi có người chết, lấy toàn bộ bài của họ.' },
  'Willy the Kid': { hp: 4, desc: 'Được dùng Bang! không giới hạn.' },
};

const ROLE_INFO = {
  Sheriff: { vi: 'Cảnh sát trưởng', goal: 'Tiêu diệt tất cả Outlaw và Renegade.' },
  Deputy: { vi: 'Phó cảnh sát', goal: 'Bảo vệ Sheriff, tiêu diệt Outlaw và Renegade.' },
  Outlaw: { vi: 'Kẻ ngoài vòng pháp luật', goal: 'Hạ gục Sheriff.' },
  Renegade: { vi: 'Kẻ phản bội', goal: 'Là người cuối cùng sống sót.' },
};

const ROLE_SETS = {
  4: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw'],
  5: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw', 'Deputy'],
  6: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw', 'Outlaw', 'Deputy'],
  7: ['Sheriff', 'Renegade', 'Outlaw', 'Outlaw', 'Outlaw', 'Deputy', 'Deputy'],
};

const DECK_SPEC = [
  ['Bang', 'S', 'A'], ['Bang', 'D', '2 3 4 5 6 7 8 9 10 J Q K A'], ['Bang', 'C', '2 3 4 5 6 7 8 9'], ['Bang', 'H', 'Q K A'],
  ['Missed', 'C', '10 J Q K A'], ['Missed', 'S', '2 3 4 5 6 7 8'],
  ['Beer', 'H', '6 7 8 9 10 J'], ['Saloon', 'H', '5'], ['Wells Fargo', 'H', '3'], ['Stagecoach', 'S', '9 9'],
  ['General Store', 'C', '9'], ['General Store', 'S', 'Q'],
  ['Panic', 'H', 'J Q A'], ['Panic', 'D', '8'], ['Cat Balou', 'H', 'K'], ['Cat Balou', 'D', '9 10 J'],
  ['Duel', 'D', 'Q'], ['Duel', 'S', 'J'], ['Duel', 'C', '8'], ['Indians', 'D', 'K A'], ['Gatling', 'H', '10'],
  ['Barrel', 'S', 'Q K'], ['Mustang', 'H', '8 9'], ['Scope', 'S', 'A'], ['Jail', 'S', 'J 10'], ['Jail', 'H', '4'],
  ['Dynamite', 'H', '2'], ['Volcanic', 'S', '10'], ['Volcanic', 'C', '10'], ['Schofield', 'C', 'J Q'],
  ['Schofield', 'S', 'K'], ['Remington', 'C', 'K'], ['Rev. Carabine', 'C', 'A'], ['Winchester', 'S', '8'],
];

function buildDeck() {
  const deck = [];
  let id = 1;
  for (const [name, suit, ranks] of DECK_SPEC) {
    for (const rank of ranks.split(' ')) deck.push({ id: id++, name, suit, rank });
  }
  return deck;
}

class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const cardStr = (c) => `${c.name} ${c.rank}${SUIT_SYMBOL[c.suit]}`;

class Game {
  constructor(names, opts = {}) {
    if (names.length < 4 || names.length > 7) fail('Cần 4–7 người chơi.');
    this.rng = opts.rng || Math.random;
    const roles = shuffle([...ROLE_SETS[names.length]], this.rng);
    const chars = shuffle(Object.keys(CHAR_INFO), this.rng);
    const order = shuffle([...names], this.rng);
    this.players = order.map((name, i) => {
      const role = roles[i];
      const char = opts.chars?.[name] || chars[i];
      const maxHp = CHAR_INFO[char].hp + (role === 'Sheriff' ? 1 : 0);
      return { name, role, char, maxHp, hp: maxHp, hand: [], eq: [], alive: true, jailed: 0 };
    });
    this.deck = shuffle(buildDeck(), this.rng);
    this.discard = [];
    this.log = [];
    this.queue = [];
    this.pending = null;
    this.winner = null;
    this.bangsPlayed = 0;
    this.phase = 'start';
    for (const p of this.players) p.hand.push(...this.draw(p.hp));
    this.turn = this.players.findIndex((p) => p.role === 'Sheriff');
    this.addLog(`Ván đấu bắt đầu! Sheriff là ${this.players[this.turn].name}.`);
    this.startTurn();
  }

  // ---------- tiện ích ----------
  addLog(msg) { this.log.push(msg); if (this.log.length > 150) this.log.shift(); }
  idx(name) { return this.players.findIndex((p) => p.name === name); }
  alive() { return this.players.map((p, i) => i).filter((i) => this.players[i].alive); }
  nextAlive(i) {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (this.players[j].alive) return j; }
    return i;
  }
  draw(n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      if (!this.deck.length) {
        if (this.discard.length <= 1) break;
        const top = this.discard.pop();
        this.deck = shuffle(this.discard, this.rng);
        this.discard = [top];
        this.addLog('Chồng bài đã được xáo lại.');
      }
      out.push(this.deck.pop());
    }
    return out;
  }
  give(p, n) { p.hand.push(...this.draw(n)); }
  toDiscard(...cards) { this.discard.push(...cards); }
  hasEq(p, name) { return p.eq.some((c) => c.name === name); }
  gun(p) { return p.eq.find((c) => CARD_INFO[c.name].type === 'gun'); }
  range(p) { const g = this.gun(p); return g ? CARD_INFO[g.name].range : 1; }
  unlimitedBang(p) { return p.char === 'Willy the Kid' || this.gun(p)?.name === 'Volcanic'; }
  barrelCount(p) { return (this.hasEq(p, 'Barrel') ? 1 : 0) + (p.char === 'Jourdonnais' ? 1 : 0); }
  distance(a, b) {
    if (a === b) return 0;
    const al = this.alive();
    const ia = al.indexOf(a), ib = al.indexOf(b);
    if (ia < 0 || ib < 0) return null;
    const d = Math.abs(ia - ib);
    let dist = Math.min(d, al.length - d);
    const pa = this.players[a], pb = this.players[b];
    if (this.hasEq(pb, 'Mustang')) dist++;
    if (pb.char === 'Paul Regret') dist++;
    if (this.hasEq(pa, 'Scope')) dist--;
    if (pa.char === 'Rose Doolan') dist--;
    return Math.max(1, dist);
  }
  takeFromHand(p, cardId) {
    const i = p.hand.findIndex((c) => c.id === cardId);
    if (i < 0) fail('Bạn không có lá bài này.');
    return p.hand.splice(i, 1)[0];
  }
  stealRandom(from, to) {
    if (!from.hand.length) return null;
    const c = from.hand.splice(Math.floor(this.rng() * from.hand.length), 1)[0];
    to.hand.push(c);
    return c;
  }
  // "Rút kiểm tra" (Draw!)
  check(p, success, label) {
    const cards = this.draw(p.char === 'Lucky Duke' ? 2 : 1);
    const chosen = cards.find(success) || cards[0];
    this.toDiscard(...cards);
    const ok = !!chosen && success(chosen);
    this.addLog(`${p.name} rút kiểm tra (${label}): ${cards.map(cardStr).join(', ')} → ${ok ? 'thành công' : 'thất bại'}.`);
    return ok;
  }

  // ---------- lượt chơi ----------
  startTurn() {
    if (this.winner) return;
    this.turnNumber = (this.turnNumber || 0) + 1;
    const pi = this.turn, p = this.players[pi];
    this.bangsPlayed = 0;
    this.phase = 'start';
    p.jailed = 0; // hết vòng bị giam (nếu có)
    this.addLog(`— Lượt của ${p.name} —`);

    const dyn = p.eq.find((c) => c.name === 'Dynamite');
    if (dyn) {
      const safe = this.check(p, (c) => !(c.suit === 'S' && rankVal(c.rank) >= 2 && rankVal(c.rank) <= 9), 'Dynamite');
      p.eq.splice(p.eq.indexOf(dyn), 1);
      if (!safe) {
        this.addLog(`💥 Dynamite nổ! ${p.name} mất 3 máu.`);
        this.toDiscard(dyn);
        this.damage(pi, 3, null);
        if (this.winner) return;
        if (!p.alive) return this.nextTurn();
      } else {
        const nx = this.players[this.nextAlive(pi)];
        nx.eq.push(dyn);
        this.addLog(`Dynamite được chuyền sang ${nx.name}.`);
      }
    }

    const jail = p.eq.find((c) => c.name === 'Jail');
    if (jail) {
      const free = this.check(p, (c) => c.suit === 'H', 'Jail');
      p.eq.splice(p.eq.indexOf(jail), 1);
      this.toDiscard(jail);
      if (!free) {
        p.jailed = this.turnNumber; // hiện song sắt đến lượt sau của người này
        this.addLog(`${p.name} bị giam, mất lượt.`);
        return this.nextTurn();
      }
      this.addLog(`${p.name} thoát khỏi nhà tù!`);
    }

    this.phase = 'draw';
    if (p.char === 'Kit Carlson') {
      this.pending = { type: 'kit', player: pi, cards: this.draw(3) };
    } else if (p.char === 'Jesse Jones' && this.alive().some((i) => i !== pi && this.players[i].hand.length)) {
      this.pending = { type: 'draw', player: pi, options: ['deck', 'player'] };
    } else if (p.char === 'Pedro Ramirez' && this.discard.length) {
      this.pending = { type: 'draw', player: pi, options: ['deck', 'discard'] };
    } else {
      this.normalDraw(p);
    }
  }

  normalDraw(p) {
    const cards = this.draw(2);
    p.hand.push(...cards);
    if (p.char === 'Black Jack' && cards[1]) {
      const red = cards[1].suit === 'H' || cards[1].suit === 'D';
      this.addLog(`${p.name} lật lá thứ hai: ${cardStr(cards[1])}${red ? ' → rút thêm 1 lá!' : ''}`);
      if (red) this.give(p, 1);
    }
    this.phase = 'play';
  }

  nextTurn() {
    this.pending = null;
    this.queue = [];
    if (this.winner) return;
    this.turn = this.nextAlive(this.turn);
    this.startTurn();
  }

  // ---------- máu, chết, thắng ----------
  damage(ti, amount, src) {
    const t = this.players[ti];
    if (!t.alive) return;
    t.hp -= amount;
    this.addLog(`${t.name} mất ${amount} máu (còn ${Math.max(t.hp, 0)}).`);
    if (t.hp <= 0) this.trySave(t);
    if (t.hp <= 0) return this.kill(ti, src);
    if (t.char === 'Bart Cassidy') { this.give(t, amount); this.addLog(`${t.name} rút ${amount} lá (Bart Cassidy).`); }
    if (t.char === 'El Gringo' && src != null && src !== ti) {
      for (let k = 0; k < amount; k++) {
        if (this.stealRandom(this.players[src], t)) this.addLog(`${t.name} lấy 1 lá từ tay ${this.players[src].name} (El Gringo).`);
      }
    }
  }

  trySave(t) {
    while (t.hp <= 0) {
      const beer = t.hand.find((c) => c.name === 'Beer');
      if (beer && this.alive().length > 2) {
        t.hand.splice(t.hand.indexOf(beer), 1);
        this.toDiscard(beer);
        t.hp++;
        this.addLog(`🍺 ${t.name} uống Beer để sống sót!`);
      } else if (t.char === 'Sid Ketchum' && t.hand.length >= 2) {
        this.toDiscard(...t.hand.splice(0, 2));
        t.hp++;
        this.addLog(`${t.name} bỏ 2 lá để hồi 1 máu (Sid Ketchum).`);
      } else break;
    }
  }

  kill(ti, src) {
    const t = this.players[ti];
    t.alive = false;
    t.hp = 0;
    this.addLog(`☠️ ${t.name} đã chết! Vai trò: ${t.role} (${ROLE_INFO[t.role].vi}).`);
    const cards = [...t.hand, ...t.eq];
    t.hand = []; t.eq = [];
    const vulture = this.players.find((p) => p.alive && p.char === 'Vulture Sam');
    if (vulture && cards.length) {
      vulture.hand.push(...cards);
      this.addLog(`${vulture.name} nhặt hết bài của ${t.name} (Vulture Sam).`);
    } else this.toDiscard(...cards);

    if (this.checkWin()) return;
    if (src != null && src !== ti && this.players[src].alive) {
      const k = this.players[src];
      if (t.role === 'Outlaw') { this.give(k, 3); this.addLog(`${k.name} được thưởng 3 lá vì hạ một Outlaw.`); }
      if (t.role === 'Deputy' && k.role === 'Sheriff') {
        this.toDiscard(...k.hand, ...k.eq);
        k.hand = []; k.eq = [];
        this.addLog(`Sheriff ${k.name} lỡ tay giết Phó cảnh sát, phải bỏ toàn bộ bài!`);
      }
    }
  }

  checkWin() {
    const al = this.alive().map((i) => this.players[i]);
    const sheriffAlive = al.some((p) => p.role === 'Sheriff');
    if (!sheriffAlive) {
      this.winner = al.length === 1 && al[0].role === 'Renegade' ? 'Renegade' : 'Outlaw';
    } else if (!al.some((p) => p.role === 'Outlaw' || p.role === 'Renegade')) {
      this.winner = 'Sheriff';
    }
    if (this.winner) {
      this.pending = null; this.queue = []; this.phase = 'over';
      const msg = { Sheriff: 'Phe Sheriff (Sheriff + Deputy) chiến thắng!', Outlaw: 'Phe Outlaw chiến thắng!', Renegade: 'Renegade chiến thắng!' };
      this.addLog(`🏆 ${msg[this.winner]}`);
    }
    return !!this.winner;
  }

  isWinner(p) {
    if (!this.winner) return false;
    if (this.winner === 'Sheriff') return p.role === 'Sheriff' || p.role === 'Deputy';
    return p.role === this.winner;
  }

  // ---------- hàng đợi phản hồi ----------
  nextPending() {
    this.pending = null;
    while (this.queue.length) {
      const q = this.queue.shift();
      if (this.players[q.player].alive) { this.pending = q; break; }
    }
  }

  afterAction() {
    for (const p of this.players) {
      if (p.alive && p.char === 'Suzy Lafayette' && p.hand.length === 0 && !this.winner) {
        this.give(p, 1);
        this.addLog(`${p.name} hết bài, rút 1 lá (Suzy Lafayette).`);
      }
    }
    if (!this.winner && !this.pending && !this.players[this.turn].alive) this.nextTurn();
  }

  // ---------- hành động của người chơi ----------
  act(name, a) {
    if (this.winner) fail('Ván đấu đã kết thúc.');
    const pi = this.idx(name);
    if (pi < 0) fail('Bạn không tham gia ván này.');
    const p = this.players[pi];
    if (!p.alive) fail('Bạn đã chết.');

    if (a.type === 'sid') {
      if (p.char !== 'Sid Ketchum') fail('Chỉ Sid Ketchum mới dùng được.');
      if (p.hp >= p.maxHp) fail('Bạn đang đầy máu.');
      const ids = a.cardIds || [];
      if (ids.length !== 2 || ids[0] === ids[1]) fail('Chọn đúng 2 lá.');
      if (!ids.every((id) => p.hand.some((c) => c.id === id))) fail('Bạn không có lá bài này.');
      this.toDiscard(...ids.map((id) => this.takeFromHand(p, id)));
      p.hp++;
      this.addLog(`${p.name} bỏ 2 lá để hồi 1 máu.`);
      return this.afterAction();
    }

    const pend = this.pending;
    if (pend) {
      if (pend.player !== pi) fail('Chưa đến lượt bạn phản hồi.');
      this.respond(pi, p, pend, a);
      return this.afterAction();
    }

    if (this.turn !== pi) fail('Chưa đến lượt của bạn.');
    if (this.phase !== 'play') fail('Không thể làm việc này lúc này.');

    if (a.type === 'play') this.playCard(pi, p, a);
    else if (a.type === 'discard') {
      const ids = a.cardIds || [];
      const excess = p.hand.length - p.hp;
      if (excess <= 0) fail('Bạn không cần bỏ bài.');
      if (!ids.length || ids.length > excess) fail(`Chỉ cần bỏ tối đa ${excess} lá.`);
      const cards = ids.map((id) => this.takeFromHand(p, id));
      this.toDiscard(...cards);
      this.addLog(`${p.name} bỏ ${cards.length} lá.`);
    } else if (a.type === 'endTurn') {
      if (p.hand.length > p.hp) fail(`Bạn phải bỏ bớt ${p.hand.length - p.hp} lá trước khi kết thúc lượt.`);
      this.addLog(`${p.name} kết thúc lượt.`);
      this.nextTurn();
    } else fail('Hành động không hợp lệ.');
    this.afterAction();
  }

  timeout() {
    if (this.winner) return;
    const pend = this.pending;
    const p = this.players[pend ? pend.player : this.turn];
    this.addLog(`⏱ ${p.name} đã hết thời gian${pend ? ' phản hồi' : ' lượt chơi'}.`);
    if (pend) {
      let action = { type: 'take' };
      if (pend.type === 'draw') action = { type: 'drawChoice', from: 'deck' };
      if (pend.type === 'kit') action = { type: 'kit', cardIds: pend.cards.slice(0, 2).map((c) => c.id) };
      if (pend.type === 'store') action = { type: 'pick', cardId: pend.cards[0].id };
      this.act(p.name, action);
    } else {
      const excess = p.hand.length - p.hp;
      if (excess > 0) this.act(p.name, { type: 'discard', cardIds: p.hand.slice(0, excess).map((c) => c.id) });
      this.act(p.name, { type: 'endTurn' });
    }
  }

  respond(pi, p, pend, a) {
    switch (pend.type) {
      case 'draw': {
        if (a.type !== 'drawChoice' || !pend.options.includes(a.from)) fail('Lựa chọn không hợp lệ.');
        if (a.from === 'player') {
          const ti = this.idx(a.target);
          const t = this.players[ti];
          if (!t || ti === pi || !t.alive || !t.hand.length) fail('Chọn người có bài trên tay.');
          this.stealRandom(t, p);
          this.give(p, 1);
          this.addLog(`${p.name} lấy 1 lá từ tay ${t.name} và rút 1 lá.`);
        } else if (a.from === 'discard') {
          const c = this.discard.pop();
          p.hand.push(c);
          this.give(p, 1);
          this.addLog(`${p.name} lấy ${cardStr(c)} từ chồng bài bỏ và rút 1 lá.`);
        } else {
          this.give(p, 2);
          this.addLog(`${p.name} rút 2 lá.`);
        }
        this.pending = null;
        this.phase = 'play';
        return;
      }
      case 'kit': {
        const ids = a.cardIds || [];
        if (a.type !== 'kit' || ids.length !== Math.min(2, pend.cards.length) || new Set(ids).size !== ids.length) fail('Chọn 2 lá để giữ.');
        const keep = pend.cards.filter((c) => ids.includes(c.id));
        if (keep.length !== ids.length) fail('Lá không hợp lệ.');
        p.hand.push(...keep);
        for (const c of pend.cards) if (!ids.includes(c.id)) this.deck.push(c);
        this.addLog(`${p.name} xem 3 lá, giữ 2 và trả lại 1.`);
        this.pending = null;
        this.phase = 'play';
        return;
      }
      case 'store': {
        if (a.type !== 'pick') fail('Hãy chọn 1 lá.');
        const i = pend.cards.findIndex((c) => c.id === a.cardId);
        if (i < 0) fail('Lá không hợp lệ.');
        const c = pend.cards.splice(i, 1)[0];
        p.hand.push(c);
        this.addLog(`${p.name} chọn ${cardStr(c)} ở General Store.`);
        pend.order.shift();
        while (pend.order.length && !this.players[pend.order[0]].alive) pend.order.shift();
        if (pend.cards.length && pend.order.length) pend.player = pend.order[0];
        else { this.toDiscard(...pend.cards); this.nextPending(); }
        return;
      }
      case 'bang': {
        if (a.type === 'barrel') {
          if (pend.barrels <= 0) fail('Bạn không còn Barrel để dùng.');
          pend.barrels--;
          if (this.check(p, (c) => c.suit === 'H', 'Barrel')) pend.got++;
        } else if (a.type === 'respond') {
          const c = p.hand.find((x) => x.id === a.cardId);
          const ok = c && (c.name === 'Missed' || (c.name === 'Bang' && p.char === 'Calamity Janet'));
          if (!ok) fail('Cần dùng lá Missed!.');
          this.toDiscard(this.takeFromHand(p, c.id));
          pend.got++;
          this.addLog(`${p.name} dùng ${c.name === 'Missed' ? 'Missed!' : 'Bang! (như Missed!)'}.`);
        } else if (a.type === 'take') {
          this.damage(pi, 1, pend.source);
          return this.nextPending();
        } else fail('Hành động không hợp lệ.');
        if (pend.got >= pend.need) { this.addLog(`${p.name} đã né được!`); this.nextPending(); }
        return;
      }
      case 'indians':
      case 'duel': {
        if (a.type === 'respond') {
          const c = p.hand.find((x) => x.id === a.cardId);
          const ok = c && (c.name === 'Bang' || (c.name === 'Missed' && p.char === 'Calamity Janet'));
          if (!ok) fail('Cần dùng lá Bang!.');
          this.toDiscard(this.takeFromHand(p, c.id));
          this.addLog(`${p.name} bỏ một Bang!.`);
          if (pend.type === 'duel') this.pending = { type: 'duel', player: pend.other, other: pi };
          else this.nextPending();
        } else if (a.type === 'take') {
          this.damage(pi, 1, pend.type === 'duel' ? pend.other : pend.source);
          this.nextPending();
        } else fail('Hành động không hợp lệ.');
        return;
      }
      default: fail('Không có gì để phản hồi.');
    }
  }

  playCard(pi, p, a) {
    const card = p.hand.find((c) => c.id === a.cardId);
    if (!card) fail('Bạn không có lá bài này.');
    let name = card.name;
    if (name === 'Missed' && p.char === 'Calamity Janet') name = 'Bang';
    const info = CARD_INFO[card.name];

    const needTarget = (cond) => {
      const ti = this.idx(a.target);
      const t = this.players[ti];
      if (!t || !t.alive || ti === pi) fail('Hãy chọn một người chơi khác còn sống.');
      if (cond) cond(ti, t);
      return [ti, t];
    };
    const use = () => { this.takeFromHand(p, card.id); };
    const others = () => { const out = []; let j = this.nextAlive(pi); while (j !== pi) { out.push(j); j = this.nextAlive(j); } return out; };

    switch (name) {
      case 'Bang': {
        if (this.bangsPlayed >= 1 && !this.unlimitedBang(p)) fail('Mỗi lượt chỉ được dùng 1 Bang!.');
        const [ti, t] = needTarget((ti) => { if (this.distance(pi, ti) > this.range(p)) fail('Mục tiêu ngoài tầm súng.'); });
        use(); this.toDiscard(card); this.bangsPlayed++;
        this.addLog(`💥 ${p.name} bắn ${t.name}!`);
        this.pending = { type: 'bang', player: ti, source: pi, need: p.char === 'Slab the Killer' ? 2 : 1, got: 0, barrels: this.barrelCount(t) };
        return;
      }
      case 'Missed': return fail('Missed! chỉ dùng khi bị bắn.');
      case 'Beer': {
        if (this.alive().length <= 2) fail('Beer vô dụng khi chỉ còn 2 người.');
        if (p.hp >= p.maxHp) fail('Bạn đang đầy máu.');
        use(); this.toDiscard(card); p.hp++;
        this.addLog(`🍺 ${p.name} uống Beer (+1 máu).`);
        return;
      }
      case 'Saloon': {
        use(); this.toDiscard(card);
        for (const i of this.alive()) { const q = this.players[i]; q.hp = Math.min(q.maxHp, q.hp + 1); }
        this.addLog(`🥃 ${p.name} mở Saloon: mọi người hồi 1 máu.`);
        return;
      }
      case 'Stagecoach':
      case 'Wells Fargo': {
        use(); this.toDiscard(card);
        const n = name === 'Stagecoach' ? 2 : 3;
        this.give(p, n);
        this.addLog(`${p.name} dùng ${name}, rút ${n} lá.`);
        return;
      }
      case 'General Store': {
        use(); this.toDiscard(card);
        const order = [pi, ...others()];
        this.pending = { type: 'store', player: pi, order, cards: this.draw(order.length) };
        this.addLog(`🏪 ${p.name} mở General Store.`);
        return;
      }
      case 'Panic':
      case 'Cat Balou': {
        const [, t] = needTarget((ti) => {
          if (name === 'Panic' && this.distance(pi, ti) > 1) fail('Panic! chỉ dùng với người ở khoảng cách 1.');
        });
        let taken;
        if (a.targetCard === 'hand') {
          if (!t.hand.length) fail('Người này không có bài trên tay.');
        } else {
          taken = t.eq.find((c) => c.id === a.targetCard);
          if (!taken) fail('Hãy chọn một lá bài của người đó.');
        }
        use(); this.toDiscard(card);
        if (!taken) taken = t.hand.splice(Math.floor(this.rng() * t.hand.length), 1)[0];
        else t.eq.splice(t.eq.indexOf(taken), 1);
        if (name === 'Panic') { p.hand.push(taken); this.addLog(`😱 ${p.name} lấy ${a.targetCard === 'hand' ? '1 lá trên tay' : cardStr(taken)} của ${t.name}.`); }
        else { this.toDiscard(taken); this.addLog(`💃 ${p.name} buộc ${t.name} bỏ ${cardStr(taken)}.`); }
        return;
      }
      case 'Duel': {
        const [ti, t] = needTarget();
        use(); this.toDiscard(card);
        this.addLog(`🤠 ${p.name} thách đấu ${t.name}!`);
        this.pending = { type: 'duel', player: ti, other: pi };
        return;
      }
      case 'Indians':
      case 'Gatling': {
        use(); this.toDiscard(card);
        this.addLog(name === 'Indians' ? `🪶 ${p.name} thả thổ dân tấn công!` : `🔫 ${p.name} xả Gatling!`);
        this.queue = others().map((j) => name === 'Indians'
          ? { type: 'indians', player: j, source: pi }
          : { type: 'bang', player: j, source: pi, need: 1, got: 0, barrels: this.barrelCount(this.players[j]) });
        this.nextPending();
        return;
      }
      case 'Jail': {
        const [, t] = needTarget((ti, t) => {
          if (t.role === 'Sheriff') fail('Không thể bỏ tù Sheriff.');
          if (this.hasEq(t, 'Jail')) fail('Người này đã ở trong tù.');
        });
        use(); t.eq.push(card);
        this.addLog(`⛓️ ${p.name} bỏ tù ${t.name}.`);
        return;
      }
      default: {
        if (info.type === 'gun') {
          const old = this.gun(p);
          use();
          if (old) { p.eq.splice(p.eq.indexOf(old), 1); this.toDiscard(old); }
          p.eq.push(card);
          this.addLog(`${p.name} trang bị ${card.name} (tầm ${info.range}).`);
          return;
        }
        if (info.type === 'blue') {
          if (this.hasEq(p, card.name)) fail(`Bạn đã có ${card.name}.`);
          use(); p.eq.push(card);
          this.addLog(`${p.name} trang bị ${card.name}.`);
          return;
        }
        fail('Không thể dùng lá này.');
      }
    }
  }

  // ---------- dữ liệu gửi cho từng người ----------
  viewFor(name) {
    const me = this.idx(name);
    const meAlive = me >= 0 && this.players[me].alive;
    const pend = this.pending;
    let pending = null;
    if (pend) {
      pending = { type: pend.type, player: pend.player };
      if (pend.type === 'bang') Object.assign(pending, { source: pend.source, need: pend.need, got: pend.got, barrels: pend.barrels });
      if (pend.type === 'indians') pending.source = pend.source;
      if (pend.type === 'duel') pending.other = pend.other;
      if (pend.type === 'store') pending.cards = pend.cards;
      if (pend.type === 'draw') pending.options = pend.options;
      if (pend.type === 'kit') pending.cards = pend.player === me ? pend.cards : pend.cards.map(() => null);
    }
    return {
      players: this.players.map((p, i) => ({
        name: p.name, char: p.char, hp: p.hp, maxHp: p.maxHp, alive: p.alive,
        handCount: p.hand.length, eq: p.eq,
        role: (p.role === 'Sheriff' || !p.alive || i === me || this.winner) ? p.role : null,
        distance: meAlive && p.alive ? this.distance(me, i) : null,
        winner: this.isWinner(p),
        jailed: p.alive && !this.winner ? (p.jailed || 0) : 0,
      })),
      me: me >= 0 ? { index: me, hand: this.players[me].hand, range: this.range(this.players[me]), unlimitedBang: this.unlimitedBang(this.players[me]) } : null,
      turn: this.turn, phase: this.phase, bangsPlayed: this.bangsPlayed,
      deckCount: this.deck.length, discardTop: this.discard[this.discard.length - 1] || null,
      pending, log: this.log.slice(-60), winner: this.winner,
    };
  }
}

module.exports = { Game, GameError, CARD_INFO, CHAR_INFO, ROLE_INFO, SUIT_SYMBOL };
