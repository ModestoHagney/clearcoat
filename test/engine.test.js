import test from 'node:test';
import assert from 'node:assert/strict';

// engine.js creates a handful of scratch canvases at module scope; stub just
// enough DOM for the module to import in Node. Only pure (non-canvas)
// functions are exercised here.
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};
// loadImage stub — resolves immediately so image layers deserialize
globalThis.Image = class {
  set src(v) { queueMicrotask(() => this.onload && this.onload()); }
};

const {
  createDoc,
  createFillLayer,
  serializeDoc,
  deserializeDoc,
  mixHex,
  resolveParams,
  defaultParams,
  lumSpecChannels,
  fadeBand,
  fadeDotFrac,
  hashSeed,
  fadeSeedOf,
  ripNoise,
  ripProfile,
  ripShreds,
  glitchSlices,
  RIP_DEPTH,
} = await import('../js/engine.js');

// car pattern layers: keyed src + three slot colours + patternCar round-trip
test('carpattern layer and doc.patternCar survive serialize → deserialize, bad colours normalise', async () => {
  const doc = createDoc();
  doc.patternCar = 'dallara_p217';
  doc.layers.push({
    id: 'CP1', type: 'carpattern', name: 'car pattern 03', visible: true, opacity: 0.9,
    material: 'pearl', patternId: 'car_pattern_003', colors: ['#ff8800', 'junk', '#00ccff'],
    img: { src: 'data:image/png;base64,x' }, src: 'data:image/png;base64,x',
    x: 1024, y: 1024, scale: 1, rotation: 0, rx: 0, ry: 0, rw: 2048, rh: 2048,
  });
  const data = serializeDoc(doc);
  assert.equal(data.patternCar, 'dallara_p217');
  assert.equal(data.layers[0].patternId, 'car_pattern_003');
  assert.deepEqual(data.layers[0].colors, ['#ff8800', 'junk', '#00ccff']);
  assert.equal(JSON.parse(JSON.stringify(data)).layers[0].text, undefined); // no stray text fields
  const back = await deserializeDoc(JSON.parse(JSON.stringify(data)));
  assert.equal(back.patternCar, 'dallara_p217');
  const l = back.layers[0];
  assert.equal(l.type, 'carpattern');
  assert.equal(l.patternId, 'car_pattern_003');
  assert.deepEqual(l.colors, ['#ff8800', '#1a6cff', '#00ccff']); // slot 2 fell back to the default
  assert.equal(l.src, 'data:image/png;base64,x');
  assert.equal(l.material, 'pearl');
  assert.equal(l.rw, 2048);
  // a doc without the field stays null
  assert.equal((await deserializeDoc({ layers: [] })).patternCar, null);
});

// Layers built by hand (factory functions for image/text need real canvas).
function fakeTextLayer(overrides = {}) {
  return {
    id: 'T1', type: 'text', name: 'text', visible: true, opacity: 1,
    material: 'gloss', img: {}, src: 'data:image/png;base64,x',
    text: 'TEXT', font: 'Arial Black', fontSize: 160,
    textColor: '#ffffff', outlineColor: '#000000', outlineWidth: 0,
    italic: false, letterSpacing: 0, curve: 0, fx: null,
    x: 1024, y: 1024, scale: 1, rotation: 0, skewX: 0, skewY: 0,
    flipH: false, flipV: false,
    ...overrides,
  };
}

test('serializeDoc round-trips curve on text layers (default 0)', () => {
  const doc = createDoc();
  doc.layers.push(fakeTextLayer({ curve: -45 }), fakeTextLayer({ id: 'T2' }));
  const out = serializeDoc(doc);
  assert.equal(out.layers[0].curve, -45);
  assert.equal(out.layers[1].curve, 0);
});

test('serializeDoc carries fx as-is, null when absent', () => {
  const fx = {
    strokeW: 6, strokeColor: '#ff0000',
    shadow: 20, shadowDX: 8, shadowDY: 8, shadowColor: '#000000',
    glow: 0, glowColor: '#ffffff',
  };
  const doc = createDoc();
  doc.layers.push(fakeTextLayer({ fx }), fakeTextLayer({ id: 'T2', fx: null }));
  const out = serializeDoc(doc);
  assert.deepEqual(out.layers[0].fx, fx);
  assert.equal(out.layers[1].fx, null);
});

