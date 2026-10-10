// Finishes: how a painted surface looks (gloss, matte, chrome…), as opposed
// to its colour. iRacing reads them from the spec map; the engine stamps each
// layer's `material` into it. This file decides what that material is.
//
// A finish is set in one of three ways, the more specific winning:
//   an area   — a shape that paints nothing and only carries a finish
//               (a layer with specOnly), drawn on top;
//   a layer   — this layer's own finish (layer.finishOwn, layer.material);
//   a colour  — a rule, "everything this colour" (doc.finishRules). It
//               follows the colour: recolour a shape and its finish changes.
// Anything else is gloss. Pure: no canvas, runs under node --test.

import { MATERIALS, resolveParams } from './engine.js';

// The finishes offered, in the order shown. Each is a starting point: three
// numbers (metallic, roughness, clearcoat — the spec map's three channels)
// that the sliders then move. Sparkle is separate and sits on top of any of
// them: the engine's 'flake' (single-pixel specks) or 'glitter' (chips)
// texture, built round those same three numbers.
export const FINISHES = ['gloss', 'satin', 'matte', 'metallic', 'pearl', 'chrome'];
export const finishName = (key) => (MATERIALS[key] || MATERIALS.gloss).label;
export const SPARKLE = { amount: 18, size: 1, strength: 100 }; // what ticking Sparkle starts with

// A finish as the panel shows it, read from a material and its params:
// → { met, rough, clear, sparkle: null | { amount, size, strength } }
export function readFinish(material, params) {
  const key = MATERIALS[material] ? material : 'gloss', p = resolveParams(key, params);
  const sparkle = key === 'flake' ? { amount: p.density ?? 18, size: 1, strength: p.contrast ?? 100 }
    : key === 'glitter' ? { amount: p.density ?? 30, size: Math.max(2, p.scale ?? 4), strength: p.contrast ?? 100 }
    : null;
  return { met: p.met, rough: p.rough, clear: p.clear, sparkle };
}
// the preset whose three numbers these are, if any
export function presetOf(f) {
  return FINISHES.find(k => MATERIALS[k].met === f.met && MATERIALS[k].rough === f.rough && MATERIALS[k].clear === f.clear) || null;
}
// …and back: the material and params the engine stamps. `hint`: the finish it
// was before, kept as its name when the numbers have been moved off a preset.
export function writeFinish(f, hint = 'gloss') {
  const n = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
  const base = { met: n(f.met, 0, 255), rough: n(f.rough, 0, 255), clear: n(f.clear, 0, 255) };
  if (f.sparkle) {
    const size = n(f.sparkle.size, 1, 12), amount = n(f.sparkle.amount, 1, 60), contrast = n(f.sparkle.strength, 0, 100);
    return size <= 1 ? { material: 'flake', params: { ...base, density: amount, contrast } }
      : { material: 'glitter', params: { ...base, density: amount, scale: size, contrast } };
  }
  const key = presetOf(base) || (FINISHES.includes(hint) ? hint : 'gloss');
  return { material: key, params: presetOf(base) ? null : base };
}
// what to call it: "Matte", "Matte + sparkle", "Custom"…
export function finishLabel(material, params) {
  const f = readFinish(material, params), key = presetOf(f);
  // a finish from the original screen that is neither a preset nor sparkle keeps its own name
  const name = key ? finishName(key) : (!f.sparkle && !FINISHES.includes(material) && !params && MATERIALS[material]) ? finishName(material) : 'Custom';
  return f.sparkle ? `${name} + sparkle` : name;
}

const hex = (c) => (typeof c === 'string' ? c.toLowerCase() : null);
// the one colour a layer is, if it has one (pictures do not)
export const layerColour = (l) => hex(l.type === 'fill' ? l.color : l.type === 'text' ? l.textColor : null);
export const isArea = (l) => !!l && !!l.specOnly;
// a layer whose finish was set for itself (older projects: any finish but gloss)
export const hasOwnFinish = (l) => !!l.finishOwn || (!!l.material && l.material !== 'gloss');

export function ruleFor(doc, colour) {
  const c = hex(colour);
  return (c && (doc.finishRules || []).find(r => r.color === c)) || null;
}

// the finish a layer ends up with: { material, params }
export function finishSpec(doc, layer) {
  if (isArea(layer) || hasOwnFinish(layer)) return { material: layer.material || 'gloss', params: layer.matParams || null };
  const r = ruleFor(doc, layerColour(layer));
  return r ? { material: r.material, params: r.params || null } : { material: 'gloss', params: null };
}
export const finishOf = (doc, layer) => finishSpec(doc, layer).material;
export function baseSpec(doc) {
  if (doc.baseMaterial && doc.baseMaterial !== 'gloss') return { material: doc.baseMaterial, params: doc.baseMatParams || null };
  const r = ruleFor(doc, doc.baseColor);
  return r ? { material: r.material, params: r.params || null } : { material: 'gloss', params: null };
}
export const baseFinish = (doc) => baseSpec(doc).material;

// The doc as it is finished: each layer carrying the finish it ends up with.
// The doc itself is returned when no colour rule changes anything.
export function withFinishes(doc) {
  if (!(doc.finishRules || []).length) return doc;
  let changed = false;
  const layers = doc.layers.map((l) => {
    if (isArea(l) || hasOwnFinish(l)) return l; // it already carries its own
    const f = finishSpec(doc, l);
    if (f.material === (l.material || 'gloss') && !f.params) return l;
    changed = true;
    return { ...l, material: f.material, matParams: f.params };
  });
  const base = baseSpec(doc), ownBase = doc.baseMaterial && doc.baseMaterial !== 'gloss';
  if (!changed && (ownBase || base.material === 'gloss')) return doc;
  return ownBase ? { ...doc, layers } : { ...doc, layers, baseMaterial: base.material, baseMatParams: base.params };
}

// "everything this colour is <material>"; plain gloss is the absence of a rule
export function setRule(doc, colour, material, params = null) {
  const c = hex(colour);
  if (!c) return;
  doc.finishRules = (doc.finishRules || []).filter(r => r.color !== c);
  if (!material || (material === 'gloss' && !params)) return;
  doc.finishRules.push(params ? { color: c, material, params: { ...params } } : { color: c, material });
}

// Everything that has a finish of its own, for the Finishes list:
// → [{ kind: 'colour', colour, material, params, used } | { kind: 'layer' | 'area', id, name, material, params }]
// `used`: how many layers (and the base coat) that colour is on right now.
export function finishList(doc) {
  const out = [];
  for (const r of doc.finishRules || []) {
    const used = doc.layers.filter(l => !isArea(l) && !hasOwnFinish(l) && layerColour(l) === r.color).length + (hex(doc.baseColor) === r.color ? 1 : 0);
    out.push({ kind: 'colour', colour: r.color, material: r.material, params: r.params || null, used });
  }
  for (const l of doc.layers) {
    if (isArea(l)) out.push({ kind: 'area', id: l.id, name: l.name, material: l.material || 'gloss', params: l.matParams || null });
    else if (hasOwnFinish(l)) out.push({ kind: 'layer', id: l.id, name: l.name, material: l.material || 'gloss', params: l.matParams || null });
  }
  return out;
}
