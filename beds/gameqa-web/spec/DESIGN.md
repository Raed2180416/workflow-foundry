# Lantern Vault: design document for QA (build under test)

Lantern Vault is a one-level, top-down grid game in the browser. You are a courier who must reach the vault exit.
This document says how the game is **meant** to work. Anything the build does differently is a bug. Some behaviour
below looks odd but is intended; it is marked *(by design)*.

## 1. Map and legend

The level is a 14 x 10 grid. Coordinates are `(x, y)`, with `(0, 0)` the top-left corner; x grows to the right and
y grows downwards. The player starts at `(1, 1)`.

| Tile | Meaning |
|---|---|
| `#` | wall: solid |
| `.` | floor |
| `c` | coin |
| `g` | gem |
| `R` | relic |
| `k` | key |
| `D` | locked door; `/` is a door that has been opened |
| `=` | gate: solid while closed, floor while open |
| `L` | lever: stand on it and press `use` to open or close every gate |
| `^` | spikes |
| `h` | heart |
| `E` | exit |

Enemies (slimes) are not tiles; their positions are listed separately in the state.

## 2. Ticks and input

- The game advances in **ticks**. In the test harness one action token is one tick.
- During a tick the game reads the keys pressed in that tick, **in the order they were pressed**.
- **Pause** (`P` or `Escape`) takes effect immediately. When the game becomes paused, the rest of that tick's
  input is ignored, and nothing else happens in that tick.
- **One move per tick.** Of the movement keys pressed in a tick while the game is running, only the last one
  counts: the player makes at most one move (a step or a dash) per tick.
- A **running tick** is a tick in which the game is playing once its input has been read. In a running tick, in
  this order: `use` acts on the tile the player stands on at the start of the tick; the player makes the tick's
  move; the enemies move and contact is checked; then, if the game is still playing, the timer drops by 1 and the
  dash recharge, the invulnerability count (except in the tick in which you reappear, section 5) and the toast
  timer each count down by 1.
- If the game is not playing at the end of a tick's input (paused, or a dialog is open), nothing moves that tick
  (player, enemies, timer, toasts).

## 3. Movement

- **Step** (arrow key): move one tile up, down, left or right. Walking into a wall or a closed gate does nothing
  (a "bump"). There is no diagonal movement.
- **Locked doors.** Walking into a locked door while holding at least one key opens it, uses up one key, and moves
  you into the doorway in the same step. Without a key it is a bump.
- **Dash** (Shift + arrow): move up to **two** tiles in a straight line. The dash stops before the first solid tile:
  walls, closed gates and locked doors (a locked door is solid to a dash even if you hold a key; an opened door is
  floor). If the very first tile is solid the dash does not happen and is not used up. A dash collects items on
  every tile it passes and triggers spikes and the exit like a step.
- **Dash recharge.** A dash sets the recharge to 6, and it counts down at the end of every running tick (section 2),
  so right after a dash the HUD shows `Dash 5`. While it is above 0, Shift + arrow is an ordinary step; at 0 the
  HUD shows `Dash ready` and Shift + arrow dashes again.
- *(By design)* a dash passes over an enemy on its middle tile without harm.

## 4. Items and score

| Item | Effect |
|---|---|
| coin | +100 score, coins +1 (the level has 5 coins) |
| gem | +5,000 score |
| relic | +20,000 score |
| key | keys +1. The level has exactly as many keys as locked doors, so it can always be finished without restarting. |
| heart | +1 life, up to the maximum of 5 lives. With 5 lives a heart gives +500 score instead *(by design)*. |

- Items disappear when collected and never come back (except on a restart).
- Score is never negative and is capped at 999,999.
- Completing the level adds a **time bonus** of 10 points per tick left on the timer.

## 5. Lives, hazards and enemies

- The player starts with 3 lives (maximum 5).
- **Spikes** cost one life and **500 points** (the score stops at 0, it never goes below). Spikes always hurt,
  even right after a respawn.
- **Enemies** patrol back and forth along a straight route, moving one tile **every other tick** and turning
  around at obstacles. Touching an enemy costs one life (no points). Touching means ending a tick on the same tile
  as an enemy **or** swapping tiles with an enemy in the same tick (you step onto its tile while it steps onto yours).
