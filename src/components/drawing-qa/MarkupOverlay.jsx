// tldraw markup surface. The rendered PDF page lives INSIDE the canvas as a
// locked image shape in page units (height = PAGE_UNITS), so marks and page share
// one coordinate space and the tldraw camera is the single source of truth for
// zoom/pan — the layers cannot drift apart. Shapes are persisted in normalized
// coordinates via ./markup.js and auto-saved (debounced). Ported from Checksets.
import { useCallback, useRef } from 'react';
import { AssetRecordType, Box, createShapeId, Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';
import { denormalizeShapes, normalizeShapes, PAGE_UNITS } from './markup.js';

const PAGE_SHAPE_ID = createShapeId('pdf-page');

// Keep only the fields createShapes needs; drop store bookkeeping so records
// re-create cleanly on a fresh editor.
function sanitizeShape(s) {
  return { id: s.id, type: s.type, x: s.x, y: s.y, rotation: s.rotation, opacity: s.opacity, props: s.props, meta: s.meta };
}

export default function MarkupOverlay({ pageImageUrl, imageWidth, imageHeight, aspect, initialMarkup, onSave }) {
  const saveTimer = useRef(null);

  const handleMount = useCallback(
    (editor) => {
      const pageW = PAGE_UNITS * aspect;
      const pageH = PAGE_UNITS;

      // 1. The PDF page as a locked image shape at (0,0) in page units.
      const assetId = AssetRecordType.createId();
      editor.createAssets([
        {
          id: assetId,
          typeName: 'asset',
          type: 'image',
          props: { name: 'pdf-page', src: pageImageUrl, w: imageWidth, h: imageHeight, mimeType: 'image/png', isAnimated: false },
          meta: {},
        },
      ]);
      editor.createShape({ id: PAGE_SHAPE_ID, type: 'image', x: 0, y: 0, isLocked: true, props: { assetId, w: pageW, h: pageH } });

      // 2. Restore saved markup (normalized -> page units).
      if (initialMarkup?.shapes?.length) {
        editor.createShapes(denormalizeShapes(initialMarkup.shapes));
      }

      // 3. Fit the page in view; default to the draw (pen) tool.
      editor.zoomToBounds(new Box(0, 0, pageW, pageH), { inset: 24 });
      editor.setCurrentTool('draw');

      // 4. Debounced auto-save of user edits (page shape excluded).
      const persist = () => {
        const shapes = editor
          .getCurrentPageShapes()
          .filter((s) => s.id !== PAGE_SHAPE_ID)
          .map(sanitizeShape);
        onSave({ v: 1, pageUnits: PAGE_UNITS, shapes: normalizeShapes(shapes) });
      };
      const unlisten = editor.store.listen(
        () => {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(persist, 800);
        },
        { source: 'user', scope: 'document' },
      );
      return () => {
        unlisten();
        if (saveTimer.current) clearTimeout(saveTimer.current);
      };
    },
    [pageImageUrl, imageWidth, imageHeight, aspect, initialMarkup, onSave],
  );

  return (
    <div className="absolute inset-0">
      <Tldraw onMount={handleMount} />
    </div>
  );
}
