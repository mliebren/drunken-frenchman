# Development notes — rules audit against the updated spec

**Authoritative document:** `Drunken_Frenchman_Rulebook_Clean_Engine_Spec.md` (the updated spec in the project).
The older plain-language rules file is no longer used. Where the updated spec's *rule sections* (§6–§13, rules `SP-xx`, `R2-xx`, `B2-xx`, `8-SUB-xx`, `DR-xx`)
disagree with its own legacy material (the acceptance-test catalogue and §19 "resolved choices", which still mention merges and a LIFO chain),
I followed the rule sections and the newer integration tests (`DF-SP-INT-xx`).

**Results:** `npm test` → 33 engine tests, 300-game fuzz (zone invariants), bot tests. All pass.

## A. Changes made (engine behaviour that did not match the spec)

| # | Rule | Before | Now | Why |
|---|------|--------|-----|-----|
| 1 | **SP-05** Action timing | Special actions were also allowed *before* the draw. | Red 2, black 2 (draw-seven) and 8 are accepted only in `MANDATORY_PLAY` (after the draw, before the discard), plus the two response windows. The UI hides the special buttons before the draw; the bot no longer plays specials pre-draw. | SP-05 lists the only legal windows; "before the draw" is not one of them. |
| 2 | **R2-04** Merge is not automatic | Red 2 offered an optional merge into one of your groups, with merge-reversal logic on counter. | Merging removed entirely (engine, UI prompt, bot). A stolen group always stays a separate group. | R2-04 says transferred groups remain separate. The optional merge came from the older text. |
| 3 | **R2-06 / DF-SP-INT-04** No red-on-red | Chain stack: a red 2 could answer a red 2, with LIFO counters. | One red 2 opens one window. Only a black 2 counter (or letting it stand) is legal. Playing another red 2 is a *new* action after the window closes (DF-2-03). Chain state is now `{actor, responder, targetId, fromSide, resume}`. | R2-06: "A red 2 cannot be played as a response to a red 2 … not simultaneous … no multi-red stack." |
| 4 | **R2-07** Counter resolution | Rollback via snapshots of groups and merges. | Counter simply restores the group's side; per-card scoring owners were never touched (R2-03). | Simpler and exactly what R2-07 describes. |
| 5 | **8-SUB-05 / SP-INT-10 / SP-04** Replacing a substitute 8 | The removed substitute 8 had to be re-placed as an ordinary 8. | The old substitute 8 goes to the visible exhausted pile; nothing is re-placed. `eightPlacements` returns a single `{kind:'exhaust'}` option and the UI applies it directly. Replacing an *ordinarily played* 8 still re-places it (DF-SP-INT-09). | 8-SUB-05 is explicit. (DF-8-11's wording about re-placing conflicts with 8-SUB-05/SP-INT-10; the rule text wins.) |
| 6 | **§13 Game-end conditions** | I had added a stalemate tie (6 rounds, empty draw pile, nothing played). | Removed from the default game. It survives only as an **opt-in house rule** (setup checkbox, off by default). | §13: the game "ends only on" going out or the listed ties. Without any such rule, degenerate endings can loop (empty piles, 1–3 card hands where every play is forbidden); bot-vs-bot hits this in ~1% of games. The checkbox gives you an escape hatch without changing the rules by default. |

Supporting changes: the engine records `lastTaken` (informational) so the bot can avoid trading the same card back and forth; the "Used 2s" pile label became "Used cards" because exhausted 8s now land there too; rules popup/README updated.

## B. Rulings you gave that go beyond the spec text (kept, and labelled as such)
- **Jokers, unused 2s and 8s are never forced into a group** by the mandatory-play loop (spec §6 literally lists 2s/8s among ordinary placements; you ruled they are exempt). Exception kept from §7.3: the card picked up from deep in the discard pile *must* be placed. Exhausted 2s/8s (ability used) are ordinary cards again.
- **Discarding your last card is going out** (face-down, black-2 window opens). You ruled this is correct; the spec's §10 only describes going out by placement, which is also supported (last placed card goes face-down, only if its group stays valid).

## C. Audited and already compliant (no change)
Setup/Hand of Crap redeal (§4); opening bet ordering, pool selection, canonical bottom order, "counts as first draw" (§5); mandatory loop recomputation and discard block (§6); top-discard vs indexed pickup, must-place rule (§7); set/run validation, Ace-high-only, 3–13 run length, 3–4 set size (§8.1–8.2); ownership by placer and side vs. owner separation (§8.3–8.4, R2-03); joker fixed identity and the "once among sets, once among runs" uniqueness rule (§8.5); atomic validation via cloned state (SP-03); red-2 target must be on opponent's side, invalid target rejected without exhausting (R2-02, R2-09); counter only by opponent, only in window, wrong-actor rejected (B2-02); draw-seven source order, tie when < 7 available, no partial draw (DR-01, B2-04); draw-seven not usable as a counter (B2-05); multiple draw-sevens allowed (B2-06); 8 on table (any member incl. ordinary 8, substitute 8, joker), same-group return only for set-of-three (8-SUB-03/07/11); discard-pile 8 keeps order and exhausts the 8 (8-SUB-09); consecutive 8s need different active 8s (8-SUB-10); going-out validity check, face-down discard, only black 2 may respond, red 2 / 8 refused, +20 only if the window closes, black-2 continuation resumes the going-out player (§10.1–10.8); empty-state ties (DR-05); scoring tables, substitute 8 = 0, exhausted = 0, each card once, score guarded to run once (§12–13); cumulative match (§16).

## D. Known gaps / judgment calls to be aware of
- §10.8 says the going-out discard "remains in the discard pile" while DR-01 / DF-END-09 say it is the top discard drawn first by draw-seven. I follow DR-01/DF-END-09, so the going-out player draws that card back as the first of the seven.
- The bot never plays a 2 or 8 ordinarily until it holds 5 or fewer cards, and only responds to windows out of turn (a strategy choice, not a rules limit).
- Because no stalemate rule is on by default, a human-vs-bot game can in rare degenerate endings continue indefinitely; enable the house-rule checkbox at setup if you want those games to end in a tie.
