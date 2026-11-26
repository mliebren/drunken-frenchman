// Run with:  node test/engine.test.js     (no dependencies)
const DF = require('../public/engine.js');
let pass = 0, failN = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { failN++; console.log('✗ ' + name + '\n    ' + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' expected ' + JSON.stringify(b)); };
const yes = (v, m) => { if (!v) throw new Error(m || 'expected truthy'); };
const RK = { J: 11, Q: 12, K: 13, A: 14 };
const sp = (ids, over = {}) => ids.map((id) => { const o = over[id]; if (o) return { id, ...o }; return { id, rank: RK[id.slice(0, -1)] || +id.slice(0, -1), suit: id.slice(-1) }; });
const A = (s, a) => DF.act(s, a);
const good = (r) => { if (!r.ok) throw new Error('rejected: ' + r.error); return r.state; };
const bad = (r, m) => { if (r.ok) throw new Error('expected rejection ' + (m || '')); };
const J = (rank, suit) => ({ rank, suit });

/* ---- setup ---- */
t('DF-SET: every deal has a special in each hand; 13/13/27+pool', () => {
  for (let seed = 1; seed < 150; seed++) {
    const s = DF.newGame({ seed });
    for (const h of s.hands) { eq(h.length, 13); yes(h.some((id) => /^(2|8)/.test(id) || id.startsWith('JK')), 'special'); }
    eq(s.draw.length, 27); yes(s.pool.revealed);
  }
});
t('DF-SET: deterministic with seed', () => eq(DF.newGame({ seed: 9 }).hands, DF.newGame({ seed: 9 }).hands));

/* ---- betting ---- */
function betState(b0, b1, rev = '3C', draw = ['4C', '5C']) {
  const s = DF.fixture({ phase: 'OPENING_BET', hands: [[b0, '9D'], [b1, '9C']], draw });
  s.pool = { revealed: rev }; s.exhausted = s.exhausted.filter((x) => x !== rev); s.cards[rev].zone = 'pool';
  return s;
}
const winner = (b0, b1) => { let s = betState(b0, b1); s = good(A(s, { type: 'placeBet', player: 0, cardId: b0 })); s = good(A(s, { type: 'placeBet', player: 1, cardId: b1 })); return s.opening.winner; };
t('DF-BET-01/02/03/05 ordering', () => {
  eq(winner('9H', '10C'), 1); eq(winner('AH', 'KH'), 0); eq(winner('7H', '7S'), 1); eq(winner('JK1', '2C'), 1);
  eq(winner('7C', '7D'), 1); eq(winner('7D', '7H'), 1); eq(winner('2C', 'JK2'), 0);
});
t('DF-BET-06..10 selection and canonical bottom order', () => {
  let s = betState('9H', '10C');
  s = good(A(s, { type: 'placeBet', player: 0, cardId: '9H' })); s = good(A(s, { type: 'placeBet', player: 1, cardId: '10C' }));
  const own = good(A(s, { type: 'selectOpening', player: 1, choice: 'bet1' }));
  yes(own.hands[1].includes('10C')); eq(own.draw, ['4C', '5C', '3C', '9H']); eq(own.phase, 'MANDATORY_PLAY'); eq(own.current, 1);
  const opp = good(A(s, { type: 'selectOpening', player: 1, choice: 'bet0' }));
  yes(opp.hands[1].includes('9H')); eq(opp.draw, ['4C', '5C', '3C', '10C']);
  const rev = good(A(s, { type: 'selectOpening', player: 1, choice: 'revealed' }));
  yes(rev.hands[1].includes('3C')); eq(rev.draw, ['4C', '5C', '9H', '10C']);
  const nxt = good(A(s, { type: 'selectOpening', player: 1, choice: 'next' }));
  yes(nxt.hands[1].includes('4C')); eq(nxt.draw, ['5C', '3C', '9H', '10C']);
  bad(A(s, { type: 'selectOpening', player: 0, choice: 'bet0' }), 'loser cannot select');
});

