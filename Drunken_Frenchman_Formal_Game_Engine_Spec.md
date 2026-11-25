# Drunken Frenchman — Formal Game-Engine Specification

**Version 1.0 | Rules resolved for deterministic implementation**

This document is the single authoritative specification for *Drunken Frenchman*: player-facing rules, implementation model, state machine, data model, resolution algorithms, scoring, and acceptance tests. Where the prior rules or clarifications left implementation choices open, this specification adopts explicit defaults so that two implementations produce the same result.

\---

## 1\. Game overview

* Players: exactly two.
* Deck: standard 52 cards plus two jokers (54).
* Deal: 13 cards to each player; 28 remain in the draw pile.
* Objective: create and extend sets and runs, exploit special-card actions, and end the game with the higher score.
* A completed game is scored once. A player who successfully ends the game by going out receives +20.
* Match mode may be single-game or cumulative (Section 17).

## 2\. Normative terminology

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

* **Physical card / physical identity:** the actual card instance, uniquely identified (e.g. `8C`, `JH`, `Joker-1`).
* **Logical identity:** the rank/suit identity a card represents in a group (e.g. `JH`). Logical identity is used for group validation and card scoring where specified.
* **Group:** one set or run with stable group ID and ordered membership.
* **Ownership:** which player receives the score for a physical card. Ownership is per-card, not necessarily group-wide.
* **Special-active card:** a 2 or 8 whose special ability has not been consumed.
* **Exhausted:** a special card removed permanently from gameplay after its special ability is activated.
* **Turn:** the ordinary turn cycle of draw, mandatory plays, discard.
* **Action window:** a response opportunity for a special-card action outside normal turn flow.
* **Table:** all groups in play.
* **Discard pile:** face-up stack/array, bottom-to-top; never reshuffled.
* **Draw pile:** face-down stack; draw from top.
* **Hand:** cards privately held by a player.

## 3\. Card and zone data model

Every card instance stores:

* `id`: unique stable physical identifier.
* `physical`: rank/suit or Joker.
* `zone`: hand, draw-pile, discard-pile, group, exhausted, betting-pool, or transient.
* `owner`: player ID or null (for cards in draw/discard/exhausted zones unless explicitly owned).
* `logicalIdentity`: null while ungrouped; rank/suit identity while in a group. Jokers and substitute 8s require this.
* `specialStatus`: `available`, `consumed`, or `not\_applicable`.
* `groupId` and `groupPosition` when in a group.

Group record:

* `id`, `type` (`set` or `run`), ordered `members` (card IDs), `ownerSide` (which side/group location the group currently resides on for red-2 transfer), and metadata.
* Group ownership/side and individual scoring ownership are separate. A group may have cards scored by both players.

### Zones

1. Player 1 hand
2. Player 2 hand
3. Draw pile (top is first card drawn)
4. Discard pile (bottom-to-top, top is last array element)
5. Player 1 table side (groups)
6. Player 2 table side (groups)
7. Exhausted pile (visible; no score)
8. Temporary opening-bet pool

A card MUST be in exactly one zone. A card in a group MUST belong to exactly one group. Group transfer changes group side/location, not individual scoring ownership, unless an action explicitly changes ownership.

## 4\. Setup and redeal

1. Shuffle all 54 card instances.
2. Deal 13 to each player.
3. Check each hand for at least one special card: any 2, any 8, or joker.
4. If either hand fails the test, return all 54 cards, shuffle, and redeal both players. Repeat without limit.
5. After a valid deal, the remaining 28 cards form the draw pile.
6. Start the opening-bet procedure.

A joker qualifies for Hand of Crap. A 2 or 8 qualifies regardless of suit. A card's special ability need not be used to qualify.

## 5\. Opening bet and selection

1. Reveal the top draw-pile card into the temporary pool (without permanently consuming it yet).
2. Each player selects one hand card as a bet; remove each bet card from the hand.
3. Reveal bets. Bet ordering is: rank (Ace high; 2 lowest rank; joker below all ordinary ranks), then suit for equal ranks: Spades > Hearts > Diamonds > Clubs. Jokers are always below non-jokers. Special status has no effect on bet rank.
4. The higher bet wins. A tie in rank is broken by suit as above. The only tie possible after suit comparison is identical physical cards from a multi-deck game; since the game uses one deck, this is not expected.
5. Winner chooses exactly one of: the revealed draw-pile card, Player 1's bet, Player 2's bet, OR the next card from the draw pile (the card immediately below the revealed card).
6. The selected card transfers to winner's hand. This selection counts as the winner's first draw/selection, not as an extra turn draw.
7. All three pool cards not selected are placed at the bottom of the draw pile, in the order: revealed draw-pile card, Player 1 bet, Player 2 bet (relative order preserved, with pool cards returned in this canonical order). If the winner selected the next draw-pile card instead, all three pool cards go to bottom in the same canonical order.
8. The losing bet is not returned to its bettor. Unselected bets are bottomed as described. The selected bet card is taken by winner as a transfer from the pool.
9. The winner starts the first ordinary turn. No group is created during the betting selection.

## 6\. Turn and mandatory-play loop

An ordinary turn MUST follow this sequence:

1. Draw/selection (Section 7).
2. Mandatory-play loop (Section 8).
3. Optional special actions in any permitted action window (Section 9); special 2s may be played outside turn.
4. Discard one card to finish, unless going-out procedure (Section 10) or an unresolved special chain prevents completion.

