# marble-race

Browser marble race (three.js, no build step, plain ES modules; three is loaded via the
import map in `index.html`). Hosted on GitHub Pages via `.github/workflows/pages.yml`.

## Critical invariant: determinism

Share links contain only seed + names; viewers re-simulate. Anything under `src/sim/`
must stay bit-for-bit deterministic across JS engines:

- No `Math.sin/cos/tan/atan2/pow/exp/log/hypot` in `src/sim/` — use `dmath.js`.
  `+ - * /`, `Math.sqrt`, `Math.floor/round/abs/min/max`, `Math.imul` are fine.
- No `Math.random`, `Date`, frame time, or float32 data in the sim. Fixed iteration order.
- `src/sim/` must not import three.js or anything from `src/render/`.
- Any change to course geometry or physics changes outcomes for existing links:
  bump `COURSE_VERSION` in `src/sim/track.js`.

The renderer (`src/render/`) is free to use anything.

## Verify

- `node tools/simtest.mjs` — must pass (determinism, every marble finishes, no course self-overlap).
- `node tools/diag.mjs <seed> <n>` for tuning zone timings / respawn hotspots.
- Serve with `python -m http.server` and check in a browser; also check a phone-sized viewport.
