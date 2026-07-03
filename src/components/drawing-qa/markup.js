// Markup coordinate handling. Client-safe. Ported from Checksets src/lib/markup.ts.
//
// The PDF page lives INSIDE the tldraw canvas as a locked image shape in "page
// units": height = PAGE_UNITS, width = PAGE_UNITS * aspect, at (0,0). Marks are
// drawn in that same space, so page + strokes share one coordinate space and the
// tldraw camera is the single source of truth for the transform — the layers
// cannot drift apart through zoom or pan. For storage, coordinates are divided by
// PAGE_UNITS -> normalized 0-1 fractions of page height; multiplied back on load.
export const PAGE_UNITS = 1000;

// Scales the coordinate-bearing fields of a tldraw shape record. Covers the shape
// types the review tools use: draw (segments), geo/image/frame (w/h), arrow
// (start/end), line (points), highlight (segments). Text scales by position only.
function scaleShape(rec, f) {
  const s = structuredClone(rec);
  if (typeof s.x === 'number') s.x *= f;
  if (typeof s.y === 'number') s.y *= f;
  const p = s.props ?? {};
  if (typeof p.w === 'number') p.w = p.w * f;
  if (typeof p.h === 'number') p.h = p.h * f;
  for (const key of ['start', 'end']) {
    const pt = p[key];
    if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') {
      pt.x *= f;
      pt.y *= f;
    }
  }
  if (Array.isArray(p.segments)) {
    for (const seg of p.segments) {
      for (const pt of seg.points ?? []) {
        pt.x *= f;
        pt.y *= f;
      }
    }
  }
  if (p.points && typeof p.points === 'object' && !Array.isArray(p.points)) {
    for (const pt of Object.values(p.points)) {
      if (typeof pt.x === 'number') pt.x *= f;
      if (typeof pt.y === 'number') pt.y *= f;
    }
  }
  return s;
}

export function normalizeShapes(shapes) {
  return shapes.map((s) => scaleShape(s, 1 / PAGE_UNITS));
}

export function denormalizeShapes(shapes) {
  return shapes.map((s) => scaleShape(s, PAGE_UNITS));
}
