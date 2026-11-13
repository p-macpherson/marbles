# Marble Race

A deterministic 3D physics marble race built with [three.js](https://threejs.org/).

- Choose how many marbles (2–32) and name each one.
- Marbles drop from randomised positions in the start zone (decided by the **seed**),
  then race down a course with banked turns, a helix, spinning blades, pendulums,
  a peg field and sliding pushers.
- Names float above each marble. Follow any marble, cycle through them, follow the
  leader automatically, or switch to a free orbit camera.
- Every race has a **share link**. Anyone who opens it watches the identical race as a
  replay (no setup screen), and is first asked which marble to follow.
- Works on phones: responsive HUD, touch controls, portrait-friendly camera.

## Running locally

No build step. Any static file server works:

```sh
python -m http.server 8080   # then open http://localhost:8080
```

(Opening `index.html` straight from disk won't work — ES modules need http.)

## Deploying

Push to `main` on GitHub and enable **Settings → Pages → Source: GitHub Actions**.
The workflow in `.github/workflows/pages.yml` runs the simulation tests and then
publishes the repo root. Share links point at whatever URL the race was created on.

## How determinism works

A share link only contains the seed and the names (`?race=<base64 JSON>`); the
viewer's browser re-simulates the race. That only works if every browser computes
bit-for-bit the same thing, so the simulation (`src/sim/`) uses:

- a custom sphere-vs-triangle/capsule physics engine with a fixed 240 Hz timestep,
  fixed iteration order, and double-precision maths;
- only operations IEEE-754 guarantees to be exact (`+ - * /`, `Math.sqrt`, rounding) —
  `Math.sin`/`cos` are replaced by polynomial versions in `dmath.js` because their
  results may differ by an ulp between JS engines;
- an integer-only seeded RNG (`sfc32`).

Rendering is decoupled: frames interpolate between simulation steps, and playback
speed only changes how many steps run per frame, so frame rate never affects results.

Safety nets keep races finishing: a marble that leaves the track, or makes no
progress for 7 s, is put back on the centreline (deterministically). Races are
capped at 5 minutes; anything still running is ranked by distance as DNF.

> **Changing the course or physics changes the outcome of old links.** Bump
> `COURSE_VERSION` in `src/sim/track.js` when you do, so old links show a clear
> "different version" message instead of a different race.

## Tests

```sh
node tools/simtest.mjs [races=6] [marbles=16]   # determinism, all finish, no course overlap
node tools/diag.mjs [seed] [marbles]            # per-zone timings + where respawns happen
```

## Layout

| Path | What |
| --- | --- |
| `src/sim/track.js` | Course definition (segment list), geometry, obstacle motion |
| `src/sim/race.js` | Physics, progress tracking, finish/standings |
| `src/sim/dmath.js`, `rng.js` | Deterministic trig and RNG |
| `src/render/view.js`, `camera.js` | three.js scene, labels, camera rig |
| `src/main.js` | App flow: setup, countdown, HUD, results, replay mode |
| `src/share.js` | Race ⇄ URL encoding |