A player cannot voluntarily end the mandatory-play loop while a mandatory play exists. At each iteration the player chooses any one available mandatory play, applies it, then recalculates available plays from scratch.

**Mandatory play is an ordinary play only**: cards are placed as ordinary cards to form or extend legal sets/runs. This rule does not require activation of special abilities, 8 substitutions, red-2 group theft, or black-2 draw/counter. A 2 or 8 may be played as an ordinary card if it forms a legal group and its special ability is not activated.

### Legal ordinary placements

* Form a new set or run from at least three cards, using cards from the player's hand.
* Add a hand card to an existing group on either player's side, if it fits the group's logical structure.
* Mandatory plays must include all available ordinary legal placements from the player's hand, one at a time, until no legal ordinary placement remains. The player's choice among alternatives is legal.

## 7\. Drawing and discard-pile access

### 7.1 Draw-pile draw

Draw the top card of the draw pile. If empty, use the fallback source sequence in Section 15.

### 7.2 Top-discard draw

Take the top discard card into hand. This is a normal draw. The card may be retained in hand and is not required to be played, even if it is playable.

### 7.3 Indexed discard pickup

Choose any discard-pile index `i` (bottom-to-top), take that card and every card above it, and place all taken cards in hand. The selected card (the card at index `i`) MUST be legally placed during the same turn. If it cannot legally be placed, this pickup is illegal and must be undone. Cards above the selected card are free to retain or play. This action counts as the player's normal draw.

* A top discard chosen via indexed pickup is still subject to this indexed-pickup requirement; the more permissive top-discard-retain rule applies only to the separate top-discard draw option.
* Special cards may be picked up; only an ability previously consumed is no longer available.

The discard pile may become empty and is never reshuffled.

## 8\. Groups, sets, runs, and mandatory-play validation

### 8.1 Sets

A set contains 3 or 4 physical cards whose logical identities share the same rank, with no duplicate logical identities. Logical identity must be unique by suit within the set. A set cannot exceed four members. A set of three is complete/legal; a joker may occupy a missing fourth identity. If a set is already four cards, no card can be added.

### 8.2 Runs

A run contains 3–13 cards of one logical suit, in consecutive rank order, Ace high only. A run cannot wrap (Q-K-A is valid; K-A-2 is not). No duplicate logical identities within a run. Runs are kept in their logical order. A substitute retains the substituted member's logical identity and position.

### 8.3 Creating a group

A new group requires at least three cards at creation. A player may use a joker with chosen logical identity to satisfy a set/run. Each physical card in the group is owned for scoring by the player who played it. The group's side is initially the creator's side.

### 8.4 Extending groups

Cards may be added to either player's table group. Added cards are owned for scoring by the player who added them. Group side does not determine card scoring owner. Groups persist and do not break apart; cards may leave a group only through an 8 substitution. Group members remain in their structure/positions after substitution.

### 8.5 Joker identity and validation

* A joker's logical identity is selected when placed and is fixed until an 8 substitutes it.
* Opponents may extend a group but cannot change joker identity.
* Jokers may be used multiple times in one group only if each joker's logical identity is distinct and group constraints remain satisfied.
* Joker logical identity cannot duplicate a logical identity in the same set/run. A duplicate identity may exist elsewhere on the table only in the opposite group type (set vs run), as allowed by the game's group-specific uniqueness rule.
* In a set of three, a joker may represent the missing fourth identity without a physical fourth card being present. This is treated as three physical members and not as a phantom fourth physical card. A set may be extended only up to four physical members; no fifth member.
* In a set of four, all four physical members are accounted for; no additional card may be added.
* Joker may represent a 2 or 8 rank identity, but not special powers.
* A joker stolen/transferred as a group member retains its logical identity.
* An 8 may substitute a joker; the 8 assumes the joker's logical identity in the former slot. The removed joker may then be placed into any legal new group with a newly chosen identity.

## 9\. Special cards and action windows

Special actions are optional. Playing a 2 or 8 as an ordinary group card does not consume its special ability. An ability is consumed permanently upon activation.

### 9.1 Red 2 (Hearts or Diamonds): steal group

When a player activates a red 2:

1. Validate that the player has a special-active red 2 and a target group on the opponent's table side.
2. Exhaust the red 2 immediately.
3. Move the selected entire group to the activating player's table side. Group members' individual scoring ownership does not change.
4. A group affected by red 2 is not itself disassembled. If a target merges with a compatible group on the receiving side, merge only when the merged membership is structurally legal and unambiguous (same type, compatible identities, no duplicate member, and no resulting violation); otherwise keep groups distinct. Merge is optional for the receiver and must be declared at the action.
5. Red 2 action is sequential, not simultaneous. Each red 2 must target a different group from the immediately preceding red-2 target in that chain, unless the prior target was merged: in that case, target the merged group as one current group. A later red 2 may target a group affected by an earlier action if it exists as a distinct current group.
6. A red-2 action opens a counter window before the action is finalized.

### 9.2 Black 2: counter or draw seven

Black 2 special ability can be activated in either mode, selected at activation.

**Counter mode**

