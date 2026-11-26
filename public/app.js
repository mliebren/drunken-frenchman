/* Drunken Frenchman — browser UI. All rules live in engine.js; this file only renders
 * state and turns clicks into engine actions. Pass-and-play: whenever the engine's next
 * actor is not the person holding the device, a hand-over screen hides everything. */
(() => {
  'use strict';
  const SYM = DF.SUIT_SYM, rl = DF.rl;
  const $app = document.getElementById('app');
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let G = null; // engine state
  const BOT = 1; // in single-player mode the human is seat 0, the bot is seat 1
  let botTimer = null;
  const ui = { botError: false, vsBot: false, seat: null, sel: [], mode: null, pick: null, choice: null, msg: null, modal: null, log: false, sort: 'suit', hint: null,
    setup: { n0: 'Player 1', n1: 'Player 2', opp: 'bot', stalemate: false, mode: 'single', target: 200, seed: '' } };

  /* ------------------------------------------------------------ persistence */
  const KEY = 'drunken-frenchman-save-v1';
  const save = () => { try { if (G) localStorage.setItem(KEY, JSON.stringify({ G, seat: ui.seat, vsBot: ui.vsBot })); } catch (e) { /* ignore */ } };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
  const clearSave = () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } };

  /* ------------------------------------------------------------ card rendering */
  const PIPS = (() => {
    const six = [[32, 22], [68, 22], [32, 50], [68, 50], [32, 78], [68, 78]];
    return {
      2: [[50, 22], [50, 78]], 3: [[50, 22], [50, 50], [50, 78]], 4: [[32, 22], [68, 22], [32, 78], [68, 78]],
      5: [[32, 22], [68, 22], [50, 50], [32, 78], [68, 78]], 6: six, 7: [...six, [50, 36]], 8: [...six, [50, 36], [50, 64]],
      9: [[32, 21], [68, 21], [32, 40], [68, 40], [50, 50], [32, 60], [68, 60], [32, 79], [68, 79]],
      10: [[32, 21], [68, 21], [50, 30], [32, 40], [68, 40], [32, 60], [68, 60], [50, 70], [32, 79], [68, 79]],
    };
  })();

  function faceInner(rank, suit) {
    const sym = SYM[suit], lab = rl(rank);
    let body;
    if (rank === 14) body = `<span class="pip ace" style="left:50%;top:50%">${sym}</span>`;
    else if (rank >= 11) body = `<span class="fc"><span class="s a">${sym}</span><span class="big">${lab}</span><span class="s b">${sym}</span></span>`;
    else body = PIPS[rank].map(([x, y]) => `<span class="pip${y > 50 ? ' f' : ''}" style="left:${x}%;top:${y}%">${sym}</span>`).join('');
    const ix = `<span class="ix"><b>${lab}</b><i>${sym}</i></span>`;
    return ix + body + ix.replace('class="ix"', 'class="ix br"');
  }

  // c: engine card (or {rank,suit} synthetic); o: {size, cls, attr, back, hidden, as}
  function cardHTML(c, o = {}) {
    const size = o.size || 'md';
    if (o.back) return `<button type="button" class="card back ${size} ${o.hidden ? 'hid' : ''} ${o.cls || ''}" ${o.attr || ''} tabindex="${o.attr ? 0 : -1}"><span class="bk"></span></button>`;
    const label = c.joker ? 'Joker' : rl(c.rank) + SYM[c.suit];
    if (c.joker) {
      const asBadge = c.logical ? `<span class="as${DF.isRed(c.logical.suit) ? ' r' : ''}">as ${rl(c.logical.rank)}${SYM[c.logical.suit]}</span>` : '';
      return `<button type="button" class="card joker ${size} ${o.cls || ''}" ${o.attr || ''} aria-label="Joker"><span class="jk"><span class="star">★</span><span class="jt">JOKER</span></span>${asBadge}</button>`;
    }
    const red = DF.isRed(c.suit) ? 'red' : '';
    let badge = '';
    if (o.as) badge = `<span class="as${DF.isRed(o.as.suit) ? ' r' : ''}">${esc(o.as.text)}</span>`;
    else if (c.subst && c.logical) badge = `<span class="as${DF.isRed(c.logical.suit) ? ' r' : ''}">as ${rl(c.logical.rank)}${SYM[c.logical.suit]}</span>`;
    return `<button type="button" class="card ${red} ${size} ${c.subst ? 'subst' : ''} ${o.cls || ''}" ${o.attr || ''} aria-label="${label}">${faceInner(c.rank, c.suit)}${badge}</button>`;
  }
  // card as it appears inside an option preview (joker shows the identity it would take)
  function specCard(m, size) {
    const c = G.cards[m.id];
    if (c && c.joker) return cardHTML({ rank: m.rank, suit: m.suit }, { size, as: { suit: m.suit, text: '★ joker' } });
    return cardHTML(c, { size });
  }
  const miniSpec = (members) => `<span class="mini">${members.map((m) => specCard(m, 'xs')).join('')}</span>`;

  /* ------------------------------------------------------------ helpers */
  const me = () => ui.seat;
  // Log lines are written in the third person ("Anna plays…"); when the human's name is "You", fix the grammar.
  const VERBS = { plays: 'play', adds: 'add', discards: 'discard', lays: 'lay', picks: 'pick', draws: 'draw', takes: 'take', does: 'do', has: 'have', goes: 'go', wins: 'win', counters: 'counter', swaps: 'swap', emptied: 'emptied' };
  function logLine(l) {
    if (!(G && G.names[0] === 'You')) return l;
    return l.replace(/\bYou (\w+)/g, (m, v) => 'You ' + (VERBS[v] || v)).replace(/\bYou go out/g, 'You go out').replace(/\btheir\b/g, (m, off, str) => (/\bYou\b/.test(str.slice(0, off)) && !/Marcel/.test(str.slice(0, off)) ? 'your' : m));
  }
  const youVerb = (p, third, base) => (G.names[p] === 'You' ? base : third);
  const nm = (p) => esc(G.names[p]);
  // Ordinary cards by rank, then suit; cards with a special role (jokers, unused 2s and 8s) are kept together at the right end.
  const isSpecialCard = (c) => c.joker || (c.special === 'available' && (c.rank === 2 || c.rank === 8));
  const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };
  const sortHand = (ids) => {
    const cs = ids.map((id) => G.cards[id]);
    const normal = cs.filter((c) => !isSpecialCard(c)).sort((x, y) => x.rank - y.rank || SUIT_ORDER[x.suit] - SUIT_ORDER[y.suit]);
    const special = cs.filter(isSpecialCard).sort((x, y) => (x.joker ? 0 : 1) - (y.joker ? 0 : 1) || (x.rank || 0) - (y.rank || 0) || SUIT_ORDER[x.suit || 'S'] - SUIT_ORDER[y.suit || 'S']);
    return [...normal, ...special].map((c) => c.id);
  };
  const toast = (text, err = true) => { ui.msg = { text, err }; render(); };

  function act(a) {
    const r = DF.act(G, { ...a, player: ui.seat });
    if (!r.ok) { toast(r.error); return false; }
    G = r.state; ui.msg = null; ui.sel = []; ui.mode = null; ui.pick = null; ui.hint = null; ui.modal = null; ui.choice = null;
    save(); render();
    return true;
  }
  function openModal(title, body, actions) { ui.modal = { title, body, actions }; render(); }
  const closeModal = () => { ui.modal = null; render(); };
  function chooseModal(title, intro, options) {
  ui.modal = {
    title,
    body: `<p>${intro}</p><div class="opts">${options.map((o, i) =>
      `<div class="optrow">
        <div class="optinfo">${o.html}</div>
        <button type="button" class="btn small" data-act="modalopt" data-i="${i}">Choose</button>
      </div>`
    ).join('')}</div>`,
    actions: [{ label: 'Cancel', ghost: true, fn: closeModal }],
    options
  };
  render();
}

  /* ------------------------------------------------------------ screens */
  function setupScreen() {
    const s = ui.setup, saved = load();
    return `<div class="center"><div class="panel">
      <h1>Drunken Frenchman</h1>
      <p>A two-player rummy-style card game. Play a friend on one shared screen (hands stay hidden behind a hand-over screen) or take on the bot.</p>
      <div class="field"><label>Opponent</label>
        <div class="row">
          <label><input type="radio" name="opp" value="bot" data-bind="opp" data-rerender="1" ${s.opp === 'bot' ? 'checked' : ''}> Play against the bot</label>
          <label><input type="radio" name="opp" value="human" data-bind="opp" data-rerender="1" ${s.opp === 'human' ? 'checked' : ''}> Another person (pass-and-play)</label>
        </div>
      </div>
      <div class="row">
        <div class="field" style="flex:1"><label for="n0">${s.opp === 'bot' ? 'Your name' : 'First player'}</label><input id="n0" type="text" maxlength="18" value="${esc(s.n0)}" data-bind="n0"></div>
        ${s.opp === 'bot' ? '' : `<div class="field" style="flex:1"><label for="n1">Second player</label><input id="n1" type="text" maxlength="18" value="${esc(s.n1)}" data-bind="n1"></div>`}
      </div>
      <div class="field"><label>Format</label>
        <div class="row">
          <label><input type="radio" name="mode" value="single" data-bind="mode" ${s.mode === 'single' ? 'checked' : ''}> Single game</label>
          <label><input type="radio" name="mode" value="cumulative" data-bind="mode" ${s.mode === 'cumulative' ? 'checked' : ''}> Match, first to
            <input type="number" min="20" step="10" value="${s.target}" data-bind="target" style="width:84px;background:#0d2a2a;border:1px solid #3e6b5e;border-radius:6px;color:inherit;padding:4px 6px"> points</label>
        </div>
      </div>
      <div class="field"><label><input type="checkbox" data-bind="stalemate" ${s.stalemate ? 'checked' : ''}> House rule: end a stalled game in a tie (draw pile empty and nothing played for six rounds). Off by default — not part of the rulebook.</label></div>
      <div class="field"><label for="seed">Shuffle seed (optional — the same seed gives the same deal)</label><input id="seed" type="text" value="${esc(s.seed)}" data-bind="seed" placeholder="leave blank for a random deal"></div>
      <div class="row" style="margin-top:14px">
        <button class="btn" data-act="start">Deal the cards</button>
        ${saved && saved.G && !saved.G.result ? '<button class="btn ghost" data-act="resume">Resume saved game</button>' : ''}
        <button class="btn ghost" data-act="rules">How to play</button>
      </div></div></div>${ui.modal ? modalHTML() : ''}`;
  }

  function handoffScreen(p) {
    const why = {
      OPENING_BET: G.bets[0] === null ? 'Choose your opening bet.' : 'Choose your opening bet. (The other bet stays hidden.)',
      OPENING_SELECTION: 'You won the bet — choose your opening card.',
      TURN_DRAW: 'It is your turn.', MANDATORY_PLAY: 'It is your turn.',
      RED2_RESPONSE_CHAIN: 'A red 2 was played. You may respond.',
      GOING_OUT_RESPONSE: G.goingOut ? `${esc(G.names[G.goingOut.player])} has gone out. You may respond with a black 2.` : '',
    }[G.phase] || '';
    return `<div class="center handoff"><div class="panel">
      <p style="color:#e9cfd6">Pass the device to</p>
      <h2>${nm(p)}</h2>
      <p>${why}</p>
      <button class="btn" data-act="seat" data-p="${p}" style="font-size:17px;padding:12px 26px">I’m ${nm(p)} — show my cards</button>
      <p style="margin-top:18px"><button class="btn ghost small" data-act="menu">Quit to menu</button></p>
    </div></div>`;
  }

  function header() {
    const sc = DF.computeScores(G), m = G.match, cur = DF.actor(G);
    const box = (p) => `<div class="sb ${cur === p ? 'turn' : ''}"><div class="n">${nm(p)}</div><div class="s">${G.phase === 'OPENING_BET' || G.phase === 'OPENING_SELECTION' ? 'Opening bet' : 'On table: ' + sc.table[p]}${m.mode === 'cumulative' ? ' · Match ' + m.totals[p] : ''}</div></div>`;
    return `<div class="top"><div class="brand">Drunken Frenchman</div>
      <div class="scoreboard">${box(0)}${box(1)}</div>
      ${m.mode === 'cumulative' ? `<div class="match">First to ${m.target}</div>` : ''}
      <button class="btn ghost small" data-act="togglelog">Log</button>
      <button class="btn ghost small" data-act="rules">Rules</button>
      <button class="btn ghost small" data-act="menu">Menu</button></div>`;
  }

  /* ---- hand ---- */
  function handHTML(p, opts = {}) {
    const ids = sortHand(G.hands[p]);
    const must = ui.hint ? new Set(ui.hint.ids) : new Set();
    const firstSpecial = ids.findIndex((id) => isSpecialCard(G.cards[id]));
    const cards = ids.map((id, i) => (i === firstSpecial && i > 0 ? '<span class="hdiv" title="Special cards: jokers, 2s and 8s"></span>' : '') + cardHTML(G.cards[id], {
      size: 'lg', cls: (ui.sel.includes(id) ? 'sel ' : '') + (must.has(id) ? 'must' : ''), attr: `data-act="hand" data-id="${id}"`,
    })).join('');
    return `<div class="handwrap"><div class="hand">${cards}</div>
      <div class="sorter"><span class="hint">${G.hands[p].length} card${G.hands[p].length === 1 ? '' : 's'}</span>${firstSpecial >= 0 ? '<span class="hint">Specials on the right</span>' : ''}</div></div>`;
  }
  const backsHTML = (n) => `<div class="backs">${Array.from({ length: Math.min(n, 12) }, () => cardHTML(null, { back: true, size: 'xs' })).join('')}</div>`;

  /* ---- table ---- */
  function groupHTML(g, ownerFilter = null) {
  const m = me(), cardsAttr = (id) => `data-act="gcard" data-id="${id}" data-g="${g.id}`;
  let can = false;
  if (ui.mode && ui.mode.kind === 'red2') can = DF.red2Targets(G, m).includes(g.id);
  else if (!ui.mode && ui.sel.length === 1 && G.phase === 'MANDATORY_PLAY') can = DF.addChoices(G, ui.sel[0], g.id).length > 0;
  const hint = ui.hint && ui.hint.groupId === g.id;

  const members = ownerFilter === null
    ? g.members
    : g.members.filter((id) => G.cards[id].owner === ownerFilter);

  if (!members.length) return '';

  return `<div class="grp ${can ? 'can' : ''} ${hint ? 'hint' : ''}" data-act="group" data-g="${g.id}">
    <div class="gl">${esc(DF.groupLabel(G, g))}${can && !ui.mode ? ' — click to add' : ''}${can && ui.mode ? ' — click to take' : ''}</div>
    <div class="cs">${members.map((id) => cardHTML(G.cards[id], { size: 'sm', attr: cardsAttr(id) })).join('')}</div></div>`;
}
function sideHTML(p, mineSide) {
  const sc = DF.computeScores(G);
  const gs = Object.values(G.groups).filter((g) =>
    g.members.some((id) => G.cards[id].owner === p)
  );
  const over = !!G.result;

  return `<section class="side"><div class="sidehead"><span class="who">${nm(p)}${mineSide && !ui.vsBot ? ' (you)' : ''}</span>
    <span class="chip">${G.hands[p].length} in hand</span><span class="chip">${sc.table[p]} on table</span>
    ${!mineSide && !over ? backsHTML(G.hands[p].length) : ''}
    ${over ? `<span class="hint">hand: ${G.hands[p].map((id) => DF.cardName(G.cards[id])).join(' ') || 'empty'}</span>` : ''}</div>
    <div class="groups">${gs.length ? gs.map((g) => groupHTML(g, p)).join('') : '<span class="empty">No groups on this side yet.</span>'}</div></section>`;
}
  function pilesHTML() {
    const turn = G.phase === 'TURN_DRAW' && DF.actor(G) === me();
    const canDraw = turn && G.draw.length > 0;
    const pickFrom = ui.pick;
    const dr = G.discard.map((id, i) => {
      const c = G.cards[id];
      const cls = (pickFrom === i ? 'dpick ' : '') + (pickFrom !== null && i > pickFrom ? 'dtake ' : '') + ((turn || (ui.mode && ui.mode.kind === 'eight')) && !c.faceDown ? 'click' : '');
      return c.faceDown ? cardHTML(c, { back: true, size: 'sm', hidden: true }) : cardHTML(c, { size: 'sm', cls, attr: `data-act="dcard" data-i="${i}"` });
    }).join('');
    const used = G.exhausted.map((id) => G.cards[id]).filter((c) => c.special === 'consumed');
    return `<section class="mid">
      <div class="pile"><div style="position:relative;display:inline-block">${G.draw.length ? cardHTML(null, { back: true, size: 'md', cls: canDraw ? 'click' : '', attr: canDraw ? 'data-act="drawpile"' : '' }) : '<span class="empty">empty</span>'}<span class="count">${G.draw.length}</span></div><div class="cap">Draw pile${canDraw ? ' — click to draw' : ''}</div></div>
      <div class="discard"><div class="dh">Discard pile (oldest → newest)${turn && G.discard.length ? ' — click a card to pick it up along with every card above it' : ''}</div><div class="drow">${dr || '<span class="empty">empty</span>'}</div></div>
      <div class="pile"><div class="used">${used.length ? used.map((c) => cardHTML(c, { size: 'xs' })).join('') : '<span class="empty">none</span>'}</div><div class="cap">Used cards (out of play)</div></div>
    </section>`;
  }

  /* ---- dock ---- */
  function specialButtons() {
    const m = me(), sp = DF.specialsFor(G, m), out = [];
    const inTurn = G.phase === 'MANDATORY_PLAY'; // SP-05: special actions only after the draw
    if (inTurn) {
      sp.red2.forEach((id) => out.push(`<button class="btn wine small" data-act="red2" data-id="${id}" ${DF.red2Targets(G, m).length ? '' : 'disabled title="No target group"'}>Red 2 ${SYM[G.cards[id].suit]}: take a group</button>`));
      sp.black2.forEach((id) => out.push(`<button class="btn wine small" data-act="seven" data-id="${id}">Black 2 ${SYM[G.cards[id].suit]}: ${esc(G.names[1 - m])} draws seven</button>`));
      sp.eights.forEach((id) => out.push(`<button class="btn wine small" data-act="eight" data-id="${id}">8 ${SYM[G.cards[id].suit]}: swap a card</button>`));
    }
    return out.join('');
  }
  function dockHTML() {
    const m = me(), ph = G.phase, name = nm(m);
    let status = '', btns = '';
    const msg = ui.msg ? `<div class="status ${ui.msg.err ? 'err' : ''}">${esc(ui.msg.text)}</div>` : '';
    if (G.result) return '';
    if (botTurn()) {
      const berr = ui.msg && ui.msg.err ? `<div class="status err">${esc(ui.msg.text)} <button class="btn small" data-act="botretry">Try again</button></div>` : '';
      return `<div class="dock">${latestHTML()}${berr}<div class="status"><b>${nm(BOT)}</b> is thinking…</div>${handHTML(m)}</div>`;
    }
    if (ui.mode && ui.mode.kind === 'red2') {
      status = `<b>Red 2:</b> click one of ${nm(1 - m)}’s groups to take it.`;
      btns = `<button class="btn ghost" data-act="cancel">Cancel</button>`;
    } else if (ui.mode && ui.mode.kind === 'eight') {
      status = `<b>8:</b> click a card in any group on the table, or a card in the discard pile. That card is swapped out; it must be placed right away.`;
      btns = `<button class="btn ghost" data-act="cancel">Cancel</button>`;
    } else if (ph === 'TURN_DRAW') {
      status = `${name}, draw a card: from the pile, the top discard, or pick up deeper in the discard pile.`;
      const noSrc = !G.draw.length && !G.discard.length;
      btns = `<button class="btn" data-act="drawpile" ${G.draw.length ? '' : 'disabled'}>Draw from pile (${G.draw.length})</button>
        <button class="btn ghost" data-act="taketop" ${G.discard.length ? '' : 'disabled'}>Take top discard</button>
        ${noSrc ? '<button class="btn" data-act="blind">Draw blindly from opponent’s hand</button>' : ''}`;
      if (ui.pick !== null) {
        const sel = G.cards[G.discard[ui.pick]], n = G.discard.length - ui.pick;
        const dry = DF.act(G, { type: 'pickupIndexed', player: m, index: ui.pick });
        status = `Pick up <b>${n}</b> card${n > 1 ? 's' : ''} starting at <b>${DF.cardName(sel)}</b>? That card must be played this turn. ` + (dry.ok ? '<b>It can be placed.</b>' : `<span style="color:var(--danger)">${esc(dry.error)}</span>`);
        btns = `<button class="btn" data-act="pickup" ${dry.ok ? '' : 'disabled'}>Pick up ${n}</button><button class="btn ghost" data-act="cancel">Cancel</button>`;
      }
    } else if (ph === 'MANDATORY_PLAY') {
      const mand = DF.mandatoryPlays(G, m, true).length > 0, n = G.hands[m].length;
      status = mand
        ? `${name}: you must make every legal play. Select 3+ cards and press <b>Make group</b>, or select one card and click a group to add it.`
        : (n === 1 ? `${name}: no plays left. Discarding your last card takes you out — your opponent may answer with a black 2.` : n ? `${name}: no plays left — discard one card to end your turn.` : `${name}: your hand is empty.`);
      btns = `<button class="btn" data-act="makegroup" ${ui.sel.length >= 3 ? '' : 'disabled'}>Make group from ${ui.sel.length || ''} selected</button>
        <button class="btn" data-act="discard" ${ui.sel.length === 1 && !mand ? '' : 'disabled'}>Discard selected</button>
        ${mand ? '<button class="btn ghost" data-act="showplay">Show me a legal play</button>' : ''}
        ${n === 0 ? '<button class="btn" data-act="endturn">End turn</button>' : ''}`;
    } else if (ph === 'RED2_RESPONSE_CHAIN') {
      const sp = DF.specialsFor(G, m), taken = G.groups[G.chain.targetId];
      status = `<b>${nm(G.chain.actor)}</b> played a red 2 and took <b>${esc(DF.groupLabel(G, taken))}</b>. Only a black 2 can answer: counter it to send the group back, or let it stand.`;
      btns = sp.black2.map((id) => `<button class="btn wine" data-act="counter" data-id="${id}">Counter with black 2 ${SYM[G.cards[id].suit]}</button>`).join('')
        + `<button class="btn" data-act="pass">Let it stand</button>`;
    } else if (ph === 'GOING_OUT_RESPONSE') {
      const sp = DF.specialsFor(G, m);
      status = `<b>${nm(G.goingOut.player)}</b> went out. Only a black 2 can stop it: ${nm(G.goingOut.player)} would draw seven and play on.`;
      btns = sp.black2.map((id) => `<button class="btn wine" data-act="seven" data-id="${id}">Black 2 ${SYM[G.cards[id].suit]}: ${nm(G.goingOut.player)} draws seven</button>`).join('')
        + `<button class="btn" data-act="goout">${sp.black2.length ? 'Let the game end' : 'Continue — the game ends'}</button>`;
    }
    const specials = ph === 'MANDATORY_PLAY' && !ui.mode ? specialButtons() : '';
    return `<div class="dock">${latestHTML()}${msg}<div class="status">${status}</div><div class="actions">${btns}${specials ? '<span class="sep"></span>' + specials : ''}</div>${handHTML(m)}</div>`;
  }

  /* ---- opening ---- */
  function openingBetView() {
    const m = me(), rev = G.cards[G.pool.revealed];
    return `${header()}<div class="board"><div class="panel" style="width:auto;max-width:900px;margin:0 auto">
      <h2>Opening bet — ${nm(m)}</h2>
      <p>The top card of the draw pile is face-up. Each player secretly bets one hand card. The higher bet (Ace high, 2 lowest, Joker below everything; ties Spades > Hearts > Diamonds > Clubs) wins and takes <b>any one</b> of: the revealed card, either bet, or the next card in the draw pile.</p>
      <div class="opening"><div class="opt">${cardHTML(rev, { size: 'xl' })}<div class="cap2">Revealed card</div></div></div></div></div>
      <div class="dock"><div class="status">${ui.msg ? `<span style="color:var(--danger)">${esc(ui.msg.text)}</span>` : ui.sel.length ? 'Lock in this card as your bet?' : 'Select the card you want to bet.'}</div>
      <div class="actions"><button class="btn" data-act="bet" ${ui.sel.length === 1 ? '' : 'disabled'}>Lock in bet</button></div>${handHTML(m)}</div>`;
  }
  function openingSelView() {
    const m = me(), w = G.opening.winner, opts = [
      ['revealed', G.pool.revealed, 'Revealed card'], ['bet0', G.bets[0], `${G.names[0]}’s bet`], ['bet1', G.bets[1], `${G.names[1]}’s bet`], ['next', null, 'Next card from the draw pile (unseen)'],
    ];
    return `${header()}<div class="board"><div class="panel" style="width:auto;max-width:900px;margin:0 auto">
      <h2>${nm(w)} ${youVerb(w, 'wins', 'win')} the bet</h2><p>Choose one card to take into your hand. The other three go to the bottom of the draw pile, and you start the first turn. This counts as your first draw.</p>
      <div class="opening">${opts.map(([key, id, cap]) => `<div class="opt ${ui.choice === key ? 'sel' : ''}">${id ? cardHTML(G.cards[id], { size: 'xl', attr: `data-act="choice" data-k="${key}"` }) : cardHTML(null, { back: true, size: 'xl', attr: `data-act="choice" data-k="${key}"` })}<div class="cap2">${esc(cap)}</div></div>`).join('')}</div>
      <div class="actions" style="justify-content:center;margin-top:12px"><button class="btn" data-act="take" ${ui.choice ? '' : 'disabled'}>Take this card</button></div>
      ${ui.msg ? `<p style="color:var(--danger)">${esc(ui.msg.text)}</p>` : ''}</div></div>`;
  }

  /* ---- game over ---- */
  function overView() {
    const r = G.result, ms = DF.matchStatus(G), cum = G.match.mode === 'cumulative';
    const row = (lab, f) => `<tr><td>${lab}</td><td>${f(0)}</td><td>${f(1)}</td></tr>`;
    const head = r.tie ? 'The game ends in a tie condition' : `${nm(r.out)} ${youVerb(r.out, 'goes', 'go')} out`;
    let verdict;
    if (cum && ms.over) verdict = `${nm(ms.winner)} ${youVerb(ms.winner, 'wins', 'win')} the match!`;
    else if (cum) verdict = 'No one has reached the target yet — on to the next game.';
    else verdict = r.winner === null ? 'It’s a draw.' : `${nm(r.winner)} ${youVerb(r.winner, 'wins', 'win')}!`;
    const going = G.goingOut || null;
    return `${header()}<div class="board"><div class="center" style="padding:6px"><div class="panel" style="width:min(720px,96vw)">
      <h2>${head}</h2><p>${esc(r.reason || '')}</p>
      <table class="res"><tr><th></th><th>${nm(0)}</th><th>${nm(1)}</th></tr>
        ${row('Cards on the table', (p) => '+' + r.table[p])}
        ${row('Cards left in hand', (p) => '−' + r.hand[p])}
        ${row('Going-out bonus', (p) => '+' + r.bonus[p])}
        ${row('<b>Game score</b>', (p) => `<b class="${r.winner === p ? 'win' : ''}">${r.final[p]}</b>`)}
        ${cum ? row('Match total', (p) => G.match.totals[p]) : ''}</table>
      <div class="banner"><b>${verdict}</b></div>
      <div class="row" style="margin-top:14px">
        ${cum && !ms.over ? '<button class="btn" data-act="nextgame">Next game</button>' : ''}
        <button class="btn ${cum && !ms.over ? 'ghost' : ''}" data-act="menu">${cum && !ms.over ? 'End match' : 'New game'}</button>
        <button class="btn ghost" data-act="togglelog">Game log</button></div>
    </div></div>
    <section class="side"><div class="sidehead"><span class="who">Final table</span></div><div class="groups">${Object.values(G.groups).map(groupHTML).join('') || '<span class="empty">No groups were laid.</span>'}</div></section>
    <section class="side"><div class="sidehead"><span class="who">Hands revealed</span></div>
      ${[0, 1].map((p) => `<div class="sidehead"><span class="hint" style="min-width:90px">${nm(p)}</span><span class="hand" style="display:inline-flex">${sortHand(G.hands[p]).map((id) => cardHTML(G.cards[id], { size: 'sm' })).join('') || '<span class="empty">empty</span>'}</span></div>`).join('')}</section></div>`;
  }

  function tableView() {
    const m = me();
    return `${header()}<div class="board">${sideHTML(1 - m, false)}${pilesHTML()}${sideHTML(m, true)}</div>${dockHTML()}`;
  }

  /* ------------------------------------------------------------ modal / rules */
  function modalHTML() {
    const md = ui.modal;
    return `<div class="overlay" data-act="overlay"><div class="modal" role="dialog" aria-modal="true"><h3>${md.title}</h3>${md.body}
      <div class="mfoot">${(md.actions || []).map((a, i) => `<button class="btn ${a.ghost ? 'ghost' : ''}" data-act="modalbtn" data-i="${i}">${esc(a.label)}</button>`).join('')}</div></div></div>`;
  }
  function rulesModal() {
    openModal('How to play', `<ul class="rules">
      <li><b>Goal:</b> lay sets and runs, use the special cards, and finish with the higher score. Going out earns +20.</li>
      <li><b>Turn:</b> draw (pile, top discard, or pick up deeper in the discard pile — the card you pick must be played that turn), then <b>play every card you legally can</b>, then discard one. Jokers and unused 2s and 8s are the exception: you are never forced to play them into a group (the card you pick up from the discard pile must still be placed).</li>
      <li><b>Set:</b> 3–4 cards of one rank, all different suits. <b>Run:</b> 3–13 consecutive cards of one suit, Ace high only (Q-K-A is fine, K-A-2 is not). Jokers pick an identity when played and keep it.</li>
      <li>You may add cards to <b>either</b> player’s groups. Points belong to whoever played each card.</li>
      <li><b>Special actions</b> are played after you draw and before you discard (a black 2 can also be played in the response windows).</li>
      <li><b>Red 2:</b> take one of your opponent’s whole groups; card points stay with whoever played each card, and groups never merge. Only a black 2 can answer a red 2 (it sends the group back). <b>Black 2:</b> counter a red 2, <i>or</i> make your opponent draw seven (discard pile first, then draw pile, then blindly from your hand; if there aren’t enough cards the game ends in a tie).</li>
      <li><b>8:</b> swap into any table card (or any discard). The removed card must be placed legally at once. A used 8 scores 0 in a group; if a later 8 replaces it, the old 8 leaves play.</li>
      <li><b>Going out:</b> empty your hand — by playing cards (your last card then goes face-down to the discard pile, provided its group stays valid) or by discarding your last card (face-down). Your opponent may then answer <i>only</i> with a black 2, which makes you draw seven and play on; otherwise the game ends and you score +20.</li>
      <li><b>Scoring:</b> table cards +5 (2–9), +10 (10–K), +15 (A). Hand cards −5/−10/−15, Joker −10. Used 2s score 0.</li></ul>`, [{ label: 'Close', fn: closeModal }]);
  }
  function logModal() {
    openModal('Game log', `<ol class="log" reversed>${G.log.slice(-40).reverse().map((l) => `<li>${esc(logLine(l))}</li>`).join('')}</ol>`, [{ label: 'Close', fn: closeModal }]);
  }

  /* ------------------------------------------------------------ render */
  function render() {
    const prev = document.querySelector('.board'), top = prev ? prev.scrollTop : 0;
    let html;
    if (!G) html = setupScreen();
    else {
      const need = DF.actor(G);
      if (G.result) html = overView();
      else if (ui.vsBot && need === BOT && (G.phase === 'OPENING_BET' || G.phase === 'OPENING_SELECTION')) html = botWaitView();
      else if (!ui.vsBot && need !== null && ui.seat !== need) html = handoffScreen(need);
      else if (G.phase === 'OPENING_BET') html = openingBetView();
      else if (G.phase === 'OPENING_SELECTION') html = openingSelView();
      else html = tableView();
    }
    $app.innerHTML = html + (G && ui.modal ? modalHTML() : '');
    const b = document.querySelector('.board'); if (b) b.scrollTop = top;
    scheduleBot();
  }

  /* ------------------------------------------------------------ bot driver */
  const botTurn = () => !!(G && ui.vsBot && !G.result && DF.actor(G) === BOT);
  function botWaitView() {
    return `${header()}<div class="board"><div class="center"><div class="panel"><h2>${nm(BOT)} is choosing…</h2><p>${esc(logLine(G.log[G.log.length - 1] || ''))}</p>${ui.msg && ui.msg.err ? `<p style="color:var(--danger)">${esc(ui.msg.text)}</p><button class="btn" data-act="botretry">Try again</button>` : ''}</div></div></div>`;
  }
  function scheduleBot() {
    clearTimeout(botTimer);
    if (!botTurn() || ui.botError) return;
    const quick = G.phase === 'MANDATORY_PLAY' || G.phase === 'RED2_RESPONSE_CHAIN';
    botTimer = setTimeout(() => {
      if (!botTurn()) return;
      if (typeof Bot === 'undefined') { // index.html did not include bot.js: load it ourselves, then carry on
        loadBotScript((err) => {
          if (err) { ui.msg = { text: err, err: true }; ui.botError = true; }
          render();
        });
        return;
      }
      try {
        const next = Bot.step(G, BOT);
        if (!next) throw new Error('The bot could not find a legal move.');
        G = next; ui.msg = null; save(); render();
      } catch (e) {
        console.error(e);
        ui.msg = { text: e.message, err: true }; ui.botError = true; render();
      }
    }, quick ? 650 : 1000);
  }
  let botLoading = false;
  function loadBotScript(done) {
    if (botLoading) return;
    botLoading = true;
    const sc = document.createElement('script');
    sc.src = 'bot.js?v=3';
    sc.onload = () => { botLoading = false; done(typeof Bot === 'undefined' ? 'bot.js loaded but did not define the bot — re-copy public/bot.js.' : null); };
    sc.onerror = () => { botLoading = false; done('Could not load public/bot.js — check that the file is in the public folder next to app.js.'); };
    document.head.appendChild(sc);
  }
  function latestHTML() {
    if (!ui.vsBot) return '';
    return `<div class="hint latest">${G.log.slice(-3).map((l) => esc(logLine(l))).join(' · ')}</div>`;
  }

  /* ------------------------------------------------------------ interactions */
  function makeGroup() {
    const m = me(), ids = ui.sel.slice();
    const opts = DF.createOptions(G, m, ids);
    if (!opts.length) {
      return toast(DF.createOptions(G, m, ids, { checkEmpty: false }).length
        ? 'That is a legal group, but you cannot empty your hand with it: its last card must leave the group still valid.'
        : 'Those cards do not form a legal set or run (or an identity is already used by a same-type group on the table).');
    }
    const go = (o) => act({ type: 'createGroup', ids, specs: o.spec.members });
    if (opts.length === 1) return go(opts[0]);
    chooseModal('Which group?', 'A joker can stand for more than one card. Pick the identity you want.', opts.map((o) => ({ html: `${miniSpec(o.spec.members)}<span>${esc(o.label)}</span>`, fn: () => go(o) })));
  }
  function addTo(gid) {
    const id = ui.sel[0], ch = DF.addChoices(G, id, gid);
    if (!ch.length) return toast('That card does not fit that group.');
    const go = (lg) => act({ type: 'addToGroup', cardId: id, groupId: gid, logical: lg });
    if (ch.length === 1) return go(ch[0]);
    chooseModal('Joker identity', 'What does the joker stand for?', ch.map((lg) => ({ html: `<span>as ${rl(lg.rank)}${SYM[lg.suit]}</span>`, fn: () => go(lg) })));
  }
  function startEight(eightId) { ui.mode = { kind: 'eight', eightId }; ui.sel = []; ui.pick = null; ui.msg = null; render(); }
  function eightTarget(target, labelCard) {
    const m = me(), opts = DF.eightPlacements(G, m, ui.mode.eightId, target);
    if (!opts.length) return toast('That swap is not allowed: the removed card would have no legal place to go.');
    const eid = ui.mode.eightId;
    if (opts.length === 1 && opts[0].placement.kind === 'exhaust') return act({ type: 'eightTable', eightId: eid, targetId: target.table, placement: opts[0].placement });
    const seen = new Set(), uniq = opts.filter((o) => (seen.has(o.label) ? false : (seen.add(o.label), true))).slice(0, 40);
    const go = (o) => act(target.table ? { type: 'eightTable', eightId: eid, targetId: target.table, placement: o.placement } : { type: 'eightDiscard', eightId: eid, index: target.discard, placement: o.placement });
    chooseModal('Where does ' + esc(labelCard) + ' go?', 'The swapped-out card must be placed immediately.', uniq.map((o) => ({ html: `${o.spec ? miniSpec(o.spec.members) : ''}<span>${esc(o.label)}</span>`, fn: () => go(o) })));
  }
  function red2Target(gid) {
    if (!DF.red2Targets(G, me()).includes(gid)) return toast('Choose one of the opponent’s groups.');
    act({ type: 'red2', cardId: ui.mode.cardId, targetId: gid }); // R2-04: groups never merge
  }
  function confirmSeven(id) {
    const m = me(), victim = G.phase === 'GOING_OUT_RESPONSE' ? G.goingOut.player : 1 - m;
    const avail = G.discard.length + G.draw.length + G.hands[m].length - 1;
    openModal('Black 2: draw seven', `<p>${nm(victim)} must draw seven cards: the discard pile first (newest first), then the draw pile, then blindly from your hand.</p>
      ${avail < 7 ? '<p style="color:var(--danger)"><b>Warning:</b> there are fewer than seven cards available — the game would end in a tie and be scored immediately.</p>' : ''}
      <p>This black 2 is used up either way.</p>`, [
      { label: 'Cancel', ghost: true, fn: closeModal }, { label: 'Play it', fn: () => act({ type: 'blackSeven', cardId: id }) }]);
  }

  function startGame() {
    const s = ui.setup;
    const seed = s.seed.trim() ? [...s.seed.trim()].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7) : undefined;
    ui.vsBot = s.opp === 'bot';
    G = DF.newGame({ seed, names: [(ui.vsBot && s.n0.trim() === 'Player 1' ? '' : s.n0.trim()) || (ui.vsBot ? 'You' : 'Player 1'), ui.vsBot ? 'Marcel (bot)' : (s.n1.trim() || 'Player 2')],
      stalemateRule: s.stalemate,
      match: { mode: s.mode, target: Math.max(20, +s.target || 200), totals: [0, 0], games: 0 } });
    ui.seat = ui.vsBot ? 0 : null; ui.sel = []; ui.mode = null; ui.modal = null; ui.msg = null; save(); render();
  }

  const clicks = {
    start: () => startGame(),
    botretry: () => { ui.botError = false; ui.msg = null; render(); },
    resume: () => { const sv = load(); if (sv) { G = sv.G; ui.vsBot = !!sv.vsBot; ui.seat = ui.vsBot ? 0 : null; render(); } },
    rules: () => rulesModal(),
    togglelog: () => logModal(),
    menu: () => { if (G && !G.result && !confirm('Leave this game? You can resume it from the menu.')) return; if (G && G.result) clearSave(); clearTimeout(botTimer); G = null; ui.modal = null; render(); },
    seat: (d) => { ui.seat = +d.p; ui.sel = []; ui.mode = null; ui.msg = null; ui.hint = null; ui.pick = null; save(); render(); },
    hand: (d) => {
      ui.hint = null; ui.msg = null;
      if (ui.mode || botTurn()) return;
      const i = ui.sel.indexOf(d.id);
      if (G.phase === 'OPENING_BET') ui.sel = i >= 0 ? [] : [d.id];
      else if (i >= 0) ui.sel.splice(i, 1); else ui.sel.push(d.id);
      render();
    },
    bet: () => act({ type: 'placeBet', cardId: ui.sel[0] }),
    choice: (d) => { ui.choice = d.k; render(); },
    take: () => act({ type: 'selectOpening', choice: ui.choice }),
    drawpile: () => { if (G.phase === 'TURN_DRAW') act({ type: 'drawPile' }); },
    taketop: () => act({ type: 'takeDiscardTop' }),
    blind: () => act({ type: 'blindDraw' }),
    dcard: (d) => {
      const i = +d.i;
      if (ui.mode && ui.mode.kind === 'eight') return eightTarget({ discard: i }, DF.cardName(G.cards[G.discard[i]]));
      if (G.phase === 'TURN_DRAW') { ui.pick = ui.pick === i ? null : i; ui.msg = null; render(); }
    },
    pickup: () => act({ type: 'pickupIndexed', index: ui.pick }),
    cancel: () => { ui.mode = null; ui.pick = null; ui.msg = null; render(); },
    makegroup: () => makeGroup(),
    group: (d) => {
      if (ui.mode && ui.mode.kind === 'red2') return red2Target(d.g);
      if (!ui.mode && ui.sel.length === 1 && G.phase === 'MANDATORY_PLAY') return addTo(d.g);
    },
    gcard: (d) => {
      if (ui.mode && ui.mode.kind === 'eight') { const c = G.cards[d.id]; return eightTarget({ table: d.id }, c.joker ? 'the joker' : DF.cardName(c)); }
      clicks.group({ g: d.g });
    },
    discard: () => act({ type: 'discard', cardId: ui.sel[0] }),
    endturn: () => act({ type: 'endTurn' }),
    showplay: () => {
      const p = DF.mandatoryPlays(G, me(), true)[0]; if (!p) return;
      if (p.kind === 'add') { ui.sel = [p.cardId]; ui.hint = { ids: [p.cardId], groupId: p.groupId }; } else { ui.sel = p.ids.slice(); ui.hint = { ids: p.ids }; }
      ui.msg = { text: p.kind === 'add' ? 'That card fits a highlighted group — click the group.' : 'These cards form a group — press Make group.', err: false }; render();
    },
    red2: (d) => { ui.mode = { kind: 'red2', cardId: d.id }; ui.sel = []; ui.pick = null; ui.msg = null; render(); },
    eight: (d) => startEight(d.id),
    seven: (d) => confirmSeven(d.id),
    counter: (d) => act({ type: 'counter', cardId: d.id }),
    pass: () => act({ type: 'passChain' }),
    goout: () => act({ type: 'goingOutPass' }),
    nextgame: () => {
      G = DF.newGame({ names: G.names, stalemateRule: G.stalemateRule, match: JSON.parse(JSON.stringify(G.match)) });
      ui.seat = ui.vsBot ? 0 : null; ui.sel = []; ui.mode = null; save(); render();
    },
    modalbtn: (d) => { const a = ui.modal.actions[+d.i]; if (a && a.fn) a.fn(); },
    modalopt: (d) => { const o = ui.modal.options[+d.i]; if (o) o.fn(); },
    overlay: (d, ev) => { if (ev.target.classList.contains('overlay')) closeModal(); },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = clicks[el.dataset.act];
    if (fn) fn(el.dataset, ev);
  });
  document.addEventListener('input', (ev) => {
    const b = ev.target.dataset && ev.target.dataset.bind;
    if (b) { ui.setup[b] = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value; if (ev.target.dataset.rerender) render(); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && ui.modal) closeModal(); });

  render();
})();
