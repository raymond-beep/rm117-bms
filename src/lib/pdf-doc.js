// Shared PDF building blocks for RM117 documents (letters, proposals): page
// geometry, the letterhead, logo embedding, an attachment appender, and a
// cursor-based text writer with auto-pagination. Keeps every document's
// letterhead + layout consistent.
import { PDFDocument, rgb } from 'pdf-lib';
import { wrapText } from './doc-format.js';

export const PAGE = [612, 792];   // US Letter, points
export const ML = 72, MR = 72;     // left / right margins
export const MT = 54, MB = 54;     // top / bottom margins
export const CONTENT_W = PAGE[0] - ML - MR;
export const INK = rgb(0, 0, 0);
export const GREY = rgb(0.33, 0.33, 0.33);

// Embed the (trimmed) logo PNG once; null if absent/unreadable.
export async function embedLogo(doc, logo) {
  if (!logo?.bytes) return null;
  try { return await doc.embedPng(logo.bytes); }
  catch (e) { console.error('[pdf-doc] logo embed failed:', e?.message || e); return null; }
}

// Centered letterhead: RM117 mark + firm name on one line (vertically centered
// together), address/contact line beneath. Compact, house-style sizing.
export function drawLetterhead(page, { times, logoImg }) {
  const firm = 'Room 117 Architecture + Design, LLC';
  const addr = '836 Galloping Hill Road | Roselle Park | NJ 07204 | T: 908.451.4633 | Email: tom@rm117.com';
  const firmSize = 10.5, addrSize = 8, gapLW = 8;
  const centerY = PAGE[1] - 56;
  const targetH = logoImg ? 22 : 16;
  const logoW = logoImg ? (logoImg.width / logoImg.height) * targetH : 24;

  const firmW = times.widthOfTextAtSize(firm, firmSize);
  const groupW = logoW + gapLW + firmW;
  const startX = (PAGE[0] - groupW) / 2;

  if (logoImg) {
    page.drawImage(logoImg, { x: startX, y: centerY - targetH / 2, width: logoW, height: targetH });
  } else {
    const lx = startX, ly = centerY, t = 2.4;
    page.drawLine({ start: { x: lx, y: ly }, end: { x: lx + logoW / 2, y: ly + 12 }, thickness: t, color: INK });
    page.drawLine({ start: { x: lx + logoW / 2, y: ly + 12 }, end: { x: lx + logoW, y: ly }, thickness: t, color: INK });
    page.drawLine({ start: { x: lx, y: ly - 8 }, end: { x: lx + logoW / 2, y: ly + 4 }, thickness: t, color: INK });
    page.drawLine({ start: { x: lx + logoW / 2, y: ly + 4 }, end: { x: lx + logoW, y: ly - 8 }, thickness: t, color: INK });
  }

  page.drawText(firm, { x: startX + logoW + gapLW, y: centerY - firmSize * 0.34, size: firmSize, font: times, color: INK });
  const addrW = times.widthOfTextAtSize(addr, addrSize);
  page.drawText(addr, { x: (PAGE[0] - addrW) / 2, y: centerY - targetH / 2 - 13, size: addrSize, font: times, color: GREY });
}

// Append attachment pages in order: an image fills its own page; a reference
// PDF's pages are merged in. Never throws on a single bad attachment.
export async function appendAttachments(doc, attachments) {
  for (const att of attachments || []) {
    if (!att?.bytes) continue;
    if (att.kind === 'pdf') {
      try {
        const src = await PDFDocument.load(att.bytes);
        const copied = await doc.copyPages(src, src.getPageIndices());
        copied.forEach((p) => doc.addPage(p));
      } catch (e) { console.error('[pdf-doc] merge PDF failed:', att.name, e?.message || e); }
    } else if (att.kind === 'image') {
      try {
        const img = att.mime?.includes('png') ? await doc.embedPng(att.bytes) : await doc.embedJpg(att.bytes);
        const ap = doc.addPage(PAGE);
        const maxW = PAGE[0] - 2 * MB, maxH = PAGE[1] - 2 * MB;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        ap.drawImage(img, { x: (PAGE[0] - w) / 2, y: (PAGE[1] - h) / 2, width: w, height: h });
      } catch (e) { console.error('[pdf-doc] embed image failed:', att.name, e?.message || e); }
    }
  }
}

