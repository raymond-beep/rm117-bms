// Zoomable/pannable viewer for a single rendered PDF sheet. Replaces the former
// tldraw markup canvas: Drawing QA is now an AI-review tool (walk the firm
// checklist against each sheet), so the page only needs to be *readable* —
// zoom in on dimension strings / notes, pan around a big architectural sheet.
//
// We dropped tldraw because tldraw SDK 4.0+ requires a paid license key on
// production domains and otherwise tears its canvas down a few seconds after
// mount (the "sheet flashes away" bug). react-zoom-pan-pinch is MIT-licensed
// and has no such gate. The underlying raster is high-res (long edge 2800px),
// so zooming stays crisp well past 1:1.
import { TransformWrapper, TransformComponent, useControls } from 'react-zoom-pan-pinch';

function ViewerControls() {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <div className="dqa-viewer-ctrls">
      <button type="button" onClick={() => zoomOut()} aria-label="Zoom out" title="Zoom out">−</button>
      <button type="button" onClick={() => resetTransform()} aria-label="Fit to screen" title="Fit to screen">Fit</button>
      <button type="button" onClick={() => zoomIn()} aria-label="Zoom in" title="Zoom in">+</button>
    </div>
  );
}

export default function PageViewer({ src }) {
  return (
    <TransformWrapper
      minScale={0.1}
      maxScale={12}
      centerOnInit
      limitToBounds={false}
      doubleClick={{ mode: 'reset' }}
      wheel={{ step: 0.12 }}
      panning={{ velocityDisabled: true }}
    >
      <ViewerControls />
      <TransformComponent
        wrapperStyle={{ width: '100%', height: '100%' }}
        contentStyle={{ width: '100%', height: '100%' }}
      >
        <img
          src={src}
          alt="Drawing sheet"
          draggable={false}
          style={{ width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' }}
        />
      </TransformComponent>
    </TransformWrapper>
  );
}
