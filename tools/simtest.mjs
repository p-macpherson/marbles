// Headless checks: course sanity, determinism, and that races finish cleanly.
// Usage: node tools/simtest.mjs [races=6] [marbles=16]
import { Race, DT } from '../src/sim/race.js';
import { getCourse } from '../src/sim/track.js';

const races = Number(process.argv[2] || 6);
const marbles = Number(process.argv[3] || 16);
let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL:', msg); };

// --- course self-intersection check ---------------------------------------
const c = getCourse();
console.log(`course: ${c.sampleCount} samples, ${c.triCount} tris, length ${c.totalS.toFixed(1)}, finish at ${c.finishS.toFixed(1)}, height ${(c.maxY - c.minY).toFixed(1)}`);
{
  let clashes = 0;
  for (let a = 0; a < c.sampleCount; a += 2) {
    for (let b = a + 2; b < c.sampleCount; b += 2) {
      if (c.S[b] - c.S[a] < 25) continue;
      const dx = c.P[a * 3] - c.P[b * 3], dz = c.P[a * 3 + 2] - c.P[b * 3 + 2];
      const dy = c.P[a * 3 + 1] - c.P[b * 3 + 1];
      const horiz = Math.sqrt(dx * dx + dz * dz);
      const need = c.HW[a] + c.HW[b] + 1.5;
      if (horiz < need && Math.abs(dy) < 7) {
        if (clashes < 5) console.log(`  clash: s=${c.S[a].toFixed(0)} vs s=${c.S[b].toFixed(0)} horiz=${horiz.toFixed(1)} dy=${dy.toFixed(1)}`);
        clashes++;
      }
    }
  }
  if (clashes) fail(`course overlaps itself at ${clashes} sample pairs`);
}

// --- races ------------------------------------------------------------------
const names = Array.from({ length: marbles }, (_, i) => `M${i + 1}`);
for (let r = 0; r < races; r++) {
  const seed = 'test-' + r;
  const race = new Race({ seed, names });
  const t0 = performance.now();
  while (!race.complete) race.step();
  const ms = performance.now() - t0;
  const res = race.results();
  const times = res.filter((x) => !x.dnf).map((x) => x.time);
  const dnf = res.filter((x) => x.dnf).length;
  const resp = Array.from(race.respawns).reduce((a, b) => a + b, 0);
  console.log(
    `seed ${seed}: winner ${res[0].name} ${times[0]?.toFixed(2)}s, last ${times.at(-1)?.toFixed(2)}s, ` +
      `dnf ${dnf}, respawns ${resp}, sim ${(ms / 1000).toFixed(2)}s (${((race.stepCount * DT) / (ms / 1000)).toFixed(0)}x realtime)`
  );
  if (dnf) fail(`${seed}: ${dnf} marbles did not finish`);

  // determinism: same seed again must match exactly
  if (r < 2) {
    const again = new Race({ seed, names });
    while (!again.complete) again.step();
    const a = JSON.stringify(race.results()), b = JSON.stringify(again.results());
    if (a !== b || race.checksum() !== again.checksum()) fail(`${seed}: replay diverged`);
    else console.log(`  replay identical (checksum ${again.checksum()})`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
