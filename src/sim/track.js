// Course construction. Everything here is deterministic (only + - * / sqrt and
// the deterministic trig from dmath.js), so the same collision geometry is
// produced on every device. The renderer reads the same data to build meshes.

import { dsin, dcos, TWO_PI } from './dmath.js';

export const MARBLE_R = 0.5;
export const COURSE_VERSION = 1;

const SPACING = 0.75; // centreline sample spacing (horizontal units)
const DEG = 0.017453292519943295;
const CHAMFER = 0.45;
const GRID_CELL = 3;

/*
 * Segment list. Angles are in degrees, positive = turn right.
 * w  = half-width (number, or [start, end] to taper)
 * wall = wall height, bank = banking in degrees for turns
 */
const SEGMENTS = [
  { zone: 'start', type: 'straight', len: 22, drop: 3.5, w: [7, 3], wall: 2.6, startCap: true },
  { type: 'straight', len: 22, drop: 3.2, w: 3, wall: 2.2 },
  { type: 'turn', radius: 10, angle: 90, drop: 2.5, w: 3, wall: 3, bank: 12 },
  { type: 'straight', len: 16, drop: 2.2, w: 3, wall: 2.2 },
  { type: 'turn', radius: 9, angle: -180, drop: 4, w: 3, wall: 3, bank: 12 },
  { type: 'straight', len: 10, drop: 1.2, w: [3, 5], wall: 2.2 },
  {
    zone: 'spinners', type: 'straight', len: 50, drop: 6.5, w: 5, wall: 2.2,
    obstacles: [
      { kind: 'spinner', at: 0.17, arms: 2, len: 3.2, omega: 1.4, phase: 0 },
      { kind: 'spinner', at: 0.5, arms: 2, len: 3.2, omega: -1.1, phase: 0.6 },
      { kind: 'spinner', at: 0.83, arms: 2, len: 3.2, omega: 1.7, phase: 1.3 },
    ],
  },
  { type: 'straight', len: 8, drop: 1, w: [5, 3.5], wall: 2.2 },
  { type: 'turn', radius: 10, angle: 180, drop: 4, w: 3.5, wall: 3, bank: 12 },
  {
    zone: 'pendulums', type: 'straight', len: 46, drop: 6, w: 3.5, wall: 2.2,
    obstacles: [
      { kind: 'pendulum', at: 0.15, amp: 0.42, period: 2.6, phase: 0 },
      { kind: 'pendulum', at: 0.38, amp: 0.42, period: 2.3, phase: 1.9 },
      { kind: 'pendulum', at: 0.62, amp: 0.42, period: 2.8, phase: 3.7 },
      { kind: 'pendulum', at: 0.85, amp: 0.42, period: 2.1, phase: 5.1 },
    ],
  },
  { type: 'turn', radius: 12, angle: -90, drop: 3, w: 3.5, wall: 3, bank: 10 },
  { type: 'straight', len: 8, drop: 1, w: [3.5, 6], wall: 2.2 },
  {
    zone: 'pegs', type: 'straight', len: 36, drop: 5.5, w: 6, wall: 2.2,
    obstacles: [{ kind: 'pegs', from: 3, to: 33, rowGap: 4 }],
  },
  { type: 'straight', len: 8, drop: 1, w: [6, 3], wall: 2.2 },
  { zone: 'helix', type: 'turn', radius: 9, angle: 720, drop: 22, w: 3, wall: 3.2, bank: 16 },
  { type: 'straight', len: 12, drop: 1.5, w: [3, 4], wall: 2.2 },
  {
    zone: 'pushers', type: 'straight', len: 38, drop: 5, w: 4, wall: 2.2,
    obstacles: [
      { kind: 'pusher', at: 0.2, amp: 2.0, period: 2.4, phase: 0 },
      { kind: 'pusher', at: 0.45, amp: 2.0, period: 2.0, phase: 2.2 },
      { kind: 'pusher', at: 0.7, amp: 2.0, period: 2.7, phase: 4.1 },
    ],
  },
  { type: 'turn', radius: 10, angle: -90, drop: 2, w: [4, 3], wall: 3, bank: 12 },
  { type: 'turn', radius: 10, angle: 90, drop: 2, w: 3, wall: 3, bank: 12 },
  { type: 'turn', radius: 10, angle: -90, drop: 2, w: 3, wall: 3, bank: 12 },
  { zone: 'final', type: 'straight', len: 40, drop: 4, w: [3, 3.5], wall: 2.2 },
  { zone: 'runout', type: 'straight', len: 20, drop: -1.2, w: [3.5, 5], wall: 2.2, finish: true, endCap: true },
];