/* ---- groups ---- */
const play = (hands, groups = [], extra = {}) => DF.fixture({ hands, groups, ...extra });
t('DF-GRP-01/02/03/04 sets', () => {
  const s = play([['5H', '5D', '5C', '9S'], ['3C']]);
  good(A(s, { type: 'createGroup', player: 0, ids: ['5H', '5D', '5C'], specs: sp(['5H', '5D', '5C']) }));
  const s4 = play([['5H', '5D', '5C', '5S', '9S'], ['3C']]);
  const r = good(A(s4, { type: 'createGroup', player: 0, ids: ['5H', '5D', '5C', '5S'], specs: sp(['5H', '5D', '5C', '5S']) }));
  eq(DF.addChoices(good(A(play([['5H', '5D', '5C', '5S', '5H'.replace('H', 'H')], ['3C']]), { type: 'createGroup', player: 0, ids: ['5H', '5D', '5C'], specs: sp(['5H', '5D', '5C']) })), '5S', 'G1').length, 1);
  bad(A(s4, { type: 'createGroup', player: 0, ids: ['5H', '5D', '5C', '5S', '9S'], specs: sp(['5H', '5D', '5C', '5S', '9S']) }), 'five');
  bad(A(play([['5H', '5H'.replace('H', 'S'), '5D'], ['3C']]), { type: 'createGroup', player: 0, ids: ['5H'], specs: [] }), 'size');
  eq(Object.values(r.groups)[0].members.length, 4);
  eq(DF.addChoices(r, '9S', 'G1').length, 0);
});
t('DF-GRP-05..10 runs', () => {
  const mk = (ids, extraHand = ['2C']) => A(play([[...ids, ...extraHand], ['3C']]), { type: 'createGroup', player: 0, ids, specs: sp(ids) });
  good(mk(['4H', '5H', '6H'])); good(mk(['QH', 'KH', 'AH']));
  bad(mk(['KH', 'AH', '2H']), 'wrap'); bad(mk(['4H', '5H', '6C']), 'suit');
  const full = ['2H', '3H', '4H', '5H', '6H', '7H', '8H', '9H', '10H', 'JH', 'QH', 'KH', 'AH'];
  good(mk(full));
});
t('DF-GRP-11/12 extend own and opponent group; owner/side', () => {
  const g = [{ id: 'G1', type: 'run', side: 0, members: ['4H', '5H', '6H'] }];
  let s = good(A(play([['7H', '9C'], ['8H', '3C']], g), { type: 'addToGroup', player: 0, cardId: '7H', groupId: 'G1', logical: J(7, 'H') }));
  eq(s.cards['7H'].owner, 0); eq(s.groups.G1.members, ['4H', '5H', '6H', '7H']);
  s.current = 1; s.phase = 'MANDATORY_PLAY';
  s = good(A(s, { type: 'addToGroup', player: 1, cardId: '8H', groupId: 'G1', logical: J(8, 'H') }));
  eq(s.cards['8H'].owner, 1); eq(s.groups.G1.side, 0);
});
t('DF-JOK: wild identity rules', () => {
  const g = play([['5H', '5D', 'JK1', '9S'], ['3C']]);
  const opts = DF.createOptions(g, 0, ['5H', '5D', 'JK1']).filter((o) => o.spec.type === 'set');
  eq(opts.length, 2);
  let s = good(A(g, { type: 'createGroup', player: 0, ids: ['5H', '5D', 'JK1'], specs: sp(['5H', '5D', 'JK1'], { JK1: J(5, 'C') }) }));
  eq(s.cards.JK1.logical, J(5, 'C'));
  // 4th identity for a 3-member set is addable by a joker only if free; set of 3 extends to 4
  eq(DF.addChoices(s, 'JK2', 'G1').length, 1);
  // joker in run: 5H 6H joker(7H) 8H
  const r = play([['5H', '6H', 'JK1', '8H', '2C'], ['3C']]);
  const ro = DF.createOptions(r, 0, ['5H', '6H', 'JK1', '8H']);
  eq(ro.length, 1); eq(ro[0].spec.members.map((m) => m.rank), [5, 6, 7, 8]);
  // duplicate identity within same group type on the table is rejected, opposite type allowed
  const base = [{ id: 'G1', type: 'run', side: 1, members: ['5H', '6H', '7H'] }];
  const dup = DF.createOptions(play([['JK1', '8H', '9H', '2C'], ['3C']], [{ id: 'G1', type: 'run', side: 1, members: ['5H', '6H', 'JK2=7H'] }]), 0, ['JK1', '8H', '9H']);
  eq(dup.map((x) => x.spec.members.map((m) => m.rank).join()), ['8,9,10'], 'joker cannot reuse 7H in a second run');
});

