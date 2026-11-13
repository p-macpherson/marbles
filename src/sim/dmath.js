// Deterministic math helpers.
//
// JavaScript guarantees IEEE-754 double arithmetic for + - * / and Math.sqrt,
// but NOT for Math.sin / Math.cos / Math.atan2 / Math.pow etc. — those may differ
// by an ulp between browsers, which is enough to make a chaotic simulation
// diverge. Everything the simulation (and course construction) touches uses
// these implementations instead.

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

const C3 = -1 / 6;
const C5 = 1 / 120;
const C7 = -1 / 5040;
const C9 = 1 / 362880;
const C11 = -1 / 39916800;
const C13 = 1 / 6227020800;
const C15 = -1 / 1307674368000;
const C17 = 1 / 355687428096000;
const C19 = -1 / 121645100408832000;

export function dsin(x) {
  const k = Math.round(x / TWO_PI);
  x = x - k * TWO_PI; // [-pi, pi]
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x; // [-pi/2, pi/2]
  const x2 = x * x;
  return x * (1 + x2 * (C3 + x2 * (C5 + x2 * (C7 + x2 * (C9 + x2 * (C11 + x2 * (C13 + x2 * (C15 + x2 * (C17 + x2 * C19)))))))));
}

export function dcos(x) {
  return dsin(x + HALF_PI);
}
