# Drunken Frenchman — pass-and-play, runs locally

A complete implementation of *Drunken Frenchman — Formal Game-Engine Specification v1.0* as a localhost website.
No installs, no internet, no dependencies: just Node.js (or Python 3 as a fallback).

## Play it (from the GitHub zip)
1. On GitHub click **Code → Download ZIP**, then unzip it anywhere.
2. Start the game:
   - **Mac:** double-click **`Start-Mac.command`**.
   - **Windows:** double-click **`Start-Windows.bat`**.
3. Your browser opens the game (http://localhost:8765). Keep the little window open while you play; close it to stop the game.

Nothing needs installing. The launcher hosts the game with Node.js, Python, or (on Mac) the Ruby that ships with macOS, whichever it finds.
If it finds none of them it opens the game straight from the folder, which plays exactly the same.

**Simplest of all:** double-click **`index.html`** in the unzipped folder. It opens the game with no server and no launcher.

### First-run security prompts (normal for downloaded files)
- **Mac:** if macOS says the `.command` file "can't be opened" because it is from an unidentified developer, **right-click it → Open → Open** (once). If it says you don't have permission to run it, open Terminal, type `bash ` (with a space), drag the file into the window, and press Return. Or just use `index.html`.
- **Windows:** if "Windows protected your PC" appears, click **More info → Run anyway**. Or just use `index.html`.

### Other ways to start it
- Terminal: `node server.js [port]` or `python3 serve.py [port]`; add `--no-open` to stop it opening the browser. If the port is busy it tries the next one.
- Linux: `./start.sh`.
- Maintainers: GitHub's web uploader drops the "executable" flag, so after uploading run `git update-index --chmod=+x Start-Mac.command start.sh serve.py` and commit. (`.gitattributes` already keeps line endings correct for the launchers.)

Cards are drawn with CSS (no image files). Games autosave in your browser; "Resume saved game" appears on the menu.

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
- `server.js` / `serve.py` — local servers; `Start-Mac.command`, `Start-Windows.bat`, `start.sh` — launchers; `index.html` — no-server entry point

## Interpretation choices (where the spec was silent, inconsistent, or you directed otherwise)
See `DEVELOPMENT_NOTES.md` for the full rule-by-rule audit. In short:
- **Special actions** (red 2, black 2 draw-seven, 8) are legal only after your draw and before your discard (SP-05). Outside your own turn, a black 2 can only be played in the red-2 counter window or the going-out window.
- **Red 2:** groups never merge (R2-04); only a black 2 can answer a red 2 (R2-06); a counter just sends the group back (R2-07).
- **Replacing a substitute 8** sends the old 8 to the exhausted pile (8-SUB-05).
- **Match target:** the spec's own text is 200 (the 1000 in §17 is a leftover); editable on the setup screen.
- **Going out:** by playing your last card (it goes face-down) or, per your ruling, by discarding your last card (face-down). Only a black 2 may answer; the black-2 player's victim then resumes as next active player (§10.8).
- **Jokers, 2s and 8s are never forced** into a group by the mandatory-play loop (your ruling). A card picked up from deep in the discard pile must still be placed.
- **Stalemate tie** is an optional house rule on the setup screen, **off by default**, because the spec's game-end list (§13) has no such rule.
- **Two jokers as opening bets:** Joker-1 beats Joker-2 (deterministic tie-break).