/* ---- red / black 2 ---- */
const redState = () => play([['2H', '3C', '9S'], ['2S', '4C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', '6H'] }, { id: 'G2', type: 'run', side: 0, members: ['7H', '8H', '9H'] }]);
t('DF-2-01/02/05 red 2 steals, exhausts; invalid target rejected', () => {
  const s = good(A(redState(), { type: 'red2', player: 0, cardId: '2H', targetId: 'G1' }));
  eq(s.groups.G1.side, 0); eq(s.cards['2H'].zone, 'exhausted'); eq(s.phase, 'RED2_RESPONSE_CHAIN'); eq(s.chain.responder, 1);
  eq(s.cards['4H'].owner, 1, 'scoring owner unchanged');
  const none = play([['2H', '3C'], ['2S', '4C']], []);
  bad(A(none, { type: 'red2', player: 0, cardId: '2H', targetId: 'G1' }));
  eq(none.cards['2H'].special, 'available');
  bad(A(redState(), { type: 'red2', player: 0, cardId: '2H', targetId: 'G2' }), 'own group');
});
t('DF-2-06/07/08 counter restores; wrong actor; no chain', () => {
  let s = good(A(redState(), { type: 'red2', player: 0, cardId: '2H', targetId: 'G1' }));
  bad(A(s, { type: 'counter', player: 0, cardId: '2H' }));
  const c = good(A(s, { type: 'counter', player: 1, cardId: '2S' }));
  eq(c.groups.G1.side, 1); eq(c.phase, 'MANDATORY_PLAY'); eq(c.cards['2S'].zone, 'exhausted'); eq(c.cards['2H'].zone, 'exhausted');
  const r = A(redState(), { type: 'counter', player: 1, cardId: '2S' }); bad(r);
});
t('R2-04 / DF-SP-INT-04: groups never merge; red-on-red is refused; a second red 2 is a new action after the window closes', () => {
  const st = play([['2H', '2D', '9S'], ['2S', '4C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', '6H'] }, { id: 'G2', type: 'run', side: 0, members: ['7H', '8H', '9H'] }, { id: 'G3', type: 'set', side: 1, members: ['KH', 'KD', 'KC'] }]);
  let s = good(A(st, { type: 'red2', player: 0, cardId: '2H', targetId: 'G1' }));
  eq(Object.keys(s.groups).sort(), ['G1', 'G2', 'G3'], 'compatible G1/G2 stay separate');
  bad(A(s, { type: 'red2', player: 0, cardId: '2D', targetId: 'G3' }), 'actor cannot stack another red 2');
  bad(A(s, { type: 'red2', player: 1, cardId: '2D', targetId: 'G2' }), 'responder cannot answer with red 2');
  bad(A(s, { type: 'blackSeven', player: 1, cardId: '2S' }), 'draw-seven is not a counter (DF-SP-INT-05)');
  bad(A(s, { type: 'discard', player: 0, cardId: '9S' }), 'no ordinary play in the window (DF-SP-INT-02)');
  s = good(A(s, { type: 'passChain', player: 1 }));
  eq(s.phase, 'MANDATORY_PLAY'); eq(s.groups.G1.side, 0);
  s = good(A(s, { type: 'red2', player: 0, cardId: '2D', targetId: 'G3' })); // DF-2-03: sequential, own window
  eq(s.phase, 'RED2_RESPONSE_CHAIN'); eq(s.groups.G3.side, 0);
});
t('SP-05: special actions are only legal after the draw', () => {
  const st = play([['2H', '2S', '8C', '9S'], ['3C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', '6H'] }], { phase: 'TURN_DRAW', discard: ['KD'], draw: ['3D'] });
  bad(A(st, { type: 'red2', player: 0, cardId: '2H', targetId: 'G1' }), 'red 2 before the draw');
  bad(A(st, { type: 'blackSeven', player: 0, cardId: '2S' }), 'black 2 before the draw');
  bad(A(st, { type: 'eightTable', player: 0, eightId: '8C', targetId: '4H', placement: { kind: 'exhaust' } }), '8 before the draw');
  const drawn = good(A(st, { type: 'drawPile', player: 0 }));
  good(A(drawn, { type: 'red2', player: 0, cardId: '2H', targetId: 'G1' }));
});
t('8-SUB-05 / DF-SP-INT-10: replacing a substitute 8 sends the old 8 to the exhausted pile', () => {
  const st = play([['8C', '9S'], ['3C']], [{ id: 'G1', type: 'set', side: 1, members: ['5D', '5C', '8S=5H'] }], { subst: ['8S'] });
  const o = DF.eightPlacements(st, 0, '8C', { table: '8S' });
  eq(o.length, 1); eq(o[0].placement.kind, 'exhaust');
  const s = good(A(st, { type: 'eightTable', player: 0, eightId: '8C', targetId: '8S', placement: o[0].placement }));
  eq(s.cards['8S'].zone, 'exhausted'); eq(s.exhausted.includes('8S'), true);
  eq(s.groups.G1.members, ['5D', '5C', '8C']); eq(s.cards['8C'].logical, J(5, 'H')); eq(s.cards['8C'].subst, true);
  eq(DF.computeScores(s).table, [0, 10], 'both 8s score zero');
});

