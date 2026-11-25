'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Game, SOUND_FILES } = require('../game');

function setup(options) {
  const g = new Game(['Alice', 'Bobby', 'Carol', 'David'], { rng: () => .4, ...options });
  while (g.pending) g.timeout();
  for (const p of g.players) { p.char = 'Willy the Kid'; p.hp = p.maxHp = 4; }
  return g;
}

function give(g, p, name) {
  const piles = [g.deck, g.discard, ...g.players.map((q) => q.hand)];
  const pile = piles.find((cards) => cards.some((c) => c.name === name));
  const [card] = pile.splice(pile.findIndex((c) => c.name === name), 1);
  p.hand.push(card);
  return card;
}

test('turn cues stay private; random Bang and dodge clips are public', (t) => {
  const g = setup(), p = g.players[g.turn], target = g.players[g.nextAlive(g.turn)];
  assert.ok(g.viewFor(p.name).sounds.some((cue) => cue.files.includes('yourturn1')));
  for (const viewer of [target.name, null]) assert.ok(g.viewFor(viewer).sounds.every((cue) => !cue.files.includes('yourturn1')));
  const rng = t.mock.method(Math, 'random', () => 0);
  for (const [sample, shot, dodge] of [[0, 'bangsound1', 'missedsound1'], [0.99, 'bangsound7', 'missedsound6']]) {
    rng.mock.mockImplementation(() => sample);
    const bang = give(g, p, 'Bang');
    g.act(p.name, { type: 'play', cardId: bang.id, target: target.name });
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, [shot]);
    const missed = give(g, target, 'Missed');
    g.act(target.name, { type: 'respond', cardId: missed.id });
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, [dodge]);
  }
});

test('Store, Indians, Gatling and equipment publish main sound cues', () => {
  const g = setup(), p = g.players[g.turn];
  for (const [name, clip] of [['General Store', 'generalstore1'], ['Indians', 'indian1'], ['Gatling', 'gatling'], ['Mustang', 'mustang1'], ['Scope', 'equipment1']]) {
    const card = give(g, p, name);
    g.act(p.name, { type: 'play', cardId: card.id });
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, [clip]);
    while (g.pending) g.timeout();
  }
});

test('Aim uses the shooter’s voice only when the shot takes two life points', () => {
  for (const { shooter, victim, hp, response, clip } of [
    { shooter: 'Black Flower', victim: 'Willy the Kid', hp: 2, response: 'take', clip: 'aim_success_f' },
    { shooter: 'Willy the Kid', victim: 'Evelyn Shebang', hp: 4, response: 'take', clip: 'aim_success_m' },
    { shooter: 'Evelyn Shebang', victim: 'Willy the Kid', hp: 1, response: 'take' },
    { shooter: 'Willy the Kid', victim: 'Evelyn Shebang', hp: 4, response: 'respond' },
    { shooter: 'Evelyn Shebang', victim: 'Willy the Kid', hp: 4, response: 'saved' },
  ]) {
    const g = setup({ valleyOfShadow: true });
    for (const p of g.players) { g.toDiscard(...p.hand); p.hand = []; }
    const p = g.players[g.turn], target = g.players[g.nextAlive(g.turn)];
    const saver = g.players.find((player) => player !== p && player !== target);
    p.char = shooter;
    target.char = victim;
    target.hp = hp;
    const aim = give(g, p, 'Aim'), bang = give(g, p, 'Bang');
    const playedAt = g.soundSeq;
    g.act(p.name, { type: 'play', cardId: aim.id, target: target.name, bangCardId: bang.id });
    assert.deepEqual(g.viewFor(null).sounds.filter((cue) => cue.seq > playedAt).flatMap((cue) => cue.files), ['Aim']);
    if (response === 'saved') {
      const saved = give(g, saver, 'Saved!');
      g.act(saver.name, { type: 'saved', cardId: saved.id, target: target.name, from: 'deck' });
    } else {
      const missed = response === 'respond' ? give(g, target, 'Missed') : null;
      g.act(target.name, { type: response, cardId: missed?.id });
    }
    const hitCues = g.viewFor(null).sounds.flatMap((cue) => cue.files).filter((file) => file.startsWith('aim_success_'));
    assert.deepEqual(hitCues, clip ? [clip] : []);
  }
});

