# playtest-link

**Player-invoked interactive debugging for browser canvas games.** The player hits a key
mid-game, types "this sucks, why?", and the developing agent instantly receives: the last
5–20 seconds of gameplay **video**, a synchronized **state timeline**, a gameplay **event
log**, timestamped **marks**, and whatever was under the player's **crosshair** — enough
context to diagnose most issues without reproducing anything.

Born July 2026 on two live games (a raycast FPS and a three.js multiplayer arena FPS).
First field session: 9 player reports across both games → 6 fixes deployed at roughly
**4 minutes per bug**, including geometry fixes diagnosed entirely from the bundles.

## How it works

```
game canvas ──captureStream──► MediaRecorder ring (always 5–20s playable webm)
game state  ──4Hz sampler────► state timeline ─┐          (same clock)
gameplay    ──event() calls──► event log ──────┤
player      ──M key──────────► marks ──────────┤
player      ──T key / 📣─────► report box ─────┴──► POST /invoke ──► relay
                                                             │
                              bundle on disk (meta.json + clips) + Discord post
```

- `playtest-link.js` — the drop-in client (~200 lines, zero deps, works on 2D and WebGL canvases)
- `relay/server.mjs` — the receiving server (zero deps; disk bundles + optional Discord delivery)
- `viewer/inbox.html` — review UI: browse invokes, play clips, hp sparkline with mark
  diamonds, zone strips, event tables, raw JSON

## Quick start

**1. Serve the relay** (behind any reverse proxy):

```bash
PTL_DISCORD_TOKEN=... PTL_DISCORD_CHANNEL=... node relay/server.mjs
# omit the Discord vars to run disk-only
```

**2. Drop the client into your game:**

```html
<script src="playtest-link.js"></script>
```

```js
PlaytestLink.init({
  canvas: document.querySelector('canvas'),
  endpoint: '/api',              // wherever the relay is proxied
  game: 'mygame',                // bundle tag — keep streams separate per build/audience
  getState: () => ({ zone, x, y, hp, ... }),   // small JSON, sampled 4x/sec
  getAim: () => 'door(12,7) 3.1m',             // optional: name the crosshair target
  keys: { mark: 'KeyM', invoke: 'KeyT' },
  fps: 15, bitrate: 900000, clipSec: 6,        // lower for big WebGL canvases (8 / 550k)
  version: 'version.json',                     // optional: enables the hot-reload toast
});
PlaytestLink.event('door_open', { x, y });     // push gameplay facts as they happen
```

**3. Stamp `version.json` at build time** — when a fix deploys, live sessions show
"⟳ patched — tap to reload".

See **AGENT-INSTRUCTIONS.md** for the doc to hand to game-building agents, and
**LEARNINGS.md** for the field notes (gotchas, tuning, workflow).

## MGS / harness readiness

Usable nearly as-is:

- The client is fully generic (all game-specific behavior enters via `init` config).
- The relay is env-configured and dependency-free. For a multi-project harness run one
  relay and use `game:` tags per project — the inbox and viewer already group by tag.
- Discord delivery is optional; the disk inbox (`meta.json` + webm per invoke) is the
  stable integration surface for an agent to poll.
- What you'd add for MGS-scale polish: auth on the invoke endpoint (it's open by design
  for playtesters), retention/pruning for the inbox, and per-project viewer URLs.
