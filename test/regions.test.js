import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGIONS_FORMAT,
  createRegionMap,
  parseRegionMap,
  regionById,
  regionAt,
  mirrorPoint,
  mirrorPairAt,
  mirrorLayerPlacement,
  uniqueRegionId,
  detectPieces,
  piecesRegionMap,
  simplifyOutline,
  renameRegion,
  labelPoint,
  pointInPolygon,
  snapToOutline,
  matchPoint,
  linkPoints,
  linkLength,
} from '../js/regions.js';

// Convenience builder: a valid raw map with two mirrored door rectangles.
function rawMap(overrides = {}) {
  return {
    format: REGIONS_FORMAT,
    car: 'test car',
    regions: [
      { id: 'door_l', name: 'Left Door', x: 100, y: 200, w: 300, h: 150, mirror: 'door_r' },
      { id: 'door_r', name: 'Right Door', x: 900, y: 200, w: 300, h: 150, mirror: 'door_l' },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------- parseRegionMap

test('parseRegionMap accepts a valid map and preserves geometry', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(map.format, REGIONS_FORMAT);
  assert.equal(map.car, 'test car');
  assert.equal(map.regions.length, 2);
  const l = map.regions[0];
  assert.deepEqual(l, {
    id: 'door_l', name: 'Left Door', x: 100, y: 200, w: 300, h: 150, mirror: 'door_r',
  });
});

test('parseRegionMap normalizes a missing name to the id', () => {
  const map = parseRegionMap({
    format: REGIONS_FORMAT,
    car: 'c',
    regions: [{ id: 'hood', x: 0, y: 0, w: 10, h: 10 }],
  });
  assert.equal(map.regions[0].name, 'hood');
  // empty-string name also falls back to id
  const map2 = parseRegionMap({
    format: REGIONS_FORMAT,
    car: 'c',
    regions: [{ id: 'roof', name: '', x: 0, y: 0, w: 10, h: 10 }],
  });
  assert.equal(map2.regions[0].name, 'roof');
});

test('parseRegionMap strips unknown extra fields from regions', () => {
  const map = parseRegionMap({
    format: REGIONS_FORMAT,
    car: 'c',
    regions: [{ id: 'hood', x: 0, y: 0, w: 10, h: 10, color: 'red', locked: true }],
  });
  assert.deepEqual(Object.keys(map.regions[0]).sort(), ['h', 'id', 'name', 'w', 'x', 'y']);
});

test('parseRegionMap keeps a valid mirror field', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(map.regions[0].mirror, 'door_r');
  assert.equal(map.regions[1].mirror, 'door_l');
});

test('parseRegionMap falls back to "unknown car" when car is missing or empty', () => {
  const noCar = rawMap();
  delete noCar.car;
  assert.equal(parseRegionMap(noCar).car, 'unknown car');
  assert.equal(parseRegionMap(rawMap({ car: '' })).car, 'unknown car');
  assert.equal(parseRegionMap(rawMap({ car: 42 })).car, 'unknown car');
});

test('parseRegionMap rejects non-objects', () => {
  assert.throws(() => parseRegionMap(null), /not a region map object/);
  assert.throws(() => parseRegionMap('nope'), /not a region map object/);
  assert.throws(() => parseRegionMap(7), /not a region map object/);
});

test('parseRegionMap rejects a wrong format string', () => {
  assert.throws(
    () => parseRegionMap(rawMap({ format: 'clearcoat-regions/2' })),
    /unknown format "clearcoat-regions\/2"/,
  );
  assert.throws(() => parseRegionMap({ regions: [] }), /unknown format/);
});

test('parseRegionMap rejects a missing regions array', () => {
  assert.throws(
    () => parseRegionMap({ format: REGIONS_FORMAT, car: 'c' }),
    /missing "regions" array/,
  );
  assert.throws(
    () => parseRegionMap({ format: REGIONS_FORMAT, regions: {} }),
    /missing "regions" array/,
  );
});

test('parseRegionMap rejects a region without an id', () => {
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ x: 0, y: 0, w: 1, h: 1 }] })),
    /region 0 has no id/,
  );
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ id: '', x: 0, y: 0, w: 1, h: 1 }] })),
    /region 0 has no id/,
  );
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [null] })),
    /region 0 is not an object/,
  );
});

test('parseRegionMap rejects duplicate ids', () => {
  assert.throws(
    () => parseRegionMap(rawMap({
      regions: [
        { id: 'a', x: 0, y: 0, w: 1, h: 1 },
        { id: 'a', x: 5, y: 5, w: 1, h: 1 },
      ],
    })),
    /duplicate region id "a"/,
  );
});