// Cursor-based writer over a document. Manages the current page + a baseline
// cursor (y), paginating as content is added. `decorate(page)` runs on every new
// page (e.g. a repeating letterhead + footer). `top` sets where content begins on
// every page (default just below the top margin; pass a lower value to clear a
// letterhead band). `fonts` = { regular, bold, italic }.
export function makeWriter(doc, { fonts, decorate, top, lineFactor = 1.4 } = {}) {
  const startY = top ?? (PAGE[1] - MT);
  let page = doc.addPage(PAGE);
  if (decorate) decorate(page);
  let y = startY;

  const newPage = () => { page = doc.addPage(PAGE); if (decorate) decorate(page); y = startY; };
  const need = (h) => { if (y - h < MB) newPage(); };

  const api = {
    get page() { return page; },
    get y() { return y; },
    set y(v) { y = v; },
    newPage,
    need,
    gap(h) { need(h); y -= h; },
    // Wrapped text from the cursor down. Returns the y of the first line's baseline.
    text(str, { size = 11, bold = false, italic = false, x = ML, width = CONTENT_W, indent = 0, leading, center = false, color = INK } = {}) {
      const font = bold ? fonts.bold : italic ? fonts.italic : fonts.regular;
      const lh = leading || size * lineFactor;
      const measure = (s) => font.widthOfTextAtSize(s, size);
      let firstY = null;
      for (const line of wrapText(str, width - indent, measure)) {
        need(lh); y -= lh;
        if (firstY === null) firstY = y;
        let dx = x + indent;
        if (center) dx = x + (width - measure(line)) / 2;
        if (line) page.drawText(line, { x: dx, y, size, font, color });
      }
      return firstY;
    },
    // Like text(), but the content is a list of inline segments, each with its
    // own style: { text, bold, italic, underline }. Words flow continuously and
    // wrap, so e.g. a bold "Title:" can lead a regular body on the same line.
    // Returns the y of the first line's baseline.
    richText(segments, { size = 11, x = ML, width = CONTENT_W, indent = 0, leading } = {}) {
      const lh = leading || size * lineFactor;
      const fontFor = (s) => (s.bold ? fonts.bold : s.italic ? fonts.italic : fonts.regular);
      // Split each segment into words (keeping the spaces) tagged with its style.
      const toks = [];
      for (const seg of segments) {
        const font = fontFor(seg);
        for (const part of String(seg.text).split(/(\s+)/)) {
          if (part.length) toks.push({ s: part, font, underline: seg.underline });
        }
      }
      const maxW = width - indent;
      let line = [], lineW = 0, firstY = null;
      const flush = () => {
        need(lh); y -= lh;
        if (firstY === null) firstY = y;
        let dx = x + indent;
        for (const t of line) {
          if (t.s.trim()) page.drawText(t.s, { x: dx, y, size, font: t.font, color: INK });
          const tw = t.font.widthOfTextAtSize(t.s, size);
          if (t.underline && t.s.trim()) {
            page.drawLine({ start: { x: dx, y: y - 1.5 }, end: { x: dx + tw, y: y - 1.5 }, thickness: 0.6, color: INK });
          }
          dx += tw;
        }
        line = []; lineW = 0;
      };
      for (const t of toks) {
        const tw = t.font.widthOfTextAtSize(t.s, size);
        if (lineW + tw > maxW && line.length) flush();
        if (!line.length && !t.s.trim()) continue; // drop leading space on a new line
        line.push(t); lineW += tw;
      }
      if (line.length) flush();
      return firstY;
    },
  };
  return api;
}
