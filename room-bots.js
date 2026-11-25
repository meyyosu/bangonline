'use strict';

const { GameError, CARD_INFO } = require('./game');
const { pauseAction } = require('./room-pause');
const DEFENSIVE_CARDS = new Set(['Missed', 'Backfire', 'Escape', 'Beer', 'Saloon', 'Last Call', 'Canteen', 'Whisky', 'Barrel', 'Mustang', 'Hideout']);

function targetCards(player) {
  const anchor = player.ghost && player.eq.find((card) => card.name === 'Ghost');
  const choices = player.eq.filter((card) => card !== anchor).map((card) => card.id);
  if (player.hand.length) choices.unshift('hand');
  if (anchor) choices.unshift(anchor.id);
  return choices;
}

// Make one move per tick so clients can follow each bot's actions.
function tickBots(room, now = Date.now()) {
  const g = room.game;
  if (room.status !== 'playing' || !g || g.winner) return false;
  let changed = false;
  for (const name of room.bots || []) {
    const vote = room.pause;
    if (vote?.phase === 'voting' && now < vote.deadline && vote.voters.includes(name) && !vote.accepted.includes(name)) {
      pauseAction(room, name, { type: 'vote', id: vote.id, agree: true }, now);
      changed = true;
    }
  }
  if (room.pause?.frozenAt != null) return changed;
  const p = g.players[g.pending ? g.pending.player : g.turn];
  if (!room.bots?.includes(p?.name)) { room.botNextAt = null; return changed; }
  const delay = room.fasterBots ? 0 : 500;
  if (room.botNextAt == null) room.botNextAt = now + delay;
  if (now < room.botNextAt) return changed;
  room.botNextAt = now + delay;
  const actions = [];
  const pending = g.pending;
  const lowSheriff = p.role === 'Sheriff' && p.hp < 2;
  const calamity = lowSheriff && g.ability(p) === 'Calamity Janet';
  const defensive = (card) => CARD_INFO[card.name].defense || DEFENSIVE_CARDS.has(card.name) || (calamity && card.name === 'Bang');
  const spendable = lowSheriff ? p.hand.filter((card) => !defensive(card)) : p.hand;
  const discardOrder = lowSheriff ? [...spendable, ...p.hand.filter(defensive)] : p.hand;
  if (g.phase === 'character') {
    actions.push({ type: 'chooseCharacter', character: pending.options[0] });
  } else if (pending) {
    if (pending.type === 'bang') {
      if (pending.barrels > 0) actions.push({ type: 'barrel' });
      const dodges = g.dodgeCards(p);
      if (dodges.length >= pending.need - pending.got) {
        for (const c of dodges) actions.push({ type: 'respond', cardId: c.id });
      }
    }
    if (['indians', 'duel'].includes(pending.type)) {
      for (const c of discardOrder) actions.push({ type: 'respond', cardId: c.id });
    }
    if (pending.canEscape) for (const card of g.escapeCards(p)) actions.push({ type: 'escape', cardId: card.id });
    if (pending.type === 'saved' && p.role === g.players[pending.target].role) {
      actions.push({ type: 'saved', cardId: p.hand.find((c) => c.name === 'Saved!')?.id, from: 'deck' });
    }
    if (pending.type === 'lemonade' && discardOrder.length) actions.push({ type: 'lemonade', cardId: discardOrder[0].id });
    if (pending.type === 'poker') actions.push({ type: 'poker', cardIds: pending.ids.slice(0, 2) });
    if (pending.type === 'valleyDiscard' && pending.count) actions.push({ type: 'valleyDiscard', cardIds: discardOrder.slice(0, pending.count).map((c) => c.id) });
    if (pending.type === 'check') actions.push({ type: 'checkDraw' });
    if (pending.type === 'draw') actions.push({ type: 'drawChoice', from: 'deck' });
    if (pending.type === 'kit') actions.push({ type: 'kit', cardIds: pending.cards.slice(0, 2).map((c) => c.id) });
    if (pending.type === 'store') actions.push({ type: 'pick', cardId: pending.cards[0].id });
    if (pending.type === 'copyAbility') actions.push({ type: 'copyAbility', target: g.players.find((q) => q.alive && q !== p)?.name });
    actions.push({ type: 'take' });
  } else {
    const saloon = lowSheriff && p.hand.find((card) => card.name === 'Saloon');
    if (saloon) actions.push({ type: 'play', cardId: saloon.id });
    // Only use the bot's own hand and public information about other players.
    const targets = g.players.filter((q) => q.alive && q !== p);
    targets.sort((a, b) => Number(!!a.ghost) - Number(!!b.ghost) ||
      (p.role === 'Outlaw' ? Number(b.role === 'Sheriff') - Number(a.role === 'Sheriff') : 0));
    const keepSheriffAlive = p.role === 'Renegade' && targets.length === 2 && targets.some((q) => q.role === 'Sheriff');
    const avoidSheriff = keepSheriffAlive || ['Sheriff', 'Deputy'].includes(p.role);
    const enemies = targets.filter((q) => !avoidSheriff || q.role !== 'Sheriff');
    const shootable = enemies.filter((q) => !q.ghost);
    const canAttackAll = shootable.length > 0 && !keepSheriffAlive;
    const lemat = g.hasLeMat(p);
    const skill = g.activeSkill(p);
    if (skill === 'Der Spot-Burst Ringer' && canAttackAll) actions.push({ type: 'skill', cardIds: [p.hand.find((card) => card.name === 'Bang').id] });
    const club = skill === 'Black Flower' && spendable.find((card) => card.suit === 'C');
    if (club) for (const target of shootable) {
      actions.push({ type: 'skill', cardIds: [club.id], target: target.name });
    }
    for (const c of [...p.eq.filter((card) => CARD_INFO[card.name].type === 'green' && !p.coolingGreen.has(card.id)), ...p.hand]) {
      const type = p.eq.includes(c) ? 'activate' : 'play';
      const info = CARD_INFO[c.name];
      if (lowSheriff && g.bangCard(p, c) && defensive(c)) continue;
      const cost = info.discardCost ? spendable.find((card) => card.id !== c.id) : null;
      if (info.discardCost && !cost) continue;
      const payment = cost ? { costCardId: cost.id } : {};
      if (c.name === 'Ghost') {
        for (const q of g.players.filter((q) => !q.alive && !q.forfeited && q.role === p.role)) actions.push({ type, cardId: c.id, target: q.name });
        continue;
      }
      if (info.effect === 'discardAll') {
        const choices = targets.filter((q) => q.hand.length || q.eq.length).map((q) => ({
          target: q.name, targetCard: targetCards(q)[0],
        }));
        actions.push({ type, cardId: c.id, ...payment, targets: choices });
        continue;
      }
      const attackAll = info.effect === 'attackAll' || ['Gatling', 'Indians', 'Bandidos'].includes(c.name);
      const singleAttack = info.effect === 'attack' || g.bangCard(p, c) || ['Aim', 'Fanning', 'Duel', 'Rattlesnake', 'Bounty'].includes(c.name);
      const targetsCard = ['Panic', 'Cat Balou'].includes(c.name) || ['take', 'discard'].includes(info.effect);
      if (attackAll) {
        if (canAttackAll) actions.push({ type, cardId: c.id, ...payment });
      } else {
        for (const target of singleAttack ? shootable : enemies) {
          if (c.name === 'Aim') {
            const bang = spendable.find((card) => card !== c && (g.bangCard(p, card) || lemat));
            if (bang) actions.push({ type, cardId: c.id, target: target.name, bangCardId: bang.id });
          } else if (c.name === 'Fanning') {
            const choices = g.fanningTargets(g.turn, g.idx(target.name));
            const allowed = choices.filter((i) => !keepSheriffAlive || g.players[i].role !== 'Sheriff');
            const second = allowed.find((i) => !g.players[i].ghost) ?? allowed[0];
            if (!choices.length || second !== undefined) {
              actions.push({ type, cardId: c.id, target: target.name, secondTarget: g.players[second]?.name });
            }
          } else if (targetsCard) {
            for (const targetCard of targetCards(target)) {
              actions.push({ type, cardId: c.id, target: target.name, targetCard, ...payment });
            }
          } else actions.push({ type, cardId: c.id, target: target.name, ...payment });
        }
        if (!singleAttack) actions.push({ type, cardId: c.id, ...payment });
      }
      if (type === 'play' && lemat && spendable.includes(c)) {
        for (const target of shootable) actions.push({ type, cardId: c.id, target: target.name, asBang: true });
      }
    }
    const excess = p.hand.length - g.handLimit(p);
    if (excess > 0 && !p.ghost) actions.push({ type: 'discard', cardIds: discardOrder.slice(0, excess).map((c) => c.id) });
    else actions.push({ type: 'endTurn' });
  }
  for (const action of actions) {
    try { g.act(p.name, action); return true; }
    catch (e) { if (!(e instanceof GameError)) throw e; }
  }
  // The rules engine supplies safe defaults for remaining choices and excess cards.
  g.timeout();
  return true;
}

module.exports = { tickBots };
