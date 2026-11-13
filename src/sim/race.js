// Deterministic marble race simulation.
//
// Fixed timestep, fixed iteration order, double precision, no Math.sin/cos etc.
// Given the same seed and number of marbles, every device produces the exact
// same race, which is what makes share links (seed + names) work as replays.

import { getCourse, createPartBuffer, evaluateObstacles, MARBLE_R } from './track.js';
import { Rng } from './rng.js';

export const STEPS_PER_SEC = 240;
export const DT = 1 / STEPS_PER_SEC;
export const MAX_RACE_SECONDS = 300;
export const MIN_MARBLES = 2;
export const MAX_MARBLES = 32;

const G = 22;
const R = MARBLE_R;
const D = 2 * R;
const D2 = D * D;
const E_MARBLE = 0.55;
const E_STATIC = 0.3;
const E_KIN = 0.6;
const E_PEG = 0.2;
const BOUNCE_MIN = 0.9; // below this normal speed collisions are perfectly inelastic
const MU = 0.15;
const DRAG = 0.006; // quadratic air drag
const ROLL = 0.1; // rolling resistance while in contact (1/s)
const MAX_SPEED = 36;
const ITERATIONS = 2;
const STUCK_STEPS = STEPS_PER_SEC * 7;
const MAX_STEPS = STEPS_PER_SEC * MAX_RACE_SECONDS;

// scratch for closest-point queries
let CX = 0, CY = 0, CZ = 0;

function closestOnTri(px, py, pz, tr, o) {
  const ax = tr[o], ay = tr[o + 1], az = tr[o + 2];
  const bx = tr[o + 3], by = tr[o + 4], bz = tr[o + 5];
  const cx = tr[o + 6], cy = tr[o + 7], cz = tr[o + 8];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) { CX = ax; CY = ay; CZ = az; return; }
  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) { CX = bx; CY = by; CZ = bz; return; }
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    CX = ax + abx * v; CY = ay + aby * v; CZ = az + abz * v; return;
  }
  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) { CX = cx; CY = cy; CZ = cz; return; }
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    CX = ax + acx * w; CY = ay + acy * w; CZ = az + acz * w; return;
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    CX = bx + (cx - bx) * w; CY = by + (cy - by) * w; CZ = bz + (cz - bz) * w; return;
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  CX = ax + abx * v + acx * w; CY = ay + aby * v + acy * w; CZ = az + abz * v + acz * w;
}

function closestOnSeg(px, py, pz, x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((px - x0) * dx + (py - y0) * dy + (pz - z0) * dz) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  CX = x0 + dx * t; CY = y0 + dy * t; CZ = z0 + dz * t;
}

export class Race {
  /**
   * @param {{seed: string, names: string[]}} config
   */
  constructor({ seed, names }) {
    this.seed = String(seed);
    this.names = names.slice();
    const n = (this.n = names.length);
    const course = (this.course = getCourse());
    this.pos = new Float64Array(n * 3);
    this.vel = new Float64Array(n * 3);
    this.prev = new Float64Array(n * 3);
    this.contact = new Uint8Array(n);
    this.sampleIdx = new Int32Array(n);
    this.progress = new Float64Array(n);
    this.best = new Float64Array(n);
    this.lastImprove = new Int32Array(n);
    this.finishStep = new Int32Array(n).fill(-1);
    this.finishOrder = [];
    this.respawns = new Int32Array(n);
    this.stepCount = 0;
    this.completeStep = -1;
    this.parts = createPartBuffer(course);
    this._spawn();
    this.prev.set(this.pos);
    evaluateObstacles(course, 0, this.parts);
  }

  get time() {
    return this.stepCount * DT;
  }
  get complete() {
    return this.completeStep >= 0;
  }