test('parseRegionMap rejects non-finite x/y/w/h', () => {
  for (const k of ['x', 'y', 'w', 'h']) {
    for (const bad of [NaN, Infinity, '5', undefined]) {
      const r = { id: 'r', x: 0, y: 0, w: 1, h: 1 };
      r[k] = bad;
      assert.throws(
        () => parseRegionMap(rawMap({ regions: [r] })),
        new RegExp(`region "r" has a bad "${k}"`),
      );
    }
  }
});

test('parseRegionMap rejects non-positive w/h', () => {
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ id: 'r', x: 0, y: 0, w: 0, h: 1 }] })),
    /non-positive size/,
  );
  assert.throws(
    () => parseRegionMap(rawMap({ regions: [{ id: 'r', x: 0, y: 0, w: 1, h: -3 }] })),
    /non-positive size/,
  );
});

test('parseRegionMap rejects a mirror pointing at an unknown id', () => {
  assert.throws(
    () => parseRegionMap(rawMap({
      regions: [{ id: 'a', x: 0, y: 0, w: 1, h: 1, mirror: 'ghost' }],
    })),
    /region "a" mirrors unknown id "ghost"/,
  );
});

test('createRegionMap defaults car to "unknown car"', () => {
  assert.deepEqual(createRegionMap(), { format: REGIONS_FORMAT, car: 'unknown car', regions: [] });
  assert.equal(createRegionMap('gt3').car, 'gt3');
});

// ---------------------------------------------------------------- regionAt

test('regionAt finds a point inside and returns null outside', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(regionAt(map, 150, 250).id, 'door_l');
  assert.equal(regionAt(map, 950, 250).id, 'door_r');
  assert.equal(regionAt(map, 50, 50), null);
  assert.equal(regionAt(map, 500, 250), null); // gap between the doors
});

test('regionAt: later (topmost) region wins where rectangles overlap', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'under', x: 0, y: 0, w: 100, h: 100 },
      { id: 'over', x: 50, y: 50, w: 100, h: 100 },
    ],
  }));
  assert.equal(regionAt(map, 75, 75).id, 'over');   // overlap → topmost
  assert.equal(regionAt(map, 25, 25).id, 'under');  // only in the lower one
});

test('regionAt boundaries are inclusive on all edges', () => {
  const map = parseRegionMap(rawMap({
    regions: [{ id: 'r', x: 10, y: 20, w: 30, h: 40 }],
  }));
  assert.equal(regionAt(map, 10, 20).id, 'r');   // top-left corner
  assert.equal(regionAt(map, 40, 60).id, 'r');   // bottom-right corner (x+w, y+h)
  assert.equal(regionAt(map, 9.999, 20), null);
  assert.equal(regionAt(map, 40.001, 60), null);
});

// ---------------------------------------------------------------- regionById

test('regionById returns the region or null', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(regionById(map, 'door_l').name, 'Left Door');
  assert.equal(regionById(map, 'nope'), null);
});

// ---------------------------------------------------------------- mirrorPoint

test('mirrorPoint reflects u and preserves v', () => {
  const src = { x: 0, y: 0, w: 100, h: 100 };
  const dst = { x: 0, y: 0, w: 100, h: 100 };
  // u = 0.25, v = 0.5 → u' = 0.75, v' = 0.5
  assert.deepEqual(mirrorPoint(src, dst, 25, 50), { x: 75, y: 50 });
  // center maps to center
  assert.deepEqual(mirrorPoint(src, dst, 50, 50), { x: 50, y: 50 });
  // left edge maps to right edge
  assert.deepEqual(mirrorPoint(src, dst, 0, 10), { x: 100, y: 10 });
});

test('mirrorPoint works across different-sized rects', () => {
  const src = { x: 100, y: 200, w: 40, h: 20 };
  const dst = { x: 500, y: 600, w: 80, h: 40 };
  // point at u=0.25, v=0.5 of src → u'=0.75, v=0.5 of dst
  const p = mirrorPoint(src, dst, 110, 210);
  assert.deepEqual(p, { x: 500 + 0.75 * 80, y: 600 + 0.5 * 40 });
});

