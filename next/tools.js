// Clearcoat, new screen: what the pointer does on the sheet.
//
// Shape tool: click points to draw a closed outline; it becomes a fill layer
// with shape 'path' (see ../js/shapes.js and the engine's fillShapePath).
// Select tool: click a layer to select it and drag to move it; a selected
// shape shows its points, which drag, and a dot on every line, which bends
// it. Clicking a line adds a point, right-clicking a point removes it.

import { SIZE, createFillLayer, isRegionLayer, toLocal } from '../js/engine.js';
import { bounds, contains, moved, segmentAt, midOf, bendTo, insertAt, removeAt, snapAngle } from '../js/shapes.js';

const GRAB = 9;        // px: how close counts as "on" a point or dot
const EDGE = 6;        // px: how close counts as "on" a line
const SLOP = 3;        // px: a press that moves less than this is a click
const BIG = 0.6;       // a layer covering more of the sheet than this is not grabbed by a click on the sheet

export const isShape = (l) => !!l && l.type === 'fill' && l.shape === 'path' && Array.isArray(l.pts) && l.pts.length >= 3;

// keep a shape's box in step with its outline (gradients and the engine's
// own hit-testing work from the box)
export function setShape(layer, pts) {
  const b = bounds(pts);
  layer.pts = pts;
  layer.rx = b.x; layer.ry = b.y; layer.rw = b.w; layer.rh = b.h;
}

export function moveLayer(l, dx, dy) {
  if (isShape(l)) l.pts = moved(l.pts, dx, dy);
  if (isRegionLayer(l)) { l.rx += dx; l.ry += dy; } else { l.x += dx; l.y += dy; }
}

export function initTools(app, env) {
  const { screenToDoc, docToScreen, change, requestDraw } = env;
  let draft = null;    // the outline being drawn: doc points
  let cursor = null;   // where the next point would go
  let drag = null;

  const selLayer = () => app.doc.layers.find(l => l.id === app.sel) || null;
  const selShape = () => { const l = selLayer(); return isShape(l) && !l.locked && l.visible ? l : null; };
  const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const onScreen = (p) => docToScreen(p.x, p.y);

  // the top layer under a doc point
  function layerAt(p) {
    for (let i = app.doc.layers.length - 1; i >= 0; i--) {
      const l = app.doc.layers[i];
      if (!l.visible || l.locked) continue;
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

  const closable = (s) => draft && draft.length >= 3 && far(onScreen(draft[0]), s) <= GRAB + 2;
  const nextPoint = (p, shift) => (shift && draft && draft.length ? snapAngle(draft[draft.length - 1], p) : p);

  function finish() {
    if (!draft || draft.length < 3) return false;
    const layer = createFillLayer(app.colour);
    const n = app.doc.layers.filter(isShape).length + 1;
    layer.name = 'Shape ' + n;
    layer.shape = 'path';
    setShape(layer, draft);
    app.doc.layers.push(layer);
    draft = null; cursor = null;
    app.tool = 'select';
    app.sel = layer.id;
    change({ now: true });
    return true;
  }

  function down(e, s) {
    const p = screenToDoc(s.x, s.y);
    if (app.tool === 'shape') {
      if (closable(s) || (e.detail >= 2 && draft && draft.length >= 3)) { finish(); return; }
      (draft || (draft = [])).push(nextPoint(p, e.shiftKey));
      requestDraw();
      env.refreshChrome();
      return;
    }
    if (app.tool !== 'select') return;
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
    const hit = layerAt(p);
    if (!hit) { if (app.sel !== null) env.select(null); return; }
    if (hit.id !== app.sel) env.select(hit.id);
    drag = { kind: 'move', layer: hit, start: s, last: p, went: false };
  }

  function move(e, s) {
    const p = screenToDoc(s.x, s.y);
    if (app.tool === 'shape') { cursor = nextPoint(p, e.shiftKey); requestDraw(); return; }
    if (!drag) return;
    const l = drag.layer;
    if (drag.kind === 'point') {
      const pts = l.pts.map(q => ({ ...q }));
      pts[drag.i] = { ...pts[drag.i], x: p.x, y: p.y };
      setShape(l, pts);
      change({ panels: false });
      return;
    }
    if (!drag.went && far(drag.start, s) < SLOP) return;
    if (drag.kind === 'bend') {
      drag.went = true;
      setShape(l, bendTo(l.pts, drag.i, p, 4 / app.view.zoom));
      change({ panels: false });
      return;
    }
    // 'edge' that moves is a move, like a press anywhere else on the layer
    drag.went = true;
    moveLayer(l, p.x - drag.last.x, p.y - drag.last.y);
    drag.last = p;
    change({ panels: false });
  }

  function up() {
    if (!drag) return;
    const d = drag;
    drag = null;
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
    if (app.tool === 'shape') {
      if (e.key === 'Enter') { if (!finish()) env.say('Click at least three points first'); return true; }
      if (e.key === 'Backspace') { if (draft && draft.length) { draft.pop(); requestDraw(); env.refreshChrome(); } return true; }
      if (e.key === 'Escape') {
        if (draft && draft.length) { draft = null; cursor = null; requestDraw(); env.refreshChrome(); }
        else env.setTool('select');
        return true;
      }
    }
    return false;
  }

  function cancel() { draft = null; cursor = null; drag = null; }

  const hint = () => {
    if (app.tool === 'shape') return draft && draft.length ? 'Enter to finish · Backspace undoes a point · Shift holds 45°' : 'Click points to draw · Shift holds 45°';
    if (selShape()) return 'Drag a point · drag a dot to bend · click a line to add a point';
    return 'Space-drag to pan · wheel to zoom';
  };

  // screen space: lines and handles stay the same size at any zoom
  function drawOverlay(ctx, accent) {
    const path = (pts, close) => {
      ctx.beginPath();
      pts.forEach((a, i) => {
        const A = onScreen(a);
        if (!i) ctx.moveTo(A.x, A.y);
        const last = i === pts.length - 1;
        if (last && !close) return;
        const B = onScreen(pts[(i + 1) % pts.length]);
        if (a.c) { const C = onScreen(a.c); ctx.quadraticCurveTo(C.x, C.y, B.x, B.y); } else ctx.lineTo(B.x, B.y);
      });
      if (close) ctx.closePath();
    };
    const square = (q, r, fill) => {
      ctx.fillStyle = fill; ctx.strokeStyle = fill === '#ffffff' ? accent : '#ffffff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(q.x - r, q.y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
    };
    ctx.lineJoin = 'round';
    if (app.tool === 'shape' && draft && draft.length) {
      const pts = cursor ? [...draft, cursor] : draft;
      path(pts, false);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
      draft.forEach((q, i) => square(onScreen(q), i === 0 && draft.length >= 3 ? 6 : 4, i === 0 ? '#ffffff' : accent));
      return;
    }
    const shape = app.tool === 'select' ? selShape() : null;
    if (!shape) return;
    path(shape.pts, true);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3.5; ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    shape.pts.forEach((q, i) => { // the dot that bends each line
      const m = onScreen(midOf(shape.pts, i));
      ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke();
    });
    shape.pts.forEach((q) => square(onScreen(q), 4.5, accent));
  }

  return { down, move, up, key, context, cancel, hint, drawOverlay, drawing: () => !!(draft && draft.length) };
}