- After losing a life you reappear at the start `(1, 1)`. **You keep everything you have collected**, including
  keys picked up in the same tick. Enemies cannot hurt you during the tick in which you reappear nor during the
  next 4 ticks; `invulnerable` in the state shows how many of those ticks are left *(by design; spikes still hurt)*.
- At 0 lives the game is over: the "Game over" dialog appears with a **Retry** button.

## 6. Timer and completion

- The timer starts at 300 and drops by 1 at the end of every running tick (section 2). When it reaches 0 you lose
  a life and the timer resets to 300.
- Stepping onto the exit completes the level: the "Level complete!" dialog shows the score, the time bonus and a
  **Finish** button. Finish shows the victory dialog with a **Play again** button.

## 7. Pause menu and dialogs

- `P` or `Escape` pauses the game and opens the pause menu (buttons **Resume** and **Restart level**). Pressing
  `P`, `Escape` or `Enter`, or clicking **Resume**, closes it and the game continues exactly where it was.
- **Restart level** puts the whole level back to its starting state (score 0, 3 lives, all items back) and the game
  is running again straight away.
- `Enter` activates the dialog's main button (Resume, Finish, Retry, Play again).
- Every visible button must be clickable: nothing may cover it.
- While the game is paused nothing moves and the timer, dash recharge and toasts (short messages such as
  "Key collected") are frozen *(by design)*.

## 8. HUD

The HUD bar always shows the **current** values: `Score`, `Lives`, `Keys`, `Coins n/5`, `Time` (ticks left) and the
dash status (`Dash ready` or `Dash n`, the ticks until it is ready).

## 9. Test harness (how you interact)

You act through action tokens; each token is one tick:

| Token | Meaning |
|---|---|
| `up` `down` `left` `right` | step |
| `dash-up` `dash-down` `dash-left` `dash-right` | dash (Shift + arrow) |
| `use` | Space (use the lever you stand on) |
| `pause` | the `P` key; `esc` is Escape; `enter` is Enter |
| `wait` | no input for one tick |
| `click:<id>` | a mouse click at the centre of the button with that id: `btn-resume`, `btn-restart`, `btn-next` (Finish), `btn-retry`, `btn-again` (Play again). Whatever is on top at that point receives the click. A click on a hidden button does nothing. |
| `a+b` | keys pressed in the same tick, in that order (for example `down+right`, `pause+left`); up to 3 key tokens |
| `goto:x,y` | harness macro: walk the shortest path to (x, y) on the map as it is when the macro starts, avoiding spikes and the exit (unless one is the target) and ignoring enemies; it expands into ordinary steps, one per tick. If (x, y) cannot be reached it expands to nothing. If something interrupts the walk (a hit, a dialog), the remaining steps are still pressed. |

Every run starts from a fresh game created with a **seed** (an integer 1..1,000,000). The seed sets the enemies'
starting positions, directions and timing; the same seed and the same tokens always produce exactly the same game.

After each tick the harness reports:
- **state** (the game's test API): `frame`, `clock` (running ticks), `mode` (`playing`, `paused`, `complete`,
  `gameover`, `won`), `dialog`, `player {x, y}`, `lives`, `score`, `keys`, `coins`, `coinsTotal`, `gems`, `relics`,
  `timeLeft`, `dashCooldown`, `dashReady`, `invulnerable`, `gateOpen`, `bonus`, `toast`, `enemies [{id, x, y, axis,
  dir}]`, `events` (what happened this tick, e.g. `move`, `bump`, `dash`, `coin`, `key`, `door-open`, `hit`,
  `spikes`, `respawn`, `pause`, `resume`, `restart`, `level-complete`) and `tiles` (the current map rows);
- **HUD**: the text of each HUD field as displayed;
- **UI**: each dialog, button and toast with `visible`, its text and rectangle, and for buttons `top`: whether the
  button itself is the topmost element at its centre (that is, whether a click there would reach it).

A run may hold at most 400 tokens. A bug report gives the bug class (`collision`, `state_desync`, `softlock`, `ui_overlap`, `score_overflow`,
`input_race`), a title, what was observed and expected, the seed, and the **shortest** list of tokens that
reproduces the bug from a fresh game with that seed. Reports are checked by replaying exactly those tokens from a
fresh game with that seed: a report whose tokens do not show the bug, or that still show it with any one token
removed, does not count as a minimal reproduction.
