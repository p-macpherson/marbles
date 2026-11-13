// Diagnostics: where do marbles respawn, how long does each zone take.
import { Race, DT } from '../src/sim/race.js';
const n = Number(process.argv[3] || 16);
const race = new Race({ seed: process.argv[2] || 'diag', names: Array.from({ length: n }, (_, i) => 'M' + i) });
const c = race.course;
const segOf = (s) => { let k = 0; for (let j = 0; j < c.sampleCount; j++) if (c.S[j] <= s) k = c.sampleSeg[j]; return k; };
const origRespawn = race._respawn.bind(race);
const log = [];
race._respawn = (i, s, step) => {
  const o = i * 3, j = race.sampleIdx[i];
  log.push({ i, step, seg: c.sampleSeg[j], reason: s === race.best[i] ? 'off' : 'stuck', at: race.progress[i].toFixed(1) });
  origRespawn(i, s, step);
};
const enter = c.segments.map(() => []);
const seen = new Set();
while (!race.complete) {
  race.step();
  for (let i = 0; i < n; i++) {
    const k = c.sampleSeg[race.sampleIdx[i]];
    if (!seen.has(i * 100 + k)) { seen.add(i * 100 + k); enter[k].push(race.stepCount * DT); }
  }
}
const byseg = {};
for (const l of log) byseg[l.seg + ':' + l.reason] = (byseg[l.seg + ':' + l.reason] || 0) + 1;
console.log('respawns by seg:reason', byseg);
let prev = 0;
c.segments.forEach((s, k) => {
  const t = enter[k].reduce((a, b) => a + b, 0) / Math.max(1, enter[k].length);
  const len = c.S[s.end] - c.S[s.start];
  console.log(`seg ${k} ${(s.zone || s.type).padEnd(9)} len ${len.toFixed(0).padStart(4)} enter ${t.toFixed(1).padStart(6)}s`);
});
console.log('results', race.results().slice(0, 3).map(r => r.time?.toFixed(1)), race.results().at(-1).time?.toFixed(1));
