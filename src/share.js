// Race <-> URL encoding. A race is fully described by its seed + marble names
// (+ course version), so that is all a share link needs to carry.

import { COURSE_VERSION } from './sim/track.js';
import { MIN_MARBLES, MAX_MARBLES } from './sim/race.js';

export const MAX_NAME_LEN = 16;

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeRace({ seed, names }) {
  return toBase64Url(JSON.stringify({ v: COURSE_VERSION, s: seed, n: names }));
}

/** Returns {seed, names} or throws with a human-readable message. */
export function decodeRace(token) {
  let data;
  try {
    data = JSON.parse(fromBase64Url(token));
  } catch {
    throw new Error('This race link looks damaged or incomplete.');
  }
  if (data.v !== COURSE_VERSION) throw new Error('This race was recorded on a different version of the course.');
  if (typeof data.s !== 'string' || !Array.isArray(data.n)) throw new Error('This race link is not valid.');
  const names = data.n.map((x) => String(x).slice(0, MAX_NAME_LEN));
  if (names.length < MIN_MARBLES || names.length > MAX_MARBLES) throw new Error('This race link is not valid.');
  return { seed: data.s, names };
}

export function shareUrl(race) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('race', encodeRace(race));
  return url.toString();
}
