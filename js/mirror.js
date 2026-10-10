// Mirroring a layer to the other side of the car, with no page elements in
// here: onto the twin panel its panel is paired with, or across its panel's
// centreline.
//
// ponytail: copied out of main.js's mirrorLayerCopy (which stays as it is for
// the original screen), plus free shapes, which mirror point by point.

import { isRegionLayer, clipPolys, newId } from './engine.js';
import { frameFrom, framed, contains } from './shapes.js';
import { MIRROR_KINDS, regionAt, regionById, centerLine, mirrorAcross, mirrorPointKind, guessMirrorKind, trimShape } from './regions.js';

// the piece (not one of the kit's number / sponsor zones) at a point
export const pieceAt = (map, x, y) => (map ? regionAt({ regions: map.regions.filter(r => !r.kind) }, x, y) : null);

const isPath = (l) => l.type === 'fill' && l.shape === 'path' && Array.isArray(l.pts) && l.pts.length >= 3;

// The panel a layer is on: the one under its middle. A free shape whose
// middle is not on the shape itself (a C-shaped panel that has been filled,
// say: the middle of its box is a wheel arch, or another panel) is asked
// where most of it lies instead.
const homes = new WeakMap(); // such a shape's points → its panel's id (the points are replaced when it is edited)
function homeOf(map, sel, cx, cy) {
  if (!isPath(sel) || contains(sel.pts, cx, cy)) return pieceAt(map, cx, cy) || regionAt(map, cx, cy);
  const known = homes.has(sel.pts) && regionById(map, homes.get(sel.pts));
  if (known) return known;
  const votes = new Map(), N = 8;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = sel.rx + (i + 0.5) / N * sel.rw, y = sel.ry + (j + 0.5) / N * sel.rh;
      const r = contains(sel.pts, x, y) ? pieceAt(map, x, y) : null;
      if (r) votes.set(r, (votes.get(r) || 0) + 1);
    }
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (!best) return pieceAt(map, cx, cy) || regionAt(map, cx, cy);
  homes.set(sel.pts, best[0].id);
  return best[0];
}

// The doc as it is painted: every layer switched to Mirrored is followed by
// its mirror image. The images are made here, each time, from the layer as it
// is now, so editing a mirrored layer moves both sides. A layer whose panel
// has lost its twin or centreline simply paints one side.
export function withMirrors(doc) {
  if (!doc.regionMap || !doc.layers.some(l => l.mirrored)) return doc;
  const layers = [];
  for (const l of doc.layers) {
    layers.push(l);
    const copy = l.mirrored ? mirrorImage(doc.regionMap, l) : null;
    if (copy) layers.push(copy);
  }
  return { ...doc, layers };
}
// one Mirrored layer's other side, or null
export function mirrorImage(map, layer) {
  const { copy } = mirrorLayer(map, layer);
  if (!copy) return null;
  copy.id = layer.id + '~m'; // steady from one paint to the next
  copy.mirrored = false;
  return copy;
}

