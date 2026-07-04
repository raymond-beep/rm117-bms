// Off-screen tldraw used only to rasterize saved markup for Drive export. It
// mounts once, then for each marked page recreates that page's shapes in "page
// units" and exports JUST the strokes (background:false) over the full page box —
// yielding a TRANSPARENT PNG the server stamps onto the original PDF page. Keeping
// the export transparent (no PDF raster) preserves the original drawing's vector
// sharpness; only the ink is added.
//
// Mounted only while an export is running (ReviewClient renders it conditionally),
// so it never affects the normal review canvas.
import { useCallback } from 'react';
import { Box, Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';
import { denormalizeShapes, PAGE_UNITS } from './markup.js';

// Long edge of each exported markup PNG, in px. Thin ink over a large sheet — this
// is plenty for crisp strokes without bloating the payload.
const EXPORT_LONG_EDGE = 2400;

// pages: [{ page:number, shapes:Array, aspect:number }] — only pages that have
// markup. onComplete([{ page, pngBase64 }]) / onError(err).
export default function MarkupExporter({ pages, onComplete, onError }) {
  const handleMount = useCallback(
    (editor) => {
      let cancelled = false;
      (async () => {
        try {
          const out = [];
          for (const pg of pages) {
            if (cancelled) return;
            // Clear the previous page's shapes so each export is isolated.
            const existing = editor.getCurrentPageShapes().map((s) => s.id);
            if (existing.length) editor.deleteShapes(existing);

            const shapes = pg.shapes?.shapes ?? pg.shapes ?? [];
            if (!Array.isArray(shapes) || shapes.length === 0) continue;

            const pageW = PAGE_UNITS * pg.aspect;
            const pageH = PAGE_UNITS;
            editor.createShapes(denormalizeShapes(shapes));

            const ids = editor.getCurrentPageShapes().map((s) => s.id);
            if (ids.length === 0) continue;

            const scale = EXPORT_LONG_EDGE / Math.max(pageW, pageH);
            const { url } = await editor.toImageDataUrl(ids, {
              format: 'png',
              background: false,
              bounds: new Box(0, 0, pageW, pageH),
              padding: 0,
              scale,
            });
            const pngBase64 = url.slice(url.indexOf(',') + 1);
            out.push({ page: pg.page, pngBase64 });
          }
          if (!cancelled) onComplete(out);
        } catch (err) {
          if (!cancelled) onError(err);
        }
      })();

      return () => { cancelled = true; };
    },
    [pages, onComplete, onError],
  );

  // Off-screen but non-zero sized (tldraw needs a measured container). It never
  // participates in the visible layout or receives pointer events.
  return (
    <div
      aria-hidden
      style={{ position: 'fixed', left: -100000, top: 0, width: 1024, height: 768, pointerEvents: 'none' }}
    >
      <Tldraw onMount={handleMount} />
    </div>
  );
}
