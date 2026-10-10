// Clearcoat, new screen: what the pointer does on the sheet.
//
// Pen tool: click points to draw a closed outline; it becomes a fill layer
// with shape 'path' (see ../js/shapes.js and the engine's fillShapePath).
// Select tool: click a layer to select it and drag to move it; a selected
// shape shows its points, which drag, and a dot on every line, which bends
// it. Clicking a line adds a point, right-clicking a point removes it.
// Shape tool: drag out a circle, box or triangle (the engine's own fill
// shapes; a selected one resizes by its corners). Band tool: a start and an
// end make a straight stripe of a set width, as an ordinary editable shape.
// Fill a panel: click a panel and it becomes a shape with that panel's
// outline. Trimming (a state of the Select tool): click panels to choose the
// windows the selected layer shows through.
// In Finish mode the same tools draw *areas*: shapes that paint nothing and
// only carry a finish. There, only areas can be moved or reshaped; a click on
// anything else just picks it as what the finish applies to.
// Text tool: click the sheet and a line of text is put there. A selected text
// or picture has a handle on each corner to resize it and one above to turn it.

import { SIZE, createFillLayer, isRegionLayer, toLocal, layerCorners } from '../js/engine.js';
import { bounds, contains, moved, segmentAt, midOf, bendTo, insertAt, removeAt, snapAngle, nextIndex, SHAPES, aspect, boxOutline, placed, joined } from '../js/shapes.js';
import { regionOutline, snapToOutline, trimShape, growOutline, pointInPolygon } from '../js/regions.js';
import { clipPolys } from '../js/engine.js';
import { pieceAt } from '../js/mirror.js';

const GRAB = 9;        // px: how close counts as "on" a point or dot
const EDGE = 6;        // px: how close counts as "on" a line
const SLOP = 3;        // px: a press that moves less than this is a click
const BIG = 0.6;       // a layer covering more of the sheet than this is not grabbed by a click on the sheet

export const isShape = (l) => !!l && l.type === 'fill' && l.shape === 'path' && Array.isArray(l.pts) && l.pts.length >= 3;
// text or a picture: placed by a centre, a size and a turn (not pinned by corners)
export const isPic = (l) => !!l && !!l.img && (l.type === 'image' || l.type === 'text') && !l.corners;
// a ready-made fill (circle, box, triangle…): sized by its box, not by points
export const isBox = (l) => !!l && l.type === 'fill' && !isShape(l);
export const READY = SHAPES;
// the three the engine draws from a box; the rest are made as outlines, so they can turn and be reshaped
const BOXED = new Set(['ellipse', 'rect', 'triangle']);

// Where a fill's fade runs: from the first point to the second (across), or
// out from the first as far as the second (from the middle). `style`, when
// given, asks for fresh points laid across the fill's box in that style.
export function fadeEnds(l, style) {
  if (!style && l.fadeFrom && l.fadeTo) return { a: l.fadeFrom, b: l.fadeTo };
  const cy = l.ry + l.rh / 2, right = { x: l.rx + l.rw, y: cy };
  return (style || l.fillType) === 'radial' ? { a: { x: l.rx + l.rw / 2, y: cy }, b: right } : { a: { x: l.rx, y: cy }, b: right };
}
export const hasFade = (l) => !!l && l.type === 'fill' && (l.fillType === 'linear' || l.fillType === 'radial');

// keep a shape's box in step with its outline (gradients and the engine's
// own hit-testing work from the box)
export function setShape(layer, pts) {
  const b = bounds(pts);
  layer.pts = pts;
  layer.rx = b.x; layer.ry = b.y; layer.rw = b.w; layer.rh = b.h;
}

export function moveLayer(l, dx, dy) {
  if (isShape(l)) l.pts = moved(l.pts, dx, dy);
  if (l.fadeFrom && l.fadeTo) { // a fade's two points belong to the shape
    l.fadeFrom = { x: l.fadeFrom.x + dx, y: l.fadeFrom.y + dy };
    l.fadeTo = { x: l.fadeTo.x + dx, y: l.fadeTo.y + dy };
  }
  if (isRegionLayer(l)) { l.rx += dx; l.ry += dy; } else { l.x += dx; l.y += dy; }
}