test('mirrorPoint with a zero-size src does not produce NaN', () => {
  const src = { x: 10, y: 10, w: 0, h: 0 };
  const dst = { x: 100, y: 100, w: 50, h: 50 };
  const p = mirrorPoint(src, dst, 10, 10);
  assert.ok(Number.isFinite(p.x));
  assert.ok(Number.isFinite(p.y));
  // u and v default to 0 → x lands at dst right edge, y at dst top
  assert.deepEqual(p, { x: 150, y: 100 });
});

// ---------------------------------------------------------------- mirrorPairAt

test('mirrorPairAt returns the { src, dst } pair for a mirrored region', () => {
  const map = parseRegionMap(rawMap());
  const pair = mirrorPairAt(map, 150, 250);
  assert.ok(pair);
  assert.equal(pair.src.id, 'door_l');
  assert.equal(pair.dst.id, 'door_r');
});

test('mirrorPairAt returns null when no region contains the point', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(mirrorPairAt(map, 5000, 5000), null);
});

test('mirrorPairAt returns null when the region has no mirror', () => {
  const map = parseRegionMap(rawMap({
    regions: [{ id: 'hood', x: 0, y: 0, w: 100, h: 100 }],
  }));
  assert.equal(mirrorPairAt(map, 50, 50), null);
});

test('mirrorPairAt returns null on a hand-built map with a dangling mirror id', () => {
  // parseRegionMap would reject this, but the helper must still cope.
  const map = {
    format: REGIONS_FORMAT,
    car: 'c',
    regions: [{ id: 'a', name: 'a', x: 0, y: 0, w: 100, h: 100, mirror: 'ghost' }],
  };
  assert.equal(mirrorPairAt(map, 50, 50), null);
});

// ---------------------------------------------------------------- mirrorLayerPlacement

test('mirrorLayerPlacement returns rounded mirrored coords with flip: true', () => {
  const map = parseRegionMap(rawMap());
  // layer center at u=0.25, v=0.5 of door_l (x=175, y=275)
  const placed = mirrorLayerPlacement(map, { x: 175, y: 275 });
  // mirrored to u=0.75 of door_r: x = 900 + 0.75*300 = 1125, y = 200 + 0.5*150 = 275
  assert.deepEqual(placed, { x: 1125, y: 275, flip: true });
});

test('mirrorLayerPlacement rounds fractional results', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'a', x: 0, y: 0, w: 3, h: 3, mirror: 'b' },
      { id: 'b', x: 10, y: 10, w: 3, h: 3 },
    ],
  }));
  const placed = mirrorLayerPlacement(map, { x: 1, y: 1 });
  // u = 1/3 → x = 10 + (2/3)*3 = 12, y = 10 + 1 = 11
  assert.deepEqual(placed, { x: 12, y: 11, flip: true });
  assert.ok(Number.isInteger(placed.x));
  assert.ok(Number.isInteger(placed.y));
});

test('mirrorLayerPlacement returns null when the layer center is outside any region', () => {
  const map = parseRegionMap(rawMap());
  assert.equal(mirrorLayerPlacement(map, { x: 5000, y: 5000 }), null);
});

// ---------------------------------------------------------------- uniqueRegionId

test('uniqueRegionId slugs names: lowercase, non-alphanumeric → underscore, trimmed', () => {
  const map = createRegionMap('c');
  assert.equal(uniqueRegionId('Left Door', map), 'left_door');
  assert.equal(uniqueRegionId('  Rear--Wing!! ', map), 'rear_wing');
  assert.equal(uniqueRegionId('A/B #3', map), 'a_b_3');
});

test('uniqueRegionId suffixes collisions with _2, _3, ...', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'hood', x: 0, y: 0, w: 1, h: 1 },
      { id: 'hood_2', x: 5, y: 5, w: 1, h: 1 },
    ],
  }));
  assert.equal(uniqueRegionId('Hood', map), 'hood_3');
});

test('uniqueRegionId falls back to "region" for empty or all-symbol names', () => {
  const map = createRegionMap('c');
  assert.equal(uniqueRegionId('', map), 'region');
  assert.equal(uniqueRegionId('!!!', map), 'region');
  const map2 = parseRegionMap(rawMap({
    regions: [{ id: 'region', x: 0, y: 0, w: 1, h: 1 }],
  }));
  assert.equal(uniqueRegionId('***', map2), 'region_2');
});

// ---------------------------------------------------------------- outlined regions