t('DF-2-12/14 black 2 draw seven + source priority 2+3+2', () => {
  const st = DF.fixture({ hands: [['2S', '2C', '3C', '4C', '9S'], ['5C', '6C']], discard: ['7C', '8C'], draw: ['9C', '10C', 'JC'] });
  const s = good(A(st, { type: 'blackSeven', player: 0, cardId: '2S' }));
  eq(s.hands[1].length, 9); eq(s.discard, []); eq(s.draw, []); eq(s.hands[0].length, 2); eq(s.cards['2S'].zone, 'exhausted');
  const again = good(A(s, { type: 'blackSeven', player: 0, cardId: '2C' }));
  yes(again, 'second black 2 allowed');
});
t('DF-SRC-06 insufficient sources → tie, scored, no bonus', () => {
  const st = DF.fixture({ hands: [['2S', '3C'], ['5C']], discard: ['7C'], draw: ['9C'] });
  const s = good(A(st, { type: 'blackSeven', player: 0, cardId: '2S' }));
  eq(s.phase, 'TIE'); eq(s.result.bonus, [0, 0]);
});

/* ---- eights ---- */
const eightBase = () => play([['8C', '9S', '9D'], ['3C']], [
  { id: 'G1', type: 'set', side: 1, members: ['5H', '5D', '5S'] },
  { id: 'G2', type: 'run', side: 0, members: ['6H', '7H', '8H'] }]);
