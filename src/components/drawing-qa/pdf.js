// pdf.js loading + page rasterization (client-only). Ported from Checksets
// src/lib/pdf.ts. Two render targets:
// - DISPLAY: crisp base raster the review canvas shows (page-as-image inside
//   tldraw), sized generously so moderate zoom stays readable.
// - ANALYSIS: ~1.1 MP export for the vision API (the API downscales past ~1568px).
import * as pdfjs from 'pdfjs-dist';

if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
}

const DISPLAY_LONG_EDGE = 2800;
const ANALYSIS_MEGAPIXELS = 1.1e6;

// Accepts a URL string or a pdf.js source object (e.g. { data: ArrayBuffer } for
// bytes fetched with auth — the Drive stream endpoint is staff-gated).
export function loadPdf(source) {
  return pdfjs.getDocument(typeof source === 'string' ? { url: source } : source).promise;
}

async function renderPage(doc, pageNumber, scaleFor, quality) {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = scaleFor(base.width, base.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create canvas context');

  await page.render({ canvasContext: ctx, canvas, viewport }).promise;

  const dataUrl =
    quality.type === 'image/png'
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', quality.q);

  return { dataUrl, width: canvas.width, height: canvas.height, aspect: base.width / base.height };
}

export function renderPageForDisplay(doc, pageNumber) {
  return renderPage(doc, pageNumber, (w, h) => DISPLAY_LONG_EDGE / Math.max(w, h), { type: 'image/png' });
}

export function renderPageForAnalysis(doc, pageNumber) {
  return renderPage(doc, pageNumber, (w, h) => Math.sqrt(ANALYSIS_MEGAPIXELS / (w * h)), { type: 'image/png' });
}

// "data:image/png;base64,AAAA..." -> { mediaType, base64 }
export function splitDataUrl(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) throw new Error('Not a base64 data URL');
  return { mediaType: match[1], base64: match[2] };
}