export function initTools(app, env) {
  const { screenToDoc, docToScreen, change, requestDraw } = env;
  let draft = null;    // the outline being drawn: doc points
  let cursor = null;   // where the next point would go
  let drag = null;

  const selLayer = () => app.doc.layers.find(l => l.id === app.sel) || null;
  // in Finish mode the paint is not to be disturbed: only areas can be changed
  // …and with several layers selected there are no handles: they move as one
  const editable = (l) => !!l && !l.locked && l.visible && (app.mode !== 'finish' || !!l.specOnly) && env.selectedLayers().length < 2;
  const selShape = () => { const l = selLayer(); return isShape(l) && editable(l) ? l : null; };
  const selBox = () => { const l = selLayer(); return isBox(l) && editable(l) ? l : null; };
  const selPic = () => { const l = selLayer(); return isPic(l) && editable(l) ? l : null; };
  const selFade = () => { const l = selLayer(); return hasFade(l) && editable(l) && app.mode === 'paint' ? l : null; };
  // where the turn handle sits: out from the middle of the top edge
  function turnHandle(l) {
    const c = layerCorners(l).map(onScreen), top = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 }, mid = onScreen(l);
    const dx = top.x - mid.x, dy = top.y - mid.y, len = Math.hypot(dx, dy) || 1;
    return { x: top.x + dx / len * 26, y: top.y + dy / len * 26, top };
  }
  const corners = (l) => [[l.rx, l.ry], [l.rx + l.rw, l.ry], [l.rx + l.rw, l.ry + l.rh], [l.rx, l.ry + l.rh]].map(([x, y]) => ({ x, y }));
  let rubber = null;   // ready-made shape being dragged out: { a, b } doc points
  let band = null;     // band being placed: { a, b, pressed }
  let hover = null;    // the panel under the pointer, while a panel is being picked

  // Fill a panel: the panel's outline as a shape, a hair over the edge so no
  // bare line shows where the sim blends across panel edges
  function fillPanel(p) {
    const r = pieceAt(app.doc.regionMap, p.x, p.y);
    if (!r) { env.say(app.doc.regionMap ? 'Click inside a panel' : 'Load a template first'); return; }
    const layer = createFillLayer(app.colour);
    layer.shape = 'path';
    layer.name = r.name;
    setShape(layer, growOutline(regionOutline(r), 2).map(q => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 })));
    env.created(layer);
    app.doc.layers.push(layer);
    app.sel = layer.id; // the tool stays armed: click the next panel
    change({ now: true });
  }
  // Trim: each click adds the panel under it as a window, or takes it out again
  function trimAt(p) {
    const l = selLayer();
    if (!l) { env.endTrim(); return; }
    const polys = clipPolys(l).slice(), ats = [].concat(l.clipAt || []);
    const had = polys.findIndex(poly => pointInPolygon(poly, p.x, p.y));
    if (had !== -1) { polys.splice(had, 1); ats.splice(had, 1); }
    else {
      const r = pieceAt(app.doc.regionMap, p.x, p.y);
      if (!r) { env.say('Click inside a panel'); return; }
      polys.push(trimShape(r, p.x, p.y));
      ats.push({ x: Math.round(p.x), y: Math.round(p.y) }); // the spot picked: says which panel (and half) this is
    }
    l.clip = polys.length ? polys : null;
    l.clipAt = polys.length ? ats : null;
    change({ now: true });
  }

  // a band's ends stick to the nearest piece edge or corner when close (Alt: free)
  function snapToPieces(p, e) {
    const map = app.doc.regionMap;
    if (e.altKey || !map) return p;
    let best = null;
    for (const r of map.regions) {
      if (!r.points || r.kind) continue;
      const hit = snapToOutline(regionOutline(r), p.x, p.y, GRAB / app.view.zoom);
      if (hit.d * app.view.zoom <= GRAB && (!best || hit.d < best.d)) best = hit;
    }
    return best ? { x: best.x, y: best.y } : p;
  }
  const bandEnd = (p, e) => (e.shiftKey && band ? snapAngle(band.a, p) : snapToPieces(p, e));
  function addLayer(layer) {
    env.created(layer);
    app.doc.layers.push(layer);
    app.tool = 'select';
    app.sel = layer.id;
    rubber = band = null;
    env.toolChanged();
    change({ now: true });
  }
  function evenBox(a, b, even) { // the dragged box; `even` makes it square
    let w = b.x - a.x, h = b.y - a.y;
    if (even) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    return { x: Math.min(a.x, a.x + w), y: Math.min(a.y, a.y + h), w: Math.abs(w), h: Math.abs(h) };
  }
  function finishReady(even) {
    let box = evenBox(rubber.a, rubber.b, even);
    const kind = app.shapeKind, name = READY[kind];
    if (box.w < 4 || box.h < 4) { const h = 300 * aspect(kind); box = { x: rubber.a.x - 150, y: rubber.a.y - h / 2, w: 300, h }; } // a plain click
    const layer = createFillLayer(app.colour);
    layer.name = name + ' ' + (app.doc.layers.filter(l => new RegExp('^' + name + ' \\d+$').test(l.name)).length + 1);
    if (BOXED.has(kind)) {
      layer.shape = kind;
      layer.rx = box.x; layer.ry = box.y; layer.rw = box.w; layer.rh = box.h;
    } else {
      layer.shape = 'path';
      setShape(layer, boxOutline(kind, box.x, box.y, box.w, box.h));
    }
    addLayer(layer);
  }
  const bandPts = (a, b, width) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len * width / 2, ny = (b.x - a.x) / len * width / 2;
    return [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }];
  };
  function finishBand() {
    if (Math.hypot(band.b.x - band.a.x, band.b.y - band.a.y) < 4) { band = null; requestDraw(); return; }
    const layer = createFillLayer(app.colour);
    layer.shape = 'path';
    layer.name = 'Band ' + (app.doc.layers.filter(l => /^Band \d+/.test(l.name)).length + 1);
    setShape(layer, bandPts(band.a, band.b, app.bandWidth));
    addLayer(layer);
  }
  // Stamp: each click places one copy. Every copy of one go (the tool left
  // armed, the colour unchanged) is a piece of the same shape, so a scatter of
  // stamps is one row in the Layers list; Split makes them shapes of their own.
  let stampRun = null;
  function stampAt(p) {
    const pts = placed(env.motif(app.stamp.key), p.x, p.y, app.stamp.size);
    let layer = app.doc.layers.find(l => l.id === stampRun && isShape(l) && !l.locked && l.color === app.colour);
    if (layer) {
      setShape(layer, joined([layer.pts, pts]));
    } else {
      layer = createFillLayer(app.colour);
      layer.shape = 'path';
      layer.name = 'Stamps ' + (app.doc.layers.filter(l => /^Stamps \d+$/.test(l.name)).length + 1);
      setShape(layer, pts);
      app.doc.layers.push(layer);
      stampRun = layer.id;
    }
    app.sel = layer.id;
    change({ now: true });
  }
  const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const onScreen = (p) => docToScreen(p.x, p.y);

  // the top layer under a doc point
  function layerAt(p) {
    for (let i = app.doc.layers.length - 1; i >= 0; i--) {
      const l = app.doc.layers[i];
      if (!l.visible || l.locked) continue;
      if (l.specOnly && app.mode !== 'finish') continue; // an area belongs to Finish mode
      if (isShape(l)) { if (contains(l.pts, p.x, p.y)) return l; continue; }
      if (isRegionLayer(l)) {
        // ponytail: a sheet-sized layer would swallow every click, so it is
        // only picked from the Layers panel; give it a real hit shape later
        if (l.rw * l.rh > BIG * SIZE * SIZE && l.id !== app.sel) continue;
        if (p.x >= l.rx && p.x <= l.rx + l.rw && p.y >= l.ry && p.y <= l.ry + l.rh) return l;
        continue;
      }
      if (!l.img) continue;
      const q = toLocal(l, p.x, p.y), hw = l.img.width / 2, hh = l.img.height / 2;
      if (Math.abs(q.x) <= hw && Math.abs(q.y) <= hh) {
        if (4 * hw * hh * (l.scale || 1) * (l.scaleY ?? l.scale ?? 1) > BIG * SIZE * SIZE && l.id !== app.sel) continue;
        return l;
      }
    }
    return null;
  }

  // does a doc point fall on this layer's own picture?
  function onLayer(l, p) {
    if (isShape(l)) return contains(l.pts, p.x, p.y);
    if (isRegionLayer(l)) return p.x >= l.rx && p.x <= l.rx + l.rw && p.y >= l.ry && p.y <= l.ry + l.rh;
    if (!l.img) return false;
    const q = toLocal(l, p.x, p.y);
    return Math.abs(q.x) <= l.img.width / 2 && Math.abs(q.y) <= l.img.height / 2;
  }
  function mirrorOwnerAt(p) {
    for (let i = app.doc.layers.length - 1; i >= 0; i--) {
      const l = app.doc.layers[i];
      if (!l.mirrored || !l.visible || l.locked) continue;
      const img = env.mirrorImage(l);
      if (img && onLayer(img, p)) return l;
    }
    return null;
  }

  // a layer's bounding box on the sheet
  function boxOf(l) {
    try {
      const cs = layerCorners(l), xs = cs.map(q => q.x), ys = cs.map(q => q.y);
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    } catch { return null; }
  }

  const closable = (s) => draft && draft.length >= 3 && far(onScreen(draft[0]), s) <= GRAB + 2;
  const nextPoint = (p, shift) => (shift && draft && draft.length ? snapAngle(draft[draft.length - 1], p) : p);

  function finish() {
    if (!draft || draft.length < 3) return false;
    const layer = createFillLayer(app.colour);
    const n = app.doc.layers.filter(l => isShape(l) && !l.specOnly).length + 1;
    layer.name = 'Shape ' + n;
    layer.shape = 'path';
    setShape(layer, draft);
    env.created(layer);
    app.doc.layers.push(layer);
    draft = null; cursor = null;
    app.tool = 'select';
    app.sel = layer.id;
    env.toolChanged();
    change({ now: true });
    return true;
  }

  function down(e, s) {
    const p = screenToDoc(s.x, s.y);
    if (app.picking) { env.picked(p); return; }
    if (app.trimming) { trimAt(p); return; }
    if (app.tool === 'piece') { fillPanel(p); return; }
    if (app.tool === 'text') { env.addText(p); return; }
    if (app.tool === 'shape') { rubber = { a: p, b: p }; return; }
    if (app.tool === 'stamp') { stampAt(p); return; }
    if (app.tool === 'band') {
      if (band && !band.pressed) { band.b = bandEnd(p, e); finishBand(); return; } // the second click
      const a = snapToPieces(p, e);
      band = { a, b: a, pressed: true, start: s };
      requestDraw();
      return;
    }
    if (app.tool === 'pen') {
      if (closable(s) || (e.detail >= 2 && draft && draft.length >= 3)) { finish(); return; }
      (draft || (draft = [])).push(nextPoint(p, e.shiftKey));
      requestDraw();
      env.refreshChrome();
      return;
    }
    if (app.tool !== 'select') return;
    const faded = selFade();
    if (faded) { // the fade's two dots sit on top of everything else the shape has
      const ends = fadeEnds(faded);
      for (const end of ['b', 'a']) if (far(onScreen(ends[end]), s) <= GRAB) { drag = { kind: 'fade', layer: faded, end }; return; }
    }
    const shape = selShape();
    if (shape) {
      const pts = shape.pts;
      const vi = pts.findIndex(q => far(onScreen(q), s) <= GRAB);
      if (vi !== -1) { drag = { kind: 'point', layer: shape, i: vi }; return; }
      const mi = pts.findIndex((q, i) => far(onScreen(midOf(pts, i)), s) <= GRAB - 1);
      if (mi !== -1) { drag = { kind: 'bend', layer: shape, i: mi, start: s, went: false }; return; }
      const seg = segmentAt(pts, p.x, p.y, EDGE / app.view.zoom);
      if (seg) { drag = { kind: 'edge', layer: shape, seg, start: s, last: p, went: false }; return; }
    }
    const pic = selPic();
    if (pic) {
      const ang = Math.atan2(p.y - pic.y, p.x - pic.x);
      if (far(turnHandle(pic), s) <= GRAB) { drag = { kind: 'turn', layer: pic, a0: ang, r0: pic.rotation || 0 }; return; }
      if (layerCorners(pic).some(q => far(onScreen(q), s) <= GRAB)) {
        drag = { kind: 'scale', layer: pic, d0: Math.hypot(p.x - pic.x, p.y - pic.y) || 1, s0: pic.scale, sy0: pic.scaleY ?? null };
        return;
      }
    }
    const box = selBox();
    if (box) {
      const ci = corners(box).findIndex(q => far(onScreen(q), s) <= GRAB);
      if (ci !== -1) { drag = { kind: 'size', layer: box, anchor: corners(box)[(ci + 2) % 4] }; return; }
    }
    const hit = layerAt(p);
    if (app.mode === 'finish') {
      env.finishPick(hit, p);               // what the finish will apply to
      if (!hit || !hit.specOnly) return;    // and only an area can be dragged here
    }
    const adding = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!hit) {
      // a click on the mirrored side of a layer selects the layer it belongs to
      const owner = mirrorOwnerAt(p);
      if (owner) { if (owner.id !== app.sel) env.select(owner.id, adding); return; }
      // empty sheet: a drag draws a box round the layers to select; a plain click selects nothing
      drag = { kind: 'marquee', a: p, b: p, start: s, went: false };
      return;
    }
    if (adding) { env.select(hit.id, true); return; } // joins the selection, or leaves it
    if (env.selectedLayers().some(l => l.id === hit.id)) { // one of several: they all move
      drag = { kind: 'move', layer: hit, start: s, last: p, went: false };
      return;
    }
    if (hit.id !== app.sel) env.select(hit.id);
    drag = { kind: 'move', layer: hit, start: s, last: p, went: false };
  }

  function move(e, s) {
    const p = screenToDoc(s.x, s.y);
    if (app.tool === 'pen') { cursor = nextPoint(p, e.shiftKey); requestDraw(); return; }
    if (app.tool === 'stamp') { cursor = p; requestDraw(); return; }
    if (app.trimming || app.tool === 'piece') {
      const r = pieceAt(app.doc.regionMap, p.x, p.y);
      if (r !== hover) { hover = r; requestDraw(); }
      return;
    }
    if (rubber) { rubber.b = p; rubber.even = e.shiftKey; requestDraw(); return; }
    if (band) { band.b = bandEnd(p, e); requestDraw(); return; }
    if (!drag) return;
    const l = drag.layer;
    if (drag.kind === 'fade') {
      const ends = fadeEnds(l), other = drag.end === 'a' ? ends.b : ends.a;
      const q = e.shiftKey ? snapAngle(other, p) : p;
      l.fadeFrom = drag.end === 'a' ? { x: q.x, y: q.y } : { ...ends.a };
      l.fadeTo = drag.end === 'b' ? { x: q.x, y: q.y } : { ...ends.b };
      change({ panels: false });
      return;
    }
    if (drag.kind === 'turn') {
      let r = drag.r0 + (Math.atan2(p.y - l.y, p.x - l.x) - drag.a0) * 180 / Math.PI;
      if (e.shiftKey) r = Math.round(r / 15) * 15;
      l.rotation = ((r + 180) % 360 + 360) % 360 - 180;
      change({ panels: false });
      return;
    }
    if (drag.kind === 'scale') { // from the centre, proportions kept
      const k = Math.max(0.02, Math.hypot(p.x - l.x, p.y - l.y) / drag.d0);
      l.scale = Math.max(0.01, Math.min(40, drag.s0 * k));
      if (drag.sy0 !== null) l.scaleY = Math.max(0.01, Math.min(40, drag.sy0 * k));
      change({ panels: false });
      return;
    }
    if (drag.kind === 'size') {
      const b = evenBox(drag.anchor, p, e.shiftKey);
      l.rx = b.x; l.ry = b.y; l.rw = Math.max(4, b.w); l.rh = Math.max(4, b.h);
      change({ panels: false });
      return;
    }
    if (drag.kind === 'point') {
      const pts = l.pts.map(q => ({ ...q }));
      pts[drag.i] = { ...pts[drag.i], x: p.x, y: p.y };
      setShape(l, pts);
      change({ panels: false });
      return;
    }
    if (!drag.went && far(drag.start, s) < SLOP) return;
    if (drag.kind === 'marquee') { drag.went = true; drag.b = p; requestDraw(); return; }
    if (drag.kind === 'bend') {
      drag.went = true;
      setShape(l, bendTo(l.pts, drag.i, p, 4 / app.view.zoom));
      change({ panels: false });
      return;
    }
    // 'edge' that moves is a move, like a press anywhere else on the layer
    drag.went = true;
    const many = env.selectedLayers(), moving = many.some(m => m.id === l.id) ? many : [l];
    for (const m of moving) if (!m.locked) moveLayer(m, p.x - drag.last.x, p.y - drag.last.y);
    drag.last = p;
    change({ panels: false });
  }

  function up(e, s) {
    if (rubber) { finishReady(rubber.even); return; }
    if (band && band.pressed) {
      band.pressed = false;
      if (s && far(band.start, s) >= SLOP) finishBand(); // dragged out in one go; otherwise wait for the second click
      return;
    }
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.kind === 'marquee') {
      if (!d.went) { if (app.sel !== null) env.select(null); return; }
      const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y);
      env.selectMany(app.doc.layers.filter((l) => {
        if (!l.visible || l.locked || l.specOnly) return false;
        const b = boxOf(l);
        return b && b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0; // touches the box
      }).map(l => l.id));
      requestDraw();
      return;
    }
    if (!d.went && d.kind === 'bend') setShape(d.layer, insertAt(d.layer.pts, d.i, 0.5));       // a click on the dot: a point there
    else if (!d.went && d.kind === 'edge') setShape(d.layer, insertAt(d.layer.pts, d.seg.i, d.seg.t)); // a click on the line
    else if (d.kind === 'move' && !d.went) return;
    change({ now: true });
  }

  // right-click on a point of the selected shape removes it
  function context(s) {
    if (app.tool !== 'select') return false;
    const shape = selShape();
    const vi = shape ? shape.pts.findIndex(q => far(onScreen(q), s) <= GRAB) : -1;
    if (vi === -1) {
      // the menu that opens next should be about the layer under the pointer
      const hit = layerAt(screenToDoc(s.x, s.y));
      if (hit && hit.id !== app.sel) env.select(hit.id);
      return false;
    }
    if (shape.pts.length > 3) { setShape(shape, removeAt(shape.pts, vi)); change({ now: true }); }
    else env.say('A shape needs three points');
    return true;
  }

  // → true when the key was used
  function key(e) {
    if (app.tool === 'pen') {
      if (e.key === 'Enter') { if (!finish()) env.say('Click at least three points first'); return true; }
      if (e.key === 'Backspace') { if (draft && draft.length) { draft.pop(); requestDraw(); env.refreshChrome(); } return true; }
      if (e.key === 'Escape') {
        if (draft && draft.length) { draft = null; cursor = null; requestDraw(); env.refreshChrome(); }
        else env.setTool('select');
        return true;
      }
    }
    if (app.trimming && (e.key === 'Escape' || e.key === 'Enter')) { env.endTrim(); return true; }
    if (e.key === 'Escape' && (app.picking || ['shape', 'band', 'piece', 'text'].includes(app.tool))) {
      if (app.picking) env.picked(null);
      else if (band) { band = null; requestDraw(); }
      else env.setTool('select');
      return true;
    }
    return false;
  }

  function cancel() { draft = null; cursor = null; drag = null; rubber = null; band = null; hover = null; stampRun = null; }

  const hint = () => {
    if (app.picking) return 'Click a colour on the sheet · Esc cancels';
    if (app.trimming) return 'Click panels to show it in · click again to take one out · Enter when done';
    if (app.mode === 'finish') {
      if (app.tool === 'piece') return 'Click a panel to give the whole panel a finish';
      if (app.tool === 'pen') return draft && draft.length ? 'Enter to finish the area · Backspace undoes a point' : 'Click points round the area · Shift holds 45°';
      if (app.tool === 'shape') return 'Drag out the area';
      if (selLayer() && selLayer().specOnly) return 'Drag the area to move it · Delete removes it';
      return 'Click a colour or a layer on the sheet, or pick one from the list';
    }
    if (app.tool === 'piece') return 'Click a panel to fill it';
    if (app.tool === 'text') return 'Click where the text goes';
    if (app.tool === 'select' && env.selectedLayers().length > 1) return `${env.selectedLayers().length} layers · drag to move them · Ctrl+E merges · Ctrl+G groups`;
    if (app.tool === 'select' && selFade()) return 'Drag the two dots to aim the fade · Shift holds 45°';
    if (app.tool === 'select' && selPic()) return 'Drag a corner to resize · the round handle turns it · Shift turns in steps';
    if (app.tool === 'shape') return 'Drag to draw · Shift keeps it even';
    if (app.tool === 'stamp') return 'Click to place one · Split makes them separate';
    if (app.tool === 'band') return band ? 'Click the end · Shift holds 45°' : 'Click the start, then the end · snaps to panel edges';
    if (app.tool === 'select' && selBox()) return 'Drag a corner to resize · Shift keeps it even';
    if (app.tool === 'pen') return draft && draft.length ? 'Enter to finish · Backspace undoes a point · Shift holds 45°' : 'Click points to draw · Shift holds 45°';
    if (selShape()) return 'Drag a point · drag a dot to bend · click a line to add a point';
    return 'Space-drag to pan · wheel to zoom';
  };

  // screen space: lines and handles stay the same size at any zoom
  function drawOverlay(ctx, accent) {
    const path = (pts, close) => {
      ctx.beginPath();
      pts.forEach((a, i) => { // a point marked `m` starts a separate piece
        const A = onScreen(a);
        if (!i || a.m) ctx.moveTo(A.x, A.y);
        const last = i === pts.length - 1 || !!pts[i + 1].m;
        if (last && !close) return;
        const B = onScreen(pts[last ? nextIndex(pts, i) : i + 1]);
        if (a.c) { const C = onScreen(a.c); ctx.quadraticCurveTo(C.x, C.y, B.x, B.y); } else ctx.lineTo(B.x, B.y);
        if (last) ctx.closePath();
      });
    };
    const square = (q, r, fill) => {
      ctx.fillStyle = fill; ctx.strokeStyle = fill === '#ffffff' ? accent : '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(q.x - r, q.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
    };
    ctx.lineJoin = 'round';
    if (app.tool === 'pen' && draft && draft.length) {
      const pts = cursor ? [...draft, cursor] : draft;
      path(pts, false);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      draft.forEach((q, i) => square(onScreen(q), i === 0 && draft.length >= 3 ? 6 : 4, i === 0 ? '#ffffff' : accent));
      return;
    }
    const preview = (pts) => { // a shape that is not made yet
      path(pts, true);
      ctx.fillStyle = app.colour; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    };
    const outline = (pts) => { ctx.beginPath(); pts.forEach((q, i) => { const a = onScreen(q); i ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y); }); ctx.closePath(); };
    if (app.mode === 'finish') {
      // an area paints nothing, so it is drawn here: tinted, dashed. Whatever
      // the finish is about to apply to gets a solid outline.
      const edge = (l) => {
        if (isShape(l)) path(l.pts, true);
        else if (isRegionLayer(l)) {
          const A = onScreen({ x: l.rx, y: l.ry }), B = onScreen({ x: l.rx + l.rw, y: l.ry + l.rh });
          ctx.beginPath();
          if (l.shape === 'ellipse') ctx.ellipse((A.x + B.x) / 2, (A.y + B.y) / 2, (B.x - A.x) / 2, (B.y - A.y) / 2, 0, 0, Math.PI * 2);
          else if (l.shape === 'triangle') { ctx.moveTo((A.x + B.x) / 2, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(A.x, B.y); ctx.closePath(); }
          else ctx.rect(A.x, A.y, B.x - A.x, B.y - A.y);
        } else if (l.img) outline(layerCorners(l));
        else ctx.beginPath();
      };
      const isTarget = env.finishTargets();
      for (const l of app.doc.layers) {
        if (!l.visible) continue;
        if (l.specOnly) {
          edge(l);
          ctx.fillStyle = accent; ctx.globalAlpha = 0.16; ctx.fill(); ctx.globalAlpha = 1;
          ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
        }
        if (isTarget(l)) {
          edge(l);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
          ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
        }
      }
    }
    if (app.trimming) {
      const l = selLayer();
      for (const poly of (l ? clipPolys(l) : [])) { // the windows it shows through now
        outline(poly);
        ctx.fillStyle = accent; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 1;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
        ctx.strokeStyle = accent; ctx.lineWidth = 1.75; ctx.stroke();
      }
    }
    if ((app.trimming || app.tool === 'piece') && hover) {
      outline(regionOutline(hover));
      if (app.tool === 'piece' && !app.trimming) { ctx.fillStyle = app.colour; ctx.globalAlpha = 0.45; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.75; ctx.stroke(); ctx.setLineDash([]);
    }
    if (app.trimming) return;
    if (rubber) {
      const b = evenBox(rubber.a, rubber.b, rubber.even), A = onScreen(b), B = onScreen({ x: b.x + b.w, y: b.y + b.h });
      if (!BOXED.has(app.shapeKind)) { if (b.w > 0 && b.h > 0) preview(boxOutline(app.shapeKind, b.x, b.y, b.w, b.h)); return; }
      ctx.beginPath();
      if (app.shapeKind === 'ellipse') ctx.ellipse((A.x + B.x) / 2, (A.y + B.y) / 2, (B.x - A.x) / 2, (B.y - A.y) / 2, 0, 0, Math.PI * 2);
      else if (app.shapeKind === 'triangle') { ctx.moveTo((A.x + B.x) / 2, A.y); ctx.lineTo(B.x, B.y); ctx.lineTo(A.x, B.y); ctx.closePath(); }
      else ctx.rect(A.x, A.y, B.x - A.x, B.y - A.y);
      ctx.fillStyle = app.colour; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      return;
    }
    if (app.tool === 'stamp' && cursor) { preview(placed(env.motif(app.stamp.key), cursor.x, cursor.y, app.stamp.size)); return; }
    if (band) {
      if (far(band.a, band.b) > 0) preview(bandPts(band.a, band.b, app.bandWidth));
      square(onScreen(band.a), 4, accent);
      return;
    }
    if (drag && drag.kind === 'marquee' && drag.went) {
      const A = onScreen(drag.a), B = onScreen(drag.b);
      ctx.fillStyle = accent; ctx.globalAlpha = 0.1; ctx.fillRect(A.x, A.y, B.x - A.x, B.y - A.y); ctx.globalAlpha = 1;
      ctx.setLineDash([5, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.25; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y); ctx.setLineDash([]);
    }
    const many = app.tool === 'select' ? env.selectedLayers() : [];
    if (many.length > 1) for (const l of many) { // each of several selected layers, boxed
      const b = boxOf(l);
      if (!b) continue;
      const A = onScreen({ x: b.x0, y: b.y0 }), B = onScreen({ x: b.x1, y: b.y1 });
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.25; ctx.strokeRect(A.x, A.y, B.x - A.x, B.y - A.y);
    }
    // a Mirrored layer's other side, dashed, so the pair reads as one thing
    const twin = app.tool === 'select' && selLayer() ? env.mirrorImage(selLayer()) : null;
    if (twin) {
      if (isShape(twin)) path(twin.pts, true);
      else if (isRegionLayer(twin)) outline(corners(twin));
      else ctx.beginPath();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
    const pic = app.tool === 'select' ? selPic() : null;
    if (pic) {
      const h = turnHandle(pic);
      ctx.beginPath(); ctx.moveTo(h.top.x, h.top.y); ctx.lineTo(h.x, h.y); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(h.x, h.y, 5, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      layerCorners(pic).forEach((q) => square(onScreen(q), 4.5, accent));
    }
    const box = app.tool === 'select' ? selBox() : null;
    if (box) corners(box).forEach((q) => square(onScreen(q), 4.5, accent));
    const fadeDots = () => { // where the fade starts (a ring) and where it ends (a dot)
      const faded = app.tool === 'select' ? selFade() : null;
      if (!faded) return;
      const ends = fadeEnds(faded), A = onScreen(ends.a), B = onScreen(ends.b);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
      for (const [q, solid] of [[A, false], [B, true]]) {
        ctx.beginPath(); ctx.arc(q.x, q.y, 6.5, 0, Math.PI * 2);
        ctx.fillStyle = solid ? '#101114' : '#ffffff'; ctx.fill();
        ctx.strokeStyle = solid ? '#ffffff' : '#101114'; ctx.lineWidth = 2; ctx.stroke();
      }
    };
    const shape = app.tool === 'select' ? selShape() : null;
    if (!shape) { fadeDots(); return; }
    path(shape.pts, true);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    shape.pts.forEach((q, i) => { // the dot that bends each line
      const m = onScreen(midOf(shape.pts, i));
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    });
    shape.pts.forEach((q) => square(onScreen(q), 4.5, accent));
    fadeDots();
  }

  return { down, move, up, key, context, cancel, hint, drawOverlay, drawing: () => !!(draft && draft.length) };
}