t('DF-8-01/02/03 table substitution', () => {
  const st = eightBase();
  const opts = DF.eightPlacements(st, 0, '8C', { table: '5H' });
  yes(opts.some((o) => o.placement.groupId === 'G2'), 'run G2 offered');
  const s = good(A(st, { type: 'eightTable', player: 0, eightId: '8C', targetId: '5H', placement: { kind: 'add', groupId: 'G2', logical: J(5, 'H') } }));
  eq(s.groups.G1.members, ['8C', '5D', '5S']); eq(s.cards['8C'].logical, J(5, 'H')); eq(s.cards['8C'].subst, true); eq(s.cards['8C'].special, 'consumed');
  eq(s.groups.G2.members, ['5H', '6H', '7H', '8H']); eq(s.cards['5H'].owner, 0);
  const sc = DF.computeScores(s);
  eq(sc.table, [20, 10], 'substitute 8 scores 0; 5H scores for new owner');
});
t('DF-8-04/06/07 rejects: same group, run return, unplaceable', () => {
  bad(A(eightBase(), { type: 'eightTable', player: 0, eightId: '8C', targetId: '5H', placement: { kind: 'add', groupId: 'G1', logical: J(5, 'H') } }), 'same set, duplicate identity');
  const runs = play([['8C', '9S'], ['3C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', 'JK1=6H'] }]);
  bad(A(runs, { type: 'eightTable', player: 0, eightId: '8C', targetId: 'JK1', placement: { kind: 'add', groupId: 'G1', logical: J(7, 'H') } }), 'run exception forbidden');
  const st = eightBase();
  bad(A(st, { type: 'eightTable', player: 0, eightId: '8C', targetId: '6H', placement: { kind: 'add', groupId: 'G1', logical: J(6, 'H') } }));
  eq(st.cards['8C'].special, 'available');
});
t('DF-8-05 set-of-three exception with a joker; DF-8-12', () => {
  const st = play([['8C', '9S'], ['3C']], [{ id: 'G1', type: 'set', side: 1, members: ['5D', '5C', 'JK1=5H'] }]);
  const s = good(A(st, { type: 'eightTable', player: 0, eightId: '8C', targetId: 'JK1', placement: { kind: 'add', groupId: 'G1', logical: J(5, 'S') } }));
  eq(s.groups.G1.members.length, 4); eq(s.cards['8C'].logical, J(5, 'H'));
});
t('DF-8-15..18 discard substitution keeps order', () => {
  const st = play([['8C', '9S'], ['3C']], [{ id: 'G2', type: 'run', side: 0, members: ['6H', '7H', '8H'] }], { discard: ['9C', '5H', 'KD'] });
  const s = good(A(st, { type: 'eightDiscard', player: 0, eightId: '8C', index: 1, placement: { kind: 'add', groupId: 'G2', logical: J(5, 'H') } }));
  eq(s.discard, ['9C', '8C', 'KD']); eq(s.cards['8C'].special, 'consumed'); eq(s.groups.G2.members.length, 4);
  bad(A(st, { type: 'eightDiscard', player: 0, eightId: '8C', index: 0, placement: { kind: 'add', groupId: 'G2', logical: J(9, 'H') } }), 'unplaceable');
});

/* ---- draw / discard / turn ---- */
t('DF-DRAW indexed pickup', () => {
  const st = play([['3C', '9S'], ['4C']], [{ id: 'G1', type: 'run', side: 1, members: ['6H', '7H', '8H'] }], { phase: 'TURN_DRAW', discard: ['5H', '9C', 'KD'], draw: ['2D'] });
  const s = good(A(st, { type: 'pickupIndexed', player: 0, index: 0 }));
  eq(s.discard, []); eq(s.hands[0].length, 5); eq(s.phase, 'MANDATORY_PLAY');
  bad(A(st, { type: 'pickupIndexed', player: 0, index: 1 }), 'unplayable');
  eq(st.hands[0].length, 2);
  const top = good(A(st, { type: 'takeDiscardTop', player: 0 })); eq(top.hands[0].includes('KD'), true);
});
t('DF-TURN discard blocked by mandatory play; then allowed', () => {
  const st = play([['4H', '5H', '6H', '9S', 'KC'], ['3C']]);
  bad(A(st, { type: 'discard', player: 0, cardId: '9S' }));
  const s = good(A(st, { type: 'createGroup', player: 0, ids: ['4H', '5H', '6H'], specs: sp(['4H', '5H', '6H']) }));
  const d = good(A(s, { type: 'discard', player: 0, cardId: '9S' }));
  eq(d.current, 1); eq(d.phase, 'TURN_DRAW'); eq(d.discard, ['9S']);
});
t('DF-DRAW-08/09 empty piles: blind draw, ties', () => {
  const st = play([['9S'], ['4C', '5C']], [], { phase: 'TURN_DRAW' });
  const s = good(A(st, { type: 'blindDraw', player: 0 })); eq(s.hands[0].length, 2); eq(s.hands[1].length, 1);
  const done = DF.fixture({ hands: [[], []], phase: 'MANDATORY_PLAY' });
  const e = good(A(done, { type: 'endTurn', player: 0 }));
  eq(e.phase, 'TIE');
});

