# Agent instructions — building games that support playtest-link

Hand this file to any agent building or maintaining a browser game that should support
player-invoked debugging. These are OUTCOME requirements — how you implement them is your
call, but every bar must hold.

## When building a new game

1. **Render to a single canvas.** The capture rig records one canvas element. Overlay UI
   (HUD, menus) may be DOM, but know that DOM is invisible in captured clips — anything
   diagnostic must be visible in the canvas or included in `getState`.

2. **Include and initialize the client:**
   ```html
   <script src="playtest-link.js"></script>
   ```
   Call `PlaytestLink.init({...})` once your game loop and state exist (see README for
   the config contract). Choose `mark`/`invoke` keys that don't collide with gameplay.

3. **Write an honest `getState`.** Small JSON (< ~1KB), sampled 4×/sec: position, area
   name, health, current objective/phase, and whatever else a debugger would want to know
   about "where the player is and what's happening". Include an AREA/ZONE NAME — position
   numbers alone force the reader to do archaeology.

4. **Push gameplay events as they happen** via `PlaytestLink.event(name, data)`:
   damage taken (with source), kills, deaths, door/gate interactions, pickups, area
   transitions, objective changes. The event log is how a report's video gets explained.

5. **Implement `getAim`** if the game has any aiming: return a short human-readable
   description of what's under the crosshair ("stalker 3.1m", "wall 'H' (18,27) 4m").
   This lets "look at THIS thing" reports name their subject exactly.

6. **Stamp a `version.json` into every build** (any changing string). The client polls it
   and offers players a reload toast when a fix ships mid-session.

7. **Expose test hooks** on a `__game` global: at minimum `teleport/setPos`, an aim
   setter, and a renderer-level screenshot function if your WebGL context doesn't
   support `canvas.toDataURL` readback (contexts without `preserveDrawingBuffer` return
   blanks — provide `__snap()` doing a fresh render + readback). Agents diagnose reports
   by re-visiting reported positions; make that possible headlessly.

## Map/level authoring requirements (hard-won — do not skip)

8. **Author levels as NAMED DATA, not imperative geometry calls.** A level must be a
   declarative structure of entries with ids and semantic types
   (`{id:'ne-stair', type:'stair', from:[...], to:[...]}`) rendered by a generic pass —
   never hundreds of anonymous `box(...)` calls. Names carry intent across sessions;
   data renders as a plan; edits become list mutations. (Original Quake's `.map` source
   vs compiled BSP is the model: keep a source format, compile for runtime if needed.)

9. **Keep nav/AI data colocated with or derived from the level data** — hand-maintained
   parallel nav graphs drift from geometry with every edit.

10. **Design changes are proposals, not fixes.** For spatial/feel changes: render the
    change from multiple eye-level positions (and ideally a walkthrough video along the
    affected route) and get a human verdict before shipping. Function bugs can ship on
    green tests; FEEL has no test — the player is the fitness function.

## When maintaining/fixing a game with playtest-link installed

- Reports arrive as bundles: `meta.json` (complaint, snapshot, aim, marks, events, state
  timeline) + `clipN.webm`. Read the meta FIRST — zone/aim/marks usually localize the
  issue before you watch anything. Extract clip frames (ffmpeg) around mark timestamps.
- Re-visit the reported position headlessly (test hooks + `__snap`) before and after your
  change; compare against the player's clip frame.
- One report class per fix commit; deploy; the version toast tells the player to reload.