* A counter may only be played in an open red-2 response chain and counters the most recent unresolved red-2 action.
* Countering restores the affected group to the side it occupied immediately before that red-2 action, and reverses any merge created solely by that red-2 action. If later actions have modified the affected group, those later modifications remain with the group as it is restored; no card is rolled back beyond the targeted red-2 transfer/merge.
* The black 2 is exhausted immediately.
* Counters alternate players: the player who just played a red 2 may not counter their own red-2 action. A counter is only available to the opponent of the actor of the latest red-2 action.
* If no counter is played during its response window, that red-2 action stands. The chain window closes and ordinary play continues.
* If a new red 2 is activated as a response before the window closes, it becomes the most recent action and opens its own counter window; resolve actions sequentially (LIFO counter targeting).
* A black 2 may counter only one red-2 action.

**Draw-seven mode**

* Exhaust the black 2 immediately, then make the opponent draw up to seven cards, using Section 15 source order. If fewer than seven cards are available across all permitted sources, the game ends in a tie and scores immediately.
* Draw-seven does not itself create a red-2 counter window.

**Two consecutive black 2s**

* Two black 2s by the same player in sequence are allowed only if the first action is draw-seven and the second is draw-seven, or if a legal chain response permits the second (counter) after an intervening red-2 action. No player may counter their own red 2.

### 9.3 Timing and windows

* Special 2s may be played outside a player's ordinary turn, provided the action's timing and target are legal.
* An open red-2 response window is the only window for counter mode.
* Red-2 chains are sequential; no simultaneous red-2 actions.
* Each special 2 is exhausted immediately, even if the action is countered.
* Red/black special actions cannot occur after a finalized game-ending state. The going-out black-2 window is a specific exception: a black 2 draw-seven action may be played there to continue the game (Section 10).
* If an unresolved red-2 response chain has no eligible red or black 2 responses remaining, the most recent red-2 action stands and the chain closes.

## 10\. Eight substitution

A special-active 8 may substitute one card from either (a) any table group on the activating player's side or opponent's side, or (b) any card at any index in the discard pile.

### 10.1 Table substitution

1. Select the target card from a group.
2. Determine its logical identity and position.
3. Validate the removed card can be immediately and legally played elsewhere, except the set-of-three-to-set-of-four exception below.
4. Exhaust the 8.
5. Replace the target card in its exact group position with the physical 8; the 8 adopts the target's logical identity and position and is scored as a substitute-8 (zero points).
6. Place the removed physical card immediately into a legal group, with ownership assigned to the player performing the placement. It may be placed on either player's group or in a newly created group. If no legal immediate placement exists, the substitution is invalid and must not occur.
7. Exception: a card removed from a set of three may be returned to that same set if the result is a set of four (the removed card fills the fourth distinct logical identity). This exception does not apply to runs or sets already containing four physical members.
8. Substitution does not break or reorder groups. A run remains ordered; the 8 represents the removed logical identity in its slot.

### 10.2 Discard-pile substitution