// An L: the full 100x100 box minus its top-right quarter.
const L_SHAPE = [
  { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

test('parseRegionMap keeps a valid outline and rejects a bad one', () => {
  const ok = parseRegionMap(rawMap({ regions: [{ id: 'l', x: 0, y: 0, w: 100, h: 100, points: L_SHAPE }] }));
  assert.deepEqual(ok.regions[0].points, L_SHAPE);
  assert.notEqual(ok.regions[0].points, L_SHAPE); // copied, not shared
  for (const points of [[], L_SHAPE.slice(0, 2), [{ x: 0, y: 0 }, { x: 1 }, { x: 2, y: 2 }], 'nope']) {
    assert.throws(
      () => parseRegionMap(rawMap({ regions: [{ id: 'l', x: 0, y: 0, w: 100, h: 100, points }] })),
      /bad "points"/,
    );
  }
});

test('regionAt follows the outline, not the bounding box', () => {
  const map = parseRegionMap(rawMap({
    regions: [
      { id: 'under', x: 0, y: 0, w: 100, h: 100 },
      { id: 'l', x: 0, y: 0, w: 100, h: 100, points: L_SHAPE },
    ],
  }));
  assert.equal(regionAt(map, 25, 25).id, 'l');
  assert.equal(regionAt(map, 75, 75).id, 'l');
  assert.equal(regionAt(map, 75, 25).id, 'under'); // inside l's box, outside its shape
});

// ---------------------------------------------------------------- detectPieces

// Draw the outline of a w×h box plus a grid line every `step` px, the way a
// wireframe draws one piece as a mesh.
function drawMesh(mask, W, x0, y0, w, h, step) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const edge = x === x0 || y === y0 || x === x0 + w - 1 || y === y0 + h - 1;
      if (edge || (x - x0) % step === 0 || (y - y0) % step === 0) mask[y * W + x] = 1;
    }
  }
}

test('detectPieces finds one outline per separate mesh, largest first', () => {
  const W = 200, H = 120;
  const mask = new Uint8Array(W * H);
  drawMesh(mask, W, 10, 10, 41, 31, 10);   // small piece
  drawMesh(mask, W, 80, 20, 101, 81, 20);  // large piece
  mask[5 * W + 190] = 1;                   // a stray speck
  const pieces = detectPieces(mask, W, H);
  assert.equal(pieces.length, 2);
  const map = piecesRegionMap('test car', pieces);
  assert.deepEqual(map.regions.map(r => [r.id, r.name, r.x, r.y, r.w, r.h]), [
    ['piece_1', 'Piece 1', 80, 20, 101, 81],
    ['piece_2', 'Piece 2', 10, 10, 41, 31],
  ]);
  assert.equal(map.regions[0].points.length, 4); // a box simplifies to its corners
  parseRegionMap(map); // what detection produces must load as a map
});

test('detectPieces traces a diagonal line network and a concave shape', () => {
  const W = 60, H = 60;
  const mask = new Uint8Array(W * H);
  // an L drawn with 1px lines, including a diagonal that only touches corner to corner
  for (let i = 10; i <= 50; i++) { mask[10 * W + i] = 1; mask[i * W + 10] = 1; mask[50 * W + i] = 1; }
  for (let i = 10; i <= 30; i++) { mask[i * W + 50] = 1; mask[30 * W + (20 + i)] = 1; }
  for (let i = 30; i <= 50; i++) mask[i * W + 50] = 1;
  for (let i = 0; i <= 40; i++) mask[(10 + i) * W + (10 + i)] = 1; // diagonal
  const [outline] = detectPieces(mask, W, H, { minArea: 100 });
  const map = parseRegionMap(piecesRegionMap('test car', [outline]));
  assert.equal(regionAt(map, 30, 30).id, 'piece_1');
  assert.equal(regionAt(map, 5, 5), null);
});

