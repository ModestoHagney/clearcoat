import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js needs a 2D context at import time and for text rasterising;
// the stub below is the same minimal one variants.test.js uses
function stubCtx() {
  return {
    font: '', textAlign: '', textBaseline: '', lineJoin: '', fillStyle: '', strokeStyle: '', lineWidth: 0,
    measureText: (s) => ({ width: s.length * 10 }),
    fillText() {}, strokeText() {}, save() {}, restore() {}, translate() {}, rotate() {},
    drawImage() {}, clearRect() {}, fillRect() {},
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  };
}
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: stubCtx, toDataURL: () => 'data:text' }),
};
globalThis.Image = class { set src(v) { queueMicrotask(() => this.onload && this.onload()); } };

const {
  parseBrief, MOOD_PALETTES, MOODS, resolvePalette, planCandidates, buildDoc, pickPatterns,
  sponsorPairs, adapter, wireAdapter, defaultRank, contrastColor, slugCar, briefWarnings, insideRegion,
} = await import('../js/brief.js');
const { parseRegionMap, regionById } = await import('../js/regions.js');

// ---------------------------------------------------------------- fixtures

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const SVG = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="4"/>';

function validBrief(extra = {}) {
  return {
    format: 'clearcoat-brief/1',
    car: 'Dallara P217',
    team: 'Ridgeline Endurance',
    driver: { name: 'R. Davenport', number: '64', custid: '1016399' },
    palette: { primary: '#0b1b3a', secondary: '#ff6a00', accent: '#ffffff' },
    style: 'clean',
    finish: 'satin',
    logos: [
      { name: 'Ridgeline', src: PNG, priority: 1 },
      { name: 'Northwind', src: SVG, priority: 2 },
      { name: 'Kestrel', src: PNG, priority: 3 },
    ],
    notes: 'keep it tidy',
    ...extra,
  };
}

// the real Dallara P217 zone list, as Clearcoat v0.65 reads it from the PSD
const R = (id, x1, y1, x2, y2, extra = {}) => ({ id, name: id, x: x1, y: y1, w: x2 - x1, h: y2 - y1, ...extra });
function p217Map() {
  return parseRegionMap({
    format: 'clearcoat-regions/1', car: 'Dallara P217',
    regions: [
      R('sponsor_1', 434, 908, 783, 1001, { kind: 'sponsor', mirror: 'sponsor_2', mirrorKind: 'rot180' }),
      R('sponsor_2', 434, 1048, 783, 1141, { kind: 'sponsor', mirror: 'sponsor_1', mirrorKind: 'rot180', rot: 180 }),
      R('sponsor_3', 1684, 690, 1883, 751, { kind: 'sponsor', mirror: 'sponsor_4', mirrorKind: 'same' }),
      R('sponsor_4', 1684, 1298, 1883, 1359, { kind: 'sponsor', mirror: 'sponsor_3', mirrorKind: 'same' }),
      R('sponsor_5', 651, 383, 790, 428, { kind: 'sponsor', mirror: 'sponsor_6', mirrorKind: 'rot180', rot: 180 }),
      R('sponsor_6', 651, 1622, 790, 1667, { kind: 'sponsor', mirror: 'sponsor_5', mirrorKind: 'rot180' }),
      R('sponsor_7', 1558, 911, 1685, 1137, { kind: 'sponsor' }),
      R('sponsor_8', 121, 1425, 188, 2018, { kind: 'sponsor', rot: 90 }),
      R('sponsor_9', 1334, 11, 1453, 52, { kind: 'sponsor' }),
      R('sponsor_10', 1502, 39, 1621, 80, { kind: 'sponsor' }),
      R('sponsor_11', 1920, 966, 1963, 1083, { kind: 'sponsor', rot: 270 }),
      R('number_1', 1285, 258, 1371, 321, { kind: 'number', rot: 180 }),
      R('number_2', 1809, 983, 1872, 1069, { kind: 'number' }),
      R('number_3', 1285, 1728, 1371, 1791, { kind: 'number' }),
    ],
  });
}

// six patterns with distinct stats: two near-identical ones (p3/p4) so the
// spread tie-break has something to do
function catalog6() {
  const P = (id, coverage, slot2, slot3, mix, edges, symmetry) =>
    ({ id, blob: null, thumb: 'data:,' + id, stats: { coverage, slot2, slot3, mix, edges, symmetry } });
  return {
    format: 'clearcoat-patterns/1', car: 'dallarap217',
    patterns: [
      P('p1', 0.10, 0.08, 0.02, 0.10, 0.20, 0.90),
      P('p2', 0.30, 0.25, 0.05, 0.20, 0.30, 0.80),
      P('p3', 0.32, 0.27, 0.05, 0.25, 0.32, 0.75),
      P('p4', 0.33, 0.28, 0.05, 0.25, 0.33, 0.70),
      P('p5', 0.60, 0.50, 0.10, 0.60, 0.70, 0.40),
      P('p6', 0.85, 0.60, 0.25, 0.90, 0.90, 0.20),
    ],
  };
}

