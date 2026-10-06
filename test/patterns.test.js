import test from 'node:test';
import assert from 'node:assert/strict';

const {
  recolorPixels, patternStats, patternRank, buildCatalog, getPattern, carSlug,
  normalizeColors, DEFAULT_COLORS, PATTERN_FORMAT, PATTERN_STYLES,
} = await import('../js/patterns.js');

// ---------- recolorPixels ----------

const px = (...rows) => new Uint8ClampedArray(rows.flat());

test('recolorPixels maps pure red/green/blue to the three slots and keeps alpha', () => {
  const data = px([255, 0, 0, 255], [0, 255, 0, 200], [0, 0, 255, 80]);
  recolorPixels(data, ['#102030', '#405060', '#708090']);
  assert.deepEqual([...data.slice(0, 4)], [0x10, 0x20, 0x30, 255]);
  assert.deepEqual([...data.slice(4, 8)], [0x40, 0x50, 0x60, 200]);
  assert.deepEqual([...data.slice(8, 12)], [0x70, 0x80, 0x90, 80]);
});

test('recolorPixels blends gradient mixes by channel weight', () => {
  // half red / half green → midpoint of c1 and c2
  const data = px([128, 128, 0, 255]);
  recolorPixels(data, ['#000000', '#ffffff', '#ff0000']);
  assert.deepEqual([...data.slice(0, 3)], [128, 128, 128]);
  // dark green (0,160,0) is still 100% slot 2 — magnitude cancels in the ratio
  const d2 = px([0, 160, 0, 255]);
  recolorPixels(d2, ['#000000', '#1a6cff', '#ffffff']);
  assert.deepEqual([...d2.slice(0, 3)], [0x1a, 0x6c, 0xff]);
});

test('recolorPixels treats black (s == 0) as slot 1 and skips transparent pixels', () => {
  const data = px([0, 0, 0, 255], [0, 255, 0, 0]);
  recolorPixels(data, ['#abcdef', '#ffffff', '#ffffff']);
  assert.deepEqual([...data.slice(0, 4)], [0xab, 0xcd, 0xef, 255]);
  assert.deepEqual([...data.slice(4, 8)], [0, 255, 0, 0]); // untouched
});

test('recolorPixels falls back to defaults for junk colours', () => {
  const data = px([255, 0, 0, 255]);
  recolorPixels(data, ['nope', null, 12]);
  const [r, g, b] = [1, 3, 5].map(i => parseInt(DEFAULT_COLORS[0].slice(i, i + 2), 16));
  assert.deepEqual([...data.slice(0, 3)], [r, g, b]);
  assert.deepEqual(normalizeColors(['#ABCDEF']), ['#abcdef', DEFAULT_COLORS[1], DEFAULT_COLORS[2]]);
});

// ---------- patternStats ----------

function sheet(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = fn(x, y);
    const i = (y * w + x) * 4;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  return d;
}

test('patternStats: all-red sheet has zero coverage, mix and edges', () => {
  const s = patternStats(sheet(16, 16, () => [255, 0, 0, 255]), 16, 16);
  assert.equal(s.coverage, 0);
  assert.equal(s.mix, 0);
  assert.equal(s.edges, 0);
  assert.equal(s.slot2, 0);
});

test('patternStats: left-red / right-green split measures coverage, slot share and an edge', () => {
  const s = patternStats(sheet(16, 16, (x) => x < 8 ? [255, 0, 0, 255] : [0, 255, 0, 255]), 16, 16);
  assert.ok(Math.abs(s.coverage - 0.5) < 1e-9);
  assert.ok(Math.abs(s.slot2 - 0.5) < 1e-9);
  assert.ok(s.edges > 0 && s.edges < 0.1);
  assert.ok(s.symmetry < 0.5); // halves differ
});

test('patternStats: gradient sheet is mostly mix; mirrored sheet is symmetric', () => {
  const grad = patternStats(sheet(32, 4, (x) => [255 - x * 8, x * 8, 0, 255]), 32, 4);
  assert.ok(grad.mix > 0.8);
  const sym = patternStats(sheet(32, 4, (x) => (x < 8 || x >= 24) ? [0, 0, 255, 255] : [255, 0, 0, 255]), 32, 4);
  assert.ok(sym.symmetry > 0.99);
  // transparent pixels are not paintable
  const alpha = patternStats(sheet(8, 8, (x) => x < 4 ? [0, 255, 0, 255] : [0, 255, 0, 0]), 8, 8);
  assert.equal(alpha.coverage, 1);
});

