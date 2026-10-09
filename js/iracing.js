// Saving a livery into the iRacing paints folder, with no page elements in
// here so any screen can use it.
//
// ponytail: this is a copy of main.js's "File System Access: save into
// iRacing" block, not a refactor of it, so the original screen cannot be
// broken by changes here. Fold the two together if that screen is retired.

import { renderPaint, renderSpec } from './engine.js';
import { canvasToTGA } from './tga.js';
import * as persist from './persist.js';

export const validCustid = (custid) => /^\d+$/.test(String(custid || '').trim());

// [paintName, specName] for what the doc paints. Custom Number paints use the
// car_num_ prefix; helmets and suits have no spec map (specName = null).
export function paintFilenames(doc, custid) {
  if (doc.target === 'helmet') return [`helmet_${custid}.tga`, null];
  if (doc.target === 'suit') return [`suit_${custid}.tga`, null];
  return [`car_${doc.customNumber ? 'num_' : ''}${custid}.tga`, `car_spec_${custid}.tga`];
}

// iRacing helmets are 1024×1024 — downscale the 2048 sheet for that target;
// car and suit ship at full size.
export function exportPaintCanvas(doc, canvas) {
  if (doc.target !== 'helmet') return canvas;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, 1024, 1024);
  return c;
}

// The user can link either one car's folder (paints/<car>) or the paints
// root; with the root linked, the chosen car subfolder (setting 'paintsCar')
// is where files go.
export async function paintsDir({ requestIfNeeded = false } = {}) {
  const root = await persist.getPaintsFolder({ requestIfNeeded }).catch(() => null);
  if (!root) return null;
  const car = await persist.loadSetting('paintsCar').catch(() => null);
  if (!car) return root;
  try {
    return await root.getDirectoryHandle(car);
  } catch {
    return root; // subfolder deleted or permission pending — fall back to root
  }
}

// Snapshot whatever is in the folder already (e.g. a Trading Paints livery)
// into clearcoat-backup/ — only if no snapshot exists yet, so repeated saves
// never overwrite the true original.
async function backupOriginals(handle, names) {
  let backed = false;
  for (const name of names) {
    if (!name) continue; // no spec map for this target
    const existing = await persist.readFileFromFolder(handle, name);
    if (!existing) continue;
    const bdir = await persist.getBackupDir(handle, true);
    if (!bdir) return false;
    if (await persist.readFileFromFolder(bdir, name)) continue; // original already kept
    await persist.writeFileToFolder(bdir, name, existing);
    backed = true;
  }
  return backed;
}

// a canvas tainted by a cross-origin image cannot be read back; say so
// plainly instead of surfacing a raw SecurityError
function assertExportable(canvas) {
  try {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
  } catch {
    throw new Error('An imported image is blocking export. Re-import that artwork as a file from your computer, then save again.');
  }
}

// Writes the paint (and, for a car, the spec map) into the linked folder.
// quiet = a live save: never prompts for permission.
// → { ok, paintName, specName, backed, error }
export async function saveToIracing(doc, custid, { quiet = false } = {}) {
  custid = String(custid || '').trim();
  if (!validCustid(custid)) return { ok: false, error: 'Enter your iRacing customer number first.' };
  try {
    const handle = await paintsDir({ requestIfNeeded: !quiet });
    if (!handle) return { ok: false, error: 'No iRacing folder linked, or its permission was lost.' };
    const [paintName, specName] = paintFilenames(doc, custid);
    const backed = await backupOriginals(handle, [paintName, specName]);
    const paint = exportPaintCanvas(doc, renderPaint(doc));
    assertExportable(paint);
    await persist.writeFileToFolder(handle, paintName, canvasToTGA(paint));
    if (specName) {
      const spec = renderSpec(doc);
      assertExportable(spec);
      await persist.writeFileToFolder(handle, specName, canvasToTGA(spec, { alpha: true }));
    }
    return { ok: true, paintName, specName, backed };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not write to the folder.' };
  }
}