test('draw sounds play once per batch for the recipient only', () => {
  const g = setup(), p = g.players[g.turn], opponent = g.players[g.nextAlive(g.turn)];
  const before = g.soundSeq;
  g.give(p, 2);
  assert.deepEqual(g.viewFor(p.name).sounds.filter((cue) => cue.seq > before).flatMap((cue) => cue.files), ['drawcard']);
  for (const viewer of [opponent.name, null]) assert.ok(g.viewFor(viewer).sounds.every((cue) => cue.seq <= before));

  const store = give(g, p, 'General Store');
  g.act(p.name, { type: 'play', cardId: store.id });
  const pickAt = g.soundSeq;
  g.act(p.name, { type: 'pick', cardId: g.pending.cards[0].id });
  assert.deepEqual(g.viewFor(p.name).sounds.filter((cue) => cue.seq > pickAt).flatMap((cue) => cue.files), ['drawcard']);
  for (const viewer of [opponent.name, null]) assert.ok(g.viewFor(viewer).sounds.every((cue) => cue.seq <= pickAt));
});

test('teamkiller plays together with elimination in both directions, including the final hit', () => {
  assert.ok(SOUND_FILES.has('teamkiller.mp3'));
  for (const [killerRole, victimRole, teamkill] of [
    ['Sheriff', 'Deputy', true], ['Deputy', 'Sheriff', true], ['Outlaw', 'Sheriff', false],
  ]) {
    const g = new Game(['Alice', 'Bobby', 'Carol', 'David', 'Elena'], { rng: () => 0.4 });
    const victim = g.players.find((p) => p.role === victimRole);
    const killer = g.players.findIndex((p) => p.role === killerRole);
    g.toDiscard(...victim.hand);
    victim.hand = [];
    victim.hp = 1;
    g.damage(g.idx(victim.name), 1, killer);
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, teamkill ? ['playereliminated', 'teamkiller'] : ['playereliminated']);
  }
});

test('Springfield, Tomahawk and Tornado use their own clips', () => {
  for (const [name, clip] of [['Springfield', 'bangsound_springfield'], ['Tomahawk', 'tomahawk'], ['Tornado', 'tornado']]) {
    const g = setup({ dodgeCity: true, valleyOfShadow: true });
    const p = g.players[g.turn], target = g.players[g.nextAlive(g.turn)];
    const card = give(g, p, name);
    const cost = p.hand.find((c) => c.id !== card.id);
    g.act(p.name, { type: 'play', cardId: card.id, target: target.name, costCardId: cost?.id });
    assert.deepEqual(g.viewFor(null).sounds.at(-1).files, [clip]);
  }
});

test('Black Flower’s ability fires the Springfield clip', () => {
  const g = setup({ valleyOfShadow: true });
  const player = g.players[g.turn], target = g.players[g.nextAlive(g.turn)];
  player.char = 'Black Flower';
  const club = give(g, player, 'Bounty');
  g.act(player.name, { type: 'skill', cardIds: [club.id], target: target.name });
  assert.equal(g.pending.type, 'bang');
  assert.deepEqual(g.viewFor(null).sounds.at(-1).files, ['bangsound_springfield']);
});

test('room sound delivery plays new cues once and skips old snapshots and other rooms', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('function showRoomSounds(');
  const end = source.indexOf('// Ô trò chuyện thu gọn được', start);
  const played = [], c = { gameAudio: { play: (...files) => played.push(files) } };
  vm.createContext(c);
  vm.runInContext(source.slice(start, end), c);
  const before = { code: 'TEST', players: ['Alice'], game: { soundSeq: 4 } };
  const after = { code: 'TEST', players: ['Alice', 'Bobby'], game: { soundSeq: 5, sounds: [{ seq: 3, files: ['old'] }, { seq: 5, files: ['gatling'] }] } };
  c.showRoomSounds(after, null);
  c.showRoomSounds({ ...after, code: 'OTHER' }, before);
  assert.deepEqual(played, []);
  c.showRoomSounds(after, before);
  assert.deepEqual(played, [['playerjoin'], ['gatling']]);
  c.showRoomSounds(after, after);
  assert.equal(played.length, 2);
});