// ---------- patternRank ----------

const S = {
  plain:    { coverage: 0.04, slot2: 0.02, slot3: 0.02, mix: 0.00, edges: 0.005, symmetry: 0.9 },
  clean:    { coverage: 0.45, slot2: 0.40, slot3: 0.05, mix: 0.02, edges: 0.02, symmetry: 0.3 },
  bold:     { coverage: 0.90, slot2: 0.60, slot3: 0.30, mix: 0.03, edges: 0.04, symmetry: 0.2 },
  jagged:   { coverage: 0.70, slot2: 0.40, slot3: 0.30, mix: 0.02, edges: 0.20, symmetry: 0.0 },
  classic:  { coverage: 0.50, slot2: 0.45, slot3: 0.05, mix: 0.01, edges: 0.02, symmetry: 0.95 },
  faded:    { coverage: 0.80, slot2: 0.40, slot3: 0.40, mix: 0.40, edges: 0.01, symmetry: 0.1 },
};
const best = (style) => Object.entries(S).sort((a, b) => patternRank(b[1], style) - patternRank(a[1], style))[0][0];

test('patternRank picks the expected pattern for every style', () => {
  assert.equal(best('minimal'), 'plain');
  assert.equal(best('bold'), 'bold');
  assert.equal(best('aggressive'), 'jagged');
  assert.equal(best('gradient'), 'faded');
  assert.equal(best('classic'), 'classic');
  assert.ok(['clean', 'classic'].includes(best('clean'))); // both are mid-coverage, flat, calm
  assert.ok(patternRank(S.clean, 'clean') > patternRank(S.jagged, 'clean'));
  assert.ok(patternRank(S.clean, 'clean') > patternRank(S.faded, 'clean'));
});

test('patternRank: scores are 0…1, unknown style ranks everything equal, null stats score 0', () => {
  for (const st of PATTERN_STYLES) for (const s of Object.values(S)) {
    const v = patternRank(s, st);
    assert.ok(v >= 0 && v <= 1, `${st} ${v}`);
  }
  assert.equal(patternRank(S.bold, 'all'), patternRank(S.plain, 'all'));
  assert.equal(patternRank(null, 'bold'), 0);
});

// ---------- catalogue ----------

test('carSlug follows the region-id rule', () => {
  assert.equal(carSlug('Dallara P217'), 'dallara_p217');
  assert.equal(carSlug('  BMW M4 EVO GT4 (1) '), 'bmw_m4_evo_gt4_1');
  assert.equal(carSlug('!!!'), 'car');
  assert.equal(carSlug(''), 'car');
});

test('buildCatalog sorts by index, derives ids from names, dedupes, drops blobless rows', () => {
  const blob = { size: 3 };
  const cat = buildCatalog('Dallara P217', [
    { name: 'car_pattern_003.tga', blob, thumb: 'data:,', stats: S.bold },
    { name: 'car_pattern_000.tga', blob },
    { name: 'car_pattern_000.tga', blob }, // duplicate name → distinct id
    { name: 'broken', blob: null },
    { id: 'custom', name: 'extra', index: 7, blob },
  ]);
  assert.equal(cat.format, PATTERN_FORMAT);
  assert.equal(cat.car, 'Dallara P217');
  assert.equal(cat.slug, 'dallara_p217');
  assert.deepEqual(cat.patterns.map(p => p.id), ['car_pattern_000', 'car_pattern_000_', 'car_pattern_003', 'custom']);
  assert.deepEqual(cat.patterns.map(p => p.index), [0, 0, 3, 7]);
  assert.equal(getPattern(cat, 'car_pattern_003').stats, S.bold);
  assert.equal(getPattern(cat, 'car_pattern_003').thumb, 'data:,');
  assert.equal(getPattern(cat, 'nope'), null);
  assert.equal(getPattern(null, 'x'), null);
  assert.equal(buildCatalog('x', null).patterns.length, 0);
});