test('createFillLayer initializes colorMid/midPos and serializeDoc keeps them', () => {
  const fill = createFillLayer('#123456');
  assert.equal(fill.colorMid, null);
  assert.equal(fill.midPos, 0.5);
  fill.colorMid = '#00ff00';
  fill.midPos = 0.25;
  const doc = createDoc();
  doc.layers.push(fill);
  const out = serializeDoc(doc);
  assert.equal(out.layers[0].colorMid, '#00ff00');
  assert.equal(out.layers[0].midPos, 0.25);
});

test('deserializeDoc restores fill colorMid/midPos with defaults', async () => {
  const doc = await deserializeDoc({
    format: 'clearcoat/1',
    layers: [
      { type: 'fill', color: '#112233', fillType: 'linear', colorMid: '#abcdef', midPos: 0.7 },
      { type: 'fill', color: '#112233', fillType: 'linear' }, // pre-feature save
    ],
  });
  assert.equal(doc.layers[0].colorMid, '#abcdef');
  assert.equal(doc.layers[0].midPos, 0.7);
  assert.equal(doc.layers[1].colorMid, null);
  assert.equal(doc.layers[1].midPos, 0.5);
});

test('deserializeDoc coerces partial fx blocks to full defaults', async () => {
  const doc = await deserializeDoc({
    format: 'clearcoat/1',
    layers: [
      { type: 'image', src: 'data:x', fx: { strokeW: 10, glow: 30 } },
      { type: 'image', src: 'data:x' }, // pre-feature save
    ],
  });
  assert.deepEqual(doc.layers[0].fx, {
    strokeW: 10, strokeColor: '#000000',
    shadow: 0, shadowDX: 8, shadowDY: 8, shadowColor: '#000000',
    glow: 30, glowColor: '#ffffff',
    neon: 0, neonColor: '#39ff14',
    fade: 0, fadeAngle: 0, fadeCell: 14, fadeStyle: 'dots', fadeSeed: null, glitchSplit: 4,
  });
  assert.equal(doc.layers[1].fx, null);
});

test('deserializeDoc keeps neon and fade settings across a reload', async () => {
  const doc = await deserializeDoc({
    format: 'clearcoat/1',
    layers: [
      { type: 'image', src: 'data:x', fx: { neon: 30, neonColor: '#ff00ff', fade: 60, fadeAngle: 90, fadeCell: 20, fadeStyle: 'lines' } },
      { type: 'image', src: 'data:x', fx: { fade: 40, fadeStyle: 'glitch', fadeSeed: 123456, glitchSplit: 9 } },
      { type: 'image', src: 'data:x', fx: { fade: 40, fadeStyle: 'rip', fadeSeed: 77 } },
      { type: 'image', src: 'data:x', fx: { fade: 40, fadeStyle: 'bogus', glitchSplit: 99 } },
    ],
  });
  const fx = doc.layers[0].fx;
  assert.equal(fx.neon, 30);
  assert.equal(fx.neonColor, '#ff00ff');
  assert.deepEqual([fx.fade, fx.fadeAngle, fx.fadeCell, fx.fadeStyle], [60, 90, 20, 'lines']);
  const g = doc.layers[1].fx;
  assert.deepEqual([g.fadeStyle, g.fadeSeed, g.glitchSplit], ['glitch', 123456, 9]);
  const r = doc.layers[2].fx;
  assert.deepEqual([r.fadeStyle, r.fadeSeed], ['rip', 77]);
  const bad = doc.layers[3].fx;
  assert.deepEqual([bad.fadeStyle, bad.fadeSeed, bad.glitchSplit], ['dots', null, 12]); // unknown style → dots, split clamped
});

test('hashSeed / fadeSeedOf: stable, and an explicit seed wins over the id hash', () => {
  assert.equal(hashSeed('L1-abc'), hashSeed('L1-abc'));
  assert.notEqual(hashSeed('L1-abc'), hashSeed('L2-abc'));
  assert.equal(fadeSeedOf({ id: 'L1-abc' }, {}), hashSeed('L1-abc'));
  assert.equal(fadeSeedOf({ id: 'L1-abc' }, { fadeSeed: 42 }), 42);
});