// → { copy, dst } (the new layer, and the region it landed on) or { error }
export function mirrorLayer(map, sel) {
  if (!map) return { error: 'Load a template first.' };
  // a trimmed layer belongs to the panel it is trimmed to, wherever its own
  // centre is
  const wins = clipPolys(sel), ats = wins.length ? [].concat(sel.clipAt || []) : [];
  const at = ats[0]; // a layer trimmed to several panels is mirrored by the first
  const cx = at ? at.x : isRegionLayer(sel) ? sel.rx + sel.rw / 2 : sel.x;
  const cy = at ? at.y : isRegionLayer(sel) ? sel.ry + sel.rh / 2 : sel.y;
  const src = at ? pieceAt(map, cx, cy) || regionAt(map, cx, cy) : homeOf(map, sel, cx, cy);
  if (!src) return { error: `${sel.name} is not on a panel.` };
  // a paired panel mirrors onto its twin; one with a centreline (bonnet,
  // roof, bumpers) mirrors onto itself across that line
  const mid = src.mirror ? null : centerLine(src);
  if (!src.mirror && !mid) return { error: `${src.name} has no twin or centreline yet. Set one in Map.` };
  const dst = mid ? src : regionById(map, src.mirror);
  if (!dst) return { error: `${src.name}'s twin is missing from the map.` };
  // how the twin lies on the sheet: a left/right or top/bottom reflection
  // (flip / flipV), the same panel turned 180° (rot180), or a plain copy
  const kind = mid ? null : MIRROR_KINDS.includes(src.mirrorKind) ? src.mirrorKind : guessMirrorKind(src, dst);
  const reflect = !!mid || kind === 'flip' || kind === 'flipV';
  // where a point of the layer lands on the copy's side
  const carry = mid ? (x, y) => mirrorAcross(src, x, y) : (x, y) => mirrorPointKind(src, dst, x, y, kind);
  const pt = (q) => { const r = carry(q.x, q.y); return { x: r.x, y: r.y }; };
  const copy = {
    ...sel,
    id: newId(),
    name: /\(mirrored\)$/.test(sel.name) ? sel.name : sel.name + ' (mirrored)',
    locked: false,
    groupId: null,
    matParams: sel.matParams ? { ...sel.matParams } : null,
    lumSpec: sel.lumSpec ? { ...sel.lumSpec } : null,
    corners: Array.isArray(sel.corners) ? sel.corners.map(q => ({ x: q.x, y: q.y })) : null,
    lassoPts: Array.isArray(sel.lassoPts) ? sel.lassoPts.map(q => ({ x: q.x, y: q.y })) : null,
    cornerPan: sel.cornerPan ? { ...sel.cornerPan } : null,
    fx: sel.fx ? { ...sel.fx } : null,
    // a trimmed layer's copy is trimmed to the matching place: the other half
    // across a centreline, or the whole twin panel
    // ponytail: with several windows every one is carried by the first
    // panel's mirror, which only suits panels that mirror the same way.
    clip: !wins.length ? null : !mid && wins.length === 1 ? [trimShape(dst, 0, 0)] : wins.map(w => w.map(pt)),
    clipAt: wins.length ? ats.map(pt) : null,
    flipH: mid || kind === 'flip' ? !sel.flipH : !!sel.flipH,
    flipV: kind === 'flipV' ? !sel.flipV : !!sel.flipV,
    // a true mirror image reflects the whole transform, not just the picture
    rotation: mid ? ((-(sel.rotation || 0) + 2 * mid.angle) % 360 + 360) % 360 - 180
      : reflect ? -(sel.rotation || 0) : kind === 'rot180' ? ((sel.rotation || 0) + 180) % 360 : (sel.rotation || 0),
    skewX: reflect ? -(sel.skewX || 0) : (sel.skewX || 0),
    skewY: reflect ? -(sel.skewY || 0) : (sel.skewY || 0),
  };
  // Words and logos have to read the right way round on both sides of the
  // car, so by default they are carried across but not reversed: the flip a
  // mirror gives them is taken back out, about their own upright. (On a twin
  // that lies upside-down on the sheet that leaves them turned to match it.)
  if ((sel.type === 'image' || sel.type === 'text') && !sel.mirrorFlip && !copy.corners) copy.flipH = !copy.flipH;
  // a pattern is drawn through the mirror, so the other side is its mirror image
  if (sel.motif) { const f = frameFrom((x, y) => carry(x, y)); copy.motifFrame = sel.motifFrame ? framed(f, sel.motifFrame) : f; }
  // a fade's two points go across with the shape
  if (sel.fadeFrom && sel.fadeTo) { copy.fadeFrom = pt(sel.fadeFrom); copy.fadeTo = pt(sel.fadeTo); }
  if (isPath(sel)) {
    // a free shape is its points: carry each across and it is the mirror
    // image, with nothing left to flip
    copy.pts = sel.pts.map((q) => { const o = pt(q); if (q.c) o.c = pt(q.c); if (q.m) o.m = true; return o; });
    // the bend handle belongs to the line *leaving* a point; a reflection
    // keeps that pairing, so the list order can stay as it is
    copy.flipH = !!sel.flipH; copy.flipV = !!sel.flipV; copy.rotation = sel.rotation || 0;
    const xs = copy.pts.flatMap(q => (q.c ? [q.x, q.c.x] : [q.x])), ys = copy.pts.flatMap(q => (q.c ? [q.y, q.c.y] : [q.y]));
    copy.rx = Math.min(...xs); copy.ry = Math.min(...ys);
    copy.rw = Math.max(1, Math.max(...xs) - copy.rx); copy.rh = Math.max(1, Math.max(...ys) - copy.ry);
  } else if (copy.corners) {
    // a pinned layer lives entirely in its corners; re-ordering afterwards
    // keeps the quad from coming out inside-out
    const m = copy.corners.map(pt);
    copy.corners = mid || kind === 'flip' ? [m[1], m[0], m[3], m[2]]
      : kind === 'flipV' ? [m[3], m[2], m[1], m[0]]
      : kind === 'rot180' ? [m[2], m[3], m[0], m[1]]
      : m;
    if (Array.isArray(copy.lassoPts)) copy.lassoPts = copy.lassoPts.map(pt);
  } else if (isRegionLayer(sel)) {
    // carry the box's corners across and take the box around them
    const cs = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => carry(sel.rx + u * sel.rw, sel.ry + v * sel.rh));
    const xs = cs.map(q => q.x), ys = cs.map(q => q.y);
    copy.rx = Math.round(Math.min(...xs));
    copy.ry = Math.round(Math.min(...ys));
    copy.rw = Math.max(1, Math.round(Math.max(...xs) - Math.min(...xs)));
    copy.rh = Math.max(1, Math.round(Math.max(...ys) - Math.min(...ys)));
    if (sel.fadeFrom && sel.fadeTo && sel.rw && sel.rh) {
      // a box is mirrored by flipping it within its rect, fade and all, so its
      // fade points keep their place in the rect and the flip carries them
      const rel = (q) => ({ x: copy.rx + (q.x - sel.rx) / sel.rw * copy.rw, y: copy.ry + (q.y - sel.ry) / sel.rh * copy.rh });
      copy.fadeFrom = rel(sel.fadeFrom); copy.fadeTo = rel(sel.fadeTo);
    }
    if (sel.type === 'pattern') {
      const o = carry(sel.x || 0, sel.y || 0); // the point it tiles from moves too
      copy.x = o.x;
      copy.y = o.y;
    } else if (mid) {
      // ponytail: a box cannot turn, so the nearer of an upright or a level
      // flip stands in for the centreline — exact when the line is one of
      // those, approximate when tilted.
      const level = Math.abs(mid.dir.x) > Math.abs(mid.dir.y);
      copy.flipH = level ? !!sel.flipH : !sel.flipH;
      copy.flipV = level ? !sel.flipV : !!sel.flipV;
      copy.rotation = -(sel.rotation || 0);
    }
  } else {
    const placed = carry(sel.x, sel.y);
    copy.x = Math.round(placed.x);
    copy.y = Math.round(placed.y);
  }
  return { copy, dst };
}
