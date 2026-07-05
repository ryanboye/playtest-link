# Field notes — what we learned building and running playtest-link

From the first live sessions (July 3–4, 2026, two games, 9 real player reports, 6 fixes
deployed at ~4 min/bug).

## Capture

- **MediaRecorder chunks are NOT independently playable** — a webm needs its init
  segment. The ring buffer is therefore **two alternating recorders** cycled every
  `clipSec` seconds; on invoke, both recorders' buffers are sent (guaranteed
  `clipSec..2×clipSec` of playable footage).
- **`canvas.captureStream()` works on 2D and WebGL alike** and does not require
  `preserveDrawingBuffer`. But **direct `canvas.toDataURL()` readback on WebGL often
  returns blank** — for headless verification give the game a `__snap()` hook that
  renders then reads back.
- **Recorder cost scales with canvas resolution.** A 240×336 2D game records free at
  15fps/900kbps; a full-res WebGL game showed player-visible lag until dropped to
  8fps/550kbps. Make fps/bitrate config, not constants.
- **The first canvas readback of a headless (swiftshader) session returns a stale
  frame.** Discard a warm-up capture before trusting anything.

## Clip window

- We started with 15–30s windows. The player's verdict: **too long — "crop through
  nonsense"**. 5–10s (clipSec 5) is right: reports are impulsive, the subject is always
  in the last few seconds. Marks cover the "it happened a while ago" case better than
  longer video.

## Report ergonomics

- **The marks workflow beats long clips**: M stamps time+state+aim silently; one T report
  at the end carries all marks as a punch list. Teach players: *mark every oddity, report
  once* for walkthroughs; bare T for single bugs.
- **The invoke key leaks into the report input** if you focus it synchronously —
  `preventDefault()` on the key and defer focus with `setTimeout(0)`.
- Release pointer lock when opening the report box; stop keydown propagation from the
  input or WASD games move while the player types.
- **Reports without text still carry value** (clip + marks + aim), so allow empty sends.

## Delivery

- **Discord bot-authored posts do NOT arrive as inbound messages to a bot-driven agent**
  (self-message filtering). If the fixing agent lives in Discord, it must POLL the relay
  (`GET /invokes`) or the inbox dir — don't wait for the message that never comes.
- Webhook creation fails in DM channels ("Unknown Channel"); posting via the bot token
  directly works everywhere the bot can speak.
- Attach the clip to the Discord post (≤9MB) — the human skims it there; the agent reads
  the disk bundle.

## Interpreting bundles

- **Zone + aim usually localize the issue before watching anything.** The aim string
  ("wall 'H' (18,27) 4.0m") is the single highest-value field for "look at THIS" reports.
- Design complaints and bug reports need different handling: bugs are fixed when the
  condition is gone; **design is only fixed when the player walks it and agrees** —
  verify spatial changes from the player's exact positions, then still expect a round of
  back-and-forth. Static screenshots under-detect feel problems (that's why the tool
  records video in the first place).

## The loop, measured

complaint → bundle read → diagnose → fix → deploy → hot-reload toast ≈ **4 minutes per
bug** for state/render bugs. Spatial design changes are slower and want the
proposal-first protocol (see AGENT-INSTRUCTIONS.md §10).

## Known limitations (from code review, July 2026)

- **Clip transport is base64-in-JSON**: `send()` base64-encodes the webm clips into one
  JSON POST (relay caps at 40MB). It's the heaviest link and the first to strain under
  bigger/longer clips. **Multipart upload** would be much leaner on both ends — the
  known next upgrade (PRs welcome).
- **Relay READ endpoints are unauthed** (`/invokes`, `/files`, `/feedbacklog`), same as
  `/invoke`. The relay binds loopback, so your reverse proxy is the real gate — but
  anyone who reaches it reads every playtester's video + complaint. Put auth in front of
  the relay before exposing it beyond a trusted proxy.