/* ---- going out ---- */
t('DF-END-01/03 go out via extension, +20 once', () => {
  const st = play([['7H'], ['3C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', '6H'] }]);
  let s = good(A(st, { type: 'addToGroup', player: 0, cardId: '7H', groupId: 'G1', logical: J(7, 'H') }));
  eq(s.phase, 'GOING_OUT_RESPONSE'); eq(s.cards['7H'].faceDown, true); eq(s.discard, ['7H']); eq(s.groups.G1.members, ['4H', '5H', '6H']);
  bad(A(s, { type: 'red2', player: 1, cardId: '2H', targetId: 'G1' }), 'red 2 not allowed in window');
  s = good(A(s, { type: 'goingOutPass', player: 1 }));
  eq(s.phase, 'GAME_OVER'); eq(s.result.final, [20, 15 - 5]); eq(s.result.out, 0);
  bad(A(s, { type: 'discard', player: 1, cardId: '3C' }));
});
t('DF-END-02 cannot go out when group would not survive', () => {
  const st = play([['4H', '5H', '6H'], ['3C']]);
  bad(A(st, { type: 'createGroup', player: 0, ids: ['4H', '5H', '6H'], specs: sp(['4H', '5H', '6H']) }));
  eq(DF.mandatoryPlays(st, 0, true).length, 0);
  good(A(st, { type: 'discard', player: 0, cardId: '4H' }));
  const four = play([['4H', '5H', '6H', '7H'], ['3C']]);
  const s = good(A(four, { type: 'createGroup', player: 0, ids: ['4H', '5H', '6H', '7H'], specs: sp(['4H', '5H', '6H', '7H']) }));
  eq(s.phase, 'GOING_OUT_RESPONSE'); eq(s.groups.G1.members.length, 3);
});
t('DF-END-04/07 black 2 continuation; 8 refused in window', () => {
  const st = play([['7H'], ['2S', '8C', '3C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', '6H'] }], { discard: ['9C', '9D'], draw: ['2D', '3D', '4D', '5D', '6D'] });
  let s = good(A(st, { type: 'addToGroup', player: 0, cardId: '7H', groupId: 'G1', logical: J(7, 'H') }));
  bad(A(s, { type: 'eightTable', player: 1, eightId: '8C', targetId: '4H' }));
  s = good(A(s, { type: 'blackSeven', player: 1, cardId: '2S' }));
  eq(s.hands[0].length, 7); eq(s.phase, 'TURN_DRAW'); eq(s.current, 0); eq(s.result, null);
  yes(s.hands[0].includes('7H'), 'face-down going-out card is the top discard and is drawn first');
});
t('DF-END-08 tie during continuation draw', () => {
  const st = play([['7H'], ['2S', '3C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', '6H'] }], { discard: [], draw: [] });
  let s = good(A(st, { type: 'addToGroup', player: 0, cardId: '7H', groupId: 'G1', logical: J(7, 'H') }));
  s = good(A(s, { type: 'blackSeven', player: 1, cardId: '2S' }));
  eq(s.phase, 'TIE'); eq(s.result.bonus, [0, 0]);
});

