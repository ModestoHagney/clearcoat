// Mirroring a layer to the other side of the car, with no page elements in
// here: onto the twin panel its panel is paired with, or across its panel's
// centreline.
//
// (It began as the original screen's mirrorLayerCopy, with free shapes added,
// which mirror point by point.)

import { isRegionLayer, clipPolys, newId } from './engine.js';
import { contains } from './shapes.js';
import { MIRROR_KINDS, regionAt, regionById, centerLine, mirrorAcross, mirrorPointKind, guessMirrorKind, trimShape, regionOutline, growOutline, seamMatrix } from './regions.js';

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

// ---------- continue across an edge ----------
// A layer switched to Continues has its panel's linked edges (Map › Link)
// carry it on: what hangs over such an edge is painted on the panel that edge
// meets, however far away that panel is on the sheet and however it is
// turned. Like Mirrored, it is worked out when painting, so both parts follow
// every edit.

// → { home, homes, links: [{ link, side, from }] } (the layer's panel, every
// panel it is on, and their linked edges) or { error }. Its panel is the one
// it was on when switched on (`continues` holds its id), so it can be slid
// mostly over the edge and still belong there; before that, the one under its
// middle. A layer with copies (Repeat) that is trimmed to several panels is on
// each of them, and carries on from the edges of every one.
export function seamsOf(map, layer) {
  if (!map) return { error: 'Load a template first.' };
  const cx = isRegionLayer(layer) ? layer.rx + layer.rw / 2 : layer.x;
  const cy = isRegionLayer(layer) ? layer.ry + layer.rh / 2 : layer.y;
  const home = (typeof layer.continues === 'string' && regionById(map, layer.continues)) || homeOf(map, layer, cx, cy);
  if (!home) return { error: `${layer.name} is not on a panel.` };
  const ats = layer.repeat && clipPolys(layer).length > 1 ? [].concat(layer.clipAt || []) : [];
  const homes = [...new Set([home, ...ats.map(q => pieceAt(map, q.x, q.y)).filter(Boolean)])];
  const links = [];
  for (const from of homes) for (const link of map.links || []) for (const side of ['a', 'b']) if (link[side].region === from.id) links.push({ link, side, from });
  if (!links.length) return { error: `${homes.map(r => r.name).join(', ')} ${homes.length > 1 ? 'have' : 'has'} no linked edges yet. Link them in Map.` };
  return { home, homes, links };
}

// The doc as it is painted: a Continues layer is trimmed to its own panel and
// followed by one carried copy for each linked edge of that panel, each
// trimmed to the panel across that edge. (A copy that nothing reaches is
// simply trimmed away.) On several panels, each carried copy takes only the
// copies standing on the panel whose edge it crosses (carry.from), so one
// panel's copies are not carried over another panel's edge.
// ponytail: the copy's shadow offset is carried too, so it points another
// way on a turned panel; work it out separately if that shows.
export function withSeams(doc) {
  if (!doc.regionMap || !doc.layers.some(l => l.continues)) return doc;
  const map = doc.regionMap, layers = [];
  const trimTo = (r) => [growOutline(regionOutline(r), 3)];
  for (const l of doc.layers) {
    const s = l.continues && seamsOf(map, l);
    if (!s || s.error) { layers.push(l); continue; }
    const own = clipPolys(l).length ? l : { ...l, clip: trimTo(s.home), clipAt: null };
    layers.push(own);
    s.links.forEach(({ link, side, from }, i) => {
      const m = seamMatrix(map, link, side), to = regionById(map, link[side === 'a' ? 'b' : 'a'].region);
      const only = s.homes.length > 1 ? trimTo(from)[0] : null;
      if (m) layers.push({ ...own, id: `${l.id}~s${i}`, continues: false, carry: { ...m, clip: trimTo(to), from: only } });
    });
  }
  return { ...doc, layers };
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
    continues: sel.continues ? dst.id : undefined, // it carries on from the twin panel's edges
    locked: false,
    groupId: null,
    matParams: sel.matParams ? { ...sel.matParams } : null,
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
  };
  // Words and logos have to read the right way round on both sides of the
  // car, so by default they are carried across but not reversed: the flip a
  // mirror gives them is taken back out, about their own upright. (On a twin
  // that lies upside-down on the sheet that leaves them turned to match it.)
  if ((sel.type === 'image' || sel.type === 'text') && !sel.mirrorFlip) copy.flipH = !copy.flipH;
  // a fade's two points go across with the shape
  if (sel.fadeFrom && sel.fadeTo) { copy.fadeFrom = pt(sel.fadeFrom); copy.fadeTo = pt(sel.fadeTo); }
  if (isPath(sel)) {
    // a free shape is its points: carry each across and it is the mirror
    // image, with nothing left to flip
    copy.pts = sel.pts.map((q) => { const o = pt(q); if (q.c) o.c = pt(q.c); if (q.m) o.m = true; return o; });
    // the bend handle belongs to the line *leaving* a point; a reflection
    // keeps that pairing, so the list order can stay as it is
    copy.flipH = !!sel.flipH; copy.flipV = !!sel.flipV; copy.rotation = sel.rotation || 0;
    copy.turn = mid ? 2 * mid.angle - (sel.turn || 0) : reflect ? -(sel.turn || 0) : sel.turn || 0; // its frame, mirrored too
    const xs = copy.pts.flatMap(q => (q.c ? [q.x, q.c.x] : [q.x])), ys = copy.pts.flatMap(q => (q.c ? [q.y, q.c.y] : [q.y]));
    copy.rx = Math.min(...xs); copy.ry = Math.min(...ys);
    copy.rw = Math.max(1, Math.max(...xs) - copy.rx); copy.rh = Math.max(1, Math.max(...ys) - copy.ry);
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
    if (mid) {
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
