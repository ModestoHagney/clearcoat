// Clearcoat, new screen: Map mode. The map is what the app knows about the
// sheet beyond pixels: which outline is which panel, which panel is the twin
// of which, and where a panel's centreline runs. Painting tools (fill a
// panel, trim, mirror) work from it; this mode is where it is looked at and
// corrected.

import { SIZE, createImageLayer, loadImage } from '../js/engine.js';
import { regionOutline, regionById, centerLine, snapToOutline, labelPoint } from '../js/regions.js';
import { pieceAt } from '../js/mirror.js';

export const GUIDE = 'Panel guide'; // the layer that puts the panel colours on the car
export const pieces = (map) => (map ? map.regions.filter(r => !r.kind) : []);
// golden-angle steps keep neighbours in the list far apart in colour
export const hue = (i, alpha = 1) => `hsl(${(i * 137.5) % 360} 62% ${i % 2 ? 64 : 50}% / ${alpha})`;

// where each panel's name goes; worked out once per outline, not per frame
const labelCache = new WeakMap();
function labelOf(r, later) {
  const c = labelCache.get(r);
  if (c && c.n === r.points.length && c.x0 === r.points[0].x && c.y0 === r.points[0].y) return c.p;
  const p = labelPoint(r, later);
  labelCache.set(r, { n: r.points.length, x0: r.points[0].x, y0: r.points[0].y, p });
  return p;
}

// The panel colours, names and centrelines as a full-sheet picture: what the
// "Show on car" guide layer is made of.
export function guideCanvas(map) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const list = pieces(map);
  const trace = (pts) => { ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.closePath(); };
  list.forEach((r, i) => {
    trace(regionOutline(r));
    ctx.fillStyle = hue(i); ctx.fill();
    ctx.strokeStyle = '#101114'; ctx.lineWidth = 3; ctx.stroke();
  });
  for (const r of list) {
    const cl = centerLine(r);
    if (!cl) continue;
    ctx.save();
    trace(regionOutline(r)); ctx.clip();
    ctx.beginPath(); ctx.moveTo(cl.p0.x, cl.p0.y); ctx.lineTo(cl.p1.x, cl.p1.y);
    ctx.strokeStyle = '#101114'; ctx.lineWidth = 14; ctx.stroke();
    ctx.setLineDash([28, 20]); ctx.strokeStyle = '#ffe119'; ctx.lineWidth = 8; ctx.stroke();
    ctx.restore();
  }
  list.forEach((r, i) => {
    const p = labelOf(r, list.slice(i + 1));
    let size = Math.max(14, Math.min(64, p.room * 0.7));
    ctx.font = `700 ${size}px "IBM Plex Mono", monospace`;
    const fit = (p.room * 1.7) / ctx.measureText(r.name).width;
    if (fit < 1) { size = Math.max(11, size * fit); ctx.font = `700 ${size}px "IBM Plex Mono", monospace`; }
    ctx.lineWidth = size / 4; ctx.strokeStyle = '#101114'; ctx.strokeText(r.name, p.x, p.y);
    ctx.fillStyle = '#ffffff'; ctx.fillText(r.name, p.x, p.y);
  });
  return c;
}

export const guideLayer = (doc) => doc.layers.find(l => l.type === 'image' && l.name === GUIDE) || null;
// Puts the guide on the car (a locked layer on top of everything), refreshes
// it after a map edit, or takes it off again.
export async function syncGuide(doc, on) {
  const old = guideLayer(doc);
  if (!on) { if (old) doc.layers.splice(doc.layers.indexOf(old), 1); return; }
  if (!doc.regionMap) return;
  const src = guideCanvas(doc.regionMap).toDataURL('image/png');
  const img = await loadImage(src);
  if (old) { old.img = img; old.src = src; return; }
  const layer = createImageLayer(img, src, GUIDE);
  layer.scale = 1;
  layer.locked = true; // sheet-sized: it must never be grabbed by a click
  doc.layers.push(layer);
}

