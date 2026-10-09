// Reading an iRacing template into what a livery doc needs: the linework
// picture, the paint mask, and a region map of the sheet's pieces and the
// kit's number / sponsor zones. No page elements in here.
//
// ponytail: the page-free half of main.js's template handler and
// applyTemplateIntel, copied rather than refactored out of that file.

import { loadImage } from './engine.js';
import { psdToTemplate } from './psd.js';
import { createRegionMap, piecesRegionMap, uniqueRegionId } from './regions.js';
import { zonesToRegions, inferDecalPairs, applyOrientation } from './zones.js';

// What the kit knows, merged into a region map (made if there is none).
// Pieces go in once: a map that already has outlined regions keeps them, so
// reloading a template never disturbs pieces that have since been named,
// paired, linked or given a centreline. The kit's zones replace the previous
// kit's zones; hand-drawn regions stay.
// decalData: ImageData of the kit's stock decals, for zone orientation.
// → { map, pieces, zones } (counts of what was added)
export function templateRegions(map, { pieces = [], zones = [], decalData = null } = {}, carName) {
  let nPieces = 0;
  if (pieces.length && !(map && map.regions.some(r => r.points))) {
    if (!map) map = createRegionMap(carName || 'template car');
    const fresh = piecesRegionMap(carName, pieces).regions;
    for (const r of fresh) r.id = uniqueRegionId(r.id, map);
    map.regions.unshift(...fresh);
    nPieces = fresh.length;
  }
  if (!zones.length) return { map, pieces: nPieces, zones: 0 };
  if (!map) map = createRegionMap(carName || 'template car');
  const kept = map.regions.filter(r => !r.kind);
  for (const r of kept) {
    if (r.mirror && !kept.some(o => o.id === r.mirror)) { delete r.mirror; delete r.mirrorKind; }
  }
  // a map that was nothing but the previous kit's zones takes the new kit's name
  if (!kept.length && carName) map.car = carName;
  map.regions = kept;
  const { regions, axis } = zonesToRegions(zones, map);
  if (decalData) {
    try { applyOrientation(regions, inferDecalPairs(decalData, { axis }), axis); } catch { /* geometric default stays */ }
  }
  map.regions.push(...regions);
  return { map, pieces: nPieces, zones: regions.length };
}

// psd.js fetches its reader relative to the *page*, which only works from the
// site root. Load it relative to this file first so any page can read PSDs.
function ensurePsdReader() {
  if (window.agPsd) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./vendor/ag-psd.min.js', import.meta.url).href;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the PSD reader'));
    document.head.appendChild(s);
  });
}

const fileToDataURL = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(file);
});

// file: a template PSD (pieces, zones and mask are read from it) or a plain
// picture (linework only). map: the doc's current region map, or null.
// → { template: { img, src }, paintMask, regionMap, pieces, zones, carName }
export async function loadTemplate(file, map = null) {
  const carName = file.name.replace(/\.[^.]+$/, '');
  if (!/\.psd$/i.test(file.name)) {
    const src = await fileToDataURL(file);
    return { template: { img: await loadImage(src), src }, paintMask: null, regionMap: map, pieces: 0, zones: 0, carName };
  }
  await ensurePsdReader();
  const res = await psdToTemplate(await file.arrayBuffer());
  let decalData = null;
  if (res.decals) {
    try { decalData = res.decals.getContext('2d').getImageData(0, 0, res.decals.width, res.decals.height); } catch { /* no orientation hints */ }
  }
  const merged = templateRegions(map, { pieces: res.pieces, zones: res.zones, decalData }, carName);
  return {
    template: { img: await loadImage(res.src), src: res.src },
    paintMask: res.paintMask || null,
    regionMap: merged.map, pieces: merged.pieces, zones: merged.zones, carName,
  };
}
