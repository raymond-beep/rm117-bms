// Build a building-department letter as a real, assembled PDF (pdf-lib):
//   page 1+ = the letter (serif, auto-paginated), then each attachment in order
//   (an image fills its own page; a reference PDF's pages are merged in).
// Pure-ish: takes plain data + attachment bytes, returns PDF bytes. The browser
// preview renders these bytes in an <iframe>; "Download" saves them.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { longDateOnly, parseBodyBlocks, wrapText } from './doc-format.js';

const PAGE = [612, 792];        // US Letter, points
const ML = 72, MR = 72;          // left / right margins
const MT = 54, MB = 54;          // top / bottom margins
const CONTENT_W = PAGE[0] - ML - MR;
const INK = rgb(0, 0, 0);
const GREY = rgb(0.33, 0.33, 0.33);

export async function buildLetterPdf(data = {}) {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);

  // Real logo (trimmed PNG bytes from the caller) embeds once; falls back to a
  // vector mark if absent or unreadable.
  let logoImg = null;
  if (data.logo?.bytes) {
    try { logoImg = await doc.embedPng(data.logo.bytes); }
    catch (e) { console.error('[letter-pdf] logo embed failed:', e?.message || e); }
  }

  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MT;

  const newPage = () => { page = doc.addPage(PAGE); y = PAGE[1] - MT; };
  // Reserve vertical space; start a new page if this block won't fit.
  const need = (h) => { if (y - h < MB) newPage(); };

  // Draw wrapped text starting at the cursor; paginates as it goes.
  const writeText = (text, { size = 11, font = times, x = ML, width = CONTENT_W, leading, center = false, color = INK } = {}) => {
    const lh = leading || size * 1.4;
    const measure = (s) => font.widthOfTextAtSize(s, size);
    for (const line of wrapText(text, width, measure)) {
      need(lh);
      y -= lh;
      let drawX = x;
      if (center) drawX = x + (width - measure(line)) / 2;
      if (line) page.drawText(line, { x: drawX, y, size, font, color });
    }
  };
  const gap = (h) => { need(h); y -= h; };

  // ── Letterhead (logo mark + firm name on one line, address beneath) ──
  drawLetterhead(page, { times, logoImg });
  y = PAGE[1] - 128; // content begins below the (compact) letterhead band

  // ── Date ──
  writeText(longDateOnly(data.date), { size: 11 });
  gap(18);

  // ── Building department (recipient) ──
  for (const ln of [data.deptName, data.deptStreet, data.deptCityStateZip]) {
    if (ln) writeText(ln, { size: 11 });
  }

  // #4 — breathing room between the recipient block and the reference/project lines
  gap(18);

  if (data.reference) writeText(`Reference: ${data.reference}`, { size: 11 });
  if (data.projectAddress) { gap(4); writeText(data.projectAddress, { size: 11, center: true }); }

  gap(22);
  writeText('To Whom It May Concern,', { size: 11 });
  gap(14);

  // ── Body (bullets + paragraphs) ──
  for (const block of parseBodyBlocks(data.body)) {
    if (block.type === 'bullets') {
      for (const item of block.items) {
        gap(4);
        const bulletY = y; // remember row for the marker
        writeText(item, { size: 11, x: ML + 22, width: CONTENT_W - 22 });
        page.drawText('•', { x: ML + 8, y: bulletY - 11 * 1.4, size: 11, font: times, color: INK });
      }
    } else {
      gap(8);
      writeText(block.text, { size: 11 });
    }
  }

  // ── Closing + sign-off ──
  if (data.closing) { gap(16); writeText(data.closing, { size: 11 }); }
  gap(34);
  writeText('Sincerely,', { size: 11 });
  gap(40);
  writeText(data.signer || 'Thomas Dores, RA', { size: 11 });

  // ── Attachments (images + merged reference PDFs), each starts a new page ──
  for (const att of data.attachments || []) {
    if (!att?.bytes) continue;
    if (att.kind === 'pdf') {
      try {
        const src = await PDFDocument.load(att.bytes);
        const copied = await doc.copyPages(src, src.getPageIndices());
        copied.forEach((p) => doc.addPage(p));
      } catch (e) {
        console.error('[letter-pdf] could not merge reference PDF:', att.name, e?.message || e);
      }
    } else if (att.kind === 'image') {
      try {
        const img = att.mime?.includes('png') ? await doc.embedPng(att.bytes) : await doc.embedJpg(att.bytes);
        const ap = doc.addPage(PAGE);
        const maxW = PAGE[0] - 2 * MB, maxH = PAGE[1] - 2 * MB;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        ap.drawImage(img, { x: (PAGE[0] - w) / 2, y: (PAGE[1] - h) / 2, width: w, height: h });
      } catch (e) {
        console.error('[letter-pdf] could not embed image:', att.name, e?.message || e);
      }
    }
  }

  return doc.save();
}

// Centered letterhead: the RM117 mark + firm name on one line (vertically
// centered together), with the standard address/contact line beneath. Uses the
// embedded logo image when supplied, else a vector fallback.
function drawLetterhead(page, { times, logoImg }) {
  const firm = 'Room 117 Architecture + Design, LLC';
  const addr = '836 Galloping Hill Road | Roselle Park | NJ 07204 | T: 908.451.4633 | Email: tom@rm117.com';
  const firmSize = 10.5, addrSize = 8, gapLW = 8;
  const centerY = PAGE[1] - 56;            // vertical center of the mark/name line
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