/* ---- scoring ---- */
t('DF-SCORE table, hand, joker, 2/8, idempotence', () => {
  const st = play([['5C', 'QH', 'AD', 'JK1', '2C', '8D'], ['9C']], [
    { id: 'G1', type: 'run', side: 1, members: ['3H', '4H', 'JK2=5H'] },
    { id: 'G2', type: 'set', side: 0, members: ['10S', '10H', '10D'] }]);
  const a = DF.computeScores(st), b = DF.computeScores(st);
  eq(a, b);
  eq(a.table, [30, 15]); eq(a.hand, [5 + 10 + 15 + 10 + 5 + 5, 5]);
});
t('DF-SCORE-14 ownership follows the placer, not the side', () => {
  const st = play([['9S'], ['3C']], [{ id: 'G1', type: 'run', side: 0, members: ['4H', '5H', '6H@1'] }]);
  eq(DF.computeScores(st).table, [10, 5]);
});
t('DF-MATCH cumulative logic', () => {
  const mk = (tot, fin) => { const s = DF.fixture({ hands: [[], []] }); s.match = { mode: 'cumulative', target: 200, totals: tot, games: 0 }; s.result = { final: fin, winner: 0 }; return DF.matchStatus(s); };
  eq(mk([100, 150], [1, 1]).over, false); eq(mk([210, 150], [1, 1]).winner, 0); eq(mk([210, 250], [1, 1]).winner, 1); eq(mk([210, 210], [1, 1]).over, false);
});

t('Specials are never forced: three 8s / three 2s / a 2 that fits a run', () => {
  const eights = play([['8H', '8D', '8C', '9S'], ['3C']]);
  eq(DF.mandatoryPlays(eights, 0, true).length, 0);
  good(A(eights, { type: 'discard', player: 0, cardId: '9S' }));
  good(A(eights, { type: 'createGroup', player: 0, ids: ['8H', '8D', '8C'], specs: sp(['8H', '8D', '8C']) })); // still allowed voluntarily
  const twos = play([['2H', '2D', '2S', 'KC'], ['3C']]);
  eq(DF.mandatoryPlays(twos, 0, true).length, 0);
  const fit = play([['2H', 'KC'], ['3C']], [{ id: 'G1', type: 'run', side: 1, members: ['3H', '4H', '5H'] }]);
  eq(DF.mandatoryPlays(fit, 0, true).length, 0); eq(DF.mandatoryPlays(fit, 0, true, true).length, 1);
  good(A(fit, { type: 'discard', player: 0, cardId: 'KC' }));
  const used = play([['8H', '8D', '8C', '9S'], ['3C']], [], { consumed: ['8H', '8D', '8C'] });
  eq(DF.mandatoryPlays(used, 0, true).length, 1, 'exhausted 8s are ordinary cards again');
  // a special picked up from the middle of the discard pile must still be placed
  const pk = play([['3C', '9S'], ['4C']], [{ id: 'G1', type: 'run', side: 1, members: ['3H', '4H', '5H'] }], { phase: 'TURN_DRAW', discard: ['2H', 'KD'], draw: ['2D'] });
  const after = good(A(pk, { type: 'pickupIndexed', player: 0, index: 0 }));
  eq(DF.mandatoryPlays(after, 0, true).length, 1);
});

t('Jokers are never forced either (screenshot case)', () => {
  const st = play([['5H', '5D', 'JK1', '9S', 'KC'], ['3C']], [{ id: 'G1', type: 'set', side: 0, members: ['7H', '7D', '7C'] }]);
  eq(DF.mandatoryPlays(st, 0, true).length, 0, 'joker could join the 5s or the 7s, but is optional');
  eq(DF.mandatoryPlays(st, 0, true, true).length > 0, true);
  good(A(st, { type: 'discard', player: 0, cardId: 'KC' }));
  // ...but a joker you picked up from the middle of the discard pile must be placed
  const pk = play([['3C', '9S'], ['4C']], [{ id: 'G1', type: 'set', side: 1, members: ['7H', '7D', '7C'] }], { phase: 'TURN_DRAW', discard: ['JK2', 'KD'], draw: ['2D'] });
  const after = good(A(pk, { type: 'pickupIndexed', player: 0, index: 0 }));
  eq(DF.mandatoryPlays(after, 0, true).length, 1);
});

