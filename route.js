// MRT routing and fares. Pure functions, so `node route.test.mjs` can check them.
import { EDGES } from './mrt.js';

// ponytail: flat change time at interchanges; real walks vary (about 2-8 min), add per-station times if it matters
export const TRANSFER_MIN = 4;
// Adult card fares in cents by distance: up to 3.2 km, then one band per km, flat over 40.2 km.
const FARES_2025 = [128, 138, 149, 159, 168, 175, 182, 186, 190, 194, 198, 202, 207, 211, 215, 220, 224, 227, 230,
  233, 236, 238, 240, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257];
const FARES_2026 = [140, 151, 162, 172, 181, 188, 195, 199, 203, 207, 211, 215, 220, 224, 228, 233, 237, 240, 243,
  246, 249, 251, 253, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270];
const NEW_FARES_FROM = new Date('2026-12-26T00:00:00+08:00');

const ADJ = {};
for (const [a, b, line, mins, km] of EDGES) {
  (ADJ[a] ??= []).push({ to: b, line, mins, km });
  (ADJ[b] ??= []).push({ to: a, line, mins, km });
}

// Dijkstra over (station, line) so changing lines costs TRANSFER_MIN.
export function findRoute(from, to) {
  if (!from || !to || from === to || !ADJ[from] || !ADJ[to]) return null;
  const key = (st, line) => `${st}|${line}`;
  const dist = new Map();
  const prev = new Map();
  const done = new Set();
  for (const e of ADJ[from]) dist.set(key(from, e.line), 0);
  for (;;) {
    // ponytail: linear scan for the next node, fine for ~150 stations; use a heap if the network grows
    let cur = null;
    let d = Infinity;
    for (const [k, v] of dist) if (!done.has(k) && v < d) { d = v; cur = k; }
    if (cur == null) return null;
    done.add(cur);
    const [st, line] = cur.split('|');
    if (st === to) {
      const hops = [];
      for (let k = cur; prev.has(k); k = prev.get(k).k) hops.unshift(prev.get(k).hop);
      const legs = [];
      for (const h of hops) {
        const last = legs[legs.length - 1];
        if (last && last.line === h.line) { last.to = h.to; last.stops++; last.mins += h.mins; } else {
          legs.push({ line: h.line, from: h.from, to: h.to, stops: 1, mins: h.mins });
        }
      }
      const km = hops.reduce((t, h) => t + h.km, 0);
      return { mins: Math.round(d), km, legs, hops, stations: [from, ...hops.map((h) => h.to)] };
    }
    for (const e of ADJ[st]) {
      const nk = key(e.to, e.line);
      const nd = d + e.mins + (e.line !== line ? TRANSFER_MIN : 0);
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, { k: cur, hop: { from: st, to: e.to, line: e.line, mins: e.mins, km: e.km } });
      }
    }
  }
}

// ponytail: distance is straight lines between stations, a little under the track distance LTA charges by
export function fareCents(km, when = new Date()) {
  const table = when >= NEW_FARES_FROM ? FARES_2026 : FARES_2025;
  const band = km <= 3.2 ? 0 : Math.ceil(km - 3.2 - 1e-9);
  return table[Math.min(band, table.length - 1)];
}