  _spawn() {
    const c = this.course;
    const rng = new Rng('marble-race/v' + c.version + '/' + this.seed + '/' + this.n);
    const { j0, j1, hMin, hMax } = c.spawn;
    for (let i = 0; i < this.n; i++) {
      let x = 0, y = 0, z = 0, j = j0;
      for (let attempt = 0; attempt < 400; attempt++) {
        j = j0 + rng.int(j1 - j0 + 1);
        const lim = c.HW[j] - R - 0.35;
        const lat = rng.range(-lim, lim);
        const h = rng.range(hMin, hMax);
        x = c.P[j * 3] + c.RV[j * 3] * lat + c.U[j * 3] * h;
        y = c.P[j * 3 + 1] + c.RV[j * 3 + 1] * lat + c.U[j * 3 + 1] * h;
        z = c.P[j * 3 + 2] + c.RV[j * 3 + 2] * lat + c.U[j * 3 + 2] * h;
        let ok = true;
        for (let q = 0; q < i && ok; q++) {
          const dx = this.pos[q * 3] - x, dy = this.pos[q * 3 + 1] - y, dz = this.pos[q * 3 + 2] - z;
          if (dx * dx + dy * dy + dz * dz < (D + 0.15) * (D + 0.15)) ok = false;
        }
        if (ok) break;
      }
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      this.sampleIdx[i] = j;
      this.progress[i] = c.S[j];
      this.best[i] = c.S[j];
    }
  }

  // Resolve a contact for marble i against a surface moving with velocity sv.
  _resolve(i, nx, ny, nz, pen, svx, svy, svz, e) {
    const p = this.pos, v = this.vel, o = i * 3;
    p[o] += nx * pen;
    p[o + 1] += ny * pen;
    p[o + 2] += nz * pen;
    const rvx = v[o] - svx, rvy = v[o + 1] - svy, rvz = v[o + 2] - svz;
    const vn = rvx * nx + rvy * ny + rvz * nz;
    if (vn < 0) {
      const jn = -vn * (1 + (vn < -BOUNCE_MIN ? e : 0));
      const tx = rvx - nx * vn, ty = rvy - ny * vn, tz = rvz - nz * vn;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      v[o] += nx * jn;
      v[o + 1] += ny * jn;
      v[o + 2] += nz * jn;
      if (vn < -BOUNCE_MIN && tl > 1e-9) {
        // friction only on real impacts — resting contact is rolling, handled by ROLL
        let dec = MU * jn;
        if (dec > tl) dec = tl;
        const k = dec / tl;
        v[o] -= tx * k;
        v[o + 1] -= ty * k;
        v[o + 2] -= tz * k;
      }
    }
    if (ny > 0.3) this.contact[i] = 1;
  }

  step() {
    if (this.completeStep >= 0 && this.stepCount >= this.completeStep + STEPS_PER_SEC * 20) return;
    const n = this.n, p = this.pos, v = this.vel, c = this.course;
    this.prev.set(p);
    const step = ++this.stepCount;
    evaluateObstacles(c, step * DT, this.parts);

    // integrate
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let vx = v[o], vy = v[o + 1] - G * DT, vz = v[o + 2];
      const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
      let f = 1 - DRAG * sp * DT - (this.contact[i] ? ROLL * DT : 0);
      if (sp * f > MAX_SPEED) f = MAX_SPEED / sp;
      vx *= f; vy *= f; vz *= f;
      v[o] = vx; v[o + 1] = vy; v[o + 2] = vz;
      p[o] += vx * DT;
      p[o + 1] += vy * DT;
      p[o + 2] += vz * DT;
      this.contact[i] = 0;
    }

    for (let it = 0; it < ITERATIONS; it++) {
      this._collideMarbles();
      this._collideStatic();
      this._collideKinematic();
    }