t('Discarding your last card goes out (face-down); only a black 2 may answer', () => {
  const st = play([['9S'], ['2H', '2S', '3C']], [{ id: 'G1', type: 'run', side: 1, members: ['4H', '5H', '6H'] }], { draw: ['3D', '4D', '5D', '6D', '7D', '9D'] });
  let s = good(A(st, { type: 'discard', player: 0, cardId: '9S' }));
  eq(s.phase, 'GOING_OUT_RESPONSE'); eq(s.cards['9S'].faceDown, true); eq(s.goingOut.player, 0);
  bad(A(s, { type: 'red2', player: 1, cardId: '2H', targetId: 'G1' }), 'red 2 refused');
  bad(A(s, { type: 'drawPile', player: 1 }), 'no normal turn');
  const end = good(A(s, { type: 'goingOutPass', player: 1 }));
  eq(end.phase, 'GAME_OVER'); eq(end.result.bonus, [20, 0]); eq(end.cards['9S'].faceDown, false);
  const cont = good(A(s, { type: 'blackSeven', player: 1, cardId: '2S' }));
  eq(cont.phase, 'TURN_DRAW'); eq(cont.current, 0);
});

t('Stalemate tie is an opt-in house rule (off by default)', () => {
  const mk = (rule) => { const s = DF.fixture({ hands: [['4S', 'KD'], ['5S', '6S']], phase: 'MANDATORY_PLAY', discard: ['9C'] }); s.stalemateRule = rule; return s; };
  for (const rule of [false, true]) {
    let s = mk(rule);
    for (let i = 0; i < 40 && !s.result; i++) { // players just trade the single discard back and forth
      const p = DF.actor(s);
      s = good(A(s, { type: 'discard', player: p, cardId: s.hands[p][0] }));
      if (s.phase === 'TURN_DRAW') s = good(A(s, { type: 'takeDiscardTop', player: DF.actor(s) }));
    }
    eq(!!s.result, rule, rule ? 'house rule ends the stall as a tie' : 'spec: the game simply continues');
  }
});

t('Joker choices list each distinct group once, in a fixed order', () => {
  const key = (sp) => sp.type + ':' + sp.members.map((m) => m.rank + m.suit).sort().join(',');
  const noDupes = (opts, what) => { const keys = opts.filter((o) => o.spec).map((o) => key(o.spec)); eq(new Set(keys).size, keys.length, what + ' has repeated groups'); const labels = opts.map((o) => o.label); eq(new Set(labels).size, labels.length, what + ' has repeated labels'); };
  // creating a group: two jokers in hand
  for (const sel of [['5H', 'JK1', 'JK2'], ['5H', '6H', 'JK1', 'JK2'], ['5H', '5D', 'JK1', 'JK2']]) noDupes(DF.createOptions(play([[...sel, '9S'], ['3C']]), 0, sel, { checkEmpty: false }), 'create ' + sel);
  // 8 swap: removed joker + a joker in hand + real cards that could stand in for it
  const base = [{ id: 'G1', type: 'set', side: 1, members: ['5D', '5C', 'JK1=5H'] }];
  for (const hand of [['8C', 'JK2', '9S', '9D'], ['8C', '7H', '6H', 'JK2'], ['8C', 'JK2', '4S', '3S']]) {
    const opts = DF.eightPlacements(play([hand, ['3C']], base), 0, '8C', { table: 'JK1' });
    noDupes(opts, 'swap ' + hand);
  }
  // sets are always listed in suit order, whichever cards make them
  const sets = DF.eightPlacements(play([['8C', 'JK2', '9S', '9D'], ['3C']], base), 0, '8C', { table: 'JK1' }).filter((o) => o.spec && o.spec.type === 'set');
  yes(sets.length > 0 && sets.every((o) => /^New Set of 9s \(♠?♥?♦?♣?\)$/.test(o.label)), 'suit order ♠♥♦♣: ' + sets.map((o) => o.label));
  // the version that keeps the joker in hand is the one offered, and it is still playable
  const st = play([['8C', '7H', '6H', 'JK2'], ['3C']], base);
  const run = DF.eightPlacements(st, 0, '8C', { table: 'JK1' }).filter((o) => o.label === 'New Run ♥ 5-6-7');
  eq(run.length, 1); eq(run[0].spec.members.some((m) => m.id === 'JK2'), false, 'real cards used, JK2 kept');
  const s = good(A(st, { type: 'eightTable', player: 0, eightId: '8C', targetId: 'JK1', placement: run[0].placement }));
  eq(s.hands[0], ['JK2']);
});

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