const img = (w, h) => ({ width: w, height: h });
const assetsFor = (brief, map, catalog) => ({
  regionMap: map,
  logoImages: brief.logos.map((_, i) => img(400 + i * 50, 120)),
  patternImages: Object.fromEntries((catalog ? catalog.patterns : []).map(p => [p.id, img(2048, 2048)])),
  patternCar: 'dallarap217',
});

// ---------------------------------------------------------------- parseBrief

test('parseBrief accepts a full valid brief and normalises it', () => {
  const b = parseBrief(validBrief({ palette: { primary: '#0B1B3A', secondary: '#f60', accent: '#fff' } }));
  assert.equal(b.format, 'clearcoat-brief/1');
  assert.equal(b.car, 'Dallara P217');
  assert.deepEqual(b.driver, { name: 'R. Davenport', number: '64', custid: '1016399' });
  assert.deepEqual(b.palette, { primary: '#0b1b3a', secondary: '#ff6600', accent: '#ffffff' });
  assert.equal(b.style, 'clean');
  assert.equal(b.finish, 'satin');
  assert.equal(b.logos.length, 3);
  assert.equal(b.logos[1].priority, 2);
  assert.equal(b.notes, 'keep it tidy');
});

test('parseBrief takes a JSON string and tolerates missing optional fields', () => {
  const b = parseBrief(JSON.stringify({ format: 'clearcoat-brief/1', palette: { mood: 'night' } }));
  assert.equal(b.car, '');
  assert.equal(b.team, '');
  assert.deepEqual(b.driver, { name: '', number: '', custid: '' });
  assert.equal(b.style, 'clean');
  assert.equal(b.finish, 'gloss');
  assert.deepEqual(b.logos, []);
  // a numeric number comes through as text; a missing priority follows order
  const b2 = parseBrief(validBrief({ driver: { number: 7 }, logos: [{ src: PNG }, { src: PNG }] }));
  assert.equal(b2.driver.number, '7');
  assert.deepEqual(b2.logos.map(l => l.priority), [1, 2]);
  assert.equal(b2.logos[1].name, 'logo 2');
});

test('parseBrief rejects bad input with readable, field-naming errors', () => {
  assert.throws(() => parseBrief('{nope'), /not valid JSON/);
  assert.throws(() => parseBrief(null), /not a brief object/);
  assert.throws(() => parseBrief({ format: 'clearcoat/1' }), /format: expected "clearcoat-brief\/1"/);
  assert.throws(() => parseBrief(validBrief({ palette: undefined })), /palette: must be/);
  assert.throws(() => parseBrief(validBrief({ palette: { primary: 'blue', secondary: '#000', accent: '#fff' } })), /palette\.primary: "blue" is not a hex colour/);
  assert.throws(() => parseBrief(validBrief({ palette: { primary: '#0b1b3a', secondary: '#ff6a00' } })), /palette\.accent/);
  assert.throws(() => parseBrief(validBrief({ palette: { mood: 'swamp' } })), /palette\.mood: "swamp" is not one of/);
  assert.throws(() => parseBrief(validBrief({ style: 'loud' })), /style: "loud" is not one of/);
  assert.throws(() => parseBrief(validBrief({ finish: 'rusty' })), /finish: "rusty"/);
  assert.throws(() => parseBrief(validBrief({ driver: { number: '12345' } })), /driver\.number/);
  assert.throws(() => parseBrief(validBrief({ driver: { custid: '12ab' } })), /driver\.custid/);
  assert.throws(() => parseBrief(validBrief({ logos: 'x' })), /logos: must be an array/);
  assert.throws(() => parseBrief(validBrief({ logos: [{ name: 'a', src: 'logo.png' }] })), /logos\[0\]\.src: must be a data:image/);
  assert.throws(() => parseBrief(validBrief({ logos: [{ src: PNG, priority: 0 }] })), /logos\[0\]\.priority/);
});

// ---------------------------------------------------------------- palette

