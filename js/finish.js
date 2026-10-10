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

import { MATERIALS } from './engine.js';

// the finishes offered, in the order shown
export const FINISHES = ['gloss', 'satin', 'matte', 'metallic', 'pearl', 'candy', 'chrome', 'flake', 'glitter', 'brushed', 'carbon'];
export const finishName = (key) => (MATERIALS[key] || MATERIALS.gloss).label;

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

// the finish a layer ends up with
export function finishOf(doc, layer) {
  if (isArea(layer) || hasOwnFinish(layer)) return layer.material || 'gloss';
  const r = ruleFor(doc, layerColour(layer));
  return r ? r.material : 'gloss';
}
export function baseFinish(doc) {
  if (doc.baseMaterial && doc.baseMaterial !== 'gloss') return doc.baseMaterial;
  const r = ruleFor(doc, doc.baseColor);
  return r ? r.material : 'gloss';
}

// The doc as it is finished: each layer carrying the finish it ends up with.
// The doc itself is returned when no colour rule changes anything.
export function withFinishes(doc) {
  if (!(doc.finishRules || []).length) return doc;
  let changed = false;
  const layers = doc.layers.map((l) => {
    const m = finishOf(doc, l);
    if (m === (l.material || 'gloss')) return l;
    changed = true;
    return { ...l, material: m };
  });
  const base = baseFinish(doc);
  if (!changed && base === (doc.baseMaterial || 'gloss')) return doc;
  return { ...doc, layers, baseMaterial: base };
}

// "everything this colour is <material>"; gloss is the absence of a rule
export function setRule(doc, colour, material) {
  const c = hex(colour);
  if (!c) return;
  doc.finishRules = (doc.finishRules || []).filter(r => r.color !== c);
  if (material && material !== 'gloss') doc.finishRules.push({ color: c, material });
}

// Everything that has a finish of its own, for the Finishes list:
// → [{ kind: 'colour', colour, material, used } | { kind: 'layer' | 'area', id, name, material }]
// `used`: how many layers (and the base coat) that colour is on right now.
export function finishList(doc) {
  const out = [];
  for (const r of doc.finishRules || []) {
    const used = doc.layers.filter(l => !isArea(l) && !hasOwnFinish(l) && layerColour(l) === r.color).length + (hex(doc.baseColor) === r.color ? 1 : 0);
    out.push({ kind: 'colour', colour: r.color, material: r.material, used });
  }
  for (const l of doc.layers) {
    if (isArea(l)) out.push({ kind: 'area', id: l.id, name: l.name, material: l.material || 'gloss' });
    else if (hasOwnFinish(l)) out.push({ kind: 'layer', id: l.id, name: l.name, material: l.material || 'gloss' });
  }
  return out;
}