    this._updateProgress(step);
  }

  _collideMarbles() {
    const n = this.n, p = this.pos, v = this.vel;
    for (let i = 0; i < n; i++) {
      const oi = i * 3;
      for (let j = i + 1; j < n; j++) {
        const oj = j * 3;
        let dx = p[oj] - p[oi];
        if (dx > D || dx < -D) continue;
        let dy = p[oj + 1] - p[oi + 1];
        if (dy > D || dy < -D) continue;
        let dz = p[oj + 2] - p[oi + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= D2) continue;
        let dist = Math.sqrt(d2);
        if (dist < 1e-9) { dx = 1; dy = 0; dz = 0; dist = 1; }
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        const half = (D - Math.sqrt(d2)) * 0.5;
        p[oi] -= nx * half; p[oi + 1] -= ny * half; p[oi + 2] -= nz * half;
        p[oj] += nx * half; p[oj + 1] += ny * half; p[oj + 2] += nz * half;
        const vn = (v[oj] - v[oi]) * nx + (v[oj + 1] - v[oi + 1]) * ny + (v[oj + 2] - v[oi + 2]) * nz;
        if (vn < 0) {
          const jj = -vn * (1 + (vn < -BOUNCE_MIN ? E_MARBLE : 0)) * 0.5;
          v[oi] -= nx * jj; v[oi + 1] -= ny * jj; v[oi + 2] -= nz * jj;
          v[oj] += nx * jj; v[oj + 1] += ny * jj; v[oj + 2] += nz * jj;
        }
        if (ny > 0.5) this.contact[j] = 1;
        else if (ny < -0.5) this.contact[i] = 1;
      }
    }
  }

  _collideStatic() {
    const c = this.course, p = this.pos, tris = c.tris, triN = c.triN, caps = c.staticCapsules;
    const cell = c.gridCell;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      const list = c.grid.get(c.gridKey(Math.floor(p[o] / cell), Math.floor(p[o + 1] / cell), Math.floor(p[o + 2] / cell)));
      if (!list) continue;
      for (let li = 0; li < list.length; li++) {
        const id = list[li];
        const px = p[o], py = p[o + 1], pz = p[o + 2];
        if (id >= 0) {
          const to = id * 9;
          const pd = (px - tris[to]) * triN[id * 3] + (py - tris[to + 1]) * triN[id * 3 + 1] + (pz - tris[to + 2]) * triN[id * 3 + 2];
          if (pd > R || pd < -R) continue;
          closestOnTri(px, py, pz, tris, to);
          let dx = px - CX, dy = py - CY, dz = pz - CZ;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= R * R) continue;
          let dist = Math.sqrt(d2);
          if (dist < 1e-9) {
            const s = pd >= 0 ? 1 : -1;
            dx = triN[id * 3] * s; dy = triN[id * 3 + 1] * s; dz = triN[id * 3 + 2] * s; dist = 1;
            this._resolve(i, dx, dy, dz, R, 0, 0, 0, E_STATIC);
          } else {
            this._resolve(i, dx / dist, dy / dist, dz / dist, R - dist, 0, 0, 0, E_STATIC);
          }
        } else {
          const cap = caps[-id - 1];
          closestOnSeg(px, py, pz, cap.a[0], cap.a[1], cap.a[2], cap.b[0], cap.b[1], cap.b[2]);
          const rr = cap.r + R;
          const dx = px - CX, dy = py - CY, dz = pz - CZ;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-18) continue;
          const dist = Math.sqrt(d2);
          this._resolve(i, dx / dist, dy / dist, dz / dist, rr - dist, 0, 0, 0, E_PEG);
        }
      }
    }
  }

  _collideKinematic() {
    const parts = this.parts, p = this.pos;
    for (let k = 0; k < parts.length; k++) {
      const q = parts[k];
      if (!q.collide) continue;
      const lim = q.br + R;
      for (let i = 0; i < this.n; i++) {
        const o = i * 3;
        const px = p[o], py = p[o + 1], pz = p[o + 2];
        const bx = px - q.bx, by = py - q.by, bz = pz - q.bz;
        if (bx * bx + by * by + bz * bz >= lim * lim) continue;
        if (q.shape === 1) { CX = q.x0; CY = q.y0; CZ = q.z0; }
        else closestOnSeg(px, py, pz, q.x0, q.y0, q.z0, q.x1, q.y1, q.z1);
        const rr = q.rad + R;
        const dx = px - CX, dy = py - CY, dz = pz - CZ;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr || d2 < 1e-18) continue;
        const dist = Math.sqrt(d2);
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        // surface velocity at contact point: v + w x (c - origin)
        const cpx = px - nx * R, cpy = py - ny * R, cpz = pz - nz * R;
        const rx = cpx - q.ox, ry = cpy - q.oy, rz = cpz - q.oz;
        const svx = q.vx + q.wy * rz - q.wz * ry;
        const svy = q.vy + q.wz * rx - q.wx * rz;
        const svz = q.vz + q.wx * ry - q.wy * rx;
        this._resolve(i, nx, ny, nz, rr - dist, svx, svy, svz, E_KIN);
      }
    }
  }

  _updateProgress(step) {
    const c = this.course, p = this.pos, P = c.P, nS = c.sampleCount;
    let newFinishers = null;
    for (let i = 0; i < this.n; i++) {
      const o = i * 3;
      const px = p[o], py = p[o + 1], pz = p[o + 2];
      const cur = this.sampleIdx[i];
      let bestJ = cur, bestD = Infinity;
      const lo = cur - 6 < 0 ? 0 : cur - 6;
      const hi = cur + 14 >= nS ? nS - 1 : cur + 14;
      for (let j = lo; j <= hi; j++) {
        const dx = px - P[j * 3], dy = py - P[j * 3 + 1], dz = pz - P[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD) { bestD = d2; bestJ = j; }
      }
      this.sampleIdx[i] = bestJ;
      const j3 = bestJ * 3;
      const rx = px - P[j3], ry = py - P[j3 + 1], rz = pz - P[j3 + 2];
      const along = rx * c.T[j3] + ry * c.T[j3 + 1] + rz * c.T[j3 + 2];
      const lat = rx * c.RV[j3] + ry * c.RV[j3 + 1] + rz * c.RV[j3 + 2];
      const up = rx * c.U[j3] + ry * c.U[j3 + 1] + rz * c.U[j3 + 2];
      const prog = c.S[bestJ] + along;
      this.progress[i] = prog;

      if (this.finishStep[i] >= 0) continue;

      if (prog >= c.finishS) {
        this.finishStep[i] = step;
        (newFinishers ||= []).push(i);
        continue;
      }

      // off the course (jumped a wall / fell through): put it back
      if (lat > c.HW[bestJ] + 1.2 || lat < -c.HW[bestJ] - 1.2 || up < -2.5) {
        this._respawn(i, this.best[i], step);
        continue;
      }
      if (prog > this.best[i] + 0.5) {
        this.best[i] = prog;
        this.lastImprove[i] = step;
      } else if (step - this.lastImprove[i] > STUCK_STEPS) {
        this._respawn(i, this.best[i] + 2, step);
      }
    }

    if (newFinishers) {
      const prog = this.progress;
      newFinishers.sort((a, b) => prog[b] - prog[a] || a - b);
      for (const i of newFinishers) this.finishOrder.push(i);
    }
    if (this.completeStep < 0 && (this.finishOrder.length === this.n || step >= MAX_STEPS)) {
      this.completeStep = step;
    }
  }

  _respawn(i, s, step) {
    const c = this.course;
    let lo = 0, hi = c.sampleCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c.S[mid] < s) lo = mid + 1; else hi = mid;
    }
    const j = lo, j3 = j * 3;
    let lat = (((i * 7) % 5) - 2) * 0.9;
    const lim = c.HW[j] - R - 0.2;
    if (lat > lim) lat = lim; else if (lat < -lim) lat = -lim;
    const o = i * 3;
    for (let d = 0; d < 3; d++) {
      this.pos[o + d] = c.P[j3 + d] + c.RV[j3 + d] * lat + c.U[j3 + d] * (R + 0.8);
      this.vel[o + d] = c.T[j3 + d] * 2;
    }
    this.sampleIdx[i] = j;
    if (c.S[j] > this.best[i]) this.best[i] = c.S[j];
    this.lastImprove[i] = step;
    this.respawns[i]++;
  }

  /** Current order: finishers first (by finish), then by distance travelled. */
  standings() {
    const done = this.finishOrder;
    const fin = new Uint8Array(this.n);
    for (const i of done) fin[i] = 1;
    const rest = [];
    for (let i = 0; i < this.n; i++) if (!fin[i]) rest.push(i);
    rest.sort((a, b) => this.progress[b] - this.progress[a] || a - b);
    return done.concat(rest);
  }

  results() {
    return this.standings().map((i, k) => ({
      place: k + 1,
      index: i,
      name: this.names[i],
      time: this.finishStep[i] >= 0 ? this.finishStep[i] * DT : null,
      dnf: this.finishStep[i] < 0,
    }));
  }

  /** Cheap fingerprint of the full state, used by determinism tests. */
  checksum() {
    let h = 0x811c9dc5;
    const view = new DataView(this.pos.buffer);
    for (let b = 0; b < view.byteLength; b += 4) h = Math.imul(h ^ view.getUint32(b, true), 16777619);
    const vv = new DataView(this.vel.buffer);
    for (let b = 0; b < vv.byteLength; b += 4) h = Math.imul(h ^ vv.getUint32(b, true), 16777619);
    return (h >>> 0).toString(16);
  }
}