1. Select any discard-pile index, including the top or bottom.
2. The selected card must be immediately legally placed into a group. Validate placement before committing.
3. Exhaust the 8.
4. Remove selected card from discard pile and immediately place it into a legal group, assigning ownership to the 8 player.
5. Place the physical 8 into the discard pile at the exact index from which the selected card was removed (maintaining the pile's order).
6. The 8 in the discard pile is exhausted and is treated as an ordinary physical 8 when subsequently drawn: it has no special ability and is worth -5 if retained in hand, or +5 if played ordinarily to a group (its ordinary physical value).
7. If the selected card cannot be legally placed, the substitution is invalid and neither card moves.

### 10.3 Special-8 usage

* Each special-active 8 can perform one substitution and is exhausted immediately.
* Consecutive 8 substitutions are allowed if each is independently legal and uses a different special-active 8.
* An 8 may replace a card whose physical card is an 8 (including ordinary-played or substitute-8) or joker, provided the target card is in a group and the resulting identities/structure remain legal.
* An 8 may replace a card in a group affected by a red-2 action only after that red-2 action has resolved (response window closed).
* An 8 substitute is not a second logical member: it represents the target's identity in the same position. It is scored 0, not the value of the target identity; the removed card retains its own physical scoring value and receives ownership based on its new placement.
* A substitute 8 cannot be duplicated in identity within the same group under the group's validation rules.

## 11\. Mandatory-play versus discard and going out

A normal turn requires a discard after mandatory plays. The turn-end resolution is deterministic:

1. After draw and mandatory-play loop, if the player has one or more cards in hand, the player MUST discard one card face-up, unless the player chooses and is eligible for the going-out procedure below.
2. Going out requires that the player empties their hand by ordinary legal group placements, with no card left to discard. To resolve the inherent discard requirement, the **last card placed to empty the hand is the going-out card** and is moved from its group to the discard pile face-down, removing it from the group; this removal is permitted only as the game's going-out exception and does not invalidate the group if the group remains valid. If removing that card would make its group invalid, instead the player must keep one card in hand and discard face-up; going out is not possible on that turn.
3. This going-out removal is a special exception to the normal no-card-leaves-group rule and is not a substitution.
4. If the player can play all cards but no legal group can survive the face-down going-out-card removal, the player MUST NOT go out; choose an ordinary mandatory play sequence that leaves a card in hand, then discard.
5. A going-out discard is face-down, and its identity is hidden until the game is scored (engine still tracks identity internally).
6. The player who goes out opens a response window for the opponent to play one black 2 in draw-seven mode. The opponent may use a black 2 only; red 2 and 8 actions are not allowed in this window.
7. If no black 2 is played in the response window, game-ending state is finalized, scores are calculated once, and the going-out player receives +20.
8. If a black 2 successfully draws seven cards for the player who went out, the game resumes: the player who went out returns to play with those cards, the going-out discard remains in the discard pile, and the normal turn sequence resumes with that player as the next active player. The +20 bonus is not awarded unless a later going-out action ends the game.
9. If draw sources cannot complete the required seven cards, the game ties immediately and is scored without the +20 bonus.

## 12\. Draw source fallback and tie

For normal draws and draw-seven:

1. Use the discard pile first, if applicable and cards remain; for draw-seven, take discard cards top-down.
2. Use the draw pile next (top-down).
3. For remaining cards, draw blindly from the opponent's hand, without revealing the remaining hand.
4. If the requested draw cannot be completed because all permitted sources are exhausted, the game ends in a tie and is scored immediately.
5. Discard-pile draws for ordinary turns still require a player's choice as defined in Section 7; this fallback is automatic only when a draw is required and other prescribed sources are exhausted.
6. A card drawn blindly from the opponent's hand is placed in the drawing player's hand. It may become playable and triggers reevaluation of mandatory plays at the appropriate point in the turn; it does not expose the opponent's hand.
7. If both players have empty hands and the draw pile is empty, game ends in a tie and scores immediately.

## 13\. Scoring

Scoring is card-by-card based on current ownership and zone. Table cards score positively; cards in hand score negatively; exhausted cards and cards in draw/discard pile do not score. The going-out discard is not on the table and does not score.

### 13.1 Table card values

|Logical/physical card|Score|
|-|-:|
|2–9|+5|
|10, J, Q, K|+10|
|Ace|+15|

* Ordinary table cards score according to their logical identity, unless physical value is expressly used for an exhausted/ordinary substitute card.
* Joker on table scores its logical identity value.
* Substitute-8 used in a table slot scores 0. The card it replaced, once played elsewhere, scores based on its logical/physical identity as a card in its new group, for its new owner.
* A physical card is counted once only. A substitute 8 contributes zero, not both the 8's normal value and the represented identity's value.

### 13.2 Hand values

|Card in hand|Score|
|-|-:|
|2–9|-5|
|10, J, Q, K|-10|
|Ace|-15|
|Joker|-10|
|8|-5|
|2|-5|

An unplayed joker is -10 regardless of assigned identity (none). An unplayed special 8/2 is -5.

### 13.3 Exhausted cards

Exhausted cards score 0 and are excluded from totals. Exhausted cards are visible and cannot be retrieved.

### 13.4 Bonus and tie

* The +20 going-out bonus is awarded only to the player whose going-out response window closes without a successful black-2 continuation.
* Ties due to exhaustion of draw sources or both players emptying under the tie rule are scored immediately without a going-out bonus.
* Scores are calculated once per terminal game state.

## 14\. Game-end conditions

Game ends only on:

1. Finalized going-out state (Section 11); or
2. Tie due to inability to complete required draw / specified empty-state tie.

A finalized game state is immutable: no card action can be initiated after it.

## 15\. Draw source priority (implementation algorithm)

For a required draw of `N` cards (including black-2 draw-seven), repeat until N fulfilled or sources exhausted:

* **Priority A — discard pile:** take top discard(s), until discard empty or N fulfilled. The face-down going-out card, if present, is considered the top discard and its identity remains hidden from players but available to the engine.
* **Priority B — draw pile:** take top draw card(s), until draw pile empty or N fulfilled.
* **Priority C — opponent hand:** take cards randomly/without choice, one at a time, from opponent's hand, until N fulfilled or opponent hand empty. (Use a uniform random choice among opponent's cards.)
* If fewer than N are obtained, terminate as tie immediately.

For an ordinary draw when all source piles are empty, use one card from opponent's hand by the same random method. If all sources are empty, tie.

**Note:** Indexed discard-pile pickup is a player-selected draw option during normal turn, not the automatic fallback algorithm. The automatic priority is used for black-2 draw-seven and required fallback draws.

## 16\. Engine state machine

Suggested phases/states:

* `SETUP\_SHUFFLE`
* `DEAL`
* `HAND\_SPECIAL\_CHECK`
* `OPENING\_BET`
* `OPENING\_SELECTION`
* `TURN\_DRAW`
* `MANDATORY\_PLAY`
* `SPECIAL\_ACTION\_WINDOW`
* `DISCARD`
* `GOING\_OUT\_RESPONSE`
* `DRAW\_SEVEN`
* `RED2\_RESPONSE\_CHAIN`
* `GAME\_OVER`
* `TIE`

### Core transitions

* Setup/deal → valid special check → opening bet; invalid special check → shuffle/deal loop.
* Opening bet → selection → first turn.
* Turn draw → mandatory loop → optional special action windows → discard or going-out.
* Red 2 action → response window; counter restores/undoes transfer and returns to chain; no response finalizes transfer.
* Draw-seven → source-priority algorithm → resume game or tie.
* Going out → response window; black 2 draw-seven resumes; no response finalizes score.
* Terminal game → scoring exactly once.

## 17\. Cumulative match mode

Default cumulative match settings, unless players agree otherwise before the first game:

* Target: 1000 points.
* Each game score is added to cumulative total.
* Match winner: first player whose cumulative score reaches or exceeds 200 after a game.
* If both players reach or exceed 200 in the same game, higher cumulative score wins; if tied, play another game and totals carry forward until one player leads after a completed game.
* No game-level bonus is altered for cumulative mode.

