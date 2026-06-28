// Build a building-department letter as a real, assembled PDF:
//   page 1+ = the letter (serif, auto-paginated), then each attachment in order
//   (an image fills its own page; a reference PDF's pages are merged in).
// Shared letterhead / geometry / attachment logic lives in ./pdf-doc.js.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { longDateOnly, parseBodyBlocks, wrapText } from './doc-format.js';
import { PAGE, ML, MT, MB, CONTENT_W, INK, embedLogo, drawLetterhead, appendAttachments } from './pdf-doc.js';

export async function buildLetterPdf(data = {}) {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const logoImg = await embedLogo(doc, data.logo);

  let page = doc.addPage(PAGE);
  let y = PAGE[1] - MT;

  const newPage = () => { page = doc.addPage(PAGE); y = PAGE[1] - MT; };
  const need = (h) => { if (y - h < MB) newPage(); };
  const writeText = (text, { size = 11, x = ML, width = CONTENT_W, leading, center = false, color = INK } = {}) => {
    const lh = leading || size * 1.4;
    const measure = (s) => times.widthOfTextAtSize(s, size);
    for (const line of wrapText(text, width, measure)) {
      need(lh); y -= lh;
      let drawX = x;
      if (center) drawX = x + (width - measure(line)) / 2;
      if (line) page.drawText(line, { x: drawX, y, size, font: times, color });
    }
  };
  const gap = (h) => { need(h); y -= h; };

  // ── Letterhead ──
  drawLetterhead(page, { times, logoImg });
  y = PAGE[1] - 128; // content begins below the (compact) letterhead band

  // ── Date ──
  writeText(longDateOnly(data.date), { size: 11 });
  gap(18);

  // ── Building department (recipient) ──
  for (const ln of [data.deptName, data.deptStreet, data.deptCityStateZip]) {
    if (ln) writeText(ln, { size: 11 });
  }

  // breathing room between the recipient block and the reference/project lines
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
        const bulletY = y;
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

  // ── Attachments ──
  await appendAttachments(doc, data.attachments);

  return doc.save();
}
