// Bot sanity tests.  node test/bot.test.js
const DF = require('../public/engine.js');
const Bot = require('../public/bot.js');

// A deliberately weak opponent: draws from the pile, makes the forced plays, discards a random card, uses no specials.
function naiveStep(s, p, R) {
  const tryAll = (list) => { for (const a of list) { const r = DF.act(s, { ...a, player: p }); if (r.ok) return r.state; } return null; };
  switch (s.phase) {
    case 'OPENING_BET': return tryAll(s.hands[p].map((id) => ({ type: 'placeBet', cardId: id })));
    case 'OPENING_SELECTION': return tryAll([{ type: 'selectOpening', choice: 'next' }]);
    case 'TURN_DRAW': return tryAll([{ type: 'drawPile' }, { type: 'takeDiscardTop' }, { type: 'blindDraw' }]);
    case 'MANDATORY_PLAY': {
      const m = DF.mandatoryPlays(s, p, true)[0];
      if (m) return tryAll([m.kind === 'add' ? { type: 'addToGroup', cardId: m.cardId, groupId: m.groupId, logical: m.logical } : { type: 'createGroup', ids: m.ids, specs: m.specs.members }]);
      const h = s.hands[p].slice().sort(() => R() - .5);
      return tryAll(h.length ? h.map((id) => ({ type: 'discard', cardId: id })) : [{ type: 'endTurn' }]);
    }
    case 'RED2_RESPONSE_CHAIN': return tryAll([{ type: 'passChain' }]);
    case 'GOING_OUT_RESPONSE': return tryAll([{ type: 'goingOutPass' }]);
  }
  return null;
}
function lcg(seed) { let x = seed; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 4294967296; }

function play(seed, botSeats, naive) {
  let s = DF.newGame({ seed }), steps = 0; const R = lcg(seed);
  while (!s.result && steps++ < 4000) {
    const p = DF.actor(s);
    const next = botSeats.includes(p) ? Bot.step(s, p) : naiveStep(s, p, R);
    if (!next) throw new Error('stuck in ' + s.phase + ' seed ' + seed);
    s = next;
  }
  return { s, steps, done: !!s.result };
}

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('✗ ' + m); } };

// 1. bot vs bot always finishes
let finished = 0, N = 150, tot = 0;
for (let i = 1; i <= N; i++) { const r = play(i, [0, 1]); if (r.done) finished++; tot += r.steps; }
console.log(`bot vs bot: ${finished}/${N} games finished, avg ${(tot / N) | 0} steps`);
ok(finished >= N * 0.9, 'bot-vs-bot games should almost always finish');

// 2. bot vs naive: bot should win clearly more often (alternate seats)
let botWins = 0, naiveWins = 0, draws = 0, margin = 0;
for (let i = 1; i <= 200; i++) {
  const seat = i % 2, r = play(1000 + i, [seat]);
  if (!r.done) continue;
  const f = r.s.result.final, d = f[seat] - f[1 - seat];
  margin += d; if (d > 0) botWins++; else if (d < 0) naiveWins++; else draws++;
}
console.log(`bot vs naive: bot ${botWins}, naive ${naiveWins}, draws ${draws}, avg margin ${(margin / 200).toFixed(1)}`);
ok(botWins > naiveWins * 1.5, 'bot should beat a naive player convincingly');

console.log(fails ? `${fails} failed` : 'bot tests passed');
process.exit(fails ? 1 : 0);