test('ripNoise: deterministic per seed, bounded in [-1, 1], seeds differ', () => {
  let maxAbs = 0, diff = 0;
  for (let i = 0; i < 2000; i++) {
    const t = i * 0.0731 - 20;
    const a = ripNoise(7, t), b = ripNoise(7, t), c = ripNoise(8, t);
    assert.equal(a, b);
    maxAbs = Math.max(maxAbs, Math.abs(a));
    diff += Math.abs(a - c);
  }
  assert.ok(maxAbs <= 1);
  assert.ok(maxAbs > 0.3); // not degenerate
  assert.ok(diff / 2000 > 0.05);
});

test('ripProfile: covers the band along v, edge stays within [uStart, uStart + RIP_DEPTH·L]', () => {
  const band = fadeBand([{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 400 }, { x: 0, y: 400 }], 0, 50);
  const prof = ripProfile(99, band, 14);
  const L = band.u1 - band.uStart;
  assert.ok(prof[0].v <= band.v0 - 14 && prof[prof.length - 1].v >= band.v1 + 14);
  for (const p of prof) assert.ok(p.u >= band.uStart - 1e-9 && p.u <= band.uStart + RIP_DEPTH * L + 1e-9);
  assert.deepEqual(ripProfile(99, band, 14), prof);
  assert.notDeepEqual(ripProfile(100, band, 14), prof);
  // shreds: past the solid edge, inside the band, thinning out toward u1
  const shreds = ripShreds(99, band, 14);
  assert.ok(shreds.length > 20);
  let near = 0, far = 0;
  for (const s of shreds) {
    assert.ok(s.u >= band.uStart && s.u <= band.u1 + s.w);
    if (s.u < band.uStart + L * 2 / 3) near++; else far++;
  }
  assert.ok(near > far * 2);
  assert.deepEqual(ripShreds(99, band, 14), shreds);
});

test('glitchSlices: strips tile the band with 0.5–3 cell heights, segments tile uStart→u1, shift grows and dropout rises', () => {
  const band = fadeBand([{ x: 0, y: 0 }, { x: 2048, y: 0 }, { x: 2048, y: 2048 }, { x: 0, y: 2048 }], 0, 60);
  const cell = 14;
  const strips = glitchSlices(5, band, cell);
  assert.deepEqual(glitchSlices(5, band, cell), strips);
  assert.notDeepEqual(glitchSlices(6, band, cell), strips);
  let v = band.v0 - cell;
  let keepNear = 0, nNear = 0, keepFar = 0, nFar = 0, shiftNear = 0, shiftFar = 0;
  const L = band.u1 - band.uStart;
  for (const s of strips) {
    assert.ok(Math.abs(s.v - v) < 1e-9, 'strips are contiguous');
    assert.ok(s.h > 0 && s.h <= cell * 3 + 1e-9);
    v += s.h;
    let u = Math.floor(band.uStart); // snapped to the pixel grid
    for (const seg of s.segs) {
      assert.ok(Math.abs(seg.u - u) < 1e-9, 'segments are contiguous');
      assert.equal(seg.shift, Math.round(seg.shift), 'whole-pixel shifts');
      u += seg.w;
      const t = (seg.u + seg.w / 2 - band.uStart) / L;
      if (t < 0.25) { nNear++; keepNear += seg.keep ? 1 : 0; shiftNear += Math.abs(seg.shift); }
      if (t > 0.75) { nFar++; keepFar += seg.keep ? 1 : 0; shiftFar += Math.abs(seg.shift); }
    }
    assert.ok(Math.abs(u - band.u1) < 1e-6, 'segments reach u1');
  }
  assert.ok(v >= band.v1 + cell - 1e-9, 'strips reach the far edge');
  assert.ok(strips.every((s, i) => i === strips.length - 1 || s.h >= cell * 0.5 - 1e-9));
  assert.ok(keepNear / nNear > 0.7 && keepFar / nFar < 0.3);
  assert.ok(shiftFar / nFar > shiftNear / nNear);
});

test('fadeBand: axis-aligned box at 0° fades toward the right edge', () => {
  const box = [{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 300 }, { x: 100, y: 300 }];
  const b = fadeBand(box, 0, 50);
  assert.equal(b.u0, 100); assert.equal(b.u1, 500);
  assert.equal(b.v0, 200); assert.equal(b.v1, 300);
  assert.equal(b.uStart, 300); // last half of the width dissolves
});