Single-game mode has no target; highest score wins.

## 18\. Test-case conventions

* `P1`, `P2` denote players.
* Card notation: rank+suit (`AH`, `7C`, `8S`); joker as `Joker-1`.
* Test cases are deterministic fixtures. Tests describe expected state changes, not randomness in setup.
* For random draw tests, use a scripted random source to make outcomes reproducible.
* Each case should assert zone membership, card owner, group type/order/logical identity, special-status, terminal flag, and score where relevant.

\---

# 19\. Acceptance-test catalogue

Each test is a minimal fixture. “Expected” describes required engine outcome.

## A. Setup and deal

**DF-SET-01 — Valid deal.** Deal 13 cards per player; each has a special.  
Expected: retain deal; 28 cards in draw pile; enter opening bet.

**DF-SET-02 — One player lacks special.** P1 has 2/8/joker; P2 has none.  
Expected: collect all 54, shuffle and redeal; no partial replacement.

**DF-SET-03 — Both players lack special.**  
Expected: full redeal, not individual hand-only redeal.

**DF-SET-04 — Joker qualifies.** P2 has only joker as qualifying special.  
Expected: deal passes special check.

**DF-SET-05 — Redeal limit.** Script multiple invalid deals followed by valid.  
Expected: no attempt limit; accept first valid deal.

## B. Betting

**DF-BET-01 — Rank wins.** P1 bets 9H; P2 bets 10C.  
Expected: P2 wins regardless of suit.

**DF-BET-02 — Ace high.** P1 bets AH; P2 bets KH.  
Expected: P1 wins.

**DF-BET-03 — Suit tie-break.** Same rank: P1 7H, P2 7S.  
Expected: P2 wins (Spades higher).

**DF-BET-04 — Suit ordering complete.** Same rank: Spades > Hearts > Diamonds > Clubs.  
Expected: comparison matches specified order.

**DF-BET-05 — Joker lowest.** P1 joker; P2 2C.  
Expected: P2 wins.

**DF-BET-06 — Bet pool pick.** Winner selects own bet.  
Expected: selected card enters winner hand; other two pool cards bottom draw pile in canonical order.

**DF-BET-07 — Winner selects opponent bet.**  
Expected: selected opponent bet transferred to winner; bettor does not regain it.

**DF-BET-08 — Winner selects revealed card.**  
Expected: revealed card enters winner hand; two bets bottom draw pile.

**DF-BET-09 — Winner selects next draw card.**  
Expected: next draw card enters winner hand; all three pool cards bottom draw pile.

**DF-BET-10 — Pool cards returned.**  
Expected: bottom order canonical and repeatable; draw pile retains correct count.

**DF-BET-11 — Bet card may be special.**  
Expected: betting does not activate or exhaust special card; if returned to bottom, card status remains available.

## C. Draw / discard pile

**DF-DRAW-01 — Draw from draw pile.**  
Expected: top card enters hand; turn continues.

**DF-DRAW-02 — Take top discard.**  
Expected: card enters hand and may be retained; no forced play solely because it is playable.

**DF-DRAW-03 — Indexed pickup at top.**  
Expected: chosen top card plus cards above (none) removed; chosen card must be legally played.

**DF-DRAW-04 — Indexed pickup mid-pile.** Select card at index i.  
Expected: selected and all cards above it enter hand; selected card must be played; pile below i remains.

**DF-DRAW-05 — Indexed pickup bottom.**  
Expected: all discard cards taken; bottom-selected card must be legally played.

**DF-DRAW-06 — Invalid indexed pickup.** Selected non-top card cannot be played legally.  
Expected: action rejected; pile and hand unchanged.

**DF-DRAW-07 — Top discard unplayable.**  
Expected: card retained in hand, turn continues.

**DF-DRAW-08 — Discard pile empty.**  
Expected: no error; use other draw source.

**DF-DRAW-09 — No reshuffle.** Discard empty and draw pile exhausted.  
Expected: no reshuffle; fallback source applied.

**DF-DRAW-10 — Cards above selected discard retained.**  
Expected: selected card is played, upper cards remain in hand unless otherwise played.

**DF-DRAW-11 — Special card in discard pickup.**  
Expected: card is available for normal placement or its special ability if it remains available; pickup itself does not consume ability.

**DF-DRAW-12 — Exhausted special in discard pickup.**  
Expected: exhausted special has no ability; card may be treated as ordinary only if zone rules allow it to re-enter gameplay.

## D. Sets, runs, creation and extension

**DF-GRP-01 — Create set of three.** 5H,5D,5C.  
Expected: valid three-card set.

**DF-GRP-02 — Create set of four.** Four distinct suits of same rank.  
Expected: valid, full set; no extension.

**DF-GRP-03 — Duplicate identity in set.** Attempt two 5H logical identities.  
Expected: rejected.

**DF-GRP-04 — Five-member set.**  
Expected: rejected.

**DF-GRP-05 — Create run.** 4H,5H,6H.  
Expected: valid run in ascending order.

**DF-GRP-06 — Run length 13.** Full suit sequence.  
Expected: valid maximum.

**DF-GRP-07 — Run >13.**  
Expected: rejected.

**DF-GRP-08 — Run wrap prohibited.** KH,AH,2H.  
Expected: rejected.

**DF-GRP-09 — Ace high run.** QH,KH,AH.  
Expected: valid.