// ---------------------------------------------------------------------------
// small vector helpers (plain arrays; only used at build time)
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.sqrt(dot(a, a));
  return [a[0] / l, a[1] / l, a[2] / l];
};
const smooth01 = (x) => x * x * (3 - 2 * x);

function buildCenterline() {
  const P = [], T = [], RV = [], U = [], S = [], HW = [], WH = [], SEG = [], BANK = [];
  const segInfo = [];
  let x = 0, y = 0, z = 0, heading = 0;

  for (let k = 0; k < SEGMENTS.length; k++) {
    const seg = SEGMENTS[k];
    const isTurn = seg.type === 'turn';
    const hLen = isTurn ? seg.radius * Math.abs(seg.angle) * DEG : seg.len;
    const n = Math.max(2, Math.ceil(hLen / SPACING));
    const dh = hLen / n;
    const dTheta = isTurn ? (seg.angle * DEG) / n : 0;
    const slope = seg.drop / hLen;
    const w0 = Array.isArray(seg.w) ? seg.w[0] : seg.w;
    const w1 = Array.isArray(seg.w) ? seg.w[1] : seg.w;
    const bank = isTurn ? (seg.bank || 0) * DEG * (seg.angle > 0 ? 1 : -1) : 0;
    const start = P.length === 0 ? 0 : P.length - 1;

    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      if (i > 0) {
        const mid = heading + dTheta * 0.5;
        x += dcos(mid) * dh;
        z += dsin(mid) * dh;
        y -= slope * dh;
        heading += dTheta;
      }
      const f = [dcos(heading), -slope, dsin(heading)];
      P.push([x, y, z]);
      T.push(norm(f));
      HW.push(w0 + (w1 - w0) * smooth01(i / n));
      WH.push(seg.wall);
      SEG.push(k);
      BANK.push(bank);
    }
    segInfo.push({ start, end: P.length - 1, ...seg });
  }

  // smooth banking and wall heights so transitions are gentle
  for (let pass = 0; pass < 3; pass++) {
    const b = BANK.slice(), w = WH.slice();
    const rad = 6;
    for (let j = 0; j < BANK.length; j++) {
      let sb = 0, sw = 0, c = 0;
      for (let q = j - rad; q <= j + rad; q++) {
        const qq = q < 0 ? 0 : q >= BANK.length ? BANK.length - 1 : q;
        sb += b[qq];
        sw = sw > w[qq] ? sw : w[qq];
        c++;
      }
      BANK[j] = sb / c;
      WH[j] = sw;
    }
  }

  let s = 0;
  const up = [0, 1, 0];
  for (let j = 0; j < P.length; j++) {
    if (j > 0) s += Math.sqrt(dot(sub(P[j], P[j - 1]), sub(P[j], P[j - 1])));
    S.push(s);
    const t = T[j];
    let r = norm(cross(t, up));
    let u = cross(r, t);
    const cb = dcos(BANK[j]), sb = dsin(BANK[j]);
    const r2 = sub(scale(r, cb), scale(u, sb));
    const u2 = add(scale(u, cb), scale(r, sb));
    RV.push(r2);
    U.push(u2);
  }
  return { P, T, RV, U, S, HW, WH, SEG, segInfo };
}

/** Cross-section profile in (lateral, up) coordinates. Index 0..5 */
function profile2d(hw, wh) {
  return [
    [-hw, wh],
    [-hw, CHAMFER],
    [-hw + CHAMFER, 0],
    [hw - CHAMFER, 0],
    [hw, CHAMFER],
    [hw, wh],
  ];
}

