import test from 'node:test';
import assert from 'node:assert/strict';
import { measureOptical, layoutRow, cornersRect } from '../js/layout.js';

// ImageData-like sampler: paints an opaque rect (in sample pixels) on a w×h
// transparent field, standing in for a logo drawn onto a scratch canvas
function rectSampler(rx, ry, rw, rh) {
  return (img, w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) data[(y * w + x) * 4 + 3] = 255;
    return { width: w, height: h, data };
  };
}

const near = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) <= eps, msg || `${a} ≉ ${b}`);

test('measureOptical finds the opaque bbox and scales it back to image pixels', () => {
  // 1000×500 image sampled at 128×64; opaque block at sample (10,20) size 50×20
  const box = measureOptical({ width: 1000, height: 500 }, { sample: rectSampler(10, 20, 50, 20) });
  const fx = 1000 / 128, fy = 500 / 64;
  near(box.x, 10 * fx); near(box.y, 20 * fy);
  near(box.w, 50 * fx); near(box.h, 20 * fy);
});

test('measureOptical ignores faint alpha below the threshold', () => {
  const sample = (img, w, h) => {
    const data = new Uint8ClampedArray(w * h * 4);
    data.fill(4); // faint haze everywhere
    data[(5 * w + 7) * 4 + 3] = 200; // one solid pixel
    return { width: w, height: h, data };
  };
  const box = measureOptical({ width: 64, height: 64 }, { sample, maxDim: 64 });
  assert.deepEqual(box, { x: 7, y: 5, w: 1, h: 1 });
});

test('measureOptical falls back to the full image when nothing is opaque', () => {
  const box = measureOptical({ width: 300, height: 200 }, { sample: rectSampler(0, 0, 0, 0) });
  assert.deepEqual(box, { x: 0, y: 0, w: 300, h: 200 });
  assert.deepEqual(measureOptical({ width: 0, height: 0 }), { x: 0, y: 0, w: 0, h: 0 });
});

// full-bleed items: optical box == image
const full = (id, w, h) => ({ id, w, h, ox: 0, oy: 0, ow: w, oh: h });

test('layoutRow gives every item the same optical height and even gaps', () => {
  const items = [full('wide', 400, 100), full('tall', 100, 100), full('mid', 200, 100)];
  const rect = { x: 100, y: 500, w: 1000, h: 200 };
  const out = layoutRow(items, rect, { gap: 'even' });
  assert.equal(out.length, 3);
  const heights = out.map((o, i) => items[i].oh * o.scale);
  near(heights[0], heights[1]); near(heights[1], heights[2]);
  assert.ok(heights[0] <= rect.h + 1e-9, 'fits the rect height');
  // vertically centred in the rect
  for (const o of out) near(o.y, 600);
  // first item's left edge sits on the rect's left edge, last item's right edge on the right
  const left = out[0].x - items[0].ow * out[0].scale / 2;
  const right = out[2].x + items[2].ow * out[2].scale / 2;
  near(left, rect.x); near(right, rect.x + rect.w);
  // gaps between neighbours are equal
  const g1 = (out[1].x - items[1].ow * out[1].scale / 2) - (out[0].x + items[0].ow * out[0].scale / 2);
  const g2 = (out[2].x - items[2].ow * out[2].scale / 2) - (out[1].x + items[1].ow * out[1].scale / 2);
  near(g1, g2);
  assert.ok(g1 > 0);
});

test('layoutRow with equal centres spaces centres uniformly and respects alignment', () => {
  const items = [full('a', 100, 100), full('b', 300, 100)];
  const rect = { x: 0, y: 0, w: 800, h: 300 };
  const centred = layoutRow(items, rect, { gap: 'centres', align: 'center' });
  near(centred[0].x, 200); near(centred[1].x, 600);
  const H = items[0].oh * centred[0].scale;
  near(items[1].oh * centred[1].scale, H);
  assert.ok(items[1].ow * centred[1].scale <= 400, 'widest item fits its slot');

  const top = layoutRow(items, rect, { gap: 'centres', align: 'start' });
  near(top[0].y, H / 2);
  const bottom = layoutRow(items, rect, { gap: 'centres', align: 'end' });
  near(bottom[0].y, 300 - H / 2);
});

test('layoutRow places by the optical box, not the canvas', () => {
  // a 400×400 canvas whose visible mark is a 200×100 box in the bottom-right
  const items = [{ id: 'pad', w: 400, h: 400, ox: 200, oy: 300, ow: 200, oh: 100 }, full('b', 200, 100)];
  const rect = { x: 0, y: 0, w: 1000, h: 100 };
  const out = layoutRow(items, rect, { gap: 'even' });
  const s = out[0].scale;
  near(items[0].oh * s, items[1].oh * out[1].scale, 1e-9, 'optical heights match');
  // optical centre of item 0 should land where a full-bleed item would
  const optCx = out[0].x + (items[0].ox + items[0].ow / 2 - items[0].w / 2) * s;
  const optCy = out[0].y + (items[0].oy + items[0].oh / 2 - items[0].h / 2) * s;
  near(optCx, items[0].ow * s / 2, 1e-9, 'left edge of the mark on the rect edge');
  near(optCy, 50);
  // flipped horizontally, the offset mirrors
  const flipped = layoutRow([{ ...items[0], flipH: true }, items[1]], rect, { gap: 'even' });
  near(flipped[0].x, -out[0].x + 2 * (items[0].ow * s / 2));
});

test('layoutRow runs vertically with equal optical width', () => {
  const items = [full('a', 100, 300), full('b', 100, 100)];
  const rect = { x: 50, y: 0, w: 200, h: 1000 };
  const out = layoutRow(items, rect, { direction: 'vertical', gap: 'even' });
  near(items[0].ow * out[0].scale, items[1].ow * out[1].scale);
  for (const o of out) near(o.x, 150);
  assert.ok(out[0].y < out[1].y);
  near(out[0].y - items[0].oh * out[0].scale / 2, 0);
  near(out[1].y + items[1].oh * out[1].scale / 2, 1000);
});

test('layoutRow handles one item and none', () => {
  assert.deepEqual(layoutRow([], { x: 0, y: 0, w: 10, h: 10 }), []);
  const one = layoutRow([full('a', 200, 100)], { x: 0, y: 0, w: 1000, h: 100 });
  near(one[0].x, 500); near(one[0].y, 50); near(one[0].scale, 1);
});

test('cornersRect unions corner lists', () => {
  const r = cornersRect([
    [{ x: 10, y: 10 }, { x: 20, y: 30 }],
    [{ x: -5, y: 15 }, { x: 8, y: 40 }],
  ]);
  assert.deepEqual(r, { x: -5, y: 10, w: 25, h: 30 });
  assert.equal(cornersRect([]), null);
});