test('MOOD_PALETTES are ten valid hex triples with real slot-1/slot-2 contrast', () => {
  assert.equal(MOODS.length, 10);
  for (const [mood, p] of Object.entries(MOOD_PALETTES)) {
    for (const k of ['primary', 'secondary', 'accent']) assert.match(p[k], /^#[0-9a-f]{6}$/, `${mood}.${k}`);
    const b = parseBrief(validBrief({ palette: { mood } }));
    assert.deepEqual(resolvePalette(b), p);
  }
});

test('resolvePalette returns explicit colours normalised', () => {
  const b = parseBrief(validBrief({ palette: { primary: '#ABC', secondary: '#123456', accent: '#FFFFFF' } }));
  assert.deepEqual(resolvePalette(b), { primary: '#aabbcc', secondary: '#123456', accent: '#ffffff' });
});

test('contrastColor picks the readable palette colour, white/black as fallback', () => {
  assert.equal(contrastColor('#0b1b3a', ['#ff6a00', '#ffffff']), '#ffffff');
  assert.equal(contrastColor('#f2ead3', ['#1f4e8c', '#e8542b']), '#1f4e8c');
  assert.equal(contrastColor('#ffffff', []), '#111111');
});

test('slugCar agrees between brief names and template file names', () => {
  assert.equal(slugCar('Dallara P217'), 'dallarap217');
  assert.equal(slugCar('dallara-p217 (1)'), 'dallarap2171');
  assert.equal(slugCar(''), '');
});

// ---------------------------------------------------------------- planCandidates

test('sponsorPairs groups twins and orders by area, biggest first', () => {
  const pairs = sponsorPairs(p217Map());
  assert.equal(pairs[0].regions.map(r => r.id).join('+'), 'sponsor_1+sponsor_2');
  assert.equal(pairs[1].regions.map(r => r.id).join('+'), 'sponsor_8');       // 67×593 single, upright strip
  assert.equal(pairs[2].regions.map(r => r.id).join('+'), 'sponsor_7');
  assert.equal(pairs[3].regions.map(r => r.id).join('+'), 'sponsor_3+sponsor_4');
  assert.equal(pairs.length, 8); // 3 twinned pairs + 5 singles
});

test('pickPatterns ranks by style, spreads coverage, pages with seed', () => {
  const cat = catalog6();
  const clean = pickPatterns(cat, 'clean', 3, 0);
  assert.equal(clean.length, 3);
  // p2/p3/p4 all sit at the "clean" sweet spot but are near-identical: only one may appear
  const near = clean.filter(p => ['p2', 'p3', 'p4'].includes(p.id));
  assert.equal(near.length, 1, 'near-identical patterns were not spread: ' + clean.map(p => p.id));
  const aggressive = pickPatterns(cat, 'aggressive', 3, 0);
  assert.equal(aggressive[0].id, 'p6');
  const minimal = pickPatterns(cat, 'minimal', 3, 0);
  assert.equal(minimal[0].id, 'p1');
  // another seed gives a different first pick, still 3 distinct ids
  const page2 = pickPatterns(cat, 'clean', 3, 1);
  assert.notEqual(page2[0].id, clean[0].id);
  assert.equal(new Set(page2.map(p => p.id)).size, 3);
  // and the adapter's ranking wins over the local heuristic when wired
  const prev = adapter.patternRank;
  wireAdapter({ patternRank: (stats) => stats.coverage });   // biggest coverage first
  assert.equal(pickPatterns(cat, 'minimal', 1, 0)[0].id, 'p6');
  adapter.patternRank = prev;
});

test('planCandidates: main sponsor on the biggest pair + twin, rot carried, numbers everywhere', () => {
  const brief = parseBrief(validBrief());
  const map = p217Map();
  const plans = planCandidates(brief, catalog6(), map, 3);
  assert.equal(plans.length, 3);
  const p = plans[0];
  assert.equal(p.finish, 'satin');
  assert.deepEqual(p.colors, ['#0b1b3a', '#ff6a00', '#ffffff']);
  // priority-1 logo (index 0) lands on sponsor_1 AND its rot180 twin sponsor_2
  const main = p.placements.filter(x => x.logoIndex === 0);
  assert.deepEqual(main.map(x => x.regionId).sort(), ['sponsor_1', 'sponsor_2']);
  assert.equal(main.find(x => x.regionId === 'sponsor_1').rot, 0);
  assert.equal(main.find(x => x.regionId === 'sponsor_2').rot, 180);
  assert.equal(main.find(x => x.regionId === 'sponsor_2').mirrorOf, 'sponsor_1');
  // priority 2 takes the next biggest (the single rot-90 strip), priority 3 the one after
  assert.deepEqual(p.placements.filter(x => x.logoIndex === 1).map(x => [x.regionId, x.rot]), [['sponsor_8', 90]]);
  assert.deepEqual(p.placements.filter(x => x.logoIndex === 2).map(x => x.regionId), ['sponsor_7']);
  assert.deepEqual(p.unplaced, []);
  // every number zone
  assert.deepEqual(p.number.regionIds.sort(), ['number_1', 'number_2', 'number_3']);
  // the name takes the largest remaining pair's first zone
  assert.equal(p.name.regionId, 'sponsor_3');
  // three distinct patterns across the candidates
  assert.equal(new Set(plans.map(x => x.patternId)).size, 3);
});

test('planCandidates honours priority order over array order and reports unplaced logos', () => {
  const logos = Array.from({ length: 12 }, (_, i) => ({ name: 'L' + i, src: PNG, priority: 12 - i }));
  const brief = parseBrief(validBrief({ logos }));
  const [p] = planCandidates(brief, catalog6(), p217Map(), 1);
  // priority 1 is the LAST logo in the array
  assert.deepEqual(p.placements.filter(x => x.logoIndex === 11).map(x => x.regionId).sort(), ['sponsor_1', 'sponsor_2']);
  // 8 pairs for 12 logos: the four lowest priorities are left out, name skipped
  assert.deepEqual(p.unplaced, [3, 2, 1, 0]);
  assert.equal(p.name.regionId, null);
});

test('planCandidates without a catalogue still yields n distinct colourways', () => {
  const brief = parseBrief(validBrief());
  const plans = planCandidates(brief, null, p217Map(), 3);
  assert.equal(plans.length, 3);
  assert.ok(plans.every(p => p.patternId === null));
  assert.equal(new Set(plans.map(p => p.colors[0])).size, 3);
  assert.deepEqual(plans[0].colors, ['#0b1b3a', '#ff6a00', '#ffffff']);
  // with a tiny catalogue the leftover slots vary colour instead of repeating the pattern verbatim
  const one = { format: 'clearcoat-patterns/1', car: 'x', patterns: catalog6().patterns.slice(0, 1) };
  const padded = planCandidates(brief, one, p217Map(), 3);
  assert.ok(padded.every(p => p.patternId === 'p1'));
  assert.equal(new Set(padded.map(p => p.colors.join())).size, 3);
});

test('planCandidates is deterministic for the same inputs', () => {
  const brief = parseBrief(validBrief());
  const a = planCandidates(brief, catalog6(), p217Map(), 3, { seed: 2 });
  const b = planCandidates(brief, catalog6(), p217Map(), 3, { seed: 2 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, planCandidates(brief, catalog6(), p217Map(), 3, { seed: 0 }));
});

// ---------------------------------------------------------------- buildDoc

test('buildDoc: base, logos fitted into their zones with rot, numbers/name bound, driver row', () => {
  const brief = parseBrief(validBrief());
  const map = p217Map();
  const cat = catalog6();
  const [plan] = planCandidates(brief, cat, map, 1);
  // mock the carpattern layer type
  const prev = adapter.createCarPatternLayer;
  wireAdapter({
    createCarPatternLayer: (patternId, img, colors) =>
      ({ id: 'CP', type: 'carpattern', name: 'pattern ' + patternId, patternId, colors, img, src: null, visible: true, opacity: 1, material: 'gloss', x: 1024, y: 1024, scale: 1, rotation: 0 }),
  });
  const doc = buildDoc(plan, brief, assetsFor(brief, map, cat));
  adapter.createCarPatternLayer = prev;

  assert.equal(doc.baseColor, '#0b1b3a');
  assert.equal(doc.baseMaterial, 'satin');
  assert.equal(doc.regionMap, map);
  assert.equal(doc.patternCar, 'dallarap217');
  const cp = doc.layers[0];
  assert.equal(cp.type, 'carpattern');
  assert.equal(cp.patternId, plan.patternId);
  assert.deepEqual(cp.colors, plan.colors);
  assert.equal(cp.material, 'satin', 'finish applies to the pattern layer');

  const images = doc.layers.filter(l => l.type === 'image');
  assert.equal(images.length, plan.placements.length);
  for (const pl of plan.placements) {
    const region = regionById(map, pl.regionId);
    const layer = images.find(l => l.name.endsWith('· ' + region.name) && l.src === brief.logos[pl.logoIndex].src);
    assert.ok(layer, 'layer for ' + pl.regionId);
    assert.ok(insideRegion(layer, region), `${layer.name} centre inside ${pl.regionId}`);
    assert.equal(layer.x, Math.round(region.x + region.w / 2));
    assert.equal(layer.y, Math.round(region.y + region.h / 2));
    assert.equal(layer.rotation, pl.rot);
    assert.equal(layer.material, 'gloss', 'logos stay gloss');
    // fitted inside the zone with the 8% margin (rot 90 swaps the axes)
    const [ew, eh] = pl.rot % 180 ? [layer.img.height, layer.img.width] : [layer.img.width, layer.img.height];
    assert.ok(ew * layer.scale <= region.w * 0.84 + 1e-6 && eh * layer.scale <= region.h * 0.84 + 1e-6, 'fits with margin');
  }

  const nums = doc.layers.filter(l => l.type === 'text' && l.variable === 'number');
  assert.equal(nums.length, 3);
  assert.ok(nums.every(l => l.text === '64'));
  assert.ok(nums.every(l => insideRegion(l, regionById(map, 'number_' + (nums.indexOf(l) + 1)))));
  assert.equal(nums.find(l => l.name.endsWith('number_1')).rotation, 180);
  assert.equal(nums[0].textColor, '#ffffff', 'number reads against the navy body');

  const names = doc.layers.filter(l => l.type === 'text' && l.variable === 'name');
  assert.equal(names.length, 1);
  assert.equal(names[0].text, 'R. Davenport');
  assert.ok(insideRegion(names[0], regionById(map, 'sponsor_3')));

  assert.equal(doc.drivers.length, 1);
  assert.equal(doc.drivers[0].custid, '1016399');
  assert.equal(doc.drivers[0].number, '64');
  assert.equal(doc.brief.patternId, plan.patternId);
});

test('buildDoc falls back to a plain base coat when no pattern layer type is available', () => {
  const brief = parseBrief(validBrief({ driver: { name: 'A. Driver', number: '7' } }));
  const map = p217Map();
  const [plan] = planCandidates(brief, null, map, 1);
  const prev = adapter.createCarPatternLayer;
  adapter.createCarPatternLayer = null;
  const doc = buildDoc(plan, brief, assetsFor(brief, map, null));
  adapter.createCarPatternLayer = prev;
  assert.ok(!doc.layers.some(l => l.type === 'carpattern'));
  assert.equal(doc.baseColor, brief.palette.primary);
  assert.equal(doc.layers.filter(l => l.type === 'image').length, 4); // 2 + 1 + 1
  assert.equal(doc.drivers.length, 0, 'no custid → no driver row');
});

test('buildDoc is deterministic apart from layer ids', () => {
  const brief = parseBrief(validBrief());
  const map = p217Map();
  const [plan] = planCandidates(brief, null, map, 1);
  const strip = (doc) => doc.layers.map(({ id, img, src, ...rest }) => rest);
  const a = buildDoc(plan, brief, assetsFor(brief, map, null));
  const b = buildDoc(plan, brief, assetsFor(brief, map, null));
  assert.deepEqual(strip(a), strip(b));
});

// ---------------------------------------------------------------- warnings

test('briefWarnings explains missing zones, catalogue, and a car mismatch', () => {
  const brief = parseBrief(validBrief());
  const none = briefWarnings(brief, {});
  assert.ok(none.some(w => /template PSD/.test(w)));
  assert.ok(none.some(w => /pattern catalogue/.test(w)));
  const ok = briefWarnings(brief, { regionMap: p217Map(), catalog: catalog6(), patternCar: 'dallarap217' });
  assert.deepEqual(ok, []);
  const other = briefWarnings(brief, { regionMap: p217Map(), catalog: catalog6(), patternCar: 'ferrari296gt3' });
  assert.equal(other.length, 1);
  assert.match(other[0], /Dallara P217.*ferrari296gt3/);
  // the regionMap's car name counts when no catalogue car is known
  assert.deepEqual(briefWarnings(brief, { regionMap: p217Map(), catalog: catalog6() }), []);
});

test('defaultRank prefers low coverage for minimal and high coverage+edges for aggressive', () => {
  const lo = { coverage: 0.1, edges: 0.1, symmetry: 0.9, mix: 0.1, slot2: 0.1 };
  const hi = { coverage: 0.9, edges: 0.9, symmetry: 0.2, mix: 0.9, slot2: 0.6 };
  assert.ok(defaultRank(lo, 'minimal') > defaultRank(hi, 'minimal'));
  assert.ok(defaultRank(hi, 'aggressive') > defaultRank(lo, 'aggressive'));
  assert.ok(Number.isFinite(defaultRank({}, 'gradient')));
});
