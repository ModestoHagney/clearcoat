// Driver variants — one shared design, one set of paint files per driver.
//
// A text layer can be bound to a *variable* ('number', 'name', or
// 'custom:<key>'). `applyVariant` returns a copy of the doc with every bound
// text layer re-rasterised for one driver; the live doc is never touched, so
// previews and batch exports leave undo history and autosave alone.
//
// `doc.drivers` holds { id, name, number, custid, enabled }.

import { regenerateText } from './engine.js';

export const VARIABLES = [
  ['', 'None'],
  ['number', 'Driver number'],
  ['name', 'Driver name'],
];

let seq = 0;
export function newDriver(partial = {}) {
  return {
    id: partial.id || ('D' + (++seq) + '-' + Date.now().toString(36)),
    name: String(partial.name ?? ''),
    number: String(partial.number ?? ''),
    custid: String(partial.custid ?? '').trim(),
    enabled: partial.enabled !== false,
  };
}

// saved → runtime; tolerates junk rows and missing fields
export function normalizeDrivers(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const d of list) {
    if (!d || typeof d !== 'object') continue;
    const drv = newDriver(d);
    if (seen.has(drv.id)) drv.id = newDriver().id;
    seen.add(drv.id);
    out.push(drv);
  }
  return out;
}

export const validCustidStr = (s) => /^\d+$/.test(String(s ?? '').trim());

// drivers that take part in "Export all drivers"
export function exportableDrivers(drivers) {
  return (drivers || []).filter(d => d.enabled && validCustidStr(d.custid));
}

// the text a variable resolves to for a driver; null = not a variable
export function variableText(variable, driver) {
  if (!variable || !driver) return null;
  if (variable === 'number') return String(driver.number ?? '');
  if (variable === 'name') return String(driver.name ?? '');
  if (variable.startsWith('custom:')) {
    const key = variable.slice('custom:'.length);
    const v = driver.fields && driver.fields[key];
    return v == null ? '' : String(v);
  }
  return null;
}

// true when any layer in the doc is bound to a variable
export function hasVariables(doc) {
  return (doc.layers || []).some(l => l.type === 'text' && l.variable);
}

// Copy of `doc` with variable text layers swapped for this driver. Only the
// doc object, the layers array and the substituted layers are cloned — every
// other layer is shared by reference (they are read-only during a render).
// `regenerate` is injectable so the pure logic can run without a canvas.
export function applyVariant(doc, driver, regenerate = regenerateText) {
  const layers = doc.layers.map(l => {
    if (l.type !== 'text' || !l.variable) return l;
    const text = variableText(l.variable, driver);
    if (text == null) return l;
    const copy = { ...l, text, img: null, src: null };
    regenerate(copy);
    return copy;
  });
  return { ...doc, layers };
}