**DF-GRP-10 — Wrong suit run.** 4H,5H,6C.  
Expected: rejected.

**DF-GRP-11 — Extend own group.** Add 7H to 4H–5H–6H.  
Expected: card added in correct order; ownership P1.

**DF-GRP-12 — Extend opponent group.** P2 adds 7H to P1's run.  
Expected: card owner P2; group side/location unchanged.

**DF-GRP-13 — Groups persist.** Substitution changes member but structure intact.  
Expected: same group ID and structure.

**DF-GRP-14 — Mandatory play multiple cards.** Hand can add two consecutive cards to run.  
Expected: both are played; reevaluate between each.

**DF-GRP-15 — Choice between mandatory placements.** Two legal alternative placements.  
Expected: player chooses one; then reevaluation; no illegal skipping.

**DF-GRP-16 — No ordinary mandatory placement.**  
Expected: mandatory loop ends.

**DF-GRP-17 — Special ability not mandatory.** Hand contains special-active 2/8 with legal special action.  
Expected: mandatory-play loop does not require activating ability.

**DF-GRP-18 — Ordinary-play 2 or 8.** Card fits group and is played as ordinary.  
Expected: remains active; ability not consumed.

## E. Jokers

**DF-JOK-01 — Joker as set wild.** Joker assigned 5D to complete rank-five set.  
Expected: legal if no duplicate identity.

**DF-JOK-02 — Joker as run wild.** Joker assigned 7H in 5H–6H–joker–8H.  
Expected: valid; identity recorded.

**DF-JOK-03 — Joker assignment immutable.** Opponent adds adjacent card that would tempt reassignment.  
Expected: identity unchanged; action rejected if requires identity change.

**DF-JOK-04 — Multiple jokers distinct identities.**  
Expected: legal only with distinct identities and valid structure.

**DF-JOK-05 — Joker duplicate in same group.**  
Expected: reject duplicate logical identity.

**DF-JOK-06 — Joker duplicate elsewhere opposite group type.** Joker identity already in a run, placed in set with same identity.  
Expected: allowed under opposite-type exception.

**DF-JOK-07 — Joker duplicate elsewhere same group type.**  
Expected: reject where duplicate restriction applies.

**DF-JOK-08 — Joker represents 2 rank.**  
Expected: ordinary logical identity accepted; special 2 ability not invoked.

**DF-JOK-09 — Joker represents 8 rank.**  
Expected: ordinary logical identity accepted; 8 substitution ability not invoked.

**DF-JOK-10 — Joker in three-member set represents missing identity.**  
Expected: set has three physical members, no phantom card; remains extendable only within four-card limit.

**DF-JOK-11 — Joker in four-card set.**  
Expected: four physical members; no fifth-card addition.

**DF-JOK-12 — Joker stolen by red 2.**  
Expected: logical identity fixed; ownership/location transfer effects do not reassign it.

## F. Red 2 / Black 2 chains

**DF-2-01 — Red 2 steals group.** P1 activates red 2 targeting P2 group.  
Expected: red 2 exhausted; group moves to P1 side; individual card scoring ownership unchanged.

**DF-2-02 — Red 2 invalid target.** No opponent group.  
Expected: action rejected, card not exhausted.

**DF-2-03 — Red 2 sequential actions.** Two red 2s target distinct groups one after another.  
Expected: no simultaneous processing; each opens its own response window.

**DF-2-04 — Target group after prior red action.**  
Expected: only currently existing groups may be targeted; prior affected group is eligible only if present and valid under chain rules.

**DF-2-05 — Red 2 exhausted immediately.** Counter later occurs.  
Expected: red 2 remains exhausted.

**DF-2-06 — Black counter.** P2 counters P1's red 2.  
Expected: black 2 exhausted; targeted group restored to pre-action side; action undone as defined.

**DF-2-07 — Counter wrong actor.** P1 tries to counter P1 red 2.  
Expected: rejected.

**DF-2-08 — Counter no chain.** Black 2 counter mode outside red-2 response window.  
Expected: rejected; card remains unexhausted.

**DF-2-09 — Counter after merge.** Red action merged compatible group, then counter.  
Expected: merge attributable solely to action reversed; pre-existing unrelated membership preserved.

**DF-2-10 — Counter response alternation.**  
Expected: counters only by opponent of latest red-2 actor; LIFO action response.

**DF-2-11 — Chain exhausted.** No eligible responses left.  
Expected: latest red action stands and chain closes.

**DF-2-12 — Black 2 draw-seven.** Player chooses draw mode.  
Expected: black 2 exhausted; opponent receives seven via source priority.

**DF-2-13 — Black 2 modes chosen at activation.**  
Expected: cannot change counter/draw mode after resolution begins.

**DF-2-14 — Two black 2 draw-sevens consecutively.**  
Expected: permitted, each exhausted; each draw resolves independently.

**DF-2-15 — Draw-seven not a counter.**  
Expected: does not counter or reverse any red-2 action.

**DF-2-16 — Red 2 cannot after finalized end.**  
Expected: rejected.

## G. Eight substitutions

**DF-8-01 — Substitute own-group card.**  
Expected: 8 exhausted; 8 occupies target slot; logical identity and position preserved.

**DF-8-02 — Substitute opponent-group card.**  
Expected: target card removed; 8 occupies slot; removed card placed elsewhere legally; target's scoring owner is assigned by new placement.