export function initMap(app, env) {
  const { screenToDoc, docToScreen, requestDraw } = env;
  let pending = null;   // centreline: the first corner clicked, { region, x, y }
  let snap = null;      // centreline: where a click would land right now

  const map = () => app.doc.regionMap;
  const sel = () => (map() && app.piece ? regionById(map(), app.piece) : null);

  // the nearest spot on a panel's edge, corners preferred
  function edgeSnap(p, only) {
    let best = null;
    for (const r of pieces(map())) {
      if (only && r.id !== only) continue;
      const q = snapToOutline(regionOutline(r), p.x, p.y, 10 / app.view.zoom);
      if (q.d <= 14 / app.view.zoom && (!best || q.d < best.d)) best = { region: r.id, x: q.x, y: q.y, d: q.d };
    }
    return best;
  }
  const centreTarget = () => (pending ? pending.region : app.centreFor);

  function down(e, s) {
    if (!map()) return;
    const p = screenToDoc(s.x, s.y);
    if (app.tool === 'mcentre') {
      const hit = edgeSnap(p, centreTarget());
      if (!hit) { env.say(pending ? 'Click the matching corner on the same panel' : 'Click closer to the panel\'s edge'); return; }
      if (!pending) { pending = hit; requestDraw(); env.refreshChrome(); return; }
      if (Math.hypot(hit.x - pending.x, hit.y - pending.y) < 2) { env.say('The two corners need to be apart'); return; }
      const r = regionById(map(), hit.region), pt = (c) => ({ x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10 });
      r.center = { a: pt(pending), b: pt(hit) };
      pending = snap = null;
      app.piece = r.id;
      app.centreFor = null;
      app.tool = 'mpick';
      env.mapChanged(`Centreline set on ${r.name}`);
      return;
    }
    const r = pieceAt(map(), p.x, p.y);
    env.pickPiece(r ? r.id : null);
  }

  function move(e, s) {
    if (app.tool !== 'mcentre' || !map()) return;
    const hit = edgeSnap(screenToDoc(s.x, s.y), centreTarget());
    if ((hit && hit.x) !== (snap && snap.x) || (hit && hit.y) !== (snap && snap.y)) { snap = hit; requestDraw(); }
  }

  function key(e) {
    if (e.key !== 'Escape') return false;
    if (pending) { pending = null; requestDraw(); env.refreshChrome(); }
    else if (app.tool === 'mcentre') env.setTool('mpick');
    else env.pickPiece(null);
    return true;
  }
  function cancel() { pending = snap = null; }

  const hint = () => {
    if (!map()) return 'Load a template to get a map';
    if (app.tool === 'mcentre') return pending ? 'Click the matching corner on the other side' : 'Click a corner, then its match on the other side';
    return sel() ? 'Name it, pair it or set its centreline on the right' : 'Click a panel';
  };

  // screen space
  function drawOverlay(ctx, accent) {
    const m = map();
    if (!m) return;
    const S = (q) => docToScreen(q.x, q.y);
    const trace = (pts) => { ctx.beginPath(); pts.forEach((q, i) => { const a = S(q); i ? ctx.lineTo(a.x, a.y) : ctx.moveTo(a.x, a.y); }); ctx.closePath(); };
    const list = pieces(m), z = app.view.zoom;
    ctx.lineJoin = 'round'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    list.forEach((r, i) => {
      trace(regionOutline(r));
      if (app.mapShow.colours) { ctx.fillStyle = hue(i, 0.82); ctx.fill(); }
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 1.25; ctx.stroke();
    });
    for (const r of m.regions) { // the kit's own number and sponsor boxes
      if (!r.kind) continue;
      const a = S(r), b = S({ x: r.x + r.w, y: r.y + r.h });
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#101114'; ctx.lineWidth = 1;
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
    for (const r of list) {
      const cl = centerLine(r);
      if (!cl) continue;
      ctx.save();
      trace(regionOutline(r)); ctx.clip();
      const a = S(cl.p0), b = S(cl.p1);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = '#101114'; ctx.lineWidth = 4; ctx.stroke();
      ctx.setLineDash([9, 6]); ctx.strokeStyle = '#ffe119'; ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    }
    if (app.mapShow.colours) list.forEach((r, i) => {
      const p = labelOf(r, list.slice(i + 1));
      let size = Math.max(14, Math.min(64, p.room * 0.7)) * z;
      if (size < 7) return; // too small to read at this zoom
      ctx.font = `600 ${size}px "IBM Plex Mono", monospace`;
      const fit = (p.room * 1.7 * z) / ctx.measureText(r.name).width;
      if (fit < 1) { size *= fit; if (size < 7) return; ctx.font = `600 ${size}px "IBM Plex Mono", monospace`; }
      const a = S(p);
      ctx.lineWidth = Math.max(2, size / 4); ctx.strokeStyle = '#101114'; ctx.strokeText(r.name, a.x, a.y);
      ctx.fillStyle = '#ffffff'; ctx.fillText(r.name, a.x, a.y);
    });
    const cur = sel();
    if (cur) {
      const twin = cur.mirror ? regionById(m, cur.mirror) : null;
      if (twin) { trace(regionOutline(twin)); ctx.setLineDash([7, 5]); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]); }
      trace(regionOutline(cur));
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 3; ctx.stroke();
    }
    const dot = (q, r, fill) => { const a = S(q); ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.stroke(); };
    if (pending) dot(pending, 6, accent);
    if (app.tool === 'mcentre' && snap) {
      const a = S(snap);
      ctx.beginPath(); ctx.arc(a.x, a.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.stroke();
      if (pending) { // where the centreline would run
        const p0 = S(pending);
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(a.x, a.y);
        ctx.setLineDash([4, 4]); ctx.strokeStyle = accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
      }
    }
  }

  return { down, move, key, cancel, hint, drawOverlay };
}