function buildCourse() {
  const cl = buildCenterline();
  const { P, RV, U, HW, WH, segInfo } = cl;
  const nS = P.length;

  const profileAt = (j) =>
    profile2d(HW[j], WH[j]).map(([a, b]) => add(P[j], add(scale(RV[j], a), scale(U[j], b))));
  const profiles = [];
  for (let j = 0; j < nS; j++) profiles.push(profileAt(j));

  // --- static triangles (9 doubles each) ---
  const tris = [];
  const triKind = []; // 0 floor, 1 wall, 2 cap
  const pushTri = (a, b, c, kind) => {
    tris.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    triKind.push(kind);
  };
  for (let j = 0; j < nS - 1; j++) {
    const A = profiles[j], B = profiles[j + 1];
    for (let k = 0; k < 5; k++) {
      const kind = k === 0 || k === 4 ? 1 : 0;
      pushTri(A[k], A[k + 1], B[k + 1], kind);
      pushTri(A[k], B[k + 1], B[k], kind);
    }
  }
  const caps = [];
  const addCap = (j) => {
    const pr = profiles[j];
    for (let k = 1; k < 5; k++) pushTri(pr[0], pr[k], pr[k + 1], 2);
    caps.push(j);
  };
  for (const seg of segInfo) {
    if (seg.startCap) addCap(seg.start);
    if (seg.endCap) addCap(seg.end);
  }

  // --- obstacles ---
  const staticCapsules = []; // {a:[3], b:[3], r}
  const obstacles = []; // kinematic
  const frameAt = (seg, frac) => {
    const j = Math.round(seg.start + frac * (seg.end - seg.start));
    return { j, p: P[j], r: RV[j], u: U[j], t: cl.T[j], hw: HW[j] };
  };

  for (const seg of segInfo) {
    for (const o of seg.obstacles || []) {
      if (o.kind === 'pegs') {
        const segLen = cl.S[seg.end] - cl.S[seg.start];
        let row = 0;
        for (let d = o.from; d <= o.to; d += o.rowGap, row++) {
          const f = frameAt(seg, d / segLen);
          const lats = row % 2 === 0 ? [-2.9, 0, 2.9] : [-4.2, -1.45, 1.45, 4.2];
          for (const lat of lats) {
            const base = add(f.p, scale(f.r, lat));
            staticCapsules.push({ a: add(base, scale(f.u, -0.3)), b: add(base, scale(f.u, 1.6)), r: 0.35, deco: 'peg' });
          }
        }
      } else if (o.kind === 'spinner') {
        const f = frameAt(seg, o.at);
        const c = add(f.p, scale(f.u, 0.55));
        const e1 = f.r;
        const e2 = cross(f.u, e1);
        staticCapsules.push({ a: add(f.p, scale(f.u, -0.2)), b: add(f.p, scale(f.u, 1.4)), r: 0.6, deco: 'hub' });
        obstacles.push({
          kind: 'spinner', c, axis: f.u, e1, e2, arms: o.arms, len: o.len, rad: 0.35,
          omega: o.omega, phase: o.phase, frame: f,
        });
      } else if (o.kind === 'pendulum') {
        const f = frameAt(seg, o.at);
        const L = 6.4;
        const pivot = add(f.p, scale(f.u, L + 0.95));
        obstacles.push({
          kind: 'pendulum', pivot, r: f.r, u: f.u, L, bobR: 0.9, amp: o.amp,
          omega: TWO_PI / o.period, phase: o.phase, frame: f,
        });
      } else if (o.kind === 'pusher') {
        const f = frameAt(seg, o.at);
        obstacles.push({
          kind: 'pusher', c: add(f.p, scale(f.u, 0.5)), r: f.r, t: f.t, half: 1.5, rad: 0.45, amp: o.amp,
          omega: TWO_PI / o.period, phase: o.phase, frame: f,
        });
      }
    }
  }

  // number of kinematic parts per obstacle
  let partCount = 0;
  for (const o of obstacles) {
    o.partStart = partCount;
    o.partCount = o.kind === 'spinner' ? o.arms : o.kind === 'pendulum' ? 2 : 1;
    partCount += o.partCount;
  }

  // --- broadphase grid over static geometry ---
  const reach = MARBLE_R + 0.05;
  const cells = new Map();
  const key = (ix, iy, iz) => ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
  const insert = (id, min, max) => {
    const x0 = Math.floor((min[0] - reach) / GRID_CELL), x1 = Math.floor((max[0] + reach) / GRID_CELL);
    const y0 = Math.floor((min[1] - reach) / GRID_CELL), y1 = Math.floor((max[1] + reach) / GRID_CELL);
    const z0 = Math.floor((min[2] - reach) / GRID_CELL), z1 = Math.floor((max[2] + reach) / GRID_CELL);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          const kk = key(ix, iy, iz);
          let list = cells.get(kk);
          if (!list) cells.set(kk, (list = []));
          list.push(id);
        }
  };
  const triCount = triKind.length;
  const triN = new Float64Array(triCount * 3);
  for (let i = 0; i < triCount; i++) {
    const o = i * 9;
    const a = [tris[o], tris[o + 1], tris[o + 2]];
    const b = [tris[o + 3], tris[o + 4], tris[o + 5]];
    const c = [tris[o + 6], tris[o + 7], tris[o + 8]];
    const nn = cross(sub(b, a), sub(c, a));
    const l = Math.sqrt(dot(nn, nn)) || 1;
    triN[i * 3] = nn[0] / l;
    triN[i * 3 + 1] = nn[1] / l;
    triN[i * 3 + 2] = nn[2] / l;
    const min = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])];
    const max = [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])];
    insert(i, min, max);
  }
  staticCapsules.forEach((cap, i) => {
    const min = [0, 1, 2].map((d) => Math.min(cap.a[d], cap.b[d]) - cap.r);
    const max = [0, 1, 2].map((d) => Math.max(cap.a[d], cap.b[d]) + cap.r);
    insert(-(i + 1), min, max);
  });
  const grid = new Map();
  for (const [k, v] of cells) grid.set(k, Int32Array.from(v));

  // flat typed arrays for the hot loop
  const flat = (arr) => {
    const out = new Float64Array(arr.length * 3);
    arr.forEach((v, i) => out.set(v, i * 3));
    return out;
  };

  const startSeg = segInfo[0];
  const finishSeg = segInfo.find((s) => s.finish);
  let minY = Infinity, maxY = -Infinity;
  for (const p of P) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }

  return {
    version: COURSE_VERSION,
    sampleCount: nS,
    P: flat(P), T: flat(cl.T), RV: flat(RV), U: flat(U),
    S: Float64Array.from(cl.S), HW: Float64Array.from(HW), WH: Float64Array.from(WH),
    sampleSeg: Int32Array.from(cl.SEG),
    segments: segInfo,
    profiles,
    tris: Float64Array.from(tris), triN, triKind: Uint8Array.from(triKind), triCount,
    caps,
    staticCapsules,
    obstacles,
    partCount,
    grid, gridCell: GRID_CELL, gridKey: key,
    spawn: { j0: startSeg.start + 3, j1: startSeg.start + 15, hMin: 1.5, hMax: 7 },
    finishIndex: finishSeg.start,
    finishS: cl.S[finishSeg.start],
    totalS: cl.S[nS - 1],
    minY, maxY,
  };
}

