// Random legal-ish play to shake out crashes and zone-invariant violations.  node test/fuzz.test.js
const DF = require('../public/engine.js');
let games = 0, over = 0;
function check(s) {
  const seen = {};
  const mark = (id, z) => { if (seen[id]) throw new Error('card in two zones: ' + id + ' ' + seen[id] + ' & ' + z); seen[id] = z; };
  s.hands.forEach((h, p) => h.forEach((id) => { mark(id, 'hand' + p); if (s.cards[id].zone !== 'hand') throw new Error('zone mismatch ' + id); }));
  s.draw.forEach((id) => mark(id, 'draw')); s.discard.forEach((id) => mark(id, 'discard')); s.exhausted.forEach((id) => mark(id, 'exh'));
  Object.values(s.groups).forEach((g) => g.members.forEach((id) => { mark(id, g.id); if (s.cards[id].groupId !== g.id || !s.cards[id].logical) throw new Error('group link ' + id); }));
  if (s.pool) mark(s.pool.revealed, 'pool'); s.bets.forEach((b) => b && mark(b, 'bet'));
  if (Object.keys(seen).length !== 54) throw new Error('lost cards: ' + Object.keys(seen).length);
}
for (let seed = 1; seed <= 300; seed++) {
  let s = DF.newGame({ seed }), steps = 0, R = seed * 7919;
  const rand = (n) => { R = (R * 1103515245 + 12345) & 0x7fffffff; return R % n; };
  const run = (a) => { const r = DF.act(s, a); if (r.ok) { s = r.state; check(s); } return r.ok; };
  while (!s.result && steps++ < 600) {
    const p = DF.actor(s);
    if (s.phase === 'OPENING_BET') { run({ type: 'placeBet', player: p, cardId: s.hands[p][rand(s.hands[p].length)] }); continue; }
    if (s.phase === 'OPENING_SELECTION') { run({ type: 'selectOpening', player: p, choice: ['revealed', 'bet0', 'bet1', 'next'][rand(4)] }); continue; }
    if (s.phase === 'RED2_RESPONSE_CHAIN') {
      const sp = DF.specialsFor(s, p);
      if (sp.black2.length && rand(2)) run({ type: 'counter', player: p, cardId: sp.black2[0] }); else run({ type: 'passChain', player: p }); continue;
    }
    if (s.phase === 'GOING_OUT_RESPONSE') {
      const sp = DF.specialsFor(s, p);
      if (sp.black2.length && rand(2)) run({ type: 'blackSeven', player: p, cardId: sp.black2[0] }); else run({ type: 'goingOutPass', player: p }); continue;
    }
    if (s.phase === 'TURN_DRAW') {
      const r = rand(12);
      if (r === 2 && s.discard.length && run({ type: 'pickupIndexed', player: p, index: rand(s.discard.length) })) continue;
      if (r === 3 && s.discard.length && run({ type: 'takeDiscardTop', player: p })) continue;
      if (!run({ type: 'drawPile', player: p }) && !run({ type: 'takeDiscardTop', player: p })) run({ type: 'blindDraw', player: p });
      continue;
    }
    if (s.phase === 'MANDATORY_PLAY') {
      const sp = DF.specialsFor(s, p);
      if (rand(14) === 0 && sp.red2.length) { const t = DF.red2Targets(s, p); if (t.length && run({ type: 'red2', player: p, cardId: sp.red2[0], targetId: t[0] })) continue; }
      if (rand(14) === 1 && sp.black2.length && run({ type: 'blackSeven', player: p, cardId: sp.black2[0] })) continue;
      if (rand(10) === 0 && sp.eights.length && s.discard.length) {
        const idx = rand(s.discard.length), o = DF.eightPlacements(s, p, sp.eights[0], { discard: idx });
        if (o.length && run({ type: 'eightDiscard', player: p, eightId: sp.eights[0], index: idx, placement: o[0].placement })) continue;
      }
      if (rand(10) === 0 && sp.eights.length) {
        const ts = DF.eightTargetCards(s), t = ts[rand(ts.length)];
        if (t) { const o = DF.eightPlacements(s, p, sp.eights[0], { table: t }); if (o.length && run({ type: 'eightTable', player: p, eightId: sp.eights[0], targetId: t, placement: o[0].placement })) continue; }
      }
      const m = DF.mandatoryPlays(s, p, true)[0];
      if (m) {
        if (m.kind === 'add') run({ type: 'addToGroup', player: p, cardId: m.cardId, groupId: m.groupId, logical: m.logical });
        else run({ type: 'createGroup', player: p, ids: m.ids, specs: m.specs.members });
        continue;
      }
      if (s.hands[p].length) run({ type: 'discard', player: p, cardId: s.hands[p][rand(s.hands[p].length)] }); else run({ type: 'endTurn', player: p });
    }
  }
  games++; if (s.result) { over++; const sc = DF.computeScores(s); if (s.result.final[0] !== sc.net[0] + s.result.bonus[0]) throw new Error('score mismatch'); }
}
console.log(`fuzz ok: ${games} games, ${over} finished`);