**DF-8-03 — Removed card legal elsewhere.**  
Expected: substitution succeeds and card placement resolves immediately.

**DF-8-04 — Removed card cannot be played.**  
Expected: substitution rejected atomically; neither card moves nor 8 exhausts.

**DF-8-05 — Set-of-three exception.** Remove card and return it as fourth member.  
Expected: allowed only if unique logical identity and resulting set exactly four.

**DF-8-06 — Exception in run prohibited.**  
Expected: cannot return removed card to same run.

**DF-8-07 — Exception in full set prohibited.**  
Expected: cannot return removed card to four-card set.

**DF-8-08 — Run substitution preserves order.**  
Expected: 8 remains at target's logical position.

**DF-8-09 — Consecutive 8 substitutions.**  
Expected: each requires different active 8; both exhaust independently.

**DF-8-10 — Replace ordinary-play 8.**  
Expected: legal target; substitute's logical identity is that card's group identity.

**DF-8-11 — Replace substitute-8.**  
Expected: legal; new 8 assumes target identity; previously substituted physical card is immediately placed legally.

**DF-8-12 — Replace joker.**  
Expected: 8 assumes joker identity; joker removed and may be assigned new identity at immediate placement.

**DF-8-13 — Replace 8 in red-2-affected group before resolution.**  
Expected: rejected while red-2 window is unresolved.

**DF-8-14 — Replace after red-2 resolution.**  
Expected: legal if other validation passes.

**DF-8-15 — Discard-index substitution bottom.**  
Expected: selected card removed, legally placed; 8 inserted at same index.

**DF-8-16 — Discard-index substitution top.**  
Expected: same index/order rule; selected card legally placed.

**DF-8-17 — Discard substitution invalid target.**  
Expected: action rejected atomically.

**DF-8-18 — Discard pile order preserved.**  
Expected: cards below and above target retain their relative order; 8 occupies target index.

**DF-8-19 — Discard 8 later drawn.**  
Expected: exhausted physical 8 has no substitution ability; ordinary treatment applies.

**DF-8-20 — Special 8 exhausted once.**  
Expected: cannot be reused.

## H. Mandatory plays and discard

**DF-TURN-01 — Draw then mandatory loop.**  
Expected: draw first, then all ordinary plays resolved.

**DF-TURN-02 — Recheck after play.**  
Expected: new legal placements created by prior placement are discovered.

**DF-TURN-03 — Cannot skip mandatory play.**  
Expected: discard or turn completion rejected while mandatory ordinary play remains.

**DF-TURN-04 — Mandatory card not discardable.**  
Expected: reject discard of a card that has an available mandatory placement.

**DF-TURN-05 — Discard one.**  
Expected: exactly one card discarded to complete ordinary turn.

**DF-TURN-06 — Discard face-up.**  
Expected: ordinary discard visible.

**DF-TURN-07 — Turn ends after discard.**  
Expected: next player active unless chain/game-end window is pending.

## I. Going out and end game

**DF-END-01 — Going-out card removal leaves valid group.**  
Expected: final card placed is removed from group and discarded face-down; player goes out.

**DF-END-02 — Going-out removal invalidates group.**  
Expected: going out prohibited; player must leave a card and discard normally.

**DF-END-03 — Going-out response without black 2.**  
Expected: game finalizes; score once; +20 awarded.

**DF-END-04 — Black 2 continuation.**  
Expected: black 2 exhausted; player who went out draws seven; game resumes; no +20 yet.

**DF-END-05 — Subsequent end.**  
Expected: bonus applies only to final successful going-out player.

**DF-END-06 — Red 2 in going-out window.**  
Expected: rejected.

**DF-END-07 — 8 in going-out window.**  
Expected: rejected.

**DF-END-08 — Tie during continuation draw.**  
Expected: tie immediately; no going-out bonus.

**DF-END-09 — Face-down going-out discard.**  
Expected: concealed to players but engine tracks it; it remains top discard for fallback draw-seven.

**DF-END-10 — Score exactly once.**  
Expected: terminal scoring event cannot duplicate bonus or score calculation.

## J. Draw source priority and tie

**DF-SRC-01 — Draw-seven from discard pile first.** Seven discard cards available.  
Expected: all seven from discard, no draw-pile cards taken.

**DF-SRC-02 — Mixed discard/draw.** Three discard, four draw cards.  
Expected: 3 discard then 4 draw.

**DF-SRC-03 — Mixed with opponent hand.** Two discard, three draw, two opponent cards.  
Expected: 2+3+2, opponent cards selected blindly.

**DF-SRC-04 — Empty discard.**  
Expected: draw pile used next.

**DF-SRC-05 — Empty draw pile.**  
Expected: opponent hand used after discard pile.

**DF-SRC-06 — Insufficient total sources.**  
Expected: tie, immediate score, no bonus.

**DF-SRC-07 — Blind draw.** Script random card from opponent hand.  
Expected: chosen card transferred; opponent's remaining hand stays hidden.

**DF-SRC-08 — Blind card is playable.**  
Expected: mandatory-play loop reevaluated after draw is resolved.

**DF-SRC-09 — Opponent hand empty.**  
Expected: if draw requirement unmet, tie.

**DF-SRC-10 — Both hands empty and draw pile empty.**  
Expected: tie terminal.

## K. Scoring

**DF-SCORE-01 — Low table card.** 5 table.  
Expected: +5.

**DF-SCORE-02 — Face table card.** J table.  
Expected: +10.