test('simplifyOutline drops points on a straight run and keeps real corners', () => {
  const ring = [];
  for (let x = 0; x < 100; x += 5) ring.push({ x, y: 0 });
  for (let y = 0; y < 100; y += 5) ring.push({ x: 100, y });
  for (let x = 100; x > 0; x -= 5) ring.push({ x, y: 100 });
  for (let y = 100; y > 0; y -= 5) ring.push({ x: 0, y });
  assert.deepEqual(simplifyOutline(ring, 1), [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
});

// ---------------------------------------------------------------- renameRegion / labelPoint

test('renameRegion makes the id follow the name and repoints the mirror partner', () => {
  const map = parseRegionMap(rawMap());
  renameRegion(map, regionById(map, 'door_l'), 'Driver Door');
  assert.deepEqual(map.regions.map(r => [r.id, r.name, r.mirror]), [
    ['driver_door', 'Driver Door', 'door_r'],
    ['door_r', 'Right Door', 'driver_door'],
  ]);
  parseRegionMap(map); // still a valid map: no dangling mirror
});

test('renameRegion avoids another region\'s id but not its own', () => {
  const map = piecesRegionMap('test car', [L_SHAPE, L_SHAPE, L_SHAPE]);
  renameRegion(map, map.regions[0], 'Roof');
  renameRegion(map, map.regions[1], 'Roof');
  renameRegion(map, map.regions[0], 'Roof'); // renaming to its current name is a no-op
  assert.deepEqual(map.regions.map(r => r.id), ['roof', 'roof_2', 'piece_3']);
});

test('labelPoint lands inside the shape and keeps off regions drawn over it', () => {
  const [l] = parseRegionMap(rawMap({ regions: [{ id: 'l', x: 0, y: 0, w: 100, h: 100, points: L_SHAPE }] })).regions;
  const p = labelPoint(l);
  assert.ok(pointInPolygon(L_SHAPE, p.x, p.y));
  assert.ok(p.room > 15); // the widest part of the L, not a corner
  const over = { id: 'over', x: 0, y: 40, w: 100, h: 60 }; // covers the L's foot
  const q = labelPoint(l, [over]);
  assert.ok(q.y < 40 && pointInPolygon(L_SHAPE, q.x, q.y));
});

// ---------------------------------------------------------------- seam links

// Two 100px squares. Square A's right edge (top to bottom) meets square B's
// top edge (right to left) — as if B were turned a quarter and moved away.
function linkedMap() {
  return parseRegionMap(rawMap({
    regions: [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 500, y: 300, w: 100, h: 100 },
    ],
    links: [{
      a: { region: 'a', from: { x: 100, y: 0 }, to: { x: 100, y: 100 } },
      b: { region: 'b', from: { x: 600, y: 300 }, to: { x: 500, y: 300 } },
    }],
  }));
}

test('snapToOutline lands on the edge, and on a corner when one is close', () => {
  const sq = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const edge = snapToOutline(sq, 104, 40, 8);
  assert.deepEqual([edge.x, edge.y, edge.s], [100, 40, 140]);
  const corner = snapToOutline(sq, 97, 5, 8);
  assert.deepEqual([corner.x, corner.y, corner.s], [100, 0, 100]);
});

test('matchPoint carries a spot across a link to a turned, far-away region', () => {
  const map = linkedMap();
  const m = matchPoint(map, 102, 25, 5); // a quarter of the way down A's right edge
  assert.equal(m.side, 'a');
  assert.ok(Math.abs(m.t - 0.25) < 1e-9);
  assert.deepEqual(m.at, { x: 100, y: 25 });
  assert.deepEqual(m.partner, { x: 575, y: 300 }); // a quarter of the way along B's top edge, from the right
  const back = matchPoint(map, 575, 298, 5); // and the same link read from B's side
  assert.deepEqual(back.partner, { x: 100, y: 25 });
});

test('matchPoint ignores spots off the linked stretch or too far from it', () => {
  const map = linkedMap();
  assert.equal(matchPoint(map, 50, 0, 5), null);   // A's top edge is not linked
  assert.equal(matchPoint(map, 130, 50, 5), null); // too far from the edge
});

test('linkPoints follows the stretch end to end, on both sides', () => {
  const map = linkedMap();
  const a = linkPoints(map, map.links[0], 'a'), b = linkPoints(map, map.links[0], 'b');
  assert.deepEqual([a[0], a[a.length - 1]], [{ x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.deepEqual([b[0], b[b.length - 1]], [{ x: 600, y: 300 }, { x: 500, y: 300 }]);
  assert.equal(linkLength(map, map.links[0]), 100);
});

test('links survive parsing and follow a renamed region; bad links are rejected', () => {
  const map = linkedMap();
  renameRegion(map, regionById(map, 'b'), 'Rear Bumper');
  assert.equal(map.links[0].b.region, 'rear_bumper');
  assert.deepEqual(parseRegionMap(map).links, map.links);
  assert.throws(() => parseRegionMap({ ...map, links: [{ a: map.links[0].a, b: { ...map.links[0].b, region: 'nope' } }] }), /unknown region "nope"/);
  assert.throws(() => parseRegionMap({ ...map, links: [{ a: map.links[0].a }] }), /bad "b" end/);
  assert.equal(parseRegionMap(rawMap()).links, undefined); // maps without links stay as they were
});
