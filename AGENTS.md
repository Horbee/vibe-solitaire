# Solitaire (Klondike) — Agent Guide

WebGL Klondike solitaire: pure TypeScript game engine + Three.js renderer + DOM HUD, packaged as an offline PWA. Toolchain is **Vite+** (`vp` CLI), pnpm, TypeScript.

## Commands

Use the Vite+ built-ins, not npm scripts:

| Task                                | Command                                 |
| ----------------------------------- | --------------------------------------- |
| Dev server                          | `vp dev`                                |
| Tests (Vitest, single run)          | `vp test`                               |
| Format + lint + typecheck           | `vp check` (auto-fix: `vp check --fix`) |
| Production build (+ service worker) | `vp build`                              |
| Preview the build                   | `vp preview`                            |

Completion bar for any change: `vp check`, `vp test`, and `vp build` all green.

## The one rule that matters

**`src/game/` never imports rendering, DOM, or Three.js.** The engine is pure:
state is plain JSON-serializable data, mutated only through `applyMove(state, move)`
which returns a new `structuredClone`d state (or `null` when illegal). Everything
reusable — hints, the solver, undo — is built on that purity. Violations break the
architecture; keep the seam.

Layers and the direction of dependency (lower never imports higher):

1. `src/game/` — engine: types, seeded shuffle/deal, rules, moves, history, hint, solve.
2. `src/audio/` — procedural WebAudio SFX (`createSoundEngine`): oscillators + filtered
   noise, no asset files. Imports nothing; render/input/controller emit cues, the HUD
   owns the mute toggle, `main.ts` wires it up.
3. `src/render/` — Three.js: atlas (procedural SVG card art), layout (fixed world-space
   board coordinates), scene, cards, input, anim. Imports `game` and `audio`.
4. `src/controller.ts` — orchestration: owns `state`, history, timer, solver playback;
   fires animations; imports both. HUD and input never talk to the engine directly.
5. `src/ui/` — DOM HUD and stats store. Subscribes to controller events; calls gated
   controller methods.

## Animation model (learned the hard way)

`render/index.ts` is **pose-diffing**: `animateStateChange(prev, next)` computes the
absolute pose (x/y/z/faceUp/pile) of every card in both states and tweens what changed.
Undo/redo/solve/deal all flow through the same path.

Timing discipline — follow it when adding transitions:

- **Never let two tweens cross paths.** Move+flip pairs on the same pile are ordered
  directionally: a mover _arriving_ waits for the cover flip to finish; a mover
  _leaving_ goes first, then the reveal. Stock draws: waste shifts fast first, drawn
  cards fly 110 ms later with 90 ms stagger. Recycle sweeps ripple 8 ms/card.
- **Flipping cards lift high** (`FLIP_LIFT` 1.0 in-place, `MOVE_FLIP_LIFT` 0.55 when
  moving) and spin only between 30–85% of the flight, so silhouettes never sweep
  neighboring piles and cards land flat.
- Per-card tweens are keyed (`animator.add({key: cardId})`) — a new tween cancels the
  in-flight one, then every `animate*` call ends with an exact `syncState`.
- Camera is a tilted orbit: the rig fits to `contentBottom(state)` (deepest tableau
  card), not the static worst-case `BOARD_H`, so landscape stays zoomed in on the
  cards. Tilt scales with viewport aspect (`tiltForAspect`: subtle on wide
  screens, up to `MAX_TILT` on tall phones — the "seated at the tableau side of
  the table" view: the camera sits below the board, so near tableau rows render
  large at the bottom of the screen while the stock/foundations recede, instead
  of letterboxing the board in empty felt).
  The orbit radius is solved numerically: binary search over the projected board
  corners (`fitTarget` in `render/scene.ts`). The tween lives in the rig
  (`fitBounds(bottom, animate)`, ticked via `rig.tick()`), deliberately NOT in the
  shared `Animator` — `syncState`'s `cancelAll` must not cut it short. Resizes
  snap; state-driven refits glide.
- **Manual zoom** multiplies the fit radius: `rig.zoomBy(scale)` (clamped to
  `MIN_ZOOM`/`MAX_ZOOM` in `render/scene.ts`) refits immediately and the factor
  survives resizes and state refits. Input: mouse wheel (`WHEEL_ZOOM_RATE`, exp
  curve) and two-finger pinch (`beginPinch` in `render/input.ts` — a second finger
  cancels any pending drag/tap; extra fingers join the pinch).

## Conventions & gotchas

- **Input**: pointer events only (mouse+touch unified). `dblclick` is mouse-only;
  double-tap is detected from raw `pointerup`s (see `DOUBLE_TAP_*` in `render/input.ts`).
  Double actions aimed at the stock mean "draw twice", never a sweep. Right-click
  card → foundation; right-click felt → sweep (`autoCollectMoves`, lowest-rank-first,
  per-card undo steps).
- **Deals are seeded** (`mulberry32`); `deal(seed, drawMode)` is deterministic. Keep it
  that way — seeded games are how bugs get reproduced.
- Tests live in `tests/` (mirroring `src/`), import from `vite-plus/test` (Vitest is
  bundled; there is no `vitest` dependency). Build hand-crafted states with the
  `c()`/`makeState()` helpers in `tests/game/helpers.ts`.
- tsconfig sets `erasableSyntaxOnly` — **no parameter properties** (`constructor(private
  x)`) or enums; declare fields and assign in the constructor. `verbatimModuleSyntax`
  requires `import type` for type-only imports.
- `vp check --fix` **reformats your files while it runs**. After invoking it, re-read
  any file before editing — whitespace-sensitive edits will otherwise fail.
- `workbox-window` is a direct devDependency on purpose: pnpm's strict layout otherwise
  breaks resolution of `virtual:pwa-register` under Rolldown. Do not remove it.
- Card art is generated SVG in `render/atlas.ts` (13×4 faces + 1 back tile, one shared
  texture), not asset files. PWA icons in `public/` were rasterized from `icon.svg` via
  headless Chrome.
- **Sound cues ride the animation timeline**: `render/index.ts` fires `flip` at the
  tween's 57.5% spin midpoint and `land` at arrival; `_recycle_` sweeps tick per card.
  Cues are scheduled on the AudioContext clock (`play(cue, delayMs)`), never setTimeout.
  Before the first pointer gesture the context is suspended and cues drop silently;
  identical cues are throttled (~20–90 ms per kind) so solve/undo bursts stay musical.
  Mute persists in `localStorage` key `solitaire.audio.v1`; all timbres are constants
  at the top of `audio/index.ts` (`GAIN`, `THROTTLE_MS`, `WIN_NOTES`) — tweak there.
- Scoring lives in one constant (`SCORE` in `game/types.ts`); tweak there only.

## Git

Conventional commits (`feat(scope): …`, `fix(scope): …`), work done to the green bar
above before committing. Only commit/push when explicitly asked.
