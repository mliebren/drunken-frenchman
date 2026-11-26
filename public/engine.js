/* Drunken Frenchman — game engine (implements Formal Game-Engine Spec v1.0)
 *
 * Pure, deterministic, seedable. State is plain JSON. Every action is applied to a
 * clone of the state, so a rejected action can never leave a partial change behind
 * (atomic validation / rollback). Works in the browser (window.DF) and Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ constants */
  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const SUIT_BET = { S: 4, H: 3, D: 2, C: 1 }; // Spades > Hearts > Diamonds > Clubs
  const RLAB = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const rl = (r) => RLAB[r] || String(r);
  const isRed = (suit) => suit === 'H' || suit === 'D';

  class GameError extends Error {}
  const fail = (m) => { throw new GameError(m); };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ------------------------------------------------------------------ cards */
  function parseId(id) {
    if (id.startsWith('JK')) return { joker: true, rank: null, suit: null };
    const suit = id.slice(-1), r = id.slice(0, -1);
    return { joker: false, suit, rank: { J: 11, Q: 12, K: 13, A: 14 }[r] || +r };
  }
  function makeCard(id) {
    const p = parseId(id);
    return {
      id, joker: p.joker, rank: p.rank, suit: p.suit, zone: 'draw', owner: null,
      logical: null, groupId: null, subst: false, faceDown: false,
      special: !p.joker && (p.rank === 2 || p.rank === 8) ? 'available' : 'na',
    };
  }
  function allIds() {
    const ids = [];
    for (const su of SUITS) for (let r = 2; r <= 14; r++) ids.push(rl(r) + su);
    ids.push('JK1', 'JK2');
    return ids;
  }
  const cardName = (c) => (c.joker ? 'Joker' : rl(c.rank) + SUIT_SYM[c.suit]);
  const lname = (l) => rl(l.rank) + SUIT_SYM[l.suit];
  const isRed2 = (c) => !c.joker && c.rank === 2 && isRed(c.suit);
  const isBlack2 = (c) => !c.joker && c.rank === 2 && !isRed(c.suit);
  const isEight = (c) => !c.joker && c.rank === 8;
  const specialActive = (c) => c.special === 'available';

  /* ------------------------------------------------------------------ RNG */
  function rnd(s) { // mulberry32, state kept in the game state so replays are exact
    s.rng = (s.rng + 0x6D2B79F5) >>> 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function shuffle(s, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd(s) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ------------------------------------------------------------------ state helpers */
  const other = (p) => 1 - p;
  const nm = (s, p) => s.names[p];
  const logp = (s, t) => { s.log.push(t); if (s.log.length > 300) s.log.shift(); };

  function detach(s, id) {
    s.hands.forEach((h) => { const k = h.indexOf(id); if (k >= 0) h.splice(k, 1); });
    for (const k of ['draw', 'discard', 'exhausted']) { const i = s[k].indexOf(id); if (i >= 0) s[k].splice(i, 1); }
    const c = s.cards[id];
    if (c.groupId && s.groups[c.groupId]) {
      const g = s.groups[c.groupId], i = g.members.indexOf(id);
      if (i >= 0) g.members.splice(i, 1);
    }
    c.groupId = null; c.logical = null; c.zone = 'transient'; c.faceDown = false;
  }
  function toHand(s, p, id) {
    detach(s, id);
    const c = s.cards[id];
    s.hands[p].push(id); c.zone = 'hand'; c.owner = p;
  }
  function toDiscardTop(s, id, faceDown) {
    detach(s, id);
    const c = s.cards[id];
    c.zone = 'discard'; c.owner = null; c.faceDown = !!faceDown; c.subst = false;
    s.discard.push(id);
  }
  function exhaust(s, id) {
    detach(s, id);
    const c = s.cards[id];
    c.zone = 'exhausted'; c.special = 'consumed'; c.owner = null;
    s.stale = 0;
    s.exhausted.push(id);
  }

  /* ------------------------------------------------------------------ new game / deal */
  function newGame(opts = {}) {
    const s = {
      v: 1,
      rng: ((opts.seed !== undefined ? opts.seed : Math.floor(Math.random() * 4294967296)) >>> 0),
      names: opts.names || ['Player 1', 'Player 2'],
      match: opts.match || { mode: 'single', target: 200, totals: [0, 0], games: 0 },
      cards: {}, hands: [[], []], draw: [], discard: [], exhausted: [],
      groups: {}, nextGroupId: 1,
      bets: [null, null], pool: null, opening: null,
      phase: 'OPENING_BET', current: 0, drawn: false, turnNo: 0,
      chain: null, goingOut: null, result: null, redeals: 0, log: [],
      stalemateRule: !!opts.stalemateRule, stale: 0, // optional house rule, OFF by default (not part of the spec)
    };
    const ids = allIds();
    ids.forEach((id) => { s.cards[id] = makeCard(id); });
    for (;;) { // Hand-of-Crap redeal loop: no attempt limit
      const deck = shuffle(s, ids.slice());
      const h0 = deck.slice(0, 13), h1 = deck.slice(13, 26);
      const ok = (h) => h.some((id) => { const c = s.cards[id]; return c.joker || c.rank === 2 || c.rank === 8; });
      if (ok(h0) && ok(h1)) {
        s.hands = [h0, h1]; s.draw = deck.slice(26);
        break;
      }
      s.redeals++;
    }
    s.hands.forEach((h, p) => h.forEach((id) => { s.cards[id].zone = 'hand'; s.cards[id].owner = p; }));
    s.draw.forEach((id) => { s.cards[id].zone = 'draw'; });
    // reveal the top draw card into the temporary pool
    const rev = s.draw.shift();
    s.pool = { revealed: rev }; s.cards[rev].zone = 'pool';
    if (s.redeals) logp(s, `Hand of Crap: ${s.redeals} redeal(s) before a valid deal.`);
    logp(s, 'Cards dealt. Place your opening bets.');
    return s;
  }

  /* ------------------------------------------------------------------ groups */
  function classify(specs) { // specs: [{id,rank,suit}] -> {type,members(ordered)} | null
    const n = specs.length;
    if (n < 3) return null;
    const r0 = specs[0].rank;
    if (specs.every((x) => x.rank === r0)) {
      if (n > 4 || new Set(specs.map((x) => x.suit)).size !== n) return null;
      return { type: 'set', members: specs.slice() };
    }
    const s0 = specs[0].suit;
    if (n <= 13 && specs.every((x) => x.suit === s0)) {
      const sorted = specs.slice().sort((a, b) => a.rank - b.rank);
      for (let i = 1; i < n; i++) if (sorted[i].rank !== sorted[i - 1].rank + 1) return null; // Ace high only, no wrap
      return { type: 'run', members: sorted };
    }
    return null;
  }
  function combos(arr, k) {
    if (k === 0) return [[]];
    const out = [];
    for (let i = 0; i <= arr.length - k; i++) for (const rest of combos(arr.slice(i + 1), k - 1)) out.push([arr[i], ...rest]);
    return out;
  }
  // every legal way to form one group from these cards (jokers get all workable identities)
  function inferSpecs(cards) {
    const reals = cards.filter((c) => !c.joker), jokers = cards.filter((c) => c.joker), n = cards.length;
    const out = [];
    if (n < 3 || n > 13 || reals.length === 0) return out;
    const rs = (c) => ({ id: c.id, rank: c.rank, suit: c.suit });
    if (n <= 4 && reals.every((c) => c.rank === reals[0].rank) && new Set(reals.map((c) => c.suit)).size === reals.length) {
      const free = SUITS.filter((su) => !reals.some((c) => c.suit === su));
      for (const pick of combos(free, jokers.length)) {
        out.push({ type: 'set', members: [...reals.map(rs), ...jokers.map((j, i) => ({ id: j.id, rank: reals[0].rank, suit: pick[i] }))] });
      }
    }
    if (reals.every((c) => c.suit === reals[0].suit) && new Set(reals.map((c) => c.rank)).size === reals.length) {
      const suit = reals[0].suit;
      for (let st = 2; st + n - 1 <= 14; st++) {
        if (!reals.every((c) => c.rank >= st && c.rank <= st + n - 1)) continue;
        let ji = 0; const members = [];
        for (let r = st; r < st + n; r++) {
          const real = reals.find((c) => c.rank === r);
          members.push(real ? rs(real) : { id: jokers[ji++].id, rank: r, suit });
        }
        out.push({ type: 'run', members });
      }
    }
    return out;
  }
  // a logical identity may appear once among sets and once among runs ("opposite type" exception)
  function identityConflict(s, type, rank, suit) {
    for (const g of Object.values(s.groups)) {
      if (g.type !== type) continue;
      for (const id of g.members) { const l = s.cards[id].logical; if (l && l.rank === rank && l.suit === suit) return true; }
    }
    return false;
  }
  function addOptions(s, cardId, g) {
    const c = s.cards[cardId], opts = [];
    const mem = g.members.map((i) => s.cards[i].logical);
    if (g.type === 'set') {
      if (mem.length >= 4) return opts;
      const rank = mem[0].rank, used = new Set(mem.map((l) => l.suit));
      const suits = c.joker ? SUITS.filter((x) => !used.has(x)) : (c.rank === rank && !used.has(c.suit) ? [c.suit] : []);
      suits.forEach((su) => opts.push({ rank, suit: su }));
    } else {
      if (mem.length >= 13) return opts;
      const suit = mem[0].suit, lo = mem[0].rank, hi = mem[mem.length - 1].rank, cand = [];
      if (lo - 1 >= 2) cand.push(lo - 1);
      if (hi + 1 <= 14) cand.push(hi + 1);
      cand.forEach((r) => { if (c.joker || (c.suit === suit && c.rank === r)) opts.push({ rank: r, suit }); });
    }
    return opts.filter((o) => !identityConflict(s, g.type, o.rank, o.suit));
  }
  function putInGroup(s, p, id, g, logical) {
    const c = s.cards[id];
    detach(s, id);
    c.zone = 'group'; c.groupId = g.id; c.logical = { rank: logical.rank, suit: logical.suit }; c.owner = p;
    s.stale = 0;
    g.members.push(id);
    if (g.type === 'run') g.members.sort((x, y) => s.cards[x].logical.rank - s.cards[y].logical.rank);
  }
  function buildGroup(s, p, specs) {
    specs.forEach((m) => {
      const c = s.cards[m.id];
      if (!c) fail('Unknown card.');
      if (!c.joker && (c.rank !== m.rank || c.suit !== m.suit)) fail('Only jokers may take another identity.');
      if (c.joker && (!SUITS.includes(m.suit) || !(m.rank >= 2 && m.rank <= 14))) fail('Choose a rank and suit for the joker.');
    });
    const cl = classify(specs);
    if (!cl) fail('Those cards do not form a legal set or run.');
    if (cl.members.some((m) => identityConflict(s, cl.type, m.rank, m.suit))) fail('That identity is already used by another ' + cl.type + ' on the table.');
    const g = { id: 'G' + s.nextGroupId++, type: cl.type, side: p, members: [] };
    s.groups[g.id] = g;
    cl.members.forEach((m) => putInGroup(s, p, m.id, g, m));
    return g;
  }
  function validWithout(s, g, id) {
    if (g.members.length - 1 < 3) return false;
    if (g.type === 'run') { const i = g.members.indexOf(id); return i === 0 || i === g.members.length - 1; }
    return true;
  }
  function groupLabel(s, g) {
    const mem = g.members.map((i) => s.cards[i].logical);
    if (g.type === 'set') return 'Set of ' + rl(mem[0].rank) + 's';
    return 'Run ' + SUIT_SYM[mem[0].suit] + ' ' + rl(mem[0].rank) + '–' + rl(mem[mem.length - 1].rank);
  }
  function specLabel(sp) {
    const jok = sp.members.filter((m) => m.joker);
    if (sp.type === 'set') return 'Set of ' + rl(sp.members[0].rank) + 's (' + sp.members.map((m) => SUIT_SYM[m.suit]).join('') + ')';
    return 'Run ' + SUIT_SYM[sp.members[0].suit] + ' ' + sp.members.map((m) => rl(m.rank)).join('-');
  }

  /* ------------------------------------------------------------------ creation / mandatory-play search */
  // can a group created from ALL remaining hand cards survive the going-out card removal?
  function goOutCandidatesFor(sp, orderIds) {
    const n = sp.members.length;
    if (n < 4) return [];
    const ordered = orderIds.slice().reverse(); // last placed first
    return ordered.filter((id) => {
      if (sp.type === 'set') return true;
      const i = sp.members.findIndex((m) => m.id === id);
      return i === 0 || i === n - 1;
    });
  }
  function creationSpecs(s, p, ids, checkEmpty) {
    const cards = ids.map((i) => s.cards[i]);
    let list = inferSpecs(cards).filter((sp) => !sp.members.some((m) => identityConflict(s, sp.type, m.rank, m.suit)));
    if (checkEmpty && ids.length === s.hands[p].length) list = list.filter((sp) => goOutCandidatesFor(sp, ids).length);
    return list;
  }
  // Jokers and unused 2s/8s are never forced into a group (the player may keep them for their powers).
  // The card picked up from the middle of the discard pile is the exception: it must be placed.
  const isOptionalCard = (s, c) => (c.joker || ((c.rank === 2 || c.rank === 8) && c.special === 'available')) && c.id !== s.mustPlay;
  function mandatoryPlays(s, p, firstOnly, includeSpecials) {
    const hand = s.hands[p], found = [];
    const skip = (id) => !includeSpecials && isOptionalCard(s, s.cards[id]);
    for (const id of hand) {
      if (skip(id)) continue;
      for (const g of Object.values(s.groups)) {
        const o = addOptions(s, id, g);
        if (o.length) { found.push({ kind: 'add', cardId: id, groupId: g.id, logical: o[0] }); if (firstOnly) return found; }
      }
    }
    const n = hand.length;
    for (let i = 0; i < n - 2; i++) for (let j = i + 1; j < n - 1; j++) for (let k = j + 1; k < n; k++) {
      const ids = [hand[i], hand[j], hand[k]];
      if (ids.some(skip)) continue;
      const sp = creationSpecs(s, p, ids, true);
      if (sp.length) { found.push({ kind: 'create', ids, specs: sp[0] }); if (firstOnly) return found; }
    }
    return found;
  }
  function placeable(s, p, id) { // can this hand card be placed ordinarily right now?
    for (const g of Object.values(s.groups)) if (addOptions(s, id, g).length) return true;
    const others = s.hands[p].filter((x) => x !== id);
    for (let i = 0; i < others.length - 1; i++) for (let j = i + 1; j < others.length; j++) {
      if (creationSpecs(s, p, [id, others[i], others[j]], true).length) return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ scoring */
  const cardValue = (rank) => (rank === 14 ? 15 : rank >= 10 ? 10 : 5);
  function computeScores(s) { // pure: never mutates, safe to call repeatedly
    const table = [0, 0], hand = [0, 0];
    for (const c of Object.values(s.cards)) {
      if (c.zone === 'group') { if (!c.subst) table[c.owner] += cardValue(c.logical.rank); }
      else if (c.zone === 'hand') hand[c.owner] += c.joker ? 10 : cardValue(c.rank);
    }
    return { table, hand, net: [table[0] - hand[0], table[1] - hand[1]] };
  }
  function finish(s, o) {
    if (s.result) return; // scored exactly once
    const sc = computeScores(s), bonus = [0, 0];
    if (!o.tie && o.out !== undefined && o.out !== null) bonus[o.out] = 20;
    const final = [sc.net[0] + bonus[0], sc.net[1] + bonus[1]];
    s.phase = o.tie ? 'TIE' : 'GAME_OVER';
    s.result = { tie: !!o.tie, out: o.out === undefined ? null : o.out, table: sc.table, hand: sc.hand, bonus, final,
      winner: final[0] === final[1] ? null : (final[0] > final[1] ? 0 : 1), reason: o.reason || '' };
    s.match.totals = [s.match.totals[0] + final[0], s.match.totals[1] + final[1]];
    s.match.games++;
    s.chain = null;
    Object.values(s.cards).forEach((c) => { c.faceDown = false; });
    logp(s, o.tie ? 'The game ends in a tie condition and is scored immediately.' : nm(s, o.out) + ' went out (+20).');
  }
  function matchStatus(s) {
    const m = s.match, r = s.result;
    if (!r) return { over: false };
    if (m.mode !== 'cumulative') return { over: true, winner: r.winner };
    const [a, b] = m.totals, ra = a >= m.target, rb = b >= m.target;
    if (!ra && !rb) return { over: false };
    if (a === b) return { over: false };
    if (ra && !rb) return { over: true, winner: 0 };
    if (rb && !ra) return { over: true, winner: 1 };
    return { over: true, winner: a > b ? 0 : 1 };
  }

  /* ------------------------------------------------------------------ phases / actors */
  function actor(s) {
    switch (s.phase) {
      case 'OPENING_BET': return s.bets[0] === null ? 0 : 1;
      case 'OPENING_SELECTION': return s.opening.winner;
      case 'TURN_DRAW': case 'MANDATORY_PLAY': return s.current;
      case 'RED2_RESPONSE_CHAIN': return s.chain.responder;
      case 'GOING_OUT_RESPONSE': return other(s.goingOut.player);
      default: return null;
    }
  }
  function enterTurnDraw(s) {
    s.phase = 'TURN_DRAW'; s.drawn = false; s.turnNo++; s.mustPlay = null;
    const c = s.current, o = other(c);
    if (s.draw.length === 0 && s.hands[0].length === 0 && s.hands[1].length === 0) return finish(s, { tie: true, reason: 'Both hands and the draw pile are empty.' });
    if (s.draw.length === 0 && s.discard.length === 0 && s.hands[o].length === 0) return finish(s, { tie: true, reason: 'No card source is left to draw from.' });
    // Optional house rule (off unless chosen at setup): with the draw pile empty and no card played or used for six rounds, end in a tie.
    if (s.stalemateRule && s.draw.length === 0) {
      s.stale++;
      if (s.stale >= 12) return finish(s, { tie: true, reason: 'Stalemate house rule: the draw pile is empty and nothing has been played for six rounds.' });
    } else s.stale = 0;
  }
  function req(s, a, phases) {
    if (s.result) fail('The game is over.');
    if (!phases.includes(s.phase)) fail('That action is not allowed right now.');
    if (actor(s) !== a.player) fail('It is not your action.');
  }
  const inHand = (s, p, id) => { if (!s.hands[p].includes(id)) fail('That card is not in your hand.'); return s.cards[id]; };

  /* ------------------------------------------------------------------ draw sources (spec §15) */
  function drawN(s, victim, n) { // returns false if sources are insufficient (tie), no card moves in that case
    const o = other(victim);
    if (s.discard.length + s.draw.length + s.hands[o].length < n) return false;
    let left = n;
    while (left > 0 && s.discard.length) { toHand(s, victim, s.discard[s.discard.length - 1]); left--; }
    while (left > 0 && s.draw.length) { toHand(s, victim, s.draw[0]); left--; }
    while (left > 0 && s.hands[o].length) { toHand(s, victim, s.hands[o][Math.floor(rnd(s) * s.hands[o].length)]); left--; }
    return true;
  }

  /* ------------------------------------------------------------------ red-2 helpers */
  // R2-02: a red 2 may target any intact group currently on the opponent's side.
  function red2Targets(s, p) {
    return Object.values(s.groups).filter((g) => g.side === other(p)).map((g) => g.id);
  }
  // SP-06: when the window closes the red 2 stands; control returns to the player whose turn it is.
  function closeChain(s) { const ph = s.chain.resume; s.chain = null; s.phase = ph; }

  /* ------------------------------------------------------------------ action handlers */
  const H = {};

  H.placeBet = (s, a) => {
    req(s, a, ['OPENING_BET']);
    inHand(s, a.player, a.cardId);
    detach(s, a.cardId); s.cards[a.cardId].zone = 'pool';
    s.bets[a.player] = a.cardId;
    if (s.bets[0] !== null && s.bets[1] !== null) {
      const key = (id) => { const c = s.cards[id]; return c.joker ? (id === 'JK1' ? 1 : 0) : 10 + c.rank * 10 + SUIT_BET[c.suit]; };
      const w = key(s.bets[0]) > key(s.bets[1]) ? 0 : 1;
      s.opening = { winner: w }; s.phase = 'OPENING_SELECTION';
      logp(s, `Bets revealed: ${nm(s, 0)} ${cardName(s.cards[s.bets[0]])}, ${nm(s, 1)} ${cardName(s.cards[s.bets[1]])}. ${nm(s, w)} wins the bet.`);
    }
  };

  H.selectOpening = (s, a) => {
    req(s, a, ['OPENING_SELECTION']);
    const w = s.opening.winner, canon = [s.pool.revealed, s.bets[0], s.bets[1]];
    let picked, rest;
    if (a.choice === 'next') { if (!s.draw.length) fail('The draw pile is empty.'); picked = s.draw[0]; rest = canon; }
    else {
      const idx = { revealed: 0, bet0: 1, bet1: 2 }[a.choice];
      if (idx === undefined) fail('Choose a card.');
      picked = canon[idx]; rest = canon.filter((_, i) => i !== idx);
    }
    toHand(s, w, picked);
    rest.forEach((id) => { detach(s, id); s.cards[id].zone = 'draw'; s.cards[id].owner = null; s.draw.push(id); }); // canonical order to the bottom
    s.pool = null; s.bets = [null, null]; s.opening = null;
    s.current = w; s.phase = 'MANDATORY_PLAY'; s.drawn = true; s.turnNo = 1; s.mustPlay = null;
    logp(s, `${nm(s, w)} takes their opening card and starts the first turn.`);
  };

  H.drawPile = (s, a) => {
    req(s, a, ['TURN_DRAW']);
    if (!s.draw.length) fail('The draw pile is empty.');
    toHand(s, a.player, s.draw[0]);
    s.drawn = true; s.phase = 'MANDATORY_PLAY';
    logp(s, `${nm(s, a.player)} draws from the pile.`);
  };
  H.takeDiscardTop = (s, a) => {
    req(s, a, ['TURN_DRAW']);
    if (!s.discard.length) fail('The discard pile is empty.');
    const id = s.discard[s.discard.length - 1];
    toHand(s, a.player, id); s.lastTaken = id;
    s.drawn = true; s.phase = 'MANDATORY_PLAY';
    logp(s, `${nm(s, a.player)} takes the top discard (${cardName(s.cards[id])}).`);
  };
  H.pickupIndexed = (s, a) => {
    req(s, a, ['TURN_DRAW']);
    const i = a.index, sel = s.discard[i];
    if (sel === undefined) fail('No such discard.');
    if (s.cards[sel].faceDown) fail('That card is face-down.');
    const taken = s.discard.slice(i);
    taken.forEach((id) => toHand(s, a.player, id));
    if (!placeable(s, a.player, sel)) fail(`${cardName(s.cards[sel])} cannot be legally placed this turn, so that pickup is not allowed.`);
    s.drawn = true; s.phase = 'MANDATORY_PLAY'; s.mustPlay = sel; s.lastTaken = sel;
    logp(s, `${nm(s, a.player)} picks up ${taken.length} card(s) from the discard pile, starting at ${cardName(s.cards[sel])}.`);
  };
  H.blindDraw = (s, a) => {
    req(s, a, ['TURN_DRAW']);
    if (s.draw.length || s.discard.length) fail('Other sources still have cards.');
    const o = other(a.player);
    if (!s.hands[o].length) return finish(s, { tie: true, reason: 'No card source is left to draw from.' });
    const blind = s.hands[o][Math.floor(rnd(s) * s.hands[o].length)];
    toHand(s, a.player, blind); s.lastTaken = blind;
    s.drawn = true; s.phase = 'MANDATORY_PLAY';
    logp(s, `${nm(s, a.player)} draws a random card from ${nm(s, o)}'s hand.`);
  };

  function afterPlay(s, p, orderIds) {
    if (s.hands[p].length) return;
    // hand emptied by ordinary placement -> going out (last placed card goes face-down)
    for (const id of orderIds.slice().reverse()) {
      const c = s.cards[id], g = s.groups[c.groupId];
      if (g && validWithout(s, g, id)) {
        toDiscardTop(s, id, true);
        s.goingOut = { player: p, cardId: id };
        s.phase = 'GOING_OUT_RESPONSE';
        logp(s, `${nm(s, p)} has emptied their hand and goes out! One card is discarded face-down.`);
        return;
      }
    }
    fail('You cannot empty your hand that way: the group would not survive losing its going-out card.');
  }

  H.createGroup = (s, a) => {
    req(s, a, ['MANDATORY_PLAY']);
    const p = a.player, ids = a.ids;
    if (new Set(ids).size !== ids.length) fail('Duplicate card.');
    ids.forEach((id) => inHand(s, p, id));
    if (!a.specs || a.specs.length !== ids.length || !ids.every((id) => a.specs.some((m) => m.id === id))) fail('Mismatched group.');
    const cl = classify(a.specs);
    if (cl && ids.length === s.hands[p].length && !goOutCandidatesFor(cl, ids).length) fail('You cannot empty your hand that way: the group would not survive losing its going-out card.');
    const g = buildGroup(s, p, a.specs);
    logp(s, `${nm(s, p)} lays down ${groupLabel(s, g)}.`);
    afterPlay(s, p, ids);
  };
  H.addToGroup = (s, a) => {
    req(s, a, ['MANDATORY_PLAY']);
    const p = a.player, c = inHand(s, p, a.cardId), g = s.groups[a.groupId];
    if (!g) fail('No such group.');
    const opt = addOptions(s, a.cardId, g).find((o) => a.logical && o.rank === a.logical.rank && o.suit === a.logical.suit);
    if (!opt) fail('That card does not fit that group.');
    putInGroup(s, p, a.cardId, g, opt);
    logp(s, `${nm(s, p)} adds ${cardName(c)}${c.joker ? ' (as ' + lname(opt) + ')' : ''} to ${groupLabel(s, g)}.`);
    afterPlay(s, p, [a.cardId]);
  };

  H.discard = (s, a) => {
    req(s, a, ['MANDATORY_PLAY']);
    inHand(s, a.player, a.cardId);
    if (mandatoryPlays(s, a.player, true).length) fail('You still have a mandatory play to make before you can discard.');
    const last = s.hands[a.player].length === 1;
    toDiscardTop(s, a.cardId, last); // discarding your last card is going out: it is discarded face-down
    if (last) {
      s.goingOut = { player: a.player, cardId: a.cardId };
      s.phase = 'GOING_OUT_RESPONSE';
      logp(s, `${nm(s, a.player)} discards the last card face-down and goes out! Only a black 2 can answer.`);
      return;
    }
    logp(s, `${nm(s, a.player)} discards ${cardName(s.cards[a.cardId])}.`);
    s.current = other(a.player); enterTurnDraw(s);
  };
  H.endTurn = (s, a) => { // only possible with an empty hand (nothing to discard)
    req(s, a, ['MANDATORY_PLAY']);
    if (s.hands[a.player].length) fail('Discard a card to finish your turn.');
    logp(s, `${nm(s, a.player)} has no cards to discard and ends their turn.`);
    s.current = other(a.player); enterTurnDraw(s);
  };

  /* ---- red 2 (R2-01..R2-09) ---- */
  H.red2 = (s, a) => {
    req(s, a, ['MANDATORY_PLAY']); // SP-05: only after the draw, before the discard
    const p = a.player, c = inHand(s, p, a.cardId);
    if (!isRed2(c) || !specialActive(c)) fail('You need an unused red 2.');
    const tgt = s.groups[a.targetId];
    if (!tgt || tgt.side !== other(p)) fail("Target one of your opponent's groups."); // R2-02 / R2-09
    const fromSide = tgt.side;
    exhaust(s, c.id);                // SP-03: exhausted immediately, even if countered later
    tgt.side = p;                    // R2-03: the whole group moves; per-card scoring owners are unchanged
    s.chain = { actor: p, responder: other(p), targetId: tgt.id, fromSide, resume: s.phase }; // R2-05: counter window
    s.phase = 'RED2_RESPONSE_CHAIN';
    logp(s, `${nm(s, p)} plays a red 2 and takes ${groupLabel(s, tgt)}!`);
  };
  H.counter = (s, a) => {
    req(s, a, ['RED2_RESPONSE_CHAIN']); // R2-05 / SP-INT-04: only a black 2 may answer a red 2
    const p = a.player, c = inHand(s, p, a.cardId);
    if (!isBlack2(c) || !specialActive(c)) fail('You need an unused black 2.');
    if (s.chain.actor === p) fail('You cannot counter your own red 2.'); // B2-02
    exhaust(s, c.id);
    s.groups[s.chain.targetId].side = s.chain.fromSide; // R2-07: only the transfer is reversed
    logp(s, `${nm(s, p)} counters with a black 2 — the group goes back.`);
    closeChain(s);
  };
  H.passChain = (s, a) => {
    req(s, a, ['RED2_RESPONSE_CHAIN']);
    logp(s, `${nm(s, a.player)} does not respond. The red 2 stands.`); // R2-08
    closeChain(s);
  };

  H.goingOutPass = (s, a) => {
    req(s, a, ['GOING_OUT_RESPONSE']);
    finish(s, { out: s.goingOut.player });
  };

  /* ---- black 2 draw seven ---- */
  H.blackSeven = (s, a) => {
    req(s, a, ['MANDATORY_PLAY', 'GOING_OUT_RESPONSE']); // SP-05
    const p = a.player, c = inHand(s, p, a.cardId);
    if (!isBlack2(c) || !specialActive(c)) fail('You need an unused black 2.');
    const victim = other(p), inWindow = s.phase === 'GOING_OUT_RESPONSE';
    exhaust(s, c.id);
    logp(s, `${nm(s, p)} plays a black 2: ${nm(s, victim)} must draw seven.`);
    if (!drawN(s, victim, 7)) return finish(s, { tie: true, reason: 'Fewer than seven cards were available to draw.' });
    if (inWindow) { // game resumes with the player who went out; no +20 yet
      s.goingOut = null; s.current = victim; enterTurnDraw(s);
    }
  };

  /* ---- eight substitution ---- */
  function applyPlacement(s, p, fid, pl, sameGroupId) {
    if (!pl) fail('Choose where the removed card goes.');
    if (pl.kind === 'add') {
      const g = s.groups[pl.groupId];
      if (!g) fail('No such group.');
      if (sameGroupId === g.id && !(g.type === 'set' && g.members.length === 3)) fail('The removed card cannot go back into the group it came from.');
      const ok = addOptions(s, fid, g).find((o) => pl.logical && o.rank === pl.logical.rank && o.suit === pl.logical.suit);
      if (!ok) fail('The removed card cannot be legally placed there.');
      putInGroup(s, p, fid, g, ok);
    } else if (pl.kind === 'create') {
      const ids = pl.specs.map((m) => m.id);
      if (!ids.includes(fid)) fail('The removed card must be part of the new group.');
      ids.filter((i) => i !== fid).forEach((i) => inHand(s, p, i));
      if (sameGroupId) { /* new group is always a different group */ }
      buildGroup(s, p, pl.specs);
    } else fail('Choose where the removed card goes.');
  }
  H.eightTable = (s, a) => {
    req(s, a, ['MANDATORY_PLAY']); // SP-05
    const p = a.player, e = inHand(s, p, a.eightId);
    if (!isEight(e) || !specialActive(e)) fail('You need an unused 8.');
    const t = s.cards[a.targetId];
    if (!t || t.zone !== 'group') fail('Pick a card that is in a group on the table.');
    const g = s.groups[t.groupId], idx = g.members.indexOf(t.id), L = clone(t.logical);
    detach(s, e.id);
    t.groupId = null; t.logical = null;
    g.members[idx] = e.id;
    e.zone = 'group'; e.groupId = g.id; e.logical = L; e.subst = true; e.owner = p; e.special = 'consumed';
    const wasSubstitute = t.subst;
    t.zone = 'transient'; t.subst = false; t.owner = null; t.faceDown = false;
    if (wasSubstitute) exhaust(s, t.id); // 8-SUB-05 / SP-INT-10: the old substitute 8 leaves play; there is no card to re-place
    else applyPlacement(s, p, t.id, a.placement, g.id);
    logp(s, `${nm(s, p)} plays an 8 to swap out ${wasSubstitute ? 'a substitute 8' : t.joker ? 'a joker' : cardName(t)} from ${groupLabel(s, g)}.`);
  };
  H.eightDiscard = (s, a) => {
    req(s, a, ['MANDATORY_PLAY']); // SP-05
    const p = a.player, e = inHand(s, p, a.eightId);
    if (!isEight(e) || !specialActive(e)) fail('You need an unused 8.');
    const sel = s.discard[a.index];
    if (sel === undefined) fail('No such discard.');
    if (s.cards[sel].faceDown) fail('That card is face-down.');
    detach(s, e.id);
    s.discard[a.index] = e.id;
    e.zone = 'discard'; e.special = 'consumed'; e.owner = null; e.faceDown = false;
    const sc = s.cards[sel]; sc.zone = 'transient'; sc.owner = null;
    applyPlacement(s, p, sel, a.placement, null);
    logp(s, `${nm(s, p)} plays an 8 into the discard pile, taking ${cardName(sc)}.`);
  };

  function act(state, a) {
    const s = clone(state);
    try {
      const h = H[a.type];
      if (!h) fail('Unknown action.');
      h(s, a);
      return { ok: true, state: s };
    } catch (e) {
      if (e instanceof GameError) return { ok: false, error: e.message };
      throw e;
    }
  }

  /* ------------------------------------------------------------------ queries for the UI */
  function describeSpec(sp) { return { spec: sp, label: specLabel(sp) }; }
  function createOptions(s, p, ids, opts = {}) {
    return creationSpecs(s, p, ids, opts.checkEmpty !== false).map(describeSpec);
  }
  function addChoices(s, cardId, groupId) { return addOptions(s, cardId, s.groups[groupId]); }
  function eightPlacements(s, p, eightId, target) { // target: {table: cardId} | {discard: index}
    const s2 = clone(s);
    let fid, sameGroup = null;
    try {
      const e = s2.cards[eightId];
      detach(s2, eightId);
      if (target.table) {
        const t = s2.cards[target.table];
        if (!t || t.zone !== 'group') return [];
        const g = s2.groups[t.groupId], idx = g.members.indexOf(t.id), L = clone(t.logical);
        t.groupId = null; t.logical = null; g.members[idx] = e.id;
        e.zone = 'group'; e.groupId = g.id; e.logical = L; e.subst = true; e.owner = p; e.special = 'consumed';
        if (t.subst) return [{ placement: { kind: 'exhaust' }, label: 'Swap in (the old substitute 8 leaves play)' }];
        t.zone = 'transient'; t.subst = false; fid = t.id; sameGroup = g.id;
      } else {
        fid = s2.discard[target.discard];
        if (fid === undefined || s2.cards[fid].faceDown) return [];
        s2.discard[target.discard] = e.id; e.zone = 'discard'; e.special = 'consumed';
        s2.cards[fid].zone = 'transient';
      }
    } catch (x) { return []; }
    const out = [];
    for (const g of Object.values(s2.groups)) {
      if (sameGroup === g.id && !(g.type === 'set' && g.members.length === 3)) continue;
      for (const o of addOptions(s2, fid, g)) out.push({ placement: { kind: 'add', groupId: g.id, logical: o }, label: 'Add to ' + groupLabel(s2, g) + (s2.cards[fid].joker ? ' as ' + lname(o) : ''), groupId: g.id });
    }
    const hand = s2.hands[p];
    for (let i = 0; i < hand.length - 1; i++) for (let j = i + 1; j < hand.length; j++) {
      creationSpecs(s2, p, [fid, hand[i], hand[j]], false).forEach((sp) => out.push({ placement: { kind: 'create', specs: sp.members }, label: 'New ' + specLabel(sp), spec: sp }));
    }
    return out;
  }
  function eightTargetCards(s) { return Object.values(s.cards).filter((c) => c.zone === 'group').map((c) => c.id); }
  function specialsFor(s, p) {
    const hand = s.hands[p].map((i) => s.cards[i]).filter(specialActive);
    return { red2: hand.filter(isRed2).map((c) => c.id), black2: hand.filter(isBlack2).map((c) => c.id), eights: hand.filter(isEight).map((c) => c.id) };
  }

  /* ------------------------------------------------------------------ test fixtures */
  // fixture({hands:[[ids],[ids]], draw:[], discard:[], groups:[{id,type,side,members:['5H','JK1=7H']}],
  //          exhausted:[], consumed:[], phase, current, drawn, seed})
  function fixture(o) {
    const s = newGame({ seed: o.seed || 1, names: o.names });
    s.redeals = 0; s.log = [];
    for (const c of Object.values(s.cards)) { c.zone = 'exhausted'; c.owner = null; c.logical = null; c.groupId = null; c.subst = false; c.faceDown = false; c.special = (!c.joker && (c.rank === 2 || c.rank === 8)) ? 'available' : 'na'; }
    s.hands = [[], []]; s.draw = []; s.discard = []; s.exhausted = Object.keys(s.cards); s.groups = {}; s.pool = null;
    const put = (id) => { s.exhausted = s.exhausted.filter((x) => x !== id); };
    (o.hands || [[], []]).forEach((h, p) => h.forEach((id) => { put(id); s.hands[p].push(id); s.cards[id].zone = 'hand'; s.cards[id].owner = p; }));
    (o.draw || []).forEach((id) => { put(id); s.draw.push(id); s.cards[id].zone = 'draw'; });
    (o.discard || []).forEach((id) => { put(id); s.discard.push(id); s.cards[id].zone = 'discard'; });
    (o.groups || []).forEach((g) => {
      const grp = { id: g.id, type: g.type, side: g.side, members: [] };
      s.groups[g.id] = grp;
      g.members.forEach((m) => {
        const mm = m.match(/^([0-9JQKA]+[SHDC]|JK\d)(?:=([0-9JQKA]+[SHDC]))?(?:@(\d))?$/);
        if (!mm) throw new Error('bad fixture member ' + m);
        const id = mm[1], lg = mm[2], own = mm[3]; const c = s.cards[id]; put(id);
        const l = lg ? { rank: parseId(lg).rank, suit: parseId(lg).suit } : { rank: c.rank, suit: c.suit };
        c.zone = 'group'; c.groupId = g.id; c.logical = l; c.owner = own !== undefined ? +own : g.side;
        grp.members.push(id);
      });
      s.nextGroupId = Math.max(s.nextGroupId, +g.id.replace(/\D/g, '') + 1 || 1);
    });
    (o.consumed || []).forEach((id) => { s.cards[id].special = 'consumed'; });
    (o.subst || []).forEach((id) => { s.cards[id].subst = true; s.cards[id].special = 'consumed'; });
    s.exhausted.forEach((id) => { s.cards[id].zone = 'exhausted'; });
    s.phase = o.phase || 'MANDATORY_PLAY'; s.current = o.current || 0; s.drawn = o.drawn !== undefined ? o.drawn : s.phase === 'MANDATORY_PLAY';
    s.bets = [null, null]; s.opening = null; s.chain = null; s.goingOut = null; s.result = null;
    return s;
  }

  return {
    SUITS, SUIT_SYM, SUIT_NAME, rl, isRed, cardName, lname, cardValue,
    newGame, act, actor, fixture, clone,
    computeScores, matchStatus, mandatoryPlays, placeable,
    createOptions, addChoices, eightPlacements, eightTargetCards, specialsFor, red2Targets,
    groupLabel, specLabel, isRed2, isBlack2, isEight, specialActive, classify, inferSpecs,
  };
});
