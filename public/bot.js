/* Drunken Frenchman — bot opponent.
 *
 * The bot plays through exactly the same engine actions as a human (DF.act), so it can never
 * break a rule. It only looks at its own hand plus public information (table, discard pile,
 * piles, opponent hand SIZE) — never the opponent's cards.
 *
 * Bot.plan(state, seat) returns a list of candidate actions, best first. Callers try them in
 * order until one is accepted, so a heuristic misjudgement can never stall the game.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Bot = factory(root.DF);
})(typeof self !== 'undefined' ? self : this, function (DF) {
  'use strict';

  const val = (r) => (r === 14 ? 15 : r >= 10 ? 10 : 5);
  const penalty = (c) => (c.joker ? 10 : val(c.rank));
  const isSpecial = (c) => !c.joker && (c.rank === 2 || c.rank === 8) && c.special === 'available';
  const handOf = (s, p) => s.hands[p].map((id) => s.cards[id]);
  const fitsTable = (s, c) => Object.values(s.groups).some((g) => DF.addChoices(s, c.id, g.id).length > 0);

  // How much a card helps the rest of the hand (pairs, neighbours in suit, table fits, jokers).
  function synergy(s, c, hand) {
    if (c.joker) return 6;
    let sc = 0;
    for (const o of hand) {
      if (o.id === c.id) continue;
      if (o.joker) { sc += 0.6; continue; }
      if (o.rank === c.rank) sc += 1.5;
      else if (o.suit === c.suit) { const d = Math.abs(o.rank - c.rank); if (d === 1) sc += 1.5; else if (d === 2) sc += 0.8; }
    }
    if (fitsTable(s, c)) sc += 3;
    return sc;
  }

  /* ---------------------------------------------------------------- opening */
  function planBet(s, p) {
    const hand = handOf(s, p);
    const scored = hand.map((c) => ({ c, v: c.joker ? -100 : (isSpecial(c) ? -60 : c.rank - 3 * synergy(s, c, hand)) }));
    scored.sort((a, b) => b.v - a.v);
    return scored.map((x) => ({ type: 'placeBet', cardId: x.c.id }));
  }
  function planSelection(s, p) {
    const hand = handOf(s, p);
    const opts = [['revealed', s.pool.revealed], ['bet0', s.bets[0]], ['bet1', s.bets[1]]].map(([k, id]) => {
      const c = s.cards[id];
      const v = c.joker ? 10 : synergy(s, c, [...hand, c]) * 2 + (isSpecial(c) ? 3 : 0) - penalty(c) * 0.1;
      return { k, v };
    });
    opts.push({ k: 'next', v: 3.5 });
    opts.sort((a, b) => b.v - a.v);
    return opts.map((o) => ({ type: 'selectOpening', choice: o.k }));
  }

  /* ---------------------------------------------------------------- drawing */
  function planDraw(s, p) {
    const cands = [];
    if (s.discard.length) {
      const top = s.discard[s.discard.length - 1], r = DF.act(s, { type: 'takeDiscardTop', player: p });
      // pointless if the bot would only discard that same card again (this also prevents endless swap loops)
      const back = r.ok && !DF.mandatoryPlays(r.state, p, true).length ? planDiscard(r.state, p)[0] : null;
      if (r.ok && !(back && back.cardId === top)) {
        const c = s.cards[top], hand = handOf(r.state, p);
        let v;
        if (c.joker) v = 12;
        else if (DF.placeable(r.state, p, top)) v = val(c.rank) * 1.2 + 4;
        else v = synergy(r.state, c, hand) * 2.2 + (isSpecial(c) ? 3 : 0) - 0.3 * penalty(c);
        cands.push({ a: { type: 'takeDiscardTop' }, v });
      }
    }
    for (let i = 0; i < s.discard.length - 1; i++) {
      const picked = s.discard.length - i;
      if (picked > 6) continue;
      const r = DF.act(s, { type: 'pickupIndexed', player: p, index: i });
      if (!r.ok) continue;
      const sel = s.cards[s.discard[i]], hand = handOf(r.state, p);
      let v = val(sel.joker ? 8 : sel.rank) * 1.2 + 4;
      for (let k = i + 1; k < s.discard.length; k++) {
        const c = s.cards[s.discard[k]], sy = synergy(r.state, c, hand);
        v += sy - (sy < 1.5 ? 0.35 * penalty(c) : 0);
      }
      cands.push({ a: { type: 'pickupIndexed', index: i }, v: v - 1.5 * (picked - 1) });
    }
    cands.sort((a, b) => b.v - a.v);
    const out = [];
    if (s.draw.length) {
      if (!cands.length || cands[0].v < 6) out.push({ type: 'drawPile' });
      cands.forEach((c) => out.push(c.a));
      if (!out.some((a) => a.type === 'drawPile')) out.push({ type: 'drawPile' });
    } else {
      cands.forEach((c) => out.push(c.a));
    }
    out.push({ type: 'takeDiscardTop' }, { type: 'blindDraw' });
    return out;
  }

  /* ---------------------------------------------------------------- special cards */
  function groupPointsAgainst(s, g, opp) {
    return g.members.reduce((t, id) => { const c = s.cards[id]; return t + (c.owner === opp && !c.subst ? val(c.logical.rank) : 0); }, 0);
  }
  function planSpecial(s, p) {
    const opp = 1 - p, sp = DF.specialsFor(s, p), hand = s.hands[p];

    // Red 2: steal a rich group
    if (sp.red2.length) {
      const targets = DF.red2Targets(s, p)
        .map((id) => ({ id, pts: groupPointsAgainst(s, s.groups[id], opp) })).sort((a, b) => b.pts - a.pts);
      if (targets.length && targets[0].pts >= 25) {
        return { type: 'red2', cardId: sp.red2[0], targetId: targets[0].id };
      }
    }
    // Black 2: make the opponent draw seven when they are close to going out (keep one black 2 to counter otherwise)
    if (sp.black2.length) {
      const avail = s.discard.length + s.draw.length + hand.length - 1;
      if (avail >= 9 && (s.hands[opp].length <= 5 || sp.black2.length >= 2)) return { type: 'blackSeven', cardId: sp.black2[0] };
    }
    // 8: swap out a high-value card that the opponent owns (or grab a good discard)
    if (sp.eights.length) {
      const threshold = hand.length <= 6 ? 15 : 20;
      let best = null;
      const consider = (target, gain) => {
        if (gain < threshold || (best && best.gain >= gain)) return;
        const opts = DF.eightPlacements(s, p, sp.eights[0], target);
        if (!opts.length) return;
        const adds = opts.filter((o) => o.placement.kind === 'add');
        const pick = (adds.length ? adds : opts).slice().sort((a, b) => ((b.placement.logical || {}).rank || 0) - ((a.placement.logical || {}).rank || 0))[0];
        best = { gain, target, placement: pick.placement };
      };
      for (const id of DF.eightTargetCards(s)) {
        const c = s.cards[id];
        if (c.owner === opp && !c.subst) consider({ table: id }, 2 * val(c.logical.rank) + 5);
      }
      s.discard.forEach((id, i) => { const c = s.cards[id]; if (!c.faceDown) consider({ discard: i }, val(c.joker ? 8 : c.rank) + 5 - 2 * Math.min(2, s.discard.length - 1 - i)); });
      if (best) {
        return best.target.table
          ? { type: 'eightTable', eightId: sp.eights[0], targetId: best.target.table, placement: best.placement }
          : { type: 'eightDiscard', eightId: sp.eights[0], index: best.target.discard, placement: best.placement };
      }
    }
    return null;
  }

  /* ---------------------------------------------------------------- ordinary plays & discard */
  function bestSpec(s, p, ids) { // choose joker identities that score the most
    const opts = DF.createOptions(s, p, ids);
    if (!opts.length) return null;
    opts.sort((a, b) => b.spec.members.reduce((t, m) => t + val(m.rank), 0) - a.spec.members.reduce((t, m) => t + val(m.rank), 0));
    return opts[0].spec.members;
  }
  function planPlay(s, p) {
    let plays = DF.mandatoryPlays(s, p, false);
    // Late in the game an unused 2/8 is worth more on the table (+5) than in hand (-5): play it ordinarily.
    if (!plays.length && s.hands[p].length <= 5) plays = DF.mandatoryPlays(s, p, false, true);
    if (!plays.length) return [];
    const usesJoker = (pl) => (pl.kind === 'add' ? [pl.cardId] : pl.ids).some((id) => s.cards[id].joker);
    const rank = (pl) => (pl.kind === 'add' ? 0 : 10) + (usesJoker(pl) ? 20 : 0) - (pl.kind === 'create' ? pl.ids.reduce((t, id) => t + (s.cards[id].joker ? 0 : val(s.cards[id].rank)), 0) / 10 : 0);
    plays.sort((a, b) => rank(a) - rank(b));
    const out = [];
    for (const pl of plays) {
      if (pl.kind === 'add') {
        const ch = DF.addChoices(s, pl.cardId, pl.groupId).sort((a, b) => b.rank - a.rank);
        ch.forEach((lg) => out.push({ type: 'addToGroup', cardId: pl.cardId, groupId: pl.groupId, logical: lg }));
      } else {
        const specs = bestSpec(s, p, pl.ids);
        if (specs) out.push({ type: 'createGroup', ids: pl.ids, specs });
      }
    }
    return out;
  }
  function planDiscard(s, p) {
    const hand = handOf(s, p);
    if (!hand.length) return [{ type: 'endTurn' }];
    return hand.map((c) => {
      let v = penalty(c) - 5 * synergy(s, c, hand);
      if (c.joker) v -= 60; else if (isSpecial(c)) v -= 18;
      return { c, v };
    }).sort((a, b) => b.v - a.v).map((x) => ({ type: 'discard', cardId: x.c.id }));
  }
  // With the draw pile empty a forced take-then-discard of the same card can repeat forever.
  // If the card just taken is also the worst card, discard the next-worst so the cards keep circulating.
  function planDiscardAvoidingLoop(s, p) {
    const list = planDiscard(s, p);
    if (s.draw.length === 0 && list.length > 1 && list[0].cardId === s.lastTaken) list.push(list.shift());
    return list;
  }

  /* ---------------------------------------------------------------- windows */
  // A red 2 was played against the bot: counter it with a black 2 when the stolen group is worth it (R2-05 / R2-07).
  function planChain(s, p) {
    const sp = DF.specialsFor(s, p), g = s.groups[s.chain.targetId];
    const worth = g && groupPointsAgainst(s, g, p) >= 15;
    const out = [];
    if (worth || sp.black2.length >= 2) sp.black2.forEach((id) => out.push({ type: 'counter', cardId: id }));
    out.push({ type: 'passChain' });
    return out;
  }
  function planGoingOut(s, p) {
    const sp = DF.specialsFor(s, p);
    return [...sp.black2.map((id) => ({ type: 'blackSeven', cardId: id })), { type: 'goingOutPass' }];
  }

  /* ---------------------------------------------------------------- entry point */
  function plan(s, p) {
    if (s.result || DF.actor(s) !== p) return [];
    switch (s.phase) {
      case 'OPENING_BET': return planBet(s, p);
      case 'OPENING_SELECTION': return planSelection(s, p);
      case 'TURN_DRAW': return planDraw(s, p); // SP-05: special actions only after the draw
      case 'MANDATORY_PLAY': {
        const sp = planSpecial(s, p);
        return [...(sp ? [sp] : []), ...planPlay(s, p), ...planDiscardAvoidingLoop(s, p)];
      }
      case 'RED2_RESPONSE_CHAIN': return planChain(s, p);
      case 'GOING_OUT_RESPONSE': return planGoingOut(s, p);
      default: return [];
    }
  }
  // apply the first candidate the engine accepts; returns the new state or null
  function step(s, p) {
    for (const a of plan(s, p)) {
      const r = DF.act(s, { ...a, player: p });
      if (r.ok) return r.state;
    }
    return null;
  }

  return { plan, step };
});
