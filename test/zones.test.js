import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alphaComponents,
  detectMirrorAxis,
  pairTwins,
  zonesToRegions,
  blobGray,
  twinRelation,
  inferDecalPairs,
  applyOrientation,
  fitToZone,
  nearestRegion,
  offPaintFraction,
} from '../js/zones.js';
import { createRegionMap, parseRegionMap, mirrorLayerPlacement, mirrorPointKind } from '../js/regions.js';

// ---------------------------------------------------------------- synthetic images

function blank(w, h) {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

// solid rectangle, optional color
function fillRect(img, x, y, w, h, rgb = [255, 255, 255]) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = (yy * img.width + xx) * 4;
      img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
    }
  }
}

// an asymmetric glyph ("L" shape with a bright dot) stamped into a w×h box,
// optionally turned 180° or flipped vertically — the probe inference must
// tell those apart
function stampGlyph(img, x, y, w, h, variant = 'same') {
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      // source-space pixel of the canonical glyph
      let sx = xx, sy = yy;
      if (variant === 'rot180') { sx = w - 1 - xx; sy = h - 1 - yy; }
      if (variant === 'flipV') { sy = h - 1 - yy; }
      const stem = sx < w * 0.3;                       // vertical bar on the left
      const foot = sy > h * 0.75;                      // bar along the bottom
      const dot = sx > w * 0.7 && sy < h * 0.25;       // bright dot top-right
      if (!stem && !foot && !dot) continue;
      const v = dot ? 255 : stem ? 90 : 160;
      const i = ((y + yy) * img.width + (x + xx)) * 4;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------- components

test('alphaComponents finds separate rectangles with exact bounds, sorted by y then x', () => {
  const img = blank(200, 200);
  fillRect(img, 10, 20, 50, 30);
  fillRect(img, 100, 120, 40, 40);
  fillRect(img, 150, 20, 20, 20);
  const cs = alphaComponents(img, 100);
  assert.equal(cs.length, 3);
  assert.deepEqual(cs.map(c => [c.x, c.y, c.w, c.h]), [[10, 20, 50, 30], [150, 20, 20, 20], [100, 120, 40, 40]]);
  assert.equal(cs[0].area, 1500);
});

test('alphaComponents drops components under minArea and merges touching pixels', () => {
  const img = blank(100, 100);
  fillRect(img, 0, 0, 10, 10);     // 100 px — too small at minArea 300
  fillRect(img, 20, 20, 20, 20);   // 400 px
  fillRect(img, 40, 20, 5, 20);    // touches the previous one → same component
  const cs = alphaComponents(img, 300);
  assert.equal(cs.length, 1);
  assert.deepEqual([cs[0].x, cs[0].y, cs[0].w, cs[0].h], [20, 20, 25, 20]);
});

// ---------------------------------------------------------------- twins + axis

test('detectMirrorAxis votes the fold from same-column pairs, not assuming 1024', () => {
  // BMW-style fold at 766: centres 220 + 1312 → 766, 307 + 1225 → 766
  const rects = [
    { x: 903, y: 160, w: 393, h: 120 }, { x: 903, y: 1252, w: 393, h: 120 },
    { x: 1410, y: 271, w: 335, h: 72 }, { x: 1410, y: 1189, w: 335, h: 72 },
    { x: 511, y: 540, w: 228, h: 447 }, // no twin
  ];
  assert.equal(detectMirrorAxis(rects), 766);
  // a single coincidental pair is not trusted → fallback
  assert.equal(detectMirrorAxis(rects.slice(0, 2)), 1024);
  assert.equal(detectMirrorAxis([]), 1024);
});

test('pairTwins pairs rectangles mirrored about the axis within tolerance, once each', () => {
  const rects = [
    { x: 434, y: 908, w: 349, h: 93 },
    { x: 434, y: 1048, w: 349, h: 93 },   // twin of 0 (centres 954.5 + 1094.5 → 1024.5)
    { x: 1684, y: 690, w: 199, h: 61 },
    { x: 1684, y: 1298, w: 199, h: 61 },  // twin of 2
    { x: 1558, y: 911, w: 127, h: 226 },  // straddles the fold, no twin
    { x: 440, y: 1048, w: 349, h: 93 },   // 6px off in x → still within tol... but 1 already used
  ];
  const pairs = pairTwins(rects, 1024, 6);
  assert.deepEqual(pairs, [[0, 1], [2, 3]]);
});

test('zonesToRegions names, numbers and pairs sponsor/number zones', () => {
  const zones = [
    { kind: 'sponsor', x: 434, y: 1048, w: 349, h: 93 },
    { kind: 'number', x: 1285, y: 258, w: 86, h: 63 },
    { kind: 'sponsor', x: 434, y: 908, w: 349, h: 93 },
    { kind: 'number', x: 1285, y: 1728, w: 86, h: 63 },
    { kind: 'sponsor', x: 1558, y: 911, w: 127, h: 226 },
  ];
  const map = createRegionMap('Dallara P217');
  map.regions.push({ id: 'sponsor_1', name: 'hand-drawn clash', x: 0, y: 0, w: 10, h: 10 });
  const { regions, axis } = zonesToRegions(zones, map);
  assert.equal(axis, 1024);
  assert.equal(regions.length, 5);
  // sorted top-to-bottom; ids avoid the existing sponsor_1
  assert.equal(regions[0].kind, 'number');
  assert.equal(regions[0].id, 'number_1');
  assert.equal(regions[0].name, 'Number 1 (86×63)');
  const s1 = regions.find(r => r.y === 908);
  assert.equal(s1.id, 'sponsor_1_2');
  assert.equal(s1.name, 'Sponsor 1 (349×93)');
  assert.equal(s1.rot, 0);
  const s2 = regions.find(r => r.y === 1048);
  assert.equal(s1.mirror, s2.id);
  assert.equal(s2.mirror, s1.id);
  assert.equal(s1.mirrorKind, 'flipV');
  const n1 = regions.find(r => r.y === 258), n2 = regions.find(r => r.y === 1728);
  assert.equal(n1.mirror, n2.id);
  assert.equal(regions.find(r => r.y === 911).mirror, undefined);
  // the whole thing survives parseRegionMap with kind/rot/mirrorKind intact
  const parsed = parseRegionMap({ ...map, regions: [...map.regions, ...regions] });
  const ps1 = parsed.regions.find(r => r.id === 'sponsor_1_2');
  assert.equal(ps1.kind, 'sponsor');
  assert.equal(ps1.rot, undefined); // 0 is the default and not stored
  assert.equal(ps1.mirrorKind, 'flipV');
});

// ---------------------------------------------------------------- decal probes

test('twinRelation tells a 180° twin from a flipped twin from a copy', () => {
  const img = blank(300, 300);
  stampGlyph(img, 10, 10, 40, 60, 'same');
  stampGlyph(img, 100, 10, 40, 60, 'rot180');
  stampGlyph(img, 200, 10, 40, 60, 'flipV');
  stampGlyph(img, 10, 200, 40, 60, 'same');
  const A = blobGray(img, { x: 10, y: 10, w: 40, h: 60 });
  assert.equal(twinRelation(A, blobGray(img, { x: 100, y: 10, w: 40, h: 60 })).kind, 'rot180');
  assert.equal(twinRelation(A, blobGray(img, { x: 200, y: 10, w: 40, h: 60 })).kind, 'flipV');
  const same = twinRelation(A, blobGray(img, { x: 10, y: 200, w: 40, h: 60 }));
  assert.equal(same.kind, 'same');
  assert.ok(same.margin > 0.1);
});

test('inferDecalPairs finds vertical twins and classifies them; symmetric blobs are skipped', () => {
  const img = blank(400, 2048);
  // glyph at y 300 (h 60, centre 330) twin at centre 1718 → y 1688, turned 180°
  stampGlyph(img, 50, 300, 40, 60, 'same');
  stampGlyph(img, 50, 1688, 40, 60, 'rot180');
  // flipped pair at x 200
  stampGlyph(img, 200, 500, 40, 60, 'same');
  stampGlyph(img, 200, 1488, 40, 60, 'flipV');
  // a symmetric square pair — can't be classified, must be dropped
  fillRect(img, 300, 100, 30, 30);
  fillRect(img, 300, 1918, 30, 30);
  const pairs = inferDecalPairs(img, { minArea: 400, axis: 1024 });
  assert.equal(pairs.length, 2);
  const byX = Object.fromEntries(pairs.map(p => [p.a.x, p]));
  assert.equal(byX[50].kind, 'rot180');
  assert.equal(byX[50].a.y, 300);     // a is always the upper blob
  assert.equal(byX[50].b.y, 1688);
  assert.equal(byX[200].kind, 'flipV');
});

test('applyOrientation gives the upper region rot 180 for a rot180 pair, flipV pairs stay upright', () => {
  const regions = [
    { id: 'sponsor_1', x: 40, y: 200, w: 100, h: 40, kind: 'sponsor', rot: 0, mirror: 'sponsor_2', mirrorKind: 'flipV' },
    { id: 'sponsor_2', x: 40, y: 1808, w: 100, h: 40, kind: 'sponsor', rot: 0, mirror: 'sponsor_1', mirrorKind: 'flipV' },
    { id: 'sponsor_3', x: 300, y: 600, w: 100, h: 40, kind: 'sponsor', rot: 0, mirror: 'sponsor_4', mirrorKind: 'flipV' },
    { id: 'sponsor_4', x: 300, y: 1408, w: 100, h: 40, kind: 'sponsor', rot: 0, mirror: 'sponsor_3', mirrorKind: 'flipV' },
    { id: 'sponsor_5', x: 600, y: 900, w: 100, h: 248, kind: 'sponsor', rot: 0 }, // straddles the fold → untouched
    { id: 'number_1', x: 10, y: 100, w: 50, h: 50, kind: 'number', rot: 0 },      // unpaired, inherits rot from nearest pair
  ];
  const pairs = [
    { a: { x: 50, y: 300, w: 40, h: 60 }, b: { x: 50, y: 1688, w: 40, h: 60 }, kind: 'rot180', margin: 0.5 },
    { a: { x: 320, y: 500, w: 40, h: 60 }, b: { x: 320, y: 1488, w: 40, h: 60 }, kind: 'flipV', margin: 0.5 },
  ];
  const changed = applyOrientation(regions, pairs, 1024);
  assert.ok(changed >= 3);
  assert.equal(regions[0].rot, 180);
  assert.equal(regions[1].rot, 0);
  assert.equal(regions[0].mirrorKind, 'rot180');
  assert.equal(regions[1].mirrorKind, 'rot180');
  assert.equal(regions[2].rot, 0);
  assert.equal(regions[3].rot, 0);
  assert.equal(regions[2].mirrorKind, 'flipV');
  assert.equal(regions[4].rot, 0);
  assert.equal(regions[4].mirrorKind, undefined);
  assert.equal(regions[5].rot, 180);
  assert.equal(regions[5].mirrorKind, undefined);
  assert.equal(applyOrientation(regions, [], 1024), 0);
});

// ---------------------------------------------------------------- fit / nearest / bleed

test('fitToZone centres with an 8% margin and swaps axes for 90/270', () => {
  const region = { x: 434, y: 908, w: 349, h: 93, rot: 0 };
  const f = fitToZone(1000, 200, region);
  assert.equal(f.x, 609); // 434 + 174.5 → rounded
  assert.equal(f.y, 955);
  assert.equal(f.rotation, 0);
  // width-bound: 349*0.84 / 1000
  assert.ok(Math.abs(f.scale - (349 * 0.84) / 1000) < 1e-9);
  const tall = fitToZone(1000, 200, { x: 0, y: 0, w: 100, h: 500, rot: 270 });
  assert.equal(tall.rotation, 270);
  // turned: the 1000-wide raster now spans the 500-tall side
  assert.ok(Math.abs(tall.scale - Math.min((100 * 0.84) / 200, (500 * 0.84) / 1000)) < 1e-9);
  assert.equal(fitToZone(10, 10, { x: 0, y: 0, w: 100, h: 100, rot: 180 }).rotation, 180);
  assert.equal(fitToZone(10, 10, { x: 0, y: 0, w: 100, h: 100 }).rotation, 0);
});

test('nearestRegion prefers the containing region, else the closest centre', () => {
  const map = createRegionMap('t');
  map.regions.push({ id: 'a', name: 'a', x: 0, y: 0, w: 100, h: 100 });
  map.regions.push({ id: 'b', name: 'b', x: 1000, y: 1000, w: 100, h: 100 });
  assert.equal(nearestRegion(map, 50, 50).id, 'a');
  assert.equal(nearestRegion(map, 900, 900).id, 'b');
  assert.equal(nearestRegion(createRegionMap('t'), 1, 1), null);
  assert.equal(nearestRegion(null, 1, 1), null);
});

test('offPaintFraction measures opaque pixels landing on unpaintable mask', () => {
  const layer = blank(10, 10);
  fillRect(layer, 0, 0, 10, 5); // 50 opaque px in the top half
  const mask = blank(10, 10);
  // paintable (white) everywhere except the top-left 10×2 strip (black)
  fillRect(mask, 0, 0, 10, 10, [255, 255, 255]);
  fillRect(mask, 0, 0, 10, 2, [0, 0, 0]);
  const f = offPaintFraction(layer, mask);
  assert.ok(Math.abs(f - 0.4) < 1e-9);
  assert.equal(offPaintFraction(blank(10, 10), mask), null);
});

// ---------------------------------------------------------------- mirror kinds (regions.js)

test('mirrorPointKind maps by relation and mirrorLayerPlacement reports the kind', () => {
  const src = { x: 0, y: 0, w: 100, h: 50 }, dst = { x: 1000, y: 1000, w: 100, h: 50 };
  assert.deepEqual(mirrorPointKind(src, dst, 10, 10, 'flip'), { x: 1090, y: 1010 });
  assert.deepEqual(mirrorPointKind(src, dst, 10, 10, 'flipV'), { x: 1010, y: 1040 });
  assert.deepEqual(mirrorPointKind(src, dst, 10, 10, 'rot180'), { x: 1090, y: 1040 });
  assert.deepEqual(mirrorPointKind(src, dst, 10, 10, 'same'), { x: 1010, y: 1010 });

  const map = parseRegionMap({
    format: 'clearcoat-regions/1', car: 't',
    regions: [
      { id: 'a', name: 'a', x: 0, y: 0, w: 100, h: 50, mirror: 'b', mirrorKind: 'rot180' },
      { id: 'b', name: 'b', x: 0, y: 1998, w: 100, h: 50, mirror: 'a', mirrorKind: 'rot180' },
      { id: 'c', name: 'c', x: 500, y: 0, w: 100, h: 50, mirror: 'd' },
      { id: 'd', name: 'd', x: 700, y: 0, w: 100, h: 50, mirror: 'c' },
      { id: 'e', name: 'e', x: 900, y: 0, w: 10, h: 10, mirrorKind: 'rot180' }, // no partner → kind dropped
    ],
  });
  const p = mirrorLayerPlacement(map, { x: 10, y: 10 });
  assert.equal(p.kind, 'rot180');
  assert.equal(p.flip, false);
  assert.deepEqual([p.x, p.y], [90, 2038]);
  const q = mirrorLayerPlacement(map, { x: 510, y: 10 });
  assert.equal(q.kind, 'flip');
  assert.equal(q.flip, true);
  assert.equal(map.regions.find(r => r.id === 'e').mirrorKind, undefined);
  // unknown kinds are dropped, not thrown
  const bad = parseRegionMap({ format: 'clearcoat-regions/1', car: 't', regions: [
    { id: 'a', name: 'a', x: 0, y: 0, w: 1, h: 1, mirror: 'b', mirrorKind: 'sideways', rot: 45, kind: 'hood' },
    { id: 'b', name: 'b', x: 0, y: 0, w: 1, h: 1, mirror: 'a' },
  ] });
  assert.equal(bad.regions[0].mirrorKind, undefined);
  assert.equal(bad.regions[0].rot, undefined);
  assert.equal(bad.regions[0].kind, undefined);
});