**DF-SCORE-03 — Ace table.**  
Expected: +15.

**DF-SCORE-04 — Low hand card.** 5 hand.  
Expected: -5.

**DF-SCORE-05 — Face hand card.** Q hand.  
Expected: -10.

**DF-SCORE-06 — Ace hand.**  
Expected: -15.

**DF-SCORE-07 — Joker hand.**  
Expected: -10.

**DF-SCORE-08 — Joker table.** Joker logical identity 6.  
Expected: +5.

**DF-SCORE-09 — Substitute 8 table.**  
Expected: substitute physical 8 contributes zero.

**DF-SCORE-10 — Removed card scoring.** Card from substitution placed elsewhere.  
Expected: that physical card scores for its new owner once.

**DF-SCORE-11 — Special 2 exhausted.**  
Expected: zero.

**DF-SCORE-12 — Special 8 exhausted.**  
Expected: zero.

**DF-SCORE-13 — Unplayed 2/8.**  
Expected: -5 each.

**DF-SCORE-14 — Ordinary table card ownership.** P2 adds card to P1-side group.  
Expected: score belongs to P2.

**DF-SCORE-15 — Red-2 group transfer.**  
Expected: group-side transfer does not change card-level score ownership.

**DF-SCORE-16 — Going-out bonus.**  
Expected: +20 to final going-out player only.

**DF-SCORE-17 — Tie bonus.**  
Expected: no +20.

**DF-SCORE-18 — Excluded zones.** Draw/discard cards.  
Expected: neither zone contributes score.

**DF-SCORE-19 — No double count.** Substitute 8 and substituted card.  
Expected: physical cards each counted once, substitute-8 zero.

**DF-SCORE-20 — Score idempotency.** Invoke scoring twice in test harness.  
Expected: stored terminal score is not incremented twice; calculation is pure or guarded.

## L. Cumulative mode

**DF-MATCH-01 — Single game.**  
Expected: compare game scores; no match target.

**DF-MATCH-02 — Below target.** Both totals below 200.  
Expected: another game begins.

**DF-MATCH-03 — One reaches target.** P1 reaches 200 after a game.  
Expected: P1 wins match.

**DF-MATCH-04 — Both reach target same game.** P1 higher cumulative.  
Expected: P1 wins.

**DF-MATCH-05 — Both totals equal or same-game tie at target.**  
Expected: continue; carry totals; determine winner after completed game when one leads.

\---

## 20\. Implementation checklist

* \[ ] Unique card IDs and deterministic zone transitions.
* \[ ] Seedable shuffle/random source.
* \[ ] Atomic validation/rollback for rejected actions.
* \[ ] Mandatory-play loop recomputed after each placement.
* \[ ] Logical identity and physical identity stored independently.
* \[ ] Stable group IDs and member ordering.
* \[ ] Card-level scoring ownership independent of group-side ownership.
* \[ ] Special 2/8 abilities exhaust immediately and cannot be reused.
* \[ ] Red-2 chain action stack/response windows.
* \[ ] Counter rollback preserves later unrelated edits.
* \[ ] 8 substitution validates immediate placement before committing.
* \[ ] Discard pile index and order semantics.
* \[ ] Hidden-hand and face-down going-out discard visibility.
* \[ ] Draw-seven source priority and tie detection.
* \[ ] Scoring function counts each physical card once.
* \[ ] Terminal scoring and bonus guarded against duplicate execution.
* \[ ] Full acceptance suite DF-SET through DF-MATCH implemented.

\---

## 21\. Resolved-rule choices and rationale

These choices are adopted to eliminate implementation ambiguity; they are defaults of this specification rather than claims that every earlier wording was explicit:

1. **Opening pool bottom order:** canonical order is revealed draw card, P1 bet, P2 bet, preserving this order. This avoids nondeterministic bottom stacking.
2. **Group merging on red 2:** merge only when compatible and merge is explicitly chosen; otherwise keep groups distinct. No automatic invalid merge.
3. **Counter rollback:** reverse only the red-2 transfer and merge attributable to that action, preserving subsequent unrelated modifications.
4. **Red-2 chain:** sequential, stack-like, counter response applies to the latest unresolved action; players alternate and cannot counter their own red 2.
5. **Going-out card:** final card placed is face-down discarded, but only if the remaining group is still valid; otherwise player cannot go out that turn.
6. **Going-out draw-seven continuation:** the going-out player resumes as next active player after receiving cards, with going-out discard retained.
7. **Tie:** immediate score with no +20.
8. **Blind opponent-hand draws:** uniform random selection, scripted in tests.
9. **Cumulative target:** default 200; higher cumulative total wins if both cross in the same completed game; tied totals continue.
10. **Indexed discard pickup:** selected non-top card (including selected top through the indexed option) must be legally placed. The separate top-discard option permits retention.
11. **Substitute scoring:** physical substitute 8 scores zero; target card's physical identity/value is scored once after its new placement; never double count.
12. **Special exhaustion:** activation exhausts immediately even if countered; rejected/invalid actions do not exhaust.
13. **Card ownership:** ordinary card placement assigns ownership to the player who placed it; red-2 group movement changes group side, not individual scoring ownership.
14. **Two consecutive black 2s:** permitted for two draw-seven actions, or where chain rules create a legal intervening response; no self-counter.

This is the deterministic implementation contract. If the table rules are later changed, update this document and the associated test fixtures together.