let cached = null;
export function getCourse() {
  if (!cached) cached = buildCourse();
  return cached;
}

// ---------------------------------------------------------------------------
// Kinematic obstacle evaluation. Used by both the simulation (at exact step
// times) and the renderer (at interpolated times).

export function createPartBuffer(course) {
  const parts = [];
  for (let i = 0; i < course.partCount; i++) {
    parts.push({
      shape: 0, collide: true, // 0 capsule, 1 sphere
      x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, rad: 0,
      vx: 0, vy: 0, vz: 0, // linear velocity
      wx: 0, wy: 0, wz: 0, ox: 0, oy: 0, oz: 0, // angular velocity about origin
      bx: 0, by: 0, bz: 0, br: 0, // bounding sphere
    });
  }
  return parts;
}

function setBound(q) {
  q.bx = (q.x0 + q.x1) * 0.5;
  q.by = (q.y0 + q.y1) * 0.5;
  q.bz = (q.z0 + q.z1) * 0.5;
  const dx = q.x1 - q.x0, dy = q.y1 - q.y0, dz = q.z1 - q.z0;
  q.br = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5 + q.rad;
}

export function evaluateObstacles(course, t, parts) {
  for (const o of course.obstacles) {
    let pi = o.partStart;
    if (o.kind === 'spinner') {
      const phi = o.phase + o.omega * t;
      const step = TWO_PI / o.arms;
      for (let k = 0; k < o.arms; k++) {
        const ang = phi + step * k;
        const ca = dcos(ang), sa = dsin(ang);
        const dx = o.e1[0] * ca + o.e2[0] * sa;
        const dy = o.e1[1] * ca + o.e2[1] * sa;
        const dz = o.e1[2] * ca + o.e2[2] * sa;
        const q = parts[pi++];
        q.shape = 0; q.collide = true; q.rad = o.rad;
        q.x0 = o.c[0]; q.y0 = o.c[1]; q.z0 = o.c[2];
        q.x1 = o.c[0] + dx * o.len; q.y1 = o.c[1] + dy * o.len; q.z1 = o.c[2] + dz * o.len;
        q.vx = 0; q.vy = 0; q.vz = 0;
        q.wx = o.axis[0] * o.omega; q.wy = o.axis[1] * o.omega; q.wz = o.axis[2] * o.omega;
        q.ox = o.c[0]; q.oy = o.c[1]; q.oz = o.c[2];
        setBound(q);
      }
    } else if (o.kind === 'pendulum') {
      const arg = o.omega * t + o.phase;
      const th = o.amp * dsin(arg);
      const thd = o.amp * o.omega * dcos(arg);
      const st = dsin(th), ct = dcos(th);
      const bx = o.pivot[0] + (o.r[0] * st - o.u[0] * ct) * o.L;
      const by = o.pivot[1] + (o.r[1] * st - o.u[1] * ct) * o.L;
      const bz = o.pivot[2] + (o.r[2] * st - o.u[2] * ct) * o.L;
      const k = o.L * thd;
      const vx = (o.r[0] * ct + o.u[0] * st) * k;
      const vy = (o.r[1] * ct + o.u[1] * st) * k;
      const vz = (o.r[2] * ct + o.u[2] * st) * k;
      const bob = parts[pi++];
      bob.shape = 1; bob.collide = true; bob.rad = o.bobR;
      bob.x0 = bob.x1 = bx; bob.y0 = bob.y1 = by; bob.z0 = bob.z1 = bz;
      bob.vx = vx; bob.vy = vy; bob.vz = vz;
      bob.wx = bob.wy = bob.wz = 0; bob.ox = bob.oy = bob.oz = 0;
      setBound(bob);
      const rod = parts[pi++];
      rod.shape = 0; rod.collide = false; rod.rad = 0.12;
      rod.x0 = o.pivot[0]; rod.y0 = o.pivot[1]; rod.z0 = o.pivot[2];
      rod.x1 = bx; rod.y1 = by; rod.z1 = bz;
      rod.vx = rod.vy = rod.vz = 0; rod.wx = rod.wy = rod.wz = 0;
      setBound(rod);
    } else if (o.kind === 'pusher') {
      const arg = o.omega * t + o.phase;
      const off = o.amp * dsin(arg);
      const vel = o.amp * o.omega * dcos(arg);
      const cx = o.c[0] + o.r[0] * off, cy = o.c[1] + o.r[1] * off, cz = o.c[2] + o.r[2] * off;
      const q = parts[pi++];
      q.shape = 0; q.collide = true; q.rad = o.rad;
      q.x0 = cx - o.t[0] * o.half; q.y0 = cy - o.t[1] * o.half; q.z0 = cz - o.t[2] * o.half;
      q.x1 = cx + o.t[0] * o.half; q.y1 = cy + o.t[1] * o.half; q.z1 = cz + o.t[2] * o.half;
      q.vx = o.r[0] * vel; q.vy = o.r[1] * vel; q.vz = o.r[2] * vel;
      q.wx = q.wy = q.wz = 0; q.ox = q.oy = q.oz = 0;
      setBound(q);
    }
  }
}
