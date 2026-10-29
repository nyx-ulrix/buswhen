// Self-check for MRT routing and fares: node route.test.mjs
import assert from 'node:assert/strict';
import { TRANSFER_MIN, fareCents, findRoute } from './route.js';

const lines = (r) => r.legs.map((l) => l.line).join('>');

// same line, no changes
const a = findRoute('Jurong East', 'Clementi');
assert.equal(lines(a), 'EW');
assert.equal(a.mins, 2);

// joined across an unopened station (Mount Pleasant): Caldecott -> Stevens is one 5-min hop
const b = findRoute('Caldecott', 'Stevens');
assert.equal(b.hops.length, 1);

// Changi Airport needs a change at Tanah Merah onto the branch
const c = findRoute('Pasir Ris', 'Changi Airport');
assert.ok(c.legs.some((l) => l.line === 'CG'));
assert.ok(c.legs.find((l) => l.line === 'CG').from === 'Tanah Merah' || c.legs.length === 1);

// cross-island trip: changes are counted and charged
const d = findRoute('Tuas Link', 'Changi Airport');
assert.ok(d.legs.length >= 2);
const ride = d.hops.reduce((t, h) => t + h.mins, 0);
assert.equal(d.mins, Math.round(ride + (d.legs.length - 1) * TRANSFER_MIN));
assert.equal(d.stations[0], 'Tuas Link');
assert.equal(d.stations.at(-1), 'Changi Airport');

// both directions take the same time
assert.equal(findRoute('Woodlands', 'Marina Bay').mins, findRoute('Marina Bay', 'Woodlands').mins);
assert.equal(findRoute('Orchard', 'Orchard'), null);
assert.equal(findRoute('Orchard', 'Nowhere'), null);

// fare bands: <=3.2 km, then 1 km bands, flat over 40.2 km; new table from 26 Dec 2026
const now = new Date('2026-10-29T12:00:00+08:00');
const later = new Date('2026-12-26T09:00:00+08:00');
assert.equal(fareCents(0.5, now), 128);
assert.equal(fareCents(3.2, now), 128);
assert.equal(fareCents(3.25, now), 138);
assert.equal(fareCents(4.2, now), 138);
assert.equal(fareCents(4.3, now), 149);
assert.equal(fareCents(6.5, now), 168); // 6.3-7.2 km
assert.equal(fareCents(40.2, now), 256);
assert.equal(fareCents(55, now), 257);
assert.equal(fareCents(6.5, later), 181);

console.log('route ok:', `Tuas Link -> Changi Airport ${d.mins} min, ${lines(d)}, ${d.km.toFixed(1)} km`);
