# Drunken Frenchman — pass-and-play, runs locally

A complete implementation of *Drunken Frenchman — Formal Game-Engine Specification v1.0* as a localhost website.
No installs, no internet, no dependencies: just Node.js (or Python 3 as a fallback).

## Run it
- **macOS / Linux:** `./start.sh`
- **Windows:** double-click `start.bat`
- or: `node server.js [port]` (default port 8765), then open **http://localhost:8765**
- No Node? `python3 serve.py` serves the same files.

Cards are drawn with CSS (no image files). Games autosave in your browser; "Resume saved game" is on the menu.

## House rules in this build
- **Special cards are never forced:** a joker or an unused 2 or 8 (alone or as part of a group) does not have to be played, even when it could be. You can still play them ordinarily if you want. The one exception is the card you pick up from deep in the discard pile, which must be placed. Used (exhausted) 2s/8s are ordinary cards again.
- **Going out:** discarding your last card also counts as going out (the card goes face-down). The opponent may answer only with a black 2; red 2s and 8s are refused in that window.
- **Hand order:** ordinary cards sorted by rank, then suit; jokers, 2s and 8s sit together at the right end behind a divider.

## Single player (vs the bot)
Choose **Play against the bot** on the setup screen. You are seat 1; Marcel (the bot) is seat 2, so there are no hand-over screens.
The bot plays through the same engine actions as you, sees only its own hand plus public information, and uses a fixed, moderate strategy
(no difficulty setting): it values pairs/near-runs, picks up discards that help, steals rich groups with red 2s, counters with black 2s,
swaps high-value opponent cards with 8s, and discards its least useful card. It beats a naive player roughly 4 games in 5.
`public/bot.js` holds all of its logic.

## How pass-and-play works
Whenever the next decision belongs to the other player, a hand-over screen hides everything until they tap *I'm …*.
This also covers secret opening bets, red-2 counter windows and the going-out black-2 window.

## Tests
`npm test` (or `node test/engine.test.js && node test/fuzz.test.js`) runs acceptance-style tests from the spec
catalogue plus a 300-game random-play fuzz that checks every card is always in exactly one zone, and bot tests (bot-vs-bot games always finish; the bot beats a naive player).

## Files
- `public/engine.js` — the rules engine (pure, seedable, atomic actions; browser + Node)
- `public/app.js`, `style.css`, `index.html` — UI
- `server.js` / `serve.py` — local servers

## Interpretation choices (where the spec was silent or inconsistent)
- **Match target:** §17 says both 1000 and 200; I used **200** (matches §21 and the DF-MATCH tests). It is editable on the setup screen.
- **Out-of-turn 2s:** red-2 responses/counters and the going-out black 2 are real response windows. Otherwise a player may play a 2 at the very start of their own turn (before drawing), which is equivalent in hot-seat play.
- **Going-out + black 2:** draw-seven takes the discard pile top-down, so the face-down going-out card is the first card the going-out player draws back (per §15 / DF-END-09).
- **Stalemate rule (added):** if the draw pile is empty and no card is played for six rounds, the game ends as a tie, because the spec otherwise allows two players to trade the same discard forever.
- **Two jokers as opening bets:** Joker-1 beats Joker-2 (deterministic tie-break).
- **Discarding your last card** (not by going out) just ends the turn; only emptying by group play is "going out".
- **Identity rule:** a given rank+suit identity may appear once among sets and once among runs, so a removed card from an 8-swap normally lands in the opposite group type.