test('fadeBand: 180° fades toward the left edge, 100% covers the whole layer', () => {
  const box = [{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 300 }, { x: 100, y: 300 }];
  const b = fadeBand(box, 180, 100);
  // u axis points left, so the box spans u = -500 .. -100 and the band is all of it
  assert.ok(Math.abs(b.u0 - -500) < 1e-9 && Math.abs(b.u1 - -100) < 1e-9);
  assert.ok(Math.abs(b.uStart - b.u0) < 1e-9);
});

test('fadeDotFrac: full dots at the band start, none at the end, area-linear between', () => {
  const b = { u0: 0, u1: 400, uStart: 200 };
  assert.equal(fadeDotFrac(0, b), 1);
  assert.equal(fadeDotFrac(200, b), 1);
  assert.equal(fadeDotFrac(400, b), 0);
  assert.equal(fadeDotFrac(500, b), 0);
  const mid = fadeDotFrac(300, b);
  assert.ok(Math.abs(mid * mid - 0.5) < 1e-9); // radius² tracks coverage
});

test('mixHex interpolates channels', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#ff0000', '#00ff00', 0), '#ff0000');
  assert.equal(mixHex('#ff0000', '#00ff00', 1), '#00ff00');
});

test('resolveParams overlays matParams on material defaults', () => {
  assert.deepEqual(defaultParams('gloss'), { met: 0, rough: 40, clear: 255 });
  assert.deepEqual(resolveParams('gloss', { rough: 99 }), { met: 0, rough: 99, clear: 255 });
});

// ---------- luminance-driven spec (weathering) ----------

test('lumSpecChannels: amt 0 is a no-op, full amt swings dark pixels to oxide', () => {
  const chrome = { met: 255, rough: 10, clear: 255 };
  // amt 0 — flat material regardless of luminance
  assert.deepEqual(lumSpecChannels(0, chrome, false, 0), chrome);
  assert.deepEqual(lumSpecChannels(1, chrome, false, 0), chrome);
  // amt 100 — bright pixels keep the material, dark pixels go full oxide
  assert.deepEqual(lumSpecChannels(1, chrome, false, 100), chrome);
  assert.deepEqual(lumSpecChannels(0, chrome, false, 100), { met: 0, rough: 235, clear: 30 });
});

test('lumSpecChannels: invert weathers the bright end instead', () => {
  const chrome = { met: 255, rough: 10, clear: 255 };
  assert.deepEqual(lumSpecChannels(1, chrome, true, 100), { met: 0, rough: 235, clear: 30 });
  assert.deepEqual(lumSpecChannels(0, chrome, true, 100), chrome);
});

test('lumSpec serializes and round-trips; amt 0 and legacy saves normalize to null', async () => {
  const doc = createDoc();
  doc.layers.push({ ...createFillLayer('#8a5a2b'), lumSpec: { amt: 70, invert: true } });
  const out = serializeDoc(doc);
  assert.deepEqual(out.layers[0].lumSpec, { amt: 70, invert: true });

  const back = await deserializeDoc({
    format: 'clearcoat/1',
    layers: [
      { type: 'fill', color: '#8a5a2b', lumSpec: { amt: 70, invert: true } },
      { type: 'fill', color: '#8a5a2b', lumSpec: { amt: 0, invert: true } },
      { type: 'fill', color: '#8a5a2b' }, // pre-feature save
      { type: 'image', src: 'data:x', lumSpec: { amt: 250 } }, // clamped
    ],
  });
  assert.deepEqual(back.layers[0].lumSpec, { amt: 70, invert: true });
  assert.equal(back.layers[1].lumSpec, null);
  assert.equal(back.layers[2].lumSpec, null);
  assert.deepEqual(back.layers[3].lumSpec, { amt: 100, invert: false });
});

test('deserializeDoc restores scaleY on image layers (stretch survived reload)', async () => {
  const doc = await deserializeDoc({
    format: 'clearcoat/1',
    layers: [
      { type: 'image', src: 'data:x', scale: 1, scaleY: 2.5 },
      { type: 'image', src: 'data:x', scale: 1 }, // uniform — stays null
    ],
  });
  assert.equal(doc.layers[0].scaleY, 2.5);
  assert.equal(doc.layers[1].scaleY, null);
});
